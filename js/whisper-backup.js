import {validateNotes} from './whisper-store.js';

export const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
const kind = 'xinwang-whispers-backup';

export function createBackup(notes, now = new Date()) {
  const result = JSON.stringify({kind, schemaVersion: 1, exportedAt: now.toISOString(), notes: validateNotes(notes)}, null, 2);
  if (new TextEncoder().encode(result).byteLength > MAX_BACKUP_BYTES) throw new Error('备份超过 2 MB，请分次整理记录后再试。');
  return result;
}

export function readBackup(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) {
    throw new Error('备份文件不能超过 2 MB。本次没有导入。');
  }
  try {
    const value = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (value?.kind !== kind || value.schemaVersion !== 1 || typeof value.exportedAt !== 'string' ||
        !Number.isFinite(Date.parse(value.exportedAt))) throw new Error();
    return {exportedAt: value.exportedAt, notes: validateNotes(value.notes)};
  } catch {
    throw new Error('这不是有效的心网心里话备份，或文件版本暂不支持。现有记录没有改变。');
  }
}
