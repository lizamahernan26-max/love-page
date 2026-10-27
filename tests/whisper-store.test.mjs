import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WhisperStore, WHISPER_STORAGE_KEY, MAX_WHISPER_LENGTH} from '../js/whisper-store.js';

function memoryStorage(initial = null) {
  const values = new Map(initial === null ? [] : [[WHISPER_STORAGE_KEY, initial]]);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); }
  };
}

test('default is page-only, and refreshing does not recover unconsented notes', () => {
  const storage = memoryStorage();
  const store = new WhisperStore(storage);
  store.add('今天也想你', 'personal');
  assert.equal(store.persistent, false);
  assert.equal(storage.getItem(WHISPER_STORAGE_KEY), null);
  assert.deepEqual(new WhisperStore(storage).notes, []);
});

test('opt-in persists and restores both intentions without claiming to send', () => {
  const storage = memoryStorage();
  const store = new WhisperStore(storage);
  store.add('留给自己', 'personal');
  const shared = store.add('想对你说', 'shared');
  store.setPersistent(true);
  const restored = new WhisperStore(storage);
  assert.equal(restored.persistent, true);
  assert.deepEqual(restored.notes, store.notes);
  assert.equal(restored.notes[0].audience, 'shared');
  assert.equal('sentAt' in shared, false);
});

test('edit preserves identity and creation time; removal is durable', () => {
  const storage = memoryStorage();
  const store = new WhisperStore(storage);
  store.setPersistent(true);
  const note = store.add('原文', 'personal');
  store.update(note.id, ' 修改后的话 ', 'shared');
  assert.equal(store.notes[0].text, '修改后的话');
  assert.equal(store.notes[0].createdAt, note.createdAt);
  assert.equal(store.notes[0].audience, 'shared');
  store.remove(note.id);
  assert.deepEqual(new WhisperStore(storage).notes, []);
});

test('opting out removes only this project key and retains page memory', () => {
  const storage = memoryStorage();
  storage.setItem('unrelated', 'keep');
  const store = new WhisperStore(storage);
  store.add('这页还在', 'personal');
  store.setPersistent(true);
  store.setPersistent(false);
  assert.equal(storage.getItem(WHISPER_STORAGE_KEY), null);
  assert.equal(storage.getItem('unrelated'), 'keep');
  assert.equal(store.notes[0].text, '这页还在');
  assert.equal(store.persistent, false);
});

test('empty, oversized and invalid audience inputs cannot change records', () => {
  const store = new WhisperStore(memoryStorage());
  assert.throws(() => store.add(' \n ', 'personal'), {code: 'empty'});
  assert.throws(() => store.add('字'.repeat(MAX_WHISPER_LENGTH + 1), 'personal'), {code: 'length'});
  assert.throws(() => store.add('内容', 'public'), {code: 'audience'});
  store.add('字'.repeat(MAX_WHISPER_LENGTH), 'personal');
  assert.equal(store.notes.length, 1);
});

test('broken JSON remains intact, and memory-only writing is available', () => {
  const storage = memoryStorage('{broken');
  const store = new WhisperStore(storage);
  assert.equal(store.storageIssue.code, 'corrupt');
  store.add('临时记下', 'personal');
  assert.throws(() => store.setPersistent(true), {code: 'corrupt'});
  assert.equal(storage.getItem(WHISPER_STORAGE_KEY), '{broken');
  assert.equal(store.persistent, false);
  assert.equal(store.notes.length, 1);
});

test('invalid persisted records and duplicates are rejected without overwriting', () => {
  const note = {id: 'same', text: '内容', audience: 'personal', createdAt: '2026-10-26T00:00:00Z', updatedAt: '2026-10-26T00:00:00Z'};
  for (const notes of [[{...note, audience: 'public'}], [{...note, text: ''}], [note, note], [{...note, updatedAt: 'yesterday'}]]) {
    const raw = JSON.stringify({schemaVersion: 1, revision: 'v1', notes});
    const storage = memoryStorage(raw);
    const store = new WhisperStore(storage);
    assert.equal(store.storageIssue.code, 'corrupt');
    assert.deepEqual(store.notes, []);
    assert.equal(storage.getItem(WHISPER_STORAGE_KEY), raw);
  }
});

test('quota failure never commits or announces a persistent mutation', () => {
  const storage = memoryStorage();
  const store = new WhisperStore(storage);
  store.setPersistent(true);
  const original = store.add('保留原文', 'personal');
  storage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => store.update(original.id, '不应覆盖', 'shared'), {code: 'write'});
  assert.equal(store.notes[0].text, '保留原文');
  assert.equal(new WhisperStore(storage).notes[0].text, '保留原文');
});

test('failed opt-in and opt-out preserve the correct persistence state', () => {
  const storage = memoryStorage();
  const store = new WhisperStore(storage);
  const setItem = storage.setItem;
  storage.setItem = () => { throw new Error(); };
  assert.throws(() => store.setPersistent(true), {code: 'write'});
  assert.equal(store.persistent, false);
  storage.setItem = setItem;
  store.setPersistent(true);
  storage.removeItem = () => { throw new Error(); };
  assert.throws(() => store.setPersistent(false), {code: 'write'});
  assert.equal(store.persistent, true);
});

test('another tab cannot be silently overwritten, including enabling or disabling persistence', () => {
  const storage = memoryStorage();
  const first = new WhisperStore(storage);
  const second = new WhisperStore(storage);
  first.setPersistent(true);
  first.add('第一页', 'personal');
  assert.throws(() => second.setPersistent(true), {code: 'conflict'});
  second.reload();
  first.add('第一页又写一条', 'shared');
  assert.throws(() => second.add('第二页', 'personal'), {code: 'conflict'});
  assert.throws(() => second.setPersistent(false), {code: 'conflict'});
  assert.equal(second.notes.length, 1);
  assert.equal(new WhisperStore(storage).notes.length, 2);
  second.reload();
  assert.equal(second.notes.length, 2);
});

test('denied storage remains usable in memory and never claims it persisted', () => {
  const store = new WhisperStore({getItem() { throw new Error('denied'); }});
  assert.equal(store.storageIssue.code, 'storage');
  store.add('<img src=x onerror=alert(1)>', 'personal');
  assert.equal(store.notes[0].text, '<img src=x onerror=alert(1)>');
  assert.throws(() => store.setPersistent(true), {code: 'storage'});
  assert.equal(store.persistent, false);
});

test('callers cannot mutate the store through returned objects', () => {
  const store = new WhisperStore(memoryStorage());
  const note = store.add('原来的文字', 'personal');
  note.text = '外部修改';
  store.notes[0].text = '另一次修改';
  assert.equal(store.notes[0].text, '原来的文字');
});

test('clock rollback cannot create a stored record that fails to reload', () => {
  const timestamp = '2099-01-01T00:00:00.000Z';
  const raw = JSON.stringify({schemaVersion:1, revision:'future-clock', notes:[{id:'rollback', text:'原文', audience:'personal', createdAt:timestamp, updatedAt:timestamp}]});
  const storage = memoryStorage(raw);
  const store = new WhisperStore(storage);
  store.update('rollback', '回拨后修改', 'personal');
  const restored = new WhisperStore(storage);
  assert.equal(restored.storageIssue, null);
  assert.equal(restored.notes[0].text, '回拨后修改');
  assert.equal(restored.notes[0].updatedAt, timestamp);
});
