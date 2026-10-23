import { REFERENCE_LIBRARY } from '../reference-catalog.js';
import { writeFile } from 'node:fs/promises';

const outputArgument = process.argv.find(value => value.startsWith('--output='));
const issueCodes = process.argv.slice(2).filter(value => !value.startsWith('--'));
const articlePattern = /<a href="\/\/wap\.cnki\.net\/touch\/web\/Journal\/Article\/([A-Z0-9]+)\.html" class="c-catalog__item"[^>]*><div[^>]*>([^<]+)<\/div><\/a>/g;
const normalized = value => String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const existingTitles = new Set(REFERENCE_LIBRARY.map(item => normalized(item.title)));
const relevant = /单片机|微控制器|STM32|ESP32|ESP8266|Arduino|嵌入式|物联网.{0,12}(系统|监测|控制|采集|设备|平台)|(?:监测|控制|采集).{0,12}物联网/i;
const unrelated = /教学|课程|专业建设|综述|趋势|市场|政策|研究进展|大数据|区块链|网络安全|物联网架构分析/i;

async function getText(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(18000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}

function articleFromHtml(html) {
  const match = html.match(/<script type="application\/json" id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  const payload = JSON.parse(match[1]);
  const detail = payload[payload[payload[1].data].getArticleDetail];
  const info = payload[detail.info];
  const field = key => payload[info[key]];
  const authors = (field('author') || []).map(index => payload[index]).filter(Boolean);
  return {
    filename: field('fileName'),
    authors,
    title: field('title'),
    journal: field('publishName'),
    year: Number(field('year')),
    issue: String(field('period') || ''),
    pages: String(field('page') || ''),
    topics: String(field('keywordCN') || '').replaceAll(';;', ' '),
    sourceUrl: `https://wap.cnki.net/touch/web/Journal/Article/${field('fileName')}.html`,
  };
}

const candidates = new Map();
for (const issue of issueCodes) {
  let html;
  try {
    html = await getText(`https://wap.cnki.net/touch/web/Journal/List/${issue}.html`);
  } catch (error) {
    console.error(`${issue}: ${error.message}`);
    continue;
  }
  let total = 0;
  for (const match of html.matchAll(articlePattern)) {
    total++;
    if (relevant.test(match[2]) && !unrelated.test(match[2]) && !existingTitles.has(normalized(match[2]))) {
      candidates.set(match[1], match[2]);
    }
  }
  console.error(`${issue}: ${total} articles, ${candidates.size} relevant candidates so far`);
}

const records = [];
const filenames = [...candidates.keys()];
for (let start = 0; start < filenames.length; start += 5) {
  const batch = filenames.slice(start, start + 5);
  const results = await Promise.all(batch.map(async filename => {
    try {
      return articleFromHtml(await getText(`https://wap.cnki.net/touch/web/Journal/Article/${filename}.html`));
    } catch (error) {
      console.error(`${filename}: ${error.message}`);
      return null;
    }
  }));
  for (const record of results) {
    if (record && record.year >= 2022 && record.year <= 2026 && record.authors.length && record.pages && !existingTitles.has(normalized(record.title))) {
      records.push(record);
    }
  }
}

if (outputArgument) {
  await writeFile(outputArgument.slice('--output='.length), `${JSON.stringify(records, null, 2)}\n`);
} else {
  console.log(JSON.stringify(records, null, 2));
}
console.error(`Verified metadata: ${records.length} of ${candidates.size} candidates`);
