import assert from 'node:assert/strict';
import { REFERENCE_LIBRARY as WORKBOOK_LIBRARY } from '../reference-library.js';
import { CNKI_REFERENCE_LIBRARY } from '../reference-library-cnki.js';
import { CNKI_EXPANDED_REFERENCES } from '../reference-library-cnki-expanded.js';
import { REFERENCE_LIBRARY, REFERENCE_LIBRARY_META, referencePublicationReady } from '../reference-catalog.js';
import { parseReferences, formatReferenceRecord } from '../../studio-next/rules.js';

const normalize = value => String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const originalTitles = new Set(WORKBOOK_LIBRARY.map(item => normalize(item.title)));
const originalDois = new Set(WORKBOOK_LIBRARY.map(item => normalize(item.identifier)).filter(Boolean));
const newTitles = new Set();
const newDois = new Set();

assert.equal(REFERENCE_LIBRARY_META.count, WORKBOOK_LIBRARY.length + CNKI_REFERENCE_LIBRARY.length + CNKI_EXPANDED_REFERENCES.length);
assert.equal(CNKI_REFERENCE_LIBRARY.length, 14);
assert.equal(CNKI_EXPANDED_REFERENCES.length, 100);

for (const item of [...CNKI_REFERENCE_LIBRARY, ...CNKI_EXPANDED_REFERENCES]) {
  const title = normalize(item.title);
  const doi = normalize(item.identifier);
  assert.ok(!originalTitles.has(title) && !newTitles.has(title), `duplicate title: ${item.title}`);
  if (doi) assert.ok(!originalDois.has(doi) && !newDois.has(doi), `duplicate DOI: ${item.identifier}`);
  newTitles.add(title);
  if (doi) newDois.add(doi);
  assert.ok(referencePublicationReady(item), `missing publication metadata: ${item.title}`);
  assert.match(item.url, /^https:\/\/(?:www\.cnki\.com\.cn\/Article\/CJFDTOTAL-|wap\.cnki\.net\/touch\/web\/Journal\/Article\/)/);
  const parsed = parseReferences([{
    id: item.id,
    authors: item.authors,
    title: item.title,
    documentType: 'J',
    source: item.source,
    year: item.year,
    volume: item.volume,
    issue: item.issue,
    pages: item.pages,
    volumeNotPublished: item.volumeNotPublished,
    formatted: item.formatted,
  }])[0];
  assert.equal(formatReferenceRecord(parsed), item.formatted);
  assert.ok(!item.formatted.includes('待补充'));
}

assert.equal(REFERENCE_LIBRARY.filter(item => item.id.startsWith('cnki-')).length, 114);
assert.ok(CNKI_EXPANDED_REFERENCES.every(item => item.year >= 2022 && item.year <= 2026));
console.log(`Reference catalog OK: ${REFERENCE_LIBRARY.length} total, ${CNKI_EXPANDED_REFERENCES.length} additional CNKI records`);
