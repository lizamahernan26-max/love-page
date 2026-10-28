import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createNeonFunction,neonFunctionConfiguration} from '../server/neon-function.mjs';
import {Database} from '../server/database.mjs';
import {root} from './helpers/device-fixture.mjs';

const env={PUBLIC_ORIGIN:'https://xinwang.example',XINWANG_API_ORIGIN:'https://api.example',NEON_BRANCH:'fixture',XINWANG_SETUP_KEY:'test-only-setup-key-at-least-32-characters',DATABASE_URL_UNPOOLED:'test-database'};
test('Neon adapter rejects missing configuration and wrong origins before opening a database',async()=>{
  for(const key of ['PUBLIC_ORIGIN','XINWANG_API_ORIGIN','NEON_BRANCH','XINWANG_SETUP_KEY'])assert.throws(()=>neonFunctionConfiguration({...env,[key]:''}));
  for(const origin of ['http://api.example','https://api.example/path','https://api.example/'])assert.throws(()=>neonFunctionConfiguration({...env,XINWANG_API_ORIGIN:origin}));
  let opened=0;const databaseFactory=()=>{opened++;throw new Error('must not open');};
  const app=createNeonFunction({root,env,databaseFactory});
  assert.equal((await app.fetch(new Request('https://wrong.example/api/status'))).status,421);
  assert.equal((await app.fetch(new Request('https://api.example/'))).status,404);
  const missing=createNeonFunction({root,env:{},databaseFactory});
  assert.equal((await missing.fetch(new Request('https://api.example/api/status'))).status,503);
  assert.equal(opened,0);
});
test('Neon HTTPS adapter preserves identity, private note isolation, reciprocal messages and CSRF',async t=>{
  const db=new Database(':memory:'),close=db.close.bind(db);let closed=false;db.close=()=>{if(!closed){closed=true;close();}};
  const app=createNeonFunction({root,env,databaseFactory:async value=>{assert.equal(value,env.DATABASE_URL_UNPOOLED);return db;}});t.after(()=>app.close());
  function client(){let cookie='',csrf='';return {async call(path,method='GET',data,extra={}){
    const response=await app.fetch(new Request(env.XINWANG_API_ORIGIN+'/api/'+path,{method,headers:{Cookie:cookie,...(method==='GET'?{}:{Origin:env.PUBLIC_ORIGIN,'Content-Type':'application/json','X-CSRF-Token':csrf}),...extra},body:data===undefined?undefined:JSON.stringify(data)}));
    const text=await response.text(),body=JSON.parse(text);if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(body.csrfToken)csrf=body.csrfToken;
    return {status:response.status,headers:response.headers,body,text};
  }};}
  const a=client(),b=client();
  assert.equal((await a.call('notes')).status,401);
  const account={username:'adapter_owner',displayName:'测试甲',password:'adapter-fixture-password-2026',setupKey:env.XINWANG_SETUP_KEY};
  assert.equal((await a.call('auth/register','POST',account,{Origin:'https://evil.example'})).status,403);
  const first=await a.call('auth/register','POST',account);assert.equal(first.status,201);assert.match(first.headers.get('set-cookie'),/^__Host-xinwang_session=.*; Secure$/);
  const invite=await a.call('couple/invite','POST',{}),second=await b.call('auth/device-enter','POST',{code:invite.body.code});assert.equal(second.status,201);assert(second.body.user.passwordless);
  const note=(text,audience='personal')=>({text,audience,requestId:randomUUID(),expectedCoupleId:second.body.couple.id});
  assert.equal((await a.call('notes','POST',note('bad'),{'X-CSRF-Token':''})).status,403);
  const secretA=await a.call('notes','POST',note('PRIVATE_A')),secretB=await b.call('notes','POST',note('PRIVATE_B'));
  assert.equal(secretA.status,201);assert.equal(secretB.status,201);
  assert.equal((await a.call('notes','POST',note('SHARED_A','shared'))).status,201);
  assert.equal((await b.call('notes','POST',note('SHARED_B','shared'))).status,201);
  const listA=await a.call('notes'),listB=await b.call('notes');
  assert(!listA.text.includes('PRIVATE_B'));assert(!listB.text.includes('PRIVATE_A'));
  for(const list of [listA,listB]){assert(list.text.includes('SHARED_A'));assert(list.text.includes('SHARED_B'));}
  assert.equal((await a.call('notes/'+secretB.body.note.id)).status,404);
  assert.equal((await b.call('notes/'+secretA.body.note.id)).status,404);
  assert.equal((await a.call('session','GET',undefined,{'Sec-Fetch-Site':'cross-site'})).status,403);
});
