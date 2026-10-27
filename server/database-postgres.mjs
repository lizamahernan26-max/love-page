import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {defaults, validateSettings} from '../js/config.js';
import {validateNotes} from '../js/whisper-store.js';
import {digest, fail, randomToken} from './security.mjs';

const SESSION_MS = 14 * 86400000;
const INVITE_MS = 24 * 3600000;
const tables = /\b(users|couples|invites|sessions|notes|rate_limits|device_users)\b/g;

export function neonConnectionOptions(value) {
  let url;
  try {url = new URL(value);} catch {throw new Error('请在托管平台设置 Neon 的 DATABASE_URL。');}
  if (!['postgres:','postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech') || !url.username || !url.password || url.pathname.length < 2) throw new Error('DATABASE_URL 必须是 Neon 的 PostgreSQL 连接地址。');
  for (const key of url.searchParams.keys()) if (!['sslmode','channel_binding','connect_timeout'].includes(key)) throw new Error('数据库地址包含未支持的连接参数。');
  if (url.searchParams.has('sslmode') && !['require','verify-full'].includes(url.searchParams.get('sslmode'))) throw new Error('数据库连接必须启用证书验证。');
  return {host:url.hostname, port:Number(url.port || 5432), database:decodeURIComponent(url.pathname.slice(1)), user:decodeURIComponent(url.username), password:decodeURIComponent(url.password),
    ssl:{rejectUnauthorized:true}, enableChannelBinding:true, max:2, idleTimeoutMillis:10000, connectionTimeoutMillis:15000, statement_timeout:10000, query_timeout:15000, application_name:'xinwang'};
}
export async function connectPostgres(value) {
  const database = new PostgresDatabase(new Pool(neonConnectionOptions(value)));
  try {await database.initialize(); return database;}
  catch (error) {await database.close(); throw error;}
}
export class PostgresDatabase {
  constructor(pool) {
    this.pool = pool;
    this.connection = new AsyncLocalStorage();
    pool.on('error', () => console.error('心网数据库连接中断：DATABASE_CONNECTION'));
  }
  close() {return this.closing ||= this.pool.end();}
  async query(sql, args = []) {
    let index = 0;
    // SQL comes only from this repository and app.mjs; user values stay in parameters.
    const statement = sql.replace('count=count+1 WHERE count<', 'count=rate_limits.count+1 WHERE rate_limits.count<').replace(tables, 'xinwang_$1').replace(/\?/g, () => '$' + ++index);
    const result = await (this.connection.getStore() || this.pool).query(statement, args);
    for (const row of result.rows || []) for (const key of ['count','created_at','updated_at','expires_at','ended_at']) if (typeof row[key] === 'string') row[key] = Number(row[key]);
    return result;
  }
  async one(sql, ...args) {return (await this.query(sql,args)).rows[0];}
  async all(sql, ...args) {return (await this.query(sql,args)).rows;}
  async run(sql, ...args) {return {changes:(await this.query(sql,args)).rowCount};}
  async transaction(action) {
    if (this.connection.getStore()) return action();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // One two-person space: serialize multi-step writes across connections and deploys.
      await client.query('SELECT pg_advisory_xact_lock(648238519)');
      const value = await this.connection.run(client, action);
      await client.query('COMMIT'); return value;
    } catch (error) {await client.query('ROLLBACK').catch(() => {}); throw error;}
    finally {client.release();}
  }
  async initialize() {
    await this.transaction(async () => {
      await this.query('CREATE TABLE IF NOT EXISTS xinwang_schema (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL)');
      const meta = await this.one('SELECT version FROM xinwang_schema WHERE id=1');
      if (meta?.version > 2) throw new Error('数据库版本较新，请先升级程序。');
      if (!meta) {
        await this.query(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at BIGINT NOT NULL);
          CREATE TABLE couples (id TEXT PRIMARY KEY, first_user TEXT NOT NULL REFERENCES users(id), second_user TEXT NOT NULL REFERENCES users(id), name_one TEXT NOT NULL, name_two TEXT NOT NULL, anniversary TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at BIGINT NOT NULL, ended_at BIGINT, CHECK(first_user != second_user));
          CREATE TABLE invites (token_hash TEXT PRIMARY KEY, owner_id TEXT UNIQUE NOT NULL REFERENCES users(id), expires_at BIGINT NOT NULL);
          CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL);
          CREATE INDEX xinwang_sessions_user ON sessions(user_id);
          CREATE TABLE notes (id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(id), text TEXT NOT NULL, audience TEXT NOT NULL CHECK(audience IN ('personal','shared')), couple_id TEXT REFERENCES couples(id), created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, version INTEGER NOT NULL DEFAULT 1, request_id TEXT NOT NULL, UNIQUE(author_id,request_id), CHECK(audience != 'shared' OR couple_id IS NOT NULL));
          CREATE INDEX xinwang_notes_author ON notes(author_id); CREATE INDEX xinwang_notes_couple ON notes(couple_id,audience);
          CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at BIGINT NOT NULL);
          INSERT INTO xinwang_schema VALUES (1,1);`);
      }
      if (!meta || meta.version < 2) {
        await this.query('CREATE TABLE device_users (user_id TEXT PRIMARY KEY REFERENCES users(id), recovery_hash TEXT UNIQUE NOT NULL)');
        await this.query('UPDATE xinwang_schema SET version=2 WHERE id=1');
      }
    });
  }

  async countUsers() { return (await this.one('SELECT count(*) AS count FROM users')).count; }
  publicUser(user) { return {id: user.id, username: user.username, displayName: user.display_name, passwordless: Boolean(user.passwordless)}; }
  async activeCouple(userId) {
    return (await this.one('SELECT * FROM couples WHERE ended_at IS NULL AND (first_user=? OR second_user=?)', userId, userId));
  }
  async pairInfo(userId) {
    const couple = (await this.activeCouple(userId));
    if (!couple) return null;
    const partner = (await this.one('SELECT id,display_name FROM users WHERE id=?', couple.first_user === userId ? couple.second_user : couple.first_user));
    return {id: couple.id, partner: {id: partner.id, displayName: partner.display_name}, profile: {
      nameOne: couple.name_one, nameTwo: couple.name_two, anniversary: couple.anniversary, version: couple.version
    }};
  }
  async validInvite(code, now = Date.now()) {
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code)) fail(400, 'invite', '邀请码无效或已过期。');
    const invite = (await this.one('SELECT * FROM invites WHERE token_hash=? AND expires_at>?', digest(code), now));
    if (!invite || (await this.activeCouple(invite.owner_id))) fail(400, 'invite', '邀请码无效或已过期。');
    return invite;
  }
  async register(account, passwordHash, inviteCode, allowFirst) {
    return (await this.transaction(async () => {
      const count = (await this.countUsers());
      if (count >= 2) fail(403, 'closed', '这是两人专用空间，两个账号已建立。请登录已有账号。');
      if ((await this.one('SELECT id FROM users WHERE username=?', account.username))) fail(409, 'username', '这个账号已使用，请换一个。');
      const invite = count ? (await this.validInvite(inviteCode)) : null;
      if (!count && !allowFirst) fail(403, 'setup', '请由站点维护者在本机初始化，或提供部署时设置的初始化密钥。');
      const userId = randomUUID(), now = Date.now();
      (await this.run('INSERT INTO users VALUES (?,?,?,?,?)', userId, account.username, account.displayName, passwordHash, now));
      if (invite) (await this.createPair(invite.owner_id, userId, now));
      return (await this.one('SELECT * FROM users WHERE id=?', userId));
    }));
  }
  async createPair(first, second, now = Date.now()) {
    if (first === second || (await this.activeCouple(first)) || (await this.activeCouple(second))) fail(409, 'paired', '其中一方已经绑定，请先确认当前关系。');
    (await this.run('INSERT INTO couples (id,first_user,second_user,name_one,name_two,anniversary,created_at) VALUES (?,?,?,?,?,?,?)',
      randomUUID(), first, second, defaults.nameOne, defaults.nameTwo, defaults.anniversary, now));
    (await this.run('DELETE FROM invites WHERE owner_id IN (?,?)', first, second));
  }
  async createInvite(userId) {
    if ((await this.activeCouple(userId))) fail(409, 'paired', '已绑定对方，无需再生成邀请码。');
    const token = randomToken(), expiresAt = Date.now() + INVITE_MS;
    (await this.run('INSERT INTO invites VALUES (?,?,?) ON CONFLICT(owner_id) DO UPDATE SET token_hash=excluded.token_hash, expires_at=excluded.expires_at', digest(token), userId, expiresAt));
    return {code: token, expiresAt: new Date(expiresAt).toISOString()};
  }
  async join(userId, code) {
    (await this.transaction(async () => {
      const invite = (await this.validInvite(code));
      (await this.createPair(invite.owner_id, userId));
    }));
  }
  async leave(userId, expectedCoupleId) {
    (await this.transaction(async () => {
      const couple = (await this.activeCouple(userId));
      if (!couple) fail(409, 'unpaired', '当前没有绑定关系。');
      if (couple.id !== expectedCoupleId) fail(409, 'conflict', '绑定关系已变化，请刷新后重新确认。');
      (await this.run('UPDATE couples SET ended_at=?,version=version+1 WHERE id=?', Date.now(), couple.id));
      (await this.run('DELETE FROM invites WHERE owner_id IN (?,?)', couple.first_user, couple.second_user));
    }));
  }
  async newSession(userId) {
    const now = Date.now(), token = randomToken(), csrf = randomToken();
    const duration = (await this.one('SELECT user_id FROM device_users WHERE user_id=?', userId)) ? 90 * 86400000 : SESSION_MS;
    (await this.run('DELETE FROM sessions WHERE expires_at<=?', now));
    const existing = (await this.all('SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC', userId));
    for (const session of existing.slice(7)) (await this.run('DELETE FROM sessions WHERE token_hash=?', session.token_hash));
    (await this.run('INSERT INTO sessions VALUES (?,?,?,?,?)', digest(token), userId, csrf, now, now + duration));
    return {token, csrf, maxAge: duration / 1000};
  }
  async session(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return (await this.one('SELECT s.token_hash,s.csrf,s.expires_at,u.*,EXISTS(SELECT 1 FROM device_users d WHERE d.user_id=u.id) AS passwordless FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?', digest(token), Date.now())) || null;
  }
  async redeemDeviceInvite(code) {
    return (await this.transaction(async () => {
      const invite = (await this.validInvite(code));
      if ((await this.countUsers()) !== 1) fail(409, 'closed', '双人身份已建立。请使用自己的恢复码进入。');
      const userId = randomUUID(), recoveryCode = randomToken();
      (await this.run('INSERT INTO users VALUES (?,?,?,?,?)', userId, 'guest_' + randomUUID().replaceAll('-', '').slice(0, 12), defaults.nameTwo, 'device-only', Date.now()));
      (await this.run('INSERT INTO device_users VALUES (?,?)', userId, digest(recoveryCode)));
      (await this.createPair(invite.owner_id, userId));
      return {...(await this.newSession(userId)), recoveryCode};
    }));
  }
  async recoverDevice(code) {
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code)) fail(401, 'recovery', '恢复码无效，请检查。');
    return (await this.transaction(async () => {
      const device = (await this.one('SELECT user_id FROM device_users WHERE recovery_hash=?', digest(code)));
      if (!device) fail(401, 'recovery', '恢复码无效或已使用。');
      const recoveryCode = randomToken();
      (await this.run('UPDATE device_users SET recovery_hash=? WHERE user_id=?', digest(recoveryCode), device.user_id));
      (await this.run('DELETE FROM sessions WHERE user_id=?', device.user_id));
      return {...(await this.newSession(device.user_id)), recoveryCode};
    }));
  }
  async renewDeviceSession(token) {
    const user = (await this.session(token)), now = Date.now();
    if (!user?.passwordless || user.expires_at > now + 60 * 86400000) return null;
    const duration = 90 * 86400000;
    return (await this.run('UPDATE sessions SET expires_at=? WHERE token_hash=? AND expires_at>?', now + duration, digest(token), now)).changes ? duration / 1000 : null;
  }
  async rotateRecovery(userId) {
    return this.transaction(async () => {
      if (!await this.one('SELECT user_id FROM device_users WHERE user_id=?', userId)) fail(403, 'device', '此身份不使用设备恢复码。');
      const recoveryCode = randomToken();
      await this.run('UPDATE device_users SET recovery_hash=? WHERE user_id=?', digest(recoveryCode), userId);
      return {recoveryCode};
    });
  }
  async changePassword(userId, expectedHash, nextHash) {
    (await this.transaction(async () => {
      if ((await this.one('SELECT password_hash FROM users WHERE id=?', userId))?.password_hash !== expectedHash) fail(409, 'conflict', '密码已在另一设备修改，请重新登录。');
      (await this.run('UPDATE users SET password_hash=? WHERE id=?', nextHash, userId));
      (await this.run('DELETE FROM sessions WHERE user_id=?', userId));
    }));
  }
  async rateLimit(key, maximum, windowMs = 15 * 60000) {
    const now = Date.now(), safeKey = digest(key);
    (await this.run('DELETE FROM rate_limits WHERE expires_at<=?', now));
    const result = (await this.run('INSERT INTO rate_limits VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<?', safeKey, 1, now + windowMs, maximum));
    if (!result.changes) fail(429, 'rate', '尝试次数较多，请稍后再试。');
  }
  async visibleNotes(userId) {
    const couple = (await this.activeCouple(userId));
    return (await this.all(`SELECT n.*,u.display_name FROM notes n JOIN users u ON n.author_id=u.id
      WHERE n.author_id=? OR (n.audience='shared' AND n.couple_id=?) ORDER BY n.updated_at DESC,n.id`, userId, couple?.id ?? '')).map(note => ({
      id: note.id, text: note.text, audience: note.audience, authorId: note.author_id,
      authorName: note.display_name, own: note.author_id === userId,
      sharedWithPartner: note.audience === 'shared' && note.couple_id === couple?.id,
      createdAt: new Date(note.created_at).toISOString(), updatedAt: new Date(note.updated_at).toISOString(), version: note.version
    }));
  }
  async ownNote(userId, noteId) {
    const note = (await this.one('SELECT * FROM notes WHERE id=? AND author_id=?', noteId, userId));
    if (!note) fail(404, 'missing', '这条记录不存在，或你没有操作权限。');
    return note;
  }
  validateNote(text, audience) {
    if (typeof text !== 'string' || !text.trim() || text.length > 1000) fail(400, 'text', '心里话需要 1—1,000 个字符。');
    if (!['personal','shared'].includes(audience)) fail(400, 'audience', '请选择仅自己可见或两人共享。');
    return text.trim();
  }
  async saveNote(userId, value, noteId) {
    const text = this.validateNote(value.text, value.audience);
    return (await this.transaction(async () => {
      const existing = noteId ? (await this.ownNote(userId, noteId)) : null;
      if (existing && (!Number.isSafeInteger(value.version) || value.version !== existing.version)) fail(409, 'conflict', '记录已在其他设备修改。本次没有覆盖，请先保留草稿再刷新记录。');
      const couple = (await this.activeCouple(userId));
      if (value.audience === 'shared' && !couple) fail(409, 'unpaired', '先绑定对方，才能发布两人共享的心里话。');
      if (value.audience === 'shared' && value.expectedCoupleId !== couple.id) fail(409, 'conflict', '绑定关系已变化，本次没有发布，请刷新后重新确认。');
      if (!existing) {
        if (typeof value.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(value.requestId)) fail(400, 'requestId', '请求编号无效，请刷新后重试。');
        const repeated = (await this.one('SELECT * FROM notes WHERE author_id=? AND request_id=?', userId, value.requestId));
        if (repeated) {
          if (repeated.text !== text || repeated.audience !== value.audience) fail(409, 'conflict', '这个请求已处理，请刷新后重试。');
          return repeated.id;
        }
        if ((await this.one('SELECT count(*) AS count FROM notes WHERE author_id=?', userId)).count >= 500) fail(409, 'capacity', '每个账号最多保留 500 条记录，请先备份和整理。');
      }
      const id = existing?.id ?? randomUUID();
      const now = Math.max(Date.now(), existing?.updated_at ?? 0);
      if (existing) (await this.run('UPDATE notes SET text=?,audience=?,couple_id=?,updated_at=?,version=version+1 WHERE id=? AND author_id=?', text, value.audience, value.audience === 'shared' ? couple.id : null, now, id, userId));
      else (await this.run('INSERT INTO notes (id,author_id,text,audience,couple_id,created_at,updated_at,request_id) VALUES (?,?,?,?,?,?,?,?)', id, userId, text, value.audience, value.audience === 'shared' ? couple.id : null, now, now, value.requestId));
      return id;
    }));
  }
  async deleteNote(userId, noteId, version) {
    const note = (await this.ownNote(userId, noteId));
    if (note.version !== version) fail(409, 'conflict', '记录已在其他设备修改，请刷新后再决定是否删除。');
    if (!(await this.run('DELETE FROM notes WHERE id=? AND author_id=? AND version=?', noteId, userId, version)).changes) fail(409, 'conflict', '记录已变化，请刷新后再决定是否删除。');
  }
  async importPrivate(userId, input) {
    let notes;
    try { notes = validateNotes(input); }
    catch { fail(400, 'backup', '备份记录格式无效，本次没有导入。'); }
    return (await this.transaction(async () => {
      let added = 0, duplicates = 0;
      let count = (await this.one('SELECT count(*) AS count FROM notes WHERE author_id=?', userId)).count;
      for (const note of notes) {
        const requestId = digest(JSON.stringify(['backup-v1', note.id, note.text, note.audience, note.createdAt, note.updatedAt]));
        if ((await this.one('SELECT id FROM notes WHERE author_id=? AND request_id=?', userId, requestId))) { duplicates++; continue; }
        if (++count > 500) fail(409, 'capacity', '合并后超过账号 500 条上限，本次没有导入。');
        (await this.run('INSERT INTO notes (id,author_id,text,audience,couple_id,created_at,updated_at,request_id) VALUES (?,?,?,?,?,?,?,?)',
          randomUUID(), userId, note.text, 'personal', null, Date.parse(note.createdAt), Date.parse(note.updatedAt), requestId));
        added++;
      }
      return {added, duplicates};
    }));
  }
  async saveProfile(userId, value) {
    const settings = validateSettings({...value, volume: 65});
    const couple = (await this.activeCouple(userId));
    if (!couple) fail(409, 'unpaired', '先完成双人绑定，再修改共同设定。');
    if (value.version !== couple.version) fail(409, 'conflict', '共同设定已被另一设备修改，请重新打开面板后再保存。');
    if (!(await this.run('UPDATE couples SET name_one=?,name_two=?,anniversary=?,version=version+1 WHERE id=? AND version=?', settings.nameOne, settings.nameTwo, settings.anniversary, couple.id, couple.version)).changes) fail(409, 'conflict', '共同设定已变化，请重新打开面板后再保存。');
    return (await this.pairInfo(userId));
  }
}
