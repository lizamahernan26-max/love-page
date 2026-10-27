// 心里话只在当前页面或当前浏览器中保存，不提供账号、同步或加密。
export const WHISPER_STORAGE_KEY = 'xinwang.whispers.v1';
export const MAX_WHISPER_LENGTH = 1000;
export const MAX_NOTES = 500;

export class WhisperError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WhisperError';
    this.code = code;
  }
}

function id() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function validateInput(text, audience) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new WhisperError('empty', '先写一点想说的话吧。');
  }
  if (text.length > MAX_WHISPER_LENGTH) {
    throw new WhisperError('length', `每条心里话最多 ${MAX_WHISPER_LENGTH} 个字符。`);
  }
  if (!['personal', 'shared'].includes(audience)) {
    throw new WhisperError('audience', '请选择“留给自己”或“想对你说”。');
  }
  return text.trim();
}

export function validateNotes(notes) {
  if (!Array.isArray(notes) || notes.length > MAX_NOTES) throw new Error('心里话记录数量不正确。');
  const ids = new Set();
  return notes.map(note => {
    if (!note || typeof note.id !== 'string' || !note.id || ids.has(note.id) ||
        typeof note.createdAt !== 'string' || !Number.isFinite(Date.parse(note.createdAt)) ||
        typeof note.updatedAt !== 'string' || !Number.isFinite(Date.parse(note.updatedAt)) ||
        Date.parse(note.updatedAt) < Date.parse(note.createdAt)) throw new Error();
    ids.add(note.id);
    const text = validateInput(note.text, note.audience);
    return {id: note.id, text, audience: note.audience, createdAt: note.createdAt, updatedAt: note.updatedAt};
  });
}

function parse(raw) {
  if (raw === null) return [];
  try {
    const data = JSON.parse(raw);
    if (data?.schemaVersion !== 1 || typeof data.revision !== 'string' || !data.revision) throw new Error();
    return validateNotes(data.notes);
  } catch {
    throw new WhisperError('corrupt', '浏览器里的心里话副本无法读取，已保留原数据。暂时只在本页记录，请勿将新内容误认为已保存。');
  }
}

function sameContent(first, second) {
  return first.text === second.text && first.audience === second.audience &&
    Date.parse(first.createdAt) === Date.parse(second.createdAt) && Date.parse(first.updatedAt) === Date.parse(second.updatedAt);
}

function mergeNotes(current, incoming) {
  const notes = current.map(note => ({...note}));
  const byId = new Map(notes.map(note => [note.id, note]));
  let added = 0, duplicates = 0, conflicts = 0;
  for (const note of validateNotes(incoming)) {
    const existing = byId.get(note.id);
    if (existing && (sameContent(existing, note) || notes.some(value => sameContent(value, note)))) {
      duplicates++;
      continue;
    }
    const copy = {...note};
    if (existing) {
      // 同一记录有不同版本时保留两份；重复导入同一备份不会继续复制。
      do { copy.id = id(); } while (byId.has(copy.id));
      conflicts++;
    }
    notes.push(copy);
    byId.set(copy.id, copy);
    added++;
  }
  if (notes.length > MAX_NOTES) throw new WhisperError('capacity', `合并后超过 ${MAX_NOTES} 条，本次没有导入。请先备份并整理现有记录。`);
  notes.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return {notes, added, duplicates, conflicts};
}

export class WhisperStore {
  constructor(storage) {
    this.storage = storage;
    this._notes = [];
    this._persistent = false;
    this._raw = null;
    this.storageIssue = null;
    try {
      this.reload();
    } catch (error) {
      this.storageIssue = error;
    }
  }

  get notes() { return this._notes.map(note => ({...note})); }
  get persistent() { return this._persistent; }

  readRaw() {
    try {
      if (!this.storage) throw new Error();
      return this.storage.getItem(WHISPER_STORAGE_KEY);
    } catch {
      throw new WhisperError('storage', '浏览器存储不可用。内容只能留在本页，刷新或关闭页面后会丢失。');
    }
  }

  reload() {
    const raw = this.readRaw();
    const notes = parse(raw);
    this._raw = raw;
    this._notes = notes;
    this._persistent = raw !== null;
    this.storageIssue = null;
  }

  assertUnchanged() {
    if (this.readRaw() !== this._raw) {
      throw new WhisperError('conflict', '另一页面修改了浏览器副本，本次没有覆盖。请先复制仍需保留的文字，再点“重新读取”。');
    }
  }

  persist(notes) {
    if (this.storageIssue) throw this.storageIssue;
    this.assertUnchanged();
    const raw = JSON.stringify({schemaVersion: 1, revision: id(), notes});
    try {
      this.storage.setItem(WHISPER_STORAGE_KEY, raw);
    } catch {
      throw new WhisperError('write', '浏览器保存失败，可能空间不足或被限制。本次修改未保存，请先复制文字保留。');
    }
    this._raw = raw;
  }

  setPersistent(enabled) {
    if (enabled === this._persistent) return;
    if (enabled) {
      this.persist(this._notes);
    } else {
      this.assertUnchanged();
      try {
        this.storage.removeItem(WHISPER_STORAGE_KEY);
      } catch {
        throw new WhisperError('write', '无法移除浏览器副本，原保存设置未改变。');
      }
      this._raw = null;
    }
    this._persistent = enabled;
  }

  commit(notes) {
    if (this._persistent) this.persist(notes);
    this._notes = notes;
  }

  previewImport(notes) {
    const {added, duplicates, conflicts} = mergeNotes(this._notes, notes);
    return {added, duplicates, conflicts, total: this._notes.length + added};
  }

  importNotes(notes) {
    const plan = mergeNotes(this._notes, notes);
    if (plan.added) this.commit(plan.notes);
    return {added: plan.added, duplicates: plan.duplicates, conflicts: plan.conflicts, total: this._notes.length};
  }

  add(text, audience) {
    text = validateInput(text, audience);
    if (this._notes.length >= MAX_NOTES) {
      throw new WhisperError('capacity', `最多保留 ${MAX_NOTES} 条，请整理后再写。`);
    }
    const timestamp = new Date().toISOString();
    const note = {id: id(), text, audience, createdAt: timestamp, updatedAt: timestamp};
    this.commit([note, ...this._notes]);
    return {...note};
  }

  update(noteId, text, audience) {
    text = validateInput(text, audience);
    if (!this._notes.some(note => note.id === noteId)) {
      throw new WhisperError('missing', '这条心里话已不存在，请重新选择。');
    }
    this.commit(this._notes.map(note => note.id === noteId ?
      {...note, text, audience, updatedAt: new Date(Math.max(Date.now(), Date.parse(note.updatedAt), Date.parse(note.createdAt))).toISOString()} : note));
  }

  remove(noteId) {
    if (!this._notes.some(note => note.id === noteId)) {
      throw new WhisperError('missing', '这条心里话已不存在，请重新选择。');
    }
    this.commit(this._notes.filter(note => note.id !== noteId));
  }
}
