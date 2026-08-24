import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const referencedIds = [...app.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]);
const htmlIds = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
const dynamicIds = new Set(['ack-ai-conflicts']);
const missing = [...new Set(referencedIds.filter(id => !htmlIds.includes(id) && !dynamicIds.has(id)))];
const duplicates = [...new Set(htmlIds.filter((id, index) => htmlIds.indexOf(id) !== index))];

if (missing.length || duplicates.length) {
  console.error(JSON.stringify({ missing, duplicates }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ referencedIds: new Set(referencedIds).size, htmlIds: htmlIds.length, missing, duplicates }));
}
