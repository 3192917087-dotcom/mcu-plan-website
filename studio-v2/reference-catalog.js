import { REFERENCE_LIBRARY as WORKBOOK_LIBRARY, REFERENCE_LIBRARY_META as WORKBOOK_META } from './reference-library.js';
import { CNKI_REFERENCE_LIBRARY } from './reference-library-cnki.js';
import { CNKI_EXPANDED_REFERENCES } from './reference-library-cnki-expanded.js';

export const REFERENCE_LIBRARY = Object.freeze([...WORKBOOK_LIBRARY, ...CNKI_REFERENCE_LIBRARY, ...CNKI_EXPANDED_REFERENCES]);
export const REFERENCE_LIBRARY_META = Object.freeze({
  count: REFERENCE_LIBRARY.length,
  updatedAt: '2026-10-23',
  workbookCount: WORKBOOK_META.count,
  cnkiCount: CNKI_REFERENCE_LIBRARY.length + CNKI_EXPANDED_REFERENCES.length,
});

export function referencePublicationReady(record) {
  const citation = String(record.formatted || '');
  if (!record.authors || !record.title || !record.source || !record.year || !citation) return false;
  if (/期刊论文|\[J\]/i.test(record.type)) {
    const volume = record.volumeNotPublished ? '' : '[,，]\\s*\\d+';
    return new RegExp(`[,，]\\s*${record.year}\\s*${volume}\\s*\\([^)]+\\)\\s*[:：]\\s*[A-Za-z]?\\d+`, 'i').test(citation);
  }
  return /\[[A-Z]+(?:\/[A-Z]+)?\]/i.test(citation);
}
