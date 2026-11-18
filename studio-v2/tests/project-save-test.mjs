import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../app.js', import.meta.url), 'utf8');
const start = source.indexOf('async function persistProject(');
const end = source.indexOf('function updateSaveStatus', start);
const writes = [], statuses = [];
let completeFirst;
const a = { id: 'a', title: 'A', updatedAt: '', storageRevision: '' };
const b = { id: 'b', title: 'B', updatedAt: '', storageRevision: '' };
const ctx = vm.createContext({
  project: a, projects: [a, b], saveRevision: 0, saveTimer: null,
  saveQueue: Promise.resolve(), savedProjectSnapshots: new WeakMap(),
  clone: structuredClone, clearTimeout, setTimeout,
  updateSaveStatus: status => statuses.push(status), toast: () => {},
  Store: { saveProject: async snapshot => {
    writes.push(snapshot);
    if (writes.length === 1) await new Promise(resolve => { completeFirst = resolve; });
    return { ...snapshot, storageRevision: String(writes.length), updatedAt: String(writes.length) };
  } },
});
vm.runInContext(source.slice(start, end), ctx);

// A queued save retains the originating project, even before its callback runs.
const first = vm.runInContext('persistProject({immediate:true})', ctx);
ctx.project = b;
await new Promise(resolve => setImmediate(resolve));
assert.equal(writes[0].id, 'a');
a.title = 'A edited while saving';
const second = vm.runInContext('persistProject({immediate:true})', ctx);
completeFirst();
await Promise.all([first, second]);
assert.deepEqual(writes.map(snapshot => snapshot.id), ['a', 'b']);
assert.equal(a.storageRevision, '1');
assert.equal(b.storageRevision, '2');

// Repeated focus/visibility flushes without edits do not invalidate other tabs.
await vm.runInContext('persistProject({immediate:true})', ctx);
assert.equal(writes.length, 2);

// Edits made while a snapshot was saving are still pending on the next flush.
ctx.project = a;
await vm.runInContext('persistProject({immediate:true})', ctx);
assert.equal(writes.length, 3);
assert.equal(writes[2].title, 'A edited while saving');
assert.equal(writes[2].storageRevision, '1');
assert.equal(statuses.at(-1), 'saved');
console.log(JSON.stringify({status:'passed', checks:3, paidApiCalls:0}));
