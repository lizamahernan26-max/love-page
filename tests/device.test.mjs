import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,devicePrivacyScenario,post} from './helpers/device-fixture.mjs';
import {Database} from '../server/database.mjs';
import {digest} from '../server/security.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';

test('passwordless partner has a distinct private identity, one-use entry and rotating recovery; owner cannot obtain her identity',t=>devicePrivacyScenario(t));
test('expired/replaced invitations, cross-site entry and an existing identity cannot be used to take over the partner',async t=>{
  const f=await fixture(t),client=f.client();
  assert.equal((await f.a.call('auth/device-enter',{method:'POST',data:{code:f.code}})).status,409);
  assert.equal((await client.call('auth/device-enter',{method:'POST',data:{code:f.code},headers:{Origin:'https://evil.example'}})).status,403);
  const rotated=await f.a.call('couple/invite',{method:'POST',data:{}});
  assert.equal((await client.call('auth/device-enter',{method:'POST',data:{code:f.code}})).status,400);
  f.database.run('UPDATE invites SET expires_at=? WHERE token_hash=?',Date.now()-1,digest(rotated.body.code));
  assert.equal((await client.call('auth/device-enter',{method:'POST',data:{code:rotated.body.code}})).status,400);
  assert.equal(f.database.countUsers(),1);
});
test('two concurrent invitation replays create exactly one partner; recovery renews only the authenticated device identity',async t=>{
  const f=await fixture(t),b=f.client(),c=f.client();
  const responses=await Promise.all([b,c].map(client=>client.call('auth/device-enter',{method:'POST',data:{code:f.code}})));
  assert.deepEqual(responses.map(x=>x.status).sort(),[201,400]);assert.equal(f.database.countUsers(),2);
  const guest=responses[0].status===201?b:c;
  const user=(await guest.call('session')).body.user;
  f.database.run('UPDATE sessions SET expires_at=? WHERE user_id=?',Date.now()+10000,user.id);
  assert.match((await guest.call('session')).headers['set-cookie'][0],/Max-Age=7776000/);
  assert((await post(guest,'still private')).status===201);
});
test('schema v1 upgrade retains existing identities and notes without converting a password account',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'xinwang-device-migration-'));
  t.after(async()=>{if(resolve(directory).startsWith(resolve(tmpdir())+sep+'xinwang-device-migration-'))await rm(directory,{recursive:true,force:true});});
  const path=join(directory,'migration.sqlite'),before=new Database(path);
  const account=before.register({username:'preserved_fixture',displayName:'保留测试'},'fixture-hash',null,true);
  const id=before.saveNote(account.id,{text:'preserve-existing-private',audience:'personal',requestId:'migration-test-request-123'});
  before.db.exec('DROP TABLE device_users; PRAGMA user_version=1;');before.close();
  const db=new Database(path);
  try {
    assert.equal(db.one('PRAGMA user_version').user_version,2);assert.equal(db.all('SELECT * FROM device_users').length,0);
    assert.equal(db.countUsers(),1);assert.equal(db.one('SELECT password_hash FROM users WHERE id=?',account.id).password_hash,'fixture-hash');
    assert.equal(db.visibleNotes(account.id)[0].id,id);assert.equal(db.visibleNotes(account.id)[0].text,'preserve-existing-private');
  }finally{db.close();}
});
