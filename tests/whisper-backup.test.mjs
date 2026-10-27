import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WhisperStore, WHISPER_STORAGE_KEY, MAX_NOTES} from '../js/whisper-store.js';
import {createBackup, readBackup, MAX_BACKUP_BYTES} from '../js/whisper-backup.js';

const timestamp = '2026-10-27T00:00:00.000Z';
const note = (id = 'first', text = '保留下来的话') => ({id, text, audience: 'personal', createdAt: timestamp, updatedAt: timestamp});
function storage() {
  const values = new Map();
  return {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
}

test('backup round-trip preserves text, intentions and timestamps, excluding unrelated fields', () => {
  const notes = [note(), {...note('second', '<img src=x>\n换行也保留'), audience: 'shared', extra: 'excluded'}];
  const raw = createBackup(notes, new Date(timestamp));
  const result = readBackup('\uFEFF' + raw);
  assert.equal(result.exportedAt, timestamp);
  assert.deepEqual(result.notes, notes.map(({extra, ...value}) => value));
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['exportedAt', 'kind', 'notes', 'schemaVersion']);
});

test('invalid schema, content, duplicate IDs and damaged files cannot be imported', () => {
  const valid = JSON.parse(createBackup([note()]));
  for (const value of [null, {}, {...valid, schemaVersion: 2}, {...valid, kind: 'other'}, {...valid, exportedAt: 'bad'},
    {...valid, notes: [note(), note()]}, {...valid, notes: [{...note(), text: ''}]},
    {...valid, notes: [{...note(), audience: 'public'}]}, {...valid, notes: [{...note(), updatedAt: 'yesterday'}]},
    {...valid, notes: [{...note(), updatedAt: '2020-01-01'}]}]) {
    assert.throws(() => readBackup(JSON.stringify(value)), /有效的心网/);
  }
  assert.throws(() => readBackup('{broken'), /有效的心网/);
  assert.throws(() => readBackup(' '.repeat(MAX_BACKUP_BYTES + 1)), /2 MB/);
});

test('preview does not mutate; merging is additive and does not enable storage', () => {
  const backing = storage(), store = new WhisperStore(backing);
  const original = store.add('原记录', 'personal');
  const before = store.notes;
  assert.deepEqual(store.previewImport([note()]), {added: 1, duplicates: 0, conflicts: 0, total: 2});
  assert.deepEqual(store.notes, before);
  store.importNotes([note()]);
  assert(store.notes.some(value => value.id === original.id));
  assert.equal(store.persistent, false);
  assert.equal(backing.getItem(WHISPER_STORAGE_KEY), null);
});

test('same record with changed content keeps both versions, repeated import is idempotent', () => {
  const store = new WhisperStore(storage());
  store.importNotes([note()]);
  const changed = {...note('first', '另一设备修改的版本'), updatedAt: '2026-10-27T01:00:00.000Z'};
  assert.deepEqual(store.importNotes([changed]), {added: 1, duplicates: 0, conflicts: 1, total: 2});
  assert.deepEqual(store.importNotes([changed, note('third')]), {added: 1, duplicates: 1, conflicts: 0, total: 3});
  assert.equal(store.notes.find(value => value.id === 'first').text, '保留下来的话');
  assert.equal(new Set(store.notes.map(value => value.id)).size, 3);
});

test('capacity and malformed record failures are atomic', () => {
  const store = new WhisperStore(storage());
  const many = Array.from({length: MAX_NOTES}, (_, i) => note(`n${i}`));
  store.importNotes(many);
  const before = store.notes;
  assert.throws(() => store.importNotes([note()]), {code: 'capacity'});
  assert.throws(() => store.importNotes([note(), {...note('bad'), text: ''}]));
  assert.deepEqual(store.notes, before);
  assert.equal(store.importNotes(many).duplicates, MAX_NOTES);
});

test('quota failure during import retains all original memory and storage', () => {
  const backing = storage(), store = new WhisperStore(backing);
  store.add('已有内容', 'personal');
  store.setPersistent(true);
  const before = store.notes, raw = backing.getItem(WHISPER_STORAGE_KEY);
  backing.setItem = () => { throw new Error('quota'); };
  assert.throws(() => store.importNotes([note()]), {code: 'write'});
  assert.deepEqual(store.notes, before);
  assert.equal(backing.getItem(WHISPER_STORAGE_KEY), raw);
});

test('another tab changing storage after preview prevents stale import', () => {
  const backing = storage(), first = new WhisperStore(backing);
  first.setPersistent(true);
  const second = new WhisperStore(backing);
  second.previewImport([note()]);
  first.add('另一个标签页留下的话', 'personal');
  assert.throws(() => second.importNotes([note()]), {code: 'conflict'});
  assert.deepEqual(second.notes, []);
  assert.equal(new WhisperStore(backing).notes.length, 1);
});

test('import stays in memory with unavailable or corrupt storage and never replaces the damaged copy', () => {
  const backing = storage();
  backing.setItem(WHISPER_STORAGE_KEY, '{broken');
  for (const source of [backing, {getItem() { throw new Error('denied'); }}]) {
    const store = new WhisperStore(source);
    store.importNotes([note()]);
    assert.equal(store.notes.length, 1);
    assert.equal(store.persistent, false);
    assert.throws(() => store.setPersistent(true));
  }
  assert.equal(backing.getItem(WHISPER_STORAGE_KEY), '{broken');
});
