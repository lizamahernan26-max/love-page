import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {defaults, validateSettings} from '../js/config.js';
import {validateNotes} from '../js/whisper-store.js';
import {digest, fail, randomToken} from './security.mjs';

const SESSION_MS = 14 * 86400000;
const INVITE_MS = 24 * 3600000;
export class Database {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), {recursive: true, mode: 0o700});
    this.db = new DatabaseSync(path, {timeout: 5000, enableForeignKeyConstraints: true});
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 2) throw new Error('数据库版本比当前程序更新，请先升级程序。');
    if (!version) this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE users (
        id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE couples (
        id TEXT PRIMARY KEY, first_user TEXT NOT NULL REFERENCES users(id), second_user TEXT NOT NULL REFERENCES users(id),
        name_one TEXT NOT NULL, name_two TEXT NOT NULL, anniversary TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, ended_at INTEGER,
        CHECK(first_user != second_user)
      ) STRICT;
      CREATE TABLE invites (
        token_hash TEXT PRIMARY KEY, owner_id TEXT UNIQUE NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX sessions_user ON sessions(user_id);
      CREATE TABLE notes (
        id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(id), text TEXT NOT NULL,
        audience TEXT NOT NULL CHECK(audience IN ('personal','shared')), couple_id TEXT REFERENCES couples(id),
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1,
        request_id TEXT NOT NULL, UNIQUE(author_id, request_id), CHECK(audience != 'shared' OR couple_id IS NOT NULL)
      ) STRICT;
      CREATE INDEX notes_author ON notes(author_id);
      CREATE INDEX notes_couple ON notes(couple_id, audience);
      CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL) STRICT;
      PRAGMA user_version=1;
      COMMIT;
    `);
    if (version < 2) this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE device_users (user_id TEXT PRIMARY KEY REFERENCES users(id), recovery_hash TEXT UNIQUE NOT NULL) STRICT;
      PRAGMA user_version=2; COMMIT;`);
  }
  close() { this.db.close(); }
  one(sql, ...args) { return this.db.prepare(sql).get(...args); }
  all(sql, ...args) { return this.db.prepare(sql).all(...args); }
  run(sql, ...args) { return this.db.prepare(sql).run(...args); }
  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = action(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  countUsers() { return this.one('SELECT count(*) AS count FROM users').count; }
  publicUser(user) { return {id: user.id, username: user.username, displayName: user.display_name, passwordless: Boolean(user.passwordless)}; }
  activeCouple(userId) {
    return this.one('SELECT * FROM couples WHERE ended_at IS NULL AND (first_user=? OR second_user=?)', userId, userId);
  }
  pairInfo(userId) {
    const couple = this.activeCouple(userId);
    if (!couple) return null;
    const partner = this.one('SELECT id,display_name FROM users WHERE id=?', couple.first_user === userId ? couple.second_user : couple.first_user);
    return {id: couple.id, partner: {id: partner.id, displayName: partner.display_name}, profile: {
      nameOne: couple.name_one, nameTwo: couple.name_two, anniversary: couple.anniversary, version: couple.version
    }};
  }
  validInvite(code, now = Date.now()) {
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code)) fail(400, 'invite', '邀请码无效或已过期。');
    const invite = this.one('SELECT * FROM invites WHERE token_hash=? AND expires_at>?', digest(code), now);
    if (!invite || this.activeCouple(invite.owner_id)) fail(400, 'invite', '邀请码无效或已过期。');
    return invite;
  }
  register(account, passwordHash, inviteCode, allowFirst) {
    return this.transaction(() => {
      const count = this.countUsers();
      if (count >= 2) fail(403, 'closed', '这是两人专用空间，两个账号已建立。请登录已有账号。');
      if (this.one('SELECT id FROM users WHERE username=?', account.username)) fail(409, 'username', '这个账号已使用，请换一个。');
      const invite = count ? this.validInvite(inviteCode) : null;
      if (!count && !allowFirst) fail(403, 'setup', '请由站点维护者在本机初始化，或提供部署时设置的初始化密钥。');
      const userId = randomUUID(), now = Date.now();
      this.run('INSERT INTO users VALUES (?,?,?,?,?)', userId, account.username, account.displayName, passwordHash, now);
      if (invite) this.createPair(invite.owner_id, userId, now);
      return this.one('SELECT * FROM users WHERE id=?', userId);
    });
  }
  createPair(first, second, now = Date.now()) {
    if (first === second || this.activeCouple(first) || this.activeCouple(second)) fail(409, 'paired', '其中一方已经绑定，请先确认当前关系。');
    this.run('INSERT INTO couples (id,first_user,second_user,name_one,name_two,anniversary,created_at) VALUES (?,?,?,?,?,?,?)',
      randomUUID(), first, second, defaults.nameOne, defaults.nameTwo, defaults.anniversary, now);
    this.run('DELETE FROM invites WHERE owner_id IN (?,?)', first, second);
  }
  createInvite(userId) {
    if (this.activeCouple(userId)) fail(409, 'paired', '已绑定对方，无需再生成邀请码。');
    const token = randomToken(), expiresAt = Date.now() + INVITE_MS;
    this.run('INSERT INTO invites VALUES (?,?,?) ON CONFLICT(owner_id) DO UPDATE SET token_hash=excluded.token_hash, expires_at=excluded.expires_at', digest(token), userId, expiresAt);
    return {code: token, expiresAt: new Date(expiresAt).toISOString()};
  }
  join(userId, code) {
    this.transaction(() => {
      const invite = this.validInvite(code);
      this.createPair(invite.owner_id, userId);
    });
  }
  leave(userId, expectedCoupleId) {
    this.transaction(() => {
      const couple = this.activeCouple(userId);
      if (!couple) fail(409, 'unpaired', '当前没有绑定关系。');
      if (couple.id !== expectedCoupleId) fail(409, 'conflict', '绑定关系已变化，请刷新后重新确认。');
      this.run('UPDATE couples SET ended_at=?,version=version+1 WHERE id=?', Date.now(), couple.id);
      this.run('DELETE FROM invites WHERE owner_id IN (?,?)', couple.first_user, couple.second_user);
    });
  }
  newSession(userId) {
    const now = Date.now(), token = randomToken(), csrf = randomToken();
    const duration = this.one('SELECT user_id FROM device_users WHERE user_id=?', userId) ? 90 * 86400000 : SESSION_MS;
    this.run('DELETE FROM sessions WHERE expires_at<=?', now);
    const existing = this.all('SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC', userId);
    for (const session of existing.slice(7)) this.run('DELETE FROM sessions WHERE token_hash=?', session.token_hash);
    this.run('INSERT INTO sessions VALUES (?,?,?,?,?)', digest(token), userId, csrf, now, now + duration);
    return {token, csrf, maxAge: duration / 1000};
  }
  session(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return this.one('SELECT s.token_hash,s.csrf,s.expires_at,u.*,EXISTS(SELECT 1 FROM device_users d WHERE d.user_id=u.id) AS passwordless FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?', digest(token), Date.now()) || null;
  }
  redeemDeviceInvite(code) {
    return this.transaction(() => {
      const invite = this.validInvite(code);
      if (this.countUsers() !== 1) fail(409, 'closed', '双人身份已建立。请使用自己的恢复码进入。');
      const userId = randomUUID(), recoveryCode = randomToken();
      this.run('INSERT INTO users VALUES (?,?,?,?,?)', userId, 'guest_' + randomUUID().replaceAll('-', '').slice(0, 12), defaults.nameTwo, 'device-only', Date.now());
      this.run('INSERT INTO device_users VALUES (?,?)', userId, digest(recoveryCode));
      this.createPair(invite.owner_id, userId);
      return {...this.newSession(userId), recoveryCode};
    });
  }
  recoverDevice(code) {
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code)) fail(401, 'recovery', '恢复码无效，请检查。');
    return this.transaction(() => {
      const device = this.one('SELECT user_id FROM device_users WHERE recovery_hash=?', digest(code));
      if (!device) fail(401, 'recovery', '恢复码无效或已使用。');
      const recoveryCode = randomToken();
      this.run('UPDATE device_users SET recovery_hash=? WHERE user_id=?', digest(recoveryCode), device.user_id);
      this.run('DELETE FROM sessions WHERE user_id=?', device.user_id);
      return {...this.newSession(device.user_id), recoveryCode};
    });
  }
  rotateRecovery(userId) {
    return this.transaction(() => {
      if (!this.one('SELECT user_id FROM device_users WHERE user_id=?', userId)) fail(403, 'device', '此身份不使用设备恢复码。');
      const recoveryCode = randomToken();
      this.run('UPDATE device_users SET recovery_hash=? WHERE user_id=?', digest(recoveryCode), userId);
      return {recoveryCode};
    });
  }
  renewDeviceSession(token) {
    const user = this.session(token), now = Date.now();
    if (!user?.passwordless || user.expires_at > now + 60 * 86400000) return null;
    const duration = 90 * 86400000;
    return this.run('UPDATE sessions SET expires_at=? WHERE token_hash=? AND expires_at>?', now + duration, digest(token), now).changes ? duration / 1000 : null;
  }
  changePassword(userId, expectedHash, nextHash) {
    this.transaction(() => {
      if (this.one('SELECT password_hash FROM users WHERE id=?', userId)?.password_hash !== expectedHash) fail(409, 'conflict', '密码已在另一设备修改，请重新登录。');
      this.run('UPDATE users SET password_hash=? WHERE id=?', nextHash, userId);
      this.run('DELETE FROM sessions WHERE user_id=?', userId);
    });
  }
  rateLimit(key, maximum, windowMs = 15 * 60000) {
    const now = Date.now(), safeKey = digest(key);
    this.run('DELETE FROM rate_limits WHERE expires_at<=?', now);
    const result = this.run('INSERT INTO rate_limits VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<?', safeKey, 1, now + windowMs, maximum);
    if (!result.changes) fail(429, 'rate', '尝试次数较多，请稍后再试。');
  }
  visibleNotes(userId) {
    const couple = this.activeCouple(userId);
    return this.all(`SELECT n.*,u.display_name FROM notes n JOIN users u ON n.author_id=u.id
      WHERE n.author_id=? OR (n.audience='shared' AND n.couple_id=?) ORDER BY n.updated_at DESC,n.id`, userId, couple?.id ?? '').map(note => ({
      id: note.id, text: note.text, audience: note.audience, authorId: note.author_id,
      authorName: note.display_name, own: note.author_id === userId,
      sharedWithPartner: note.audience === 'shared' && note.couple_id === couple?.id,
      createdAt: new Date(note.created_at).toISOString(), updatedAt: new Date(note.updated_at).toISOString(), version: note.version
    }));
  }
  ownNote(userId, noteId) {
    const note = this.one('SELECT * FROM notes WHERE id=? AND author_id=?', noteId, userId);
    if (!note) fail(404, 'missing', '这条记录不存在，或你没有操作权限。');
    return note;
  }
  validateNote(text, audience) {
    if (typeof text !== 'string' || !text.trim() || text.length > 1000) fail(400, 'text', '心里话需要 1—1,000 个字符。');
    if (!['personal','shared'].includes(audience)) fail(400, 'audience', '请选择仅自己可见或两人共享。');
    return text.trim();
  }
  saveNote(userId, value, noteId) {
    const text = this.validateNote(value.text, value.audience);
    return this.transaction(() => {
      const existing = noteId ? this.ownNote(userId, noteId) : null;
      if (existing && (!Number.isSafeInteger(value.version) || value.version !== existing.version)) fail(409, 'conflict', '记录已在其他设备修改。本次没有覆盖，请先保留草稿再刷新记录。');
      const couple = this.activeCouple(userId);
      if (value.audience === 'shared' && !couple) fail(409, 'unpaired', '先绑定对方，才能发布两人共享的心里话。');
      if (value.audience === 'shared' && value.expectedCoupleId !== couple.id) fail(409, 'conflict', '绑定关系已变化，本次没有发布，请刷新后重新确认。');
      if (!existing) {
        if (typeof value.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(value.requestId)) fail(400, 'requestId', '请求编号无效，请刷新后重试。');
        const repeated = this.one('SELECT * FROM notes WHERE author_id=? AND request_id=?', userId, value.requestId);
        if (repeated) {
          if (repeated.text !== text || repeated.audience !== value.audience) fail(409, 'conflict', '这个请求已处理，请刷新后重试。');
          return repeated.id;
        }
        if (this.one('SELECT count(*) AS count FROM notes WHERE author_id=?', userId).count >= 500) fail(409, 'capacity', '每个账号最多保留 500 条记录，请先备份和整理。');
      }
      const id = existing?.id ?? randomUUID();
      const now = Math.max(Date.now(), existing?.updated_at ?? 0);
      if (existing) this.run('UPDATE notes SET text=?,audience=?,couple_id=?,updated_at=?,version=version+1 WHERE id=? AND author_id=?', text, value.audience, value.audience === 'shared' ? couple.id : null, now, id, userId);
      else this.run('INSERT INTO notes (id,author_id,text,audience,couple_id,created_at,updated_at,request_id) VALUES (?,?,?,?,?,?,?,?)', id, userId, text, value.audience, value.audience === 'shared' ? couple.id : null, now, now, value.requestId);
      return id;
    });
  }
  deleteNote(userId, noteId, version) {
    const note = this.ownNote(userId, noteId);
    if (note.version !== version) fail(409, 'conflict', '记录已在其他设备修改，请刷新后再决定是否删除。');
    if (!this.run('DELETE FROM notes WHERE id=? AND author_id=? AND version=?', noteId, userId, version).changes) fail(409, 'conflict', '记录已变化，请刷新后再决定是否删除。');
  }
  importPrivate(userId, input) {
    let notes;
    try { notes = validateNotes(input); }
    catch { fail(400, 'backup', '备份记录格式无效，本次没有导入。'); }
    return this.transaction(() => {
      let added = 0, duplicates = 0;
      let count = this.one('SELECT count(*) AS count FROM notes WHERE author_id=?', userId).count;
      for (const note of notes) {
        const requestId = digest(JSON.stringify(['backup-v1', note.id, note.text, note.audience, note.createdAt, note.updatedAt]));
        if (this.one('SELECT id FROM notes WHERE author_id=? AND request_id=?', userId, requestId)) { duplicates++; continue; }
        if (++count > 500) fail(409, 'capacity', '合并后超过账号 500 条上限，本次没有导入。');
        this.run('INSERT INTO notes (id,author_id,text,audience,couple_id,created_at,updated_at,request_id) VALUES (?,?,?,?,?,?,?,?)',
          randomUUID(), userId, note.text, 'personal', null, Date.parse(note.createdAt), Date.parse(note.updatedAt), requestId);
        added++;
      }
      return {added, duplicates};
    });
  }
  saveProfile(userId, value) {
    const settings = validateSettings({...value, volume: 65});
    const couple = this.activeCouple(userId);
    if (!couple) fail(409, 'unpaired', '先完成双人绑定，再修改共同设定。');
    if (value.version !== couple.version) fail(409, 'conflict', '共同设定已被另一设备修改，请重新打开面板后再保存。');
    if (!this.run('UPDATE couples SET name_one=?,name_two=?,anniversary=?,version=version+1 WHERE id=? AND version=?', settings.nameOne, settings.nameTwo, settings.anniversary, couple.id, couple.version).changes) fail(409, 'conflict', '共同设定已变化，请重新打开面板后再保存。');
    return this.pairInfo(userId);
  }
}
