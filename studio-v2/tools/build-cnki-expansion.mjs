import { readFile, writeFile } from 'node:fs/promises';

const output = process.argv.find(arg => arg.startsWith('--output='))?.slice('--output='.length);
const inputs = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
if (!output || inputs.length < 2) throw new Error('Provide --output=<path> and the collected candidate JSON files');

const candidates = (await Promise.all(inputs.map(async path => JSON.parse(await readFile(path, 'utf8'))))).flat();
const byFilename = new Map(candidates.map(item => [item.filename, item]));
const allCandidates = [...byFilename.values()];
const mcuTitle = /STM32|STM8|ESP32|ESP8266|Arduino|单片机|微控制器|STC89|K210|Hi3861/i;
const topicScore = title => {
  let score = 0;
  if (/家居|农业|环境|健康|老人|宠物|消防|安防|小车|鱼塘|门锁|照明|垃圾|温室|灌溉|火灾|停车|空气|饮水|水质|温湿度|大棚/.test(title)) score += 4;
  if (/系统|装置|检测|监测|控制|报警|设计与实现/.test(title)) score += 2;
  if (/电力|变电|氢燃料|矿井|高压|PCIe|机场|工业|通信协议/.test(title)) score -= 3;
  return score;
};
const selected = [];
const yearQuotas = { 2022: 10, 2023: 10, 2024: 8, 2025: 40, 2026: 3 };
for (const [year, quota] of Object.entries(yearQuotas)) {
  const choices = allCandidates.filter(item => item.filename.startsWith('WLWJ') && item.year === Number(year) && mcuTitle.test(item.title))
    .sort((left, right) => topicScore(right.title) - topicScore(left.title) || left.filename.localeCompare(right.filename));
  if (choices.length < quota) throw new Error(`Insufficient WLWJ records for ${year}: ${choices.length}`);
  selected.push(...choices.slice(0, quota));
}
selected.push(...allCandidates.filter(item => item.filename.startsWith('GYKJ2025') && mcuTitle.test(item.title)));
for (const filename of [
  'DZJS202507007',
  'GYKJ202601041',
  'GYKJ202601043',
  'GYKJ202601060',
  'GYKJ202601061',
]) {
  const item = byFilename.get(filename);
  if (!item) throw new Error(`Missing selected source: ${filename}`);
  selected.push(item);
}
if (selected.length !== 100 || new Set(selected.map(item => item.filename)).size !== 100) {
  throw new Error(`Expected 100 unique records, got ${selected.length}`);
}

const pageOffsets = { WLWJ: 4, DZJS: 12, GYKJ: 3 };
const volumeBaseYear = { WLWJ: 2010, DZJS: 1971, GYKJ: 1987 };
function direction(title) {
  if (/农业|大棚|温室|养殖|鱼塘|灌溉|水质|农药|植/.test(title)) return '智慧农业与环境监测';
  if (/家居|门锁|照明|空调|开窗|饮水|宠物/.test(title)) return '智能家居与物联网';
  if (/医疗|健康|心率|老人|助眠|手语|中暑/.test(title)) return '健康监测与辅助设备';
  if (/小车|机器人|机械臂|巡检|停车|交通/.test(title)) return '智能控制与移动设备';
  if (/消防|报警|安防|火灾|防盗|泄漏/.test(title)) return '安全监测与预警';
  return '单片机与物联网应用';
}

const records = selected.map(item => {
  const journalCode = item.filename.slice(0, 4);
  if (journalCode === 'DZJS' && !item.filename.startsWith('DZJS202507')) {
    throw new Error(`Uncalibrated journal issue: ${item.filename}`);
  }
  const offset = pageOffsets[journalCode];
  if (!offset || !volumeBaseYear[journalCode]) throw new Error(`Unknown journal: ${journalCode}`);
  const pages = item.pages.replace(/\d+/g, value => {
    const page = Number(value) - offset;
    if (page < 1) throw new Error(`Invalid print page: ${item.filename}`);
    return String(page);
  });
  const volume = String(item.year - volumeBaseYear[journalCode]);
  const citedAuthors = item.authors.length > 3 ? `${item.authors.slice(0, 3).join(', ')}, 等` : item.authors.join(', ');
  return {
    filename: item.filename,
    authors: item.authors,
    title: item.title,
    journal: item.journal,
    year: item.year,
    volume,
    issue: item.issue,
    pages,
    direction: direction(item.title),
    topics: item.topics,
    formatted: `${citedAuthors}. ${item.title}[J]. ${item.journal}, ${item.year}, ${volume}(${item.issue}): ${pages}.`,
  };
});

records.sort((left, right) => right.year - left.year || left.filename.localeCompare(right.filename));
const source = `// Source: CNKI mobile journal records, checked 2026-10-23.\n` +
  `// Page numbers use print pagination; verified offsets are WLWJ -4, DZJS -12, GYKJ -3.\n` +
  `const records = ${JSON.stringify(records, null, 2)};\n\n` +
  `export const CNKI_EXPANDED_REFERENCES = Object.freeze(records.map(item => Object.freeze({\n` +
  `  id: \`cnki-\${item.filename.toLowerCase()}\`,\n` +
  `  type: '期刊论文[J]',\n` +
  `  direction: item.direction,\n` +
  `  language: '中文',\n` +
  `  year: item.year,\n` +
  `  authors: item.authors.join(', '),\n` +
  `  title: item.title,\n` +
  `  source: item.journal,\n` +
  `  publication: \`\${item.year}, \${item.volume}(\${item.issue}): \${item.pages}\`,\n` +
  `  volume: item.volume,\n` +
  `  issue: item.issue,\n` +
  `  pages: item.pages,\n` +
  `  identifier: '',\n` +
  `  formatted: item.formatted,\n` +
  `  url: \`https://wap.cnki.net/touch/web/Journal/Article/\${item.filename}.html\`,\n` +
  `  verification: '手机知网题录核验，纸刊页码校正，2026-10-23',\n` +
  `  citationCount: 0,\n` +
  `  topics: item.topics,\n` +
  `})));\n`;

await writeFile(output, source);
console.log(`Wrote ${records.length} verified CNKI references to ${output}`);
