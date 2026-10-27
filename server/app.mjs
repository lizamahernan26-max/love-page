import {createServer as createHttpServer} from 'node:http';
import {createServer as createStaticServer} from '../scripts/serve.mjs';
import {Database} from './database.mjs';
import {ApiError, fail, digest, matches, validateAccount, validatePassword, hashPassword, verifyPassword, requireFields} from './security.mjs';

const loopback = address => ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address);
const localHost = name => ['localhost','127.0.0.1','[::1]'].includes(name);

async function readBody(req, maximum = 16384) {
  if (!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type'] || '')) fail(415, 'contentType', '请使用 JSON 请求。');
  if (Number(req.headers['content-length']) > maximum) fail(413, 'size', '请求内容过大。');
  return new Promise((resolve, reject) => {
    let text = '', size = 0;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > maximum) { reject(new ApiError(413, 'size', '请求内容过大。')); return; }
      text += chunk;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(text)); }
      catch { reject(new ApiError(400, 'json', '请求格式不正确。')); }
    });
    req.on('error', () => reject(new ApiError(400, 'request', '请求未完整送达。')));
  });
}

export function createAppServer({root, databasePath, database: suppliedDatabase, publicOrigin = '', developmentHost = '127.0.0.1', allowInsecureLan = false, setupKey = '', trustLoopbackProxy = false}) {
  const configured = publicOrigin ? new URL(publicOrigin) : null;
  if (configured && (configured.protocol !== 'https:' || configured.origin !== publicOrigin || configured.username || configured.password)) throw new Error('PUBLIC_ORIGIN 必须为不带路径的 HTTPS 来源。');
  if (!configured && !localHost(developmentHost) && !allowInsecureLan) throw new Error('局域网 HTTP 仅能在明确启用开发测试时使用。');
  if (setupKey && setupKey.length < 32) throw new Error('初始化密钥至少需要 32 个字符。');
  const secure = Boolean(configured), cookieName = secure ? '__Host-xinwang_session' : 'xinwang_session';
  const database = suppliedDatabase || new Database(databasePath);
  const staticHandler = createStaticServer(root).listeners('request')[0];

  const server = createHttpServer({maxHeaderSize: 8192, requestTimeout: 15000, headersTimeout: 10000}, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    function json(status, value) {
      res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify(value));
    }
    function sessionCookie(token, maxAge) {
      res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
    }
    try {
      const authority = req.headers.host || '';
      const expectedPort = server.address()?.port;
      const allowedDevHosts = [`127.0.0.1:${expectedPort}`, `localhost:${expectedPort}`, `[::1]:${expectedPort}`, `${developmentHost}:${expectedPort}`];
      if (configured ? authority !== configured.host : !allowedDevHosts.includes(authority)) fail(421, 'host', '请求网址与本站不一致。');
      if (secure && !req.socket.encrypted && !(trustLoopbackProxy && loopback(req.socket.remoteAddress) && req.headers['x-forwarded-proto'] === 'https')) fail(426, 'https', '正式双人空间需要 HTTPS 连接。');
      const expectedOrigin = configured?.origin || `http://${authority}`;
      const pathname = (req.url || '/').split('?')[0];
      if (!pathname.startsWith('/api/')) { staticHandler(req, res); return; }
      if (!['GET','POST','PATCH','DELETE'].includes(req.method)) fail(405, 'method', '不支持这个请求方法。');
      if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'origin', '拒绝跨站请求。');
      const mutation = req.method !== 'GET';
      if (mutation && req.headers.origin !== expectedOrigin) fail(403, 'origin', '请求来源不受信任。');
      if (req.method === 'GET' && pathname === '/api/status') {
        json(200, {online: true, transport: secure ? 'https' : 'development-http', version: '0.5.0'}); return;
      }
      const cookies = (req.headers.cookie || '').split(';').map(value => value.trim().split('='));
      const tokens = cookies.filter(([name]) => name === cookieName);
      const user = tokens.length === 1 ? (await database.session(tokens[0][1])) : null;
      async function requireLiveSession() {
        const live = tokens.length === 1 ? (await database.session(tokens[0][1])) : null;
        if (!live || live.id !== user?.id) fail(401, 'login', '会话已结束，请重新登录。');
      }
      const allowLocalSetup = !secure && loopback(req.socket.remoteAddress) && localHost(new URL(expectedOrigin).hostname);
      const setup = (await database.countUsers()) === 0;
      const identity = async current => ({authenticated: true, user: database.publicUser(current), csrfToken: current.csrf, couple: (await database.pairInfo(current.id))});
      if (req.method === 'GET' && pathname === '/api/session') {
        if (user?.passwordless) {
          const maxAge = (await database.renewDeviceSession(tokens[0][1]));
          if (maxAge) sessionCookie(tokens[0][1], maxAge);
        }
        json(200, user ? (await identity(user)) : {authenticated: false, setupRequired: setup, setupKeyRequired: setup && !allowLocalSetup, slotsAvailable: (await database.countUsers()) < 2}); return;
      }
      if (req.method === 'POST' && ['/api/auth/device-enter','/api/auth/device-recover'].includes(pathname)) {
        (await database.rateLimit(`device-ip:${req.socket.remoteAddress}`, 15));
        if (user) fail(409, 'signed', '当前已有身份，请先退出，再使用专属入口。');
        const body = await readBody(req); requireFields(body, ['code']);
        const fresh = pathname.endsWith('device-enter') ? (await database.redeemDeviceInvite(body.code)) : (await database.recoverDevice(body.code));
        sessionCookie(fresh.token, fresh.maxAge);
        json(201, {...(await identity((await database.session(fresh.token)))), recoveryCode: fresh.recoveryCode}); return;
      }
      if (req.method === 'POST' && ['/api/auth/register','/api/auth/login'].includes(pathname)) {
        (await database.rateLimit(`auth-ip:${req.socket.remoteAddress}`, 30));
        const body = await readBody(req);
        requireFields(body, pathname.endsWith('register') ? ['username','displayName','password','inviteCode','setupKey'] : ['username','password']);
        const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
        (await database.rateLimit(`auth-user:${username.slice(0, 80)}`, 12));
        let account;
        if (pathname.endsWith('register')) {
          const validated = validateAccount(body);
          if (!(await database.countUsers()) && !(allowLocalSetup || (setupKey && matches(body.setupKey, setupKey)))) fail(403, 'setup', '首个账号需要由维护者在本机初始化，或输入初始化密钥。');
          if ((await database.countUsers()) >= 2) fail(403, 'closed', '两个账号已建立，请登录已有账号。');
          if ((await database.countUsers())) (await database.validInvite(body.inviteCode));
          account = (await database.register(validated, await hashPassword(validated.password), body.inviteCode, allowLocalSetup || Boolean(setupKey && matches(body.setupKey, setupKey))));
        } else {
          account = (await database.one('SELECT * FROM users WHERE username=?', username));
          const verified = await verifyPassword(body.password, account?.password_hash);
          if (!verified || (await database.one('SELECT password_hash FROM users WHERE id=?', account.id))?.password_hash !== account.password_hash) fail(401, 'credentials', '账号或密码不正确。');
        }
        if (user) (await database.run('DELETE FROM sessions WHERE token_hash=?', user.token_hash));
        const fresh = (await database.newSession(account.id));
        sessionCookie(fresh.token, fresh.maxAge);
        json(pathname.endsWith('register') ? 201 : 200, (await identity((await database.session(fresh.token))))); return;
      }
      if (!user) fail(401, 'login', '请先登录自己的账号。');
      res.setHeader('X-Xinwang-User', user.id);
      if (mutation && !matches(req.headers['x-csrf-token'], user.csrf)) fail(403, 'csrf', '会话已变化，请刷新后重试。');
      if (req.method === 'GET' && pathname === '/api/notes') {
        json(200, {viewerId: user.id, notes: (await database.visibleNotes(user.id)), couple: (await database.pairInfo(user.id))}); return;
      }
      const noteMatch = /^\/api\/notes\/([a-f0-9-]{36})$/.exec(pathname);
      if (req.method === 'GET' && noteMatch) {
        const note = (await database.visibleNotes(user.id)).find(value => value.id === noteMatch[1]);
        if (!note) fail(404, 'missing', '这条记录不存在，或你没有查看权限。');
        json(200, {note}); return;
      }
      if (req.method === 'POST' && pathname === '/api/auth/logout') {
        (await database.run('DELETE FROM sessions WHERE token_hash=?', user.token_hash));
        sessionCookie('', 0); json(200, {ok: true}); return;
      }
      (await database.rateLimit(`write:${user.id}`, 120, 60000));
      const body = mutation ? await readBody(req, pathname === '/api/notes/import' ? 2 * 1024 * 1024 : 16384) : {};
      (await requireLiveSession());
      if (req.method === 'POST' && pathname === '/api/auth/device-backup') {
        requireFields(body, []); json(200, await database.rotateRecovery(user.id)); return;
      }
      if (req.method === 'POST' && pathname === '/api/couple/invite') {
        requireFields(body, []); json(201, (await database.createInvite(user.id))); return;
      }
      if (req.method === 'POST' && pathname === '/api/couple/join') {
        requireFields(body, ['code']); (await database.join(user.id, body.code)); json(200, {couple: (await database.pairInfo(user.id))}); return;
      }
      if (req.method === 'POST' && pathname === '/api/couple/leave') {
        requireFields(body, ['password','coupleId']);
        if (!await verifyPassword(body.password, user.password_hash)) fail(401, 'credentials', '密码不正确，绑定关系没有改变。');
        (await requireLiveSession());
        (await database.leave(user.id, body.coupleId)); json(200, {couple: null}); return;
      }
      if (req.method === 'POST' && pathname === '/api/auth/password') {
        requireFields(body, ['currentPassword','newPassword']); validatePassword(body.newPassword);
        if (!await verifyPassword(body.currentPassword, user.password_hash)) fail(401, 'credentials', '当前密码不正确。');
        const nextHash = await hashPassword(body.newPassword);
        (await requireLiveSession());
        (await database.changePassword(user.id, user.password_hash, nextHash));
        const fresh = (await database.newSession(user.id)); sessionCookie(fresh.token, fresh.maxAge);
        json(200, (await identity((await database.session(fresh.token))))); return;
      }
      if (req.method === 'POST' && pathname === '/api/notes') {
        requireFields(body, ['text','audience','requestId','expectedCoupleId']);
        const id = (await database.saveNote(user.id, body));
        json(201, {note: (await database.visibleNotes(user.id)).find(value => value.id === id)}); return;
      }
      if (req.method === 'POST' && pathname === '/api/notes/import') {
        requireFields(body, ['notes']); json(200, (await database.importPrivate(user.id, body.notes))); return;
      }
      if (req.method === 'PATCH' && noteMatch) {
        requireFields(body, ['text','audience','version','expectedCoupleId']);
        (await database.saveNote(user.id, body, noteMatch[1]));
        json(200, {note: (await database.visibleNotes(user.id)).find(value => value.id === noteMatch[1])}); return;
      }
      if (req.method === 'DELETE' && noteMatch) {
        requireFields(body, ['version']); (await database.deleteNote(user.id, noteMatch[1], body.version)); json(200, {ok: true}); return;
      }
      if (req.method === 'PATCH' && pathname === '/api/couple/profile') {
        requireFields(body, ['nameOne','nameTwo','anniversary','version']);
        let couple;
        try { couple = (await database.saveProfile(user.id, body)); }
        catch (error) { if (error instanceof ApiError) throw error; fail(400, 'profile', error.message); }
        json(200, {couple}); return;
      }
      fail(404, 'route', '接口不存在。');
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      if (error instanceof ApiError) json(error.status, {error: {code: error.code, message: error.message}});
      else {
        // 不将请求内容、Cookie、密码、邀请码或数据库错误细节写入日志。
        console.error('心网请求失败：INTERNAL_ERROR');
        json(500, {error: {code: 'internal', message: '服务暂时无法处理，请保留草稿后稍后重试。'}});
      }
    }
  });
  server.on('close', () => database.close());
  return {server, database};
}
