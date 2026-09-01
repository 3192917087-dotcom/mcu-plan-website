const fs = require('node:fs');
const JSZip = require('jszip');

async function inspect(input) {
  try {
    const zip = await JSZip.loadAsync(fs.readFileSync(input));
    const stylesXml = await zip.file('word/styles.xml')?.async('string');
    if (!stylesXml) return null;
    const styles = [...stylesXml.matchAll(/<w:style\b([^>]*)w:styleId="([^"]+)"([^>]*)>([\s\S]*?)<\/w:style>/g)].map(match => ({
      id: match[2],
      name: match[4].match(/<w:name w:val="([^"]+)"\/>/)?.[1] || '',
      custom: /w:customStyle="(?:1|true)"/.test(`${match[1]} ${match[3]}`),
    }));
    const canonical = styles.filter(item => /^(?:normal|heading\s*[123]|caption|题注|正文|标题\s*[123])$/i.test(item.name));
    return canonical.length ? { input, canonical } : null;
  } catch {
    return null;
  }
}

async function main() {
  const results = (await Promise.all(process.argv.slice(2).map(inspect))).filter(Boolean);
  process.stdout.write(JSON.stringify(results, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
