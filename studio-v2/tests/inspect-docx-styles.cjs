const fs = require('node:fs');
const JSZip = require('jszip');

function decodeXml(value = '') {
  return String(value)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

async function main() {
  const input = process.argv[2];
  if (!input || !fs.existsSync(input)) throw new Error('请提供需要检查的DOCX路径');
  const zip = await JSZip.loadAsync(fs.readFileSync(input));
  const documentXml = await zip.file('word/document.xml').async('string');
  const stylesXml = await zip.file('word/styles.xml').async('string');
  const styleDefinitions = [...stylesXml.matchAll(/<w:style\b([^>]*)w:styleId="([^"]+)"([^>]*)>([\s\S]*?)<\/w:style>/g)].map(match => ({
    id: match[2],
    name: decodeXml(match[4].match(/<w:name w:val="([^"]+)"\/>/)?.[1] || ''),
    custom: /w:customStyle="(?:1|true)"/.test(`${match[1]} ${match[3]}`),
  }));
  const paragraphs = [...documentXml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map(match => {
    const body = match[1];
    return {
      style: body.match(/<w:pStyle w:val="([^"]+)"\/>/)?.[1] || '(none)',
      text: decodeXml([...body.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(item => item[1]).join('')),
      directParagraphFormat: /<w:(?:spacing|ind|jc)\b/.test(body.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/)?.[1] || ''),
      directRunFontOrSize: [...body.matchAll(/<w:rPr>([\s\S]*?)<\/w:rPr>/g)].some(item => /<w:(?:rFonts|sz|szCs)\b/.test(item[1])),
    };
  });
  const styleUsage = Object.entries(paragraphs.reduce((counts, item) => {
    counts[item.style] = (counts[item.style] || 0) + 1;
    return counts;
  }, {})).sort((left, right) => right[1] - left[1]);
  const required = ['1', '2', '3', '4', '5'].map(id => ({
    id,
    definitions: styleDefinitions.filter(item => item.id === id),
    paragraphs: paragraphs.filter(item => item.style === id).length,
    directParagraphFormats: paragraphs.filter(item => item.style === id && item.directParagraphFormat).length,
    directRunFontOrSize: paragraphs.filter(item => item.style === id && item.directRunFontOrSize).length,
  }));
  const usedStyleDefinitions = styleUsage.map(([id, count]) => ({ id, count, definition: styleDefinitions.find(item => item.id === id) || null }));
  const canonicalStyleDefinitions = styleDefinitions.filter(item => /normal|heading\s*[123]|caption|body text|正文|标题\s*[123]|题注/i.test(item.name));
  const numericStyleDefinitions = styleDefinitions.filter(item => /^\d+$/.test(item.id)).slice(0, 30);
  process.stdout.write(JSON.stringify({ input, required, styleUsage, usedStyleDefinitions, canonicalStyleDefinitions, numericStyleDefinitions, samples: paragraphs.filter(item => ['1', '2', '3', '4', '5'].includes(item.style)).slice(0, 18).map(item => ({ style: item.style, text: item.text.slice(0, 100) })) }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
