# Local reference-outline OCR

Used only when the user imports directory images, scanned PDFs, or Word documents containing screenshots. Loaded on demand; ordinary thesis generation does not load these assets. Runtime, worker, WASM and Chinese/English language data are served from this directory, so no public CDN is needed in the user's browser.

- `tesseract.js` 5.1.1: browser bundle and worker, from the official npm package.
- `tesseract.js-core` 5.1.1: portable LSTM WASM core, from the official npm package.
- `@tesseract.js-data/chi_sim` 1.0.0 and `@tesseract.js-data/eng` 1.0.0: `4.0.0_best_int` language data, from the official npm packages.
- All four downloaded archives were checked against their npm SHA-512 integrity values before extraction. Apache-2.0 license and bundled notices are included.

OCR extracts text locally. Only the extracted reference text is sent to the user's configured AI for interpretation; neither source images nor credentials are saved in this directory. OCR can misread unclear screenshots, so the text and interpreted requirements remain visible for correction. The AI cannot treat extraction failures as an empty reference and silently use the default outline.
