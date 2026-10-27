import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createAppServer} from '../server/app.mjs';
import {Database} from '../server/database.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const password = 'test-only-password-2026';

async function fixture(t, {paired = true, secure = false} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'xinwang-pair-test-'));
  const databasePath = join(directory, 'pair.sqlite');
  const app = createAppServer({root, databasePath, ...(secure ? {publicOrigin:'https://pair.example', trustLoopbackProxy:true, setupKey:'test-only-setup-key-at-least-32-characters'} : {})});
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  const origin = secure ? 'https://pair.example' : `http://127.0.0.1:${port}`;
  let closed = false;
  async function close() {if (!closed) {closed = true; await new Promise(resolve => app.server.close(resolve));}}
  t.after(async () => {
    await close();
    // Only this test's freshly created, resolved temporary folder can be removed.
    if (resolve(directory).startsWith(resolve(tmpdir()) + '\\xinwang-pair-test-') || resolve(directory).startsWith(resolve(tmpdir()) + '/xinwang-pair-test-')) await rm(directory, {recursive:true, force:true});
  });
  function client() {
    let cookie = '', csrf = '';
    return {
      get cookie() {return cookie;}, set cookie(value) {cookie = value;},
      async call(path, {method = 'GET', data, headers = {}, raw} = {}) {
        return new Promise((resolve, reject) => {
          const payload = raw ?? (data === undefined ? '' : JSON.stringify(data));
          const req = request({hostname:'127.0.0.1', port, path:'/api/' + path, method, headers:{
            Host:secure ? 'pair.example' : `127.0.0.1:${port}`, Cookie:cookie,
            ...(secure ? {'X-Forwarded-Proto':'https'} : {}),
            ...(method === 'GET' ? {} : {Origin:origin, 'Content-Type':'application/json', 'X-CSRF-Token':csrf, 'Content-Length':Buffer.byteLength(payload)}), ...headers
          }}, res => {
            const chunks = [];
            res.on('data', value => chunks.push(value));
            res.on('end', () => {
              const text = Buffer.concat(chunks).toString();
              let body; try {body = JSON.parse(text);} catch {body = text;}
              if (res.headers['set-cookie']) cookie = res.headers['set-cookie'][0].split(';')[0];
              if (body.csrfToken) csrf = body.csrfToken;
              resolve({status:res.statusCode, body, headers:res.headers, text});
            });
          });
          req.on('error', reject); req.end(payload);
        });
      }
    };
  }
  const a = client(), b = client();
  const registered = await a.call('auth/register', {method:'POST', data:{username:'person_a', displayName:'测试甲', password, ...(secure ? {setupKey:'test-only-setup-key-at-least-32-characters'} : {})}});
  assert.equal(registered.status, 201, registered.text);
  let couple;
  if (paired) {
    const invite = await a.call('couple/invite', {method:'POST', data:{}});
    const joined = await b.call('auth/register', {method:'POST', data:{username:'person_b', displayName:'测试乙', password, inviteCode:invite.body.code}});
    assert.equal(joined.status, 201, joined.text);
    couple = joined.body.couple;
  }
  return {...app, a, b, client, registered, directory, databasePath, close, origin, get couple() {return couple;}};
}
const post = (client, text, audience = 'personal', couple, requestId = randomUUID()) => client.call('notes', {method:'POST', data:{text,audience,requestId,...(audience === 'shared' ? {expectedCoupleId:couple.id} : {})}});

test('paired accounts use real sessions; password hashes and session tokens are not stored as raw credentials', async t => {
  const f = await fixture(t);
  const first = f.registered;
  assert.match(first.headers['set-cookie'][0], /HttpOnly; SameSite=Strict/);
  assert.equal(first.text.includes('password_hash'), false);
  assert.equal(first.text.includes(password), false);
  assert.equal(f.database.countUsers(), 2);
  const hashes = f.database.all('SELECT password_hash FROM users').map(row => row.password_hash);
  assert(hashes.every(hash => hash.startsWith('scrypt-v1:') && !hash.includes(password)));
  assert.notEqual(hashes[0], hashes[1]);
  assert(!f.database.all('SELECT token_hash FROM sessions').some(row => f.a.cookie.endsWith(row.token_hash)));
  assert.equal((await f.client().call('notes')).status, 401);
  assert.equal((await f.a.call('session')).body.couple.id, f.couple.id);
});

test('private data never reaches the partner list/detail; shared data is visible to both', async t => {
  const f = await fixture(t);
  const ap = await post(f.a, 'A_PRIVATE_SENTINEL');
  const bp = await post(f.b, 'B_PRIVATE_SENTINEL');
  const shared = await post(f.a, '共同可见', 'shared', f.couple);
  const aList = await f.a.call('notes'), bList = await f.b.call('notes');
  assert(!aList.text.includes('B_PRIVATE_SENTINEL'));
  assert(!bList.text.includes('A_PRIVATE_SENTINEL'));
  assert(!bList.text.includes(ap.body.note.id));
  assert.equal((await f.b.call(`notes/${ap.body.note.id}`)).status, 404);
  assert.equal((await f.a.call(`notes/${bp.body.note.id}`)).status, 404);
  assert.equal((await f.b.call(`notes/${shared.body.note.id}`)).body.note.own, false);
  assert.equal(shared.body.note.authorId, f.registered.body.user.id);
});

test('guessing record IDs or spoofing identity cannot edit, delete or assign someone else a record', async t => {
  const f = await fixture(t);
  const note = (await post(f.a, '作者的共享文字', 'shared', f.couple)).body.note;
  for (const method of ['PATCH','DELETE']) {
    const result = await f.b.call(`notes/${note.id}`, {method, data:method === 'DELETE' ? {version:1} : {text:'越权修改',audience:'personal',version:1}});
    assert.equal(result.status, 404);
  }
  assert.equal((await f.b.call('notes', {method:'POST', data:{text:'伪造作者', audience:'personal', requestId:randomUUID(), authorId:note.authorId}})).status, 400);
  assert.equal((await f.client().call('notes', {headers:{'X-Xinwang-User':note.authorId, 'X-User-Id':note.authorId}})).status, 401);
  assert.equal((await f.a.call(`notes/${note.id}`)).body.note.text, '作者的共享文字');
  // Additional isolated test identity verifies authorization even if the database is later extended beyond two users.
  const id = randomUUID();
  f.database.run('INSERT INTO users VALUES (?,?,?,?,?)', id, 'outsider_fixture', '旁观测试账号', f.database.one('SELECT password_hash FROM users LIMIT 1').password_hash, Date.now());
  const token = f.database.newSession(id), outsider = f.client(); outsider.cookie = `xinwang_session=${token.token}`;
  assert.deepEqual((await outsider.call('notes')).body.notes, []);
  assert.equal((await outsider.call(`notes/${note.id}`)).status, 404);
});

test('CSRF, exact Origin and Host checks reject forged or cross-site mutations', async t => {
  const f = await fixture(t);
  const data = {text:'不应写入',audience:'personal',requestId:randomUUID()};
  for (const headers of [{'X-CSRF-Token':''},{'X-CSRF-Token':'forged'},{Origin:'null'},{Origin:'https://evil.example'},{Origin:f.origin + '.evil.example'},{'Sec-Fetch-Site':'cross-site'}]) {
    assert.equal((await f.a.call('notes', {method:'POST',data,headers})).status, 403);
  }
  assert.equal((await f.a.call('notes', {headers:{Host:'evil.example'}})).status, 421);
  assert.equal((await f.a.call('notes')).body.notes.length, 0);
  assert.equal((await f.client().call('auth/login', {method:'POST',data:{username:'person_a',password},headers:{Origin:'https://evil.example'}})).status, 403);
});

test('HTTPS production requires the trusted proxy and issues a Secure host-only cookie', async t => {
  const f = await fixture(t, {secure:true});
  const cookie = f.registered.headers['set-cookie'][0];
  assert.match(cookie, /^__Host-xinwang_session=/);
  assert.match(cookie, /; Secure$/);
  assert.equal(cookie.includes('Domain='), false);
  assert.equal((await f.a.call('notes', {headers:{'X-Forwarded-Proto':'http'}})).status, 426);
  assert.match((await f.a.call('notes')).headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal((await f.a.call('notes')).headers['cache-control'], 'no-store');
});

test('idempotent create retries do not duplicate, and stale edits/deletes do not overwrite newer content', async t => {
  const f = await fixture(t), key = randomUUID();
  const first = (await post(f.a, '原文', 'personal', null, key)).body.note;
  assert.equal((await post(f.a, '原文', 'personal', null, key)).body.note.id, first.id);
  assert.equal((await post(f.a, '不同内容', 'personal', null, key)).status, 409);
  assert.equal((await f.a.call(`notes/${first.id}`, {method:'PATCH',data:{text:'新版',audience:'personal',version:1}})).status, 200);
  assert.equal((await f.a.call(`notes/${first.id}`, {method:'PATCH',data:{text:'旧版覆盖',audience:'personal',version:1}})).status, 409);
  assert.equal((await f.a.call(`notes/${first.id}`, {method:'DELETE',data:{version:1}})).status, 409);
  assert.equal((await f.a.call(`notes/${first.id}`)).body.note.text, '新版');
  assert.equal((await f.a.call('notes')).body.notes.length, 1);
});

test('private/shared conversion is enforced on the backend, including withdrawal from the partner', async t => {
  const f = await fixture(t), note = (await post(f.a, '开始私密')).body.note;
  assert.equal((await f.a.call(`notes/${note.id}`, {method:'PATCH',data:{text:note.text,audience:'shared',version:1,expectedCoupleId:f.couple.id}})).status, 200);
  assert.equal((await f.b.call(`notes/${note.id}`)).status, 200);
  assert.equal((await f.a.call(`notes/${note.id}`, {method:'PATCH',data:{text:note.text,audience:'personal',version:2}})).status, 200);
  assert.equal((await f.b.call(`notes/${note.id}`)).status, 404);
  assert.equal((await f.b.call('notes')).body.notes.length, 0);
});

test('invitation rotation, expiry and account cap prevent unauthorised registration', async t => {
  const f = await fixture(t, {paired:false});
  const old = await f.a.call('couple/invite', {method:'POST',data:{}});
  const fresh = await f.a.call('couple/invite', {method:'POST',data:{}});
  const register = code => f.b.call('auth/register', {method:'POST',data:{username:'person_b',displayName:'测试乙',password,inviteCode:code}});
  assert.equal((await register(old.body.code)).status, 400);
  f.database.run('UPDATE invites SET expires_at=?', Date.now() - 1);
  assert.equal((await register(fresh.body.code)).status, 400);
  const usable = await f.a.call('couple/invite', {method:'POST',data:{}});
  assert.equal((await register(usable.body.code)).status, 201);
  assert.equal((await f.client().call('auth/register', {method:'POST',data:{username:'third_user',displayName:'第三者',password,inviteCode:usable.body.code}})).status, 403);
});

test('unbind revokes shared reads, retains each author records, and rebind does not republish old shared notes', async t => {
  const f = await fixture(t);
  const own = (await post(f.a, '自己保留')).body.note;
  const sharedA = (await post(f.a, '旧关系共享 A', 'shared', f.couple)).body.note;
  const sharedB = (await post(f.b, '旧关系共享 B', 'shared', f.couple)).body.note;
  assert.equal((await f.a.call('couple/leave', {method:'POST',data:{password:'wrong-password',coupleId:f.couple.id}})).status, 401);
  assert.equal((await f.a.call('couple/leave', {method:'POST',data:{password,coupleId:f.couple.id}})).status, 200);
  assert.equal((await f.b.call(`notes/${sharedA.id}`)).status, 404);
  assert.equal((await f.a.call(`notes/${sharedB.id}`)).status, 404);
  assert.equal((await f.a.call(`notes/${own.id}`)).status, 200);
  const invite = await f.a.call('couple/invite', {method:'POST',data:{}});
  const joined = await f.b.call('couple/join', {method:'POST',data:{code:invite.body.code}});
  assert.notEqual(joined.body.couple.id, f.couple.id);
  assert.equal((await f.b.call(`notes/${sharedA.id}`)).status, 404);
  assert.equal((await post(f.a, '错误关系', 'shared', f.couple)).status, 409);
});

test('profile settings synchronize to both users and reject stale versions', async t => {
  const f = await fixture(t);
  const value = {nameOne:'共同设定甲',nameTwo:'共同设定乙',anniversary:'2024-05-25T00:20',version:1};
  assert.equal((await f.a.call('couple/profile', {method:'PATCH',data:value})).status, 200);
  assert.equal((await f.b.call('session')).body.couple.profile.nameOne, '共同设定甲');
  assert.equal((await f.b.call('couple/profile', {method:'PATCH',data:value})).status, 409);
  assert.equal((await f.b.call('couple/profile', {method:'PATCH',data:{...value,version:2,anniversary:'2024-02-31T12:00'}})).status, 400);
});

test('imports are private, idempotent and atomic even when legacy files mark records shared', async t => {
  const f = await fixture(t), time = '2026-10-27T00:00:00.000Z';
  const note = {id:'old-id',text:'旧备份的私密文字',audience:'shared',createdAt:time,updatedAt:time};
  const send = notes => f.a.call('notes/import', {method:'POST',data:{notes}});
  assert.equal((await send([note])).body.added, 1);
  assert.equal((await send([note])).body.duplicates, 1);
  assert.equal((await f.a.call('notes')).body.notes[0].audience, 'personal');
  assert.equal((await f.b.call('notes')).body.notes.length, 0);
  assert.equal((await send([{...note,id:'new-id'}, {...note,id:'bad-id',text:''}])).status, 400);
  assert.equal((await f.a.call('notes')).body.notes.length, 1);
  const many = Array.from({length:498}, (_,i) => ({...note,id:`fill-${i}`}));
  f.database.importPrivate(f.registered.body.user.id, many);
  assert.equal((await send([{...note,id:'overflow-one'},{...note,id:'overflow-two'}])).status, 409);
  assert.equal(f.database.one('SELECT count(*) AS count FROM notes').count, 499);
});

test('logout and password changes revoke old sessions on other devices', async t => {
  const f = await fixture(t), otherDevice = f.client();
  assert.equal((await otherDevice.call('auth/login', {method:'POST',data:{username:'person_a',password}})).status, 200);
  const changed = await f.a.call('auth/password', {method:'POST',data:{currentPassword:password,newPassword:'a-new-test-only-password-2026'}});
  assert.equal(changed.status, 200);
  assert.equal((await otherDevice.call('notes')).status, 401);
  assert.equal((await f.a.call('notes')).status, 200);
  assert.equal((await otherDevice.call('auth/login', {method:'POST',data:{username:'person_a',password}})).status, 401);
  assert.equal((await otherDevice.call('auth/login', {method:'POST',data:{username:'person_a',password:'a-new-test-only-password-2026'}})).status, 200);
  await otherDevice.call('auth/logout', {method:'POST',data:{}});
  assert.equal((await otherDevice.call('notes')).status, 401);
});

test('auth throttling is persisted and invalid input/oversized requests do not mutate data', async t => {
  const f = await fixture(t);
  const user = f.registered.body.user;
  for (let i=0;i<12;i++) f.database.rateLimit('auth-user:blocked_fixture', 12);
  assert.equal((await f.client().call('auth/login', {method:'POST',data:{username:'blocked_fixture',password}})).status, 429);
  assert.equal((await f.a.call('notes', {method:'POST',data:{text:'x'.repeat(17000),audience:'personal',requestId:randomUUID()}})).status, 413);
  assert.equal((await f.a.call('notes', {method:'POST',raw:'{broken'})).status, 400);
  assert.equal(f.database.one('SELECT count(*) AS count FROM notes WHERE author_id=?', user.id).count, 0);
  await post(f.a, '持久保留的记录');
  await f.close();
  const reopened = new Database(f.databasePath);
  assert.equal(reopened.countUsers(), 2);
  assert.equal(reopened.visibleNotes(user.id)[0].text, '持久保留的记录');
  assert(reopened.one('SELECT count(*) AS count FROM rate_limits').count > 0);
  reopened.close();
});
