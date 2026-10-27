import {randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

const scrypt = promisify(scryptCallback);
const parameters = {N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024};
let hashing = 0;

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export function fail(status, code, message) { throw new ApiError(status, code, message); }
export const randomToken = () => randomBytes(32).toString('base64url');
export const digest = value => createHash('sha256').update(value).digest('hex');
export function matches(first, second) {
  return typeof first === 'string' && typeof second === 'string' && timingSafeEqual(Buffer.from(digest(first), 'hex'), Buffer.from(digest(second), 'hex'));
}

export function validateAccount(value) {
  const username = typeof value.username === 'string' ? value.username.trim().toLowerCase() : '';
  const displayName = typeof value.displayName === 'string' ? value.displayName.trim() : '';
  if (!/^[a-z0-9_]{3,24}$/.test(username)) fail(400, 'username', '账号使用 3—24 位小写字母、数字或下划线。');
  if (!displayName || displayName.length > 20) fail(400, 'displayName', '昵称需要 1—20 个字符。');
  validatePassword(value.password);
  return {username, displayName, password: value.password};
}
export function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) fail(400, 'password', '密码请使用 12—128 个字符，可使用较长的句子。');
}
async function derive(password, salt) {
  if (hashing >= 2) fail(503, 'busy', '登录验证繁忙，请稍后再试。');
  hashing++;
  try { return await scrypt(password, salt, 64, parameters); }
  finally { hashing--; }
}
export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt);
  return `scrypt-v1:${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const parts = typeof encoded === 'string' ? encoded.split(':') : [];
  const valid = parts.length === 3 && parts[0] === 'scrypt-v1' && /^[a-f0-9]{32}$/.test(parts[1]) && /^[a-f0-9]{128}$/.test(parts[2]);
  const expected = valid ? Buffer.from(parts[2], 'hex') : Buffer.alloc(64);
  const actual = await derive(password, valid ? parts[1] : '0'.repeat(32));
  return timingSafeEqual(expected, actual) && valid;
}

export function requireFields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) {
    fail(400, 'fields', '请求包含不支持的字段。');
  }
}
