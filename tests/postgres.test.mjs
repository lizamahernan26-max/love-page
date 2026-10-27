import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {PostgresDatabase,neonConnectionOptions} from '../server/database-postgres.mjs';
import {fixture,post,devicePrivacyScenario} from './helpers/device-fixture.mjs';

const value=process.env.XINWANG_TEST_PG_URL;
async function database() {
  const url=new URL(value);
  if(url.hostname!=='127.0.0.1' || !/^\/xinwang_test_[a-f0-9]+$/.test(url.pathname))throw new Error('PostgreSQL 测试仅允许专用本机临时数据库。');
  const db=new PostgresDatabase(new Pool({connectionString:value,max:4}));
  await db.initialize();
  await db.query('TRUNCATE notes,sessions,invites,device_users,couples,users,rate_limits CASCADE');
  return db;
}
test('Neon connection enforces verified TLS and disallows host or certificate override parameters',()=>{
  const config=neonConnectionOptions('postgresql://fixture:fixture@ep-test.neon.tech/neondb?sslmode=require&channel_binding=require');
  assert.equal(config.ssl.rejectUnauthorized,true);assert.equal(config.enableChannelBinding,true);assert.equal(config.max,2);
  for(const url of ['postgres://fixture:fixture@example.com/db','postgres://fixture:fixture@ep-test.neon.tech/db?sslmode=disable','postgres://fixture:fixture@ep-test.neon.tech/db?sslrootcert=bad','postgres://fixture:fixture@ep-test.neon.tech/db?host=evil.example'])assert.throws(()=>neonConnectionOptions(url));
});
test('real PostgreSQL: one-use device entry, recovery rotation and private/shared permission behavior',{skip:!value},async t=>devicePrivacyScenario(t,await database()));
test('real PostgreSQL: concurrent entry and stale edits serialize; reconnect retains notes and schema',{skip:!value},async t=>{
  const db=await database(),f=await fixture(t,db),b=f.client(),c=f.client();
  const responses=await Promise.all([b,c].map(client=>client.call('auth/device-enter',{method:'POST',data:{code:f.code}})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,400]);assert.equal(await db.countUsers(),2);
  const note=(await post(f.a,'persist-original')).body.note;
  const updates=await Promise.all(['first','second'].map(text=>f.a.call('notes/'+note.id,{method:'PATCH',data:{text,audience:'personal',version:1}})));
  assert.deepEqual(updates.map(r=>r.status).sort(),[200,409]);
  const again=new PostgresDatabase(new Pool({connectionString:value,max:2}));
  try {await again.initialize();assert.equal(await again.countUsers(),2);const stored=await again.visibleNotes(f.first.body.user.id);assert.equal(stored.length,1);assert.equal(stored[0].version,2);}finally{await again.close();}
});
