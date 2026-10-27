import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request,createServer} from 'node:http';
import {renderConfiguration,startCloud} from '../server/cloud.mjs';
import {Database} from '../server/database.mjs';
import {root} from './helpers/device-fixture.mjs';

function database() {const db=new Database(':memory:'),close=db.close.bind(db);let closed=false;db.close=()=>{if(!closed){closed=true;close();}};return db;}
const setupKey='test-only-cloud-setup-at-least-32-characters';
test('cloud startup requires Render, HTTPS, external database and initialization key; no ephemeral fallback',()=>{
  const env={RENDER:'true',RENDER_SERVICE_ID:'fixture',RENDER_EXTERNAL_URL:'https://fixture.onrender.com',DATABASE_URL:'fixture',XINWANG_SETUP_KEY:setupKey};
  assert.equal(renderConfiguration(env).port,10000);
  for(const key of ['RENDER','RENDER_SERVICE_ID','DATABASE_URL','XINWANG_SETUP_KEY','RENDER_EXTERNAL_URL'])assert.throws(()=>renderConfiguration({...env,[key]:''}));
  for(const url of ['http://fixture.onrender.com','https://fixture.onrender.com/path','https://evil.example','https://fixture.onrender.com/'])assert.throws(()=>renderConfiguration({...env,RENDER_EXTERNAL_URL:url}));
});
test('cloud gateway retains secure cookies, initialization, Origin and CSRF restrictions',async t=>{
  const db=database(),app=await startCloud({root,database:db,publicOrigin:'https://fixture.onrender.com',setupKey,port:0,host:'127.0.0.1'});
  t.after(app.close);
  const port=app.server.address().port;
  function call(path,method='GET',data,headers={}) {
    const text=data===undefined?'':JSON.stringify(data);
    return new Promise((resolve,reject)=>{
      const req=request({host:'127.0.0.1',port,path,method,headers:{Host:'fixture.onrender.com','X-Forwarded-Proto':'https',...(method==='GET'?{}:{Origin:'https://fixture.onrender.com','Content-Type':'application/json','Content-Length':Buffer.byteLength(text)}),...headers}},res=>{
        let raw='';res.setEncoding('utf8');res.on('data',chunk=>raw+=chunk);res.on('end',()=>{let body;try{body=JSON.parse(raw);}catch{body=raw;}resolve({status:res.statusCode,headers:res.headers,body});});
      });req.on('error',reject);req.end(text);
    });
  }
  assert.equal((await call('/healthz','GET',undefined,{Host:'probe.local','X-Forwarded-Proto':'http'})).status,200);
  assert.equal((await call('/api/notes')).status,401);
  assert.equal((await call('/api/status','GET',undefined,{'X-Forwarded-Proto':'http'})).status,421);
  assert.equal((await call('/api/status','GET',undefined,{Host:'evil.example'})).status,421);
  const account={username:'cloud_fixture',displayName:'云端测试',password:'test-cloud-password-2026'};
  assert.equal((await call('/api/auth/register','POST',account)).status,403);
  const created=await call('/api/auth/register','POST',{...account,setupKey});
  assert.equal(created.status,201);assert.match(created.headers['set-cookie'][0],/^__Host-xinwang_session=.*; Secure$/);
  const cookie=created.headers['set-cookie'][0].split(';')[0],data={text:'private',audience:'personal',requestId:'cloud-test-request-123456'};
  assert.equal((await call('/api/notes','POST',data,{Cookie:cookie})).status,403);
  assert.equal((await call('/api/notes','POST',data,{Cookie:cookie,'X-CSRF-Token':created.body.csrfToken,Origin:'https://evil.example'})).status,403);
  assert.equal((await call('/api/notes','POST',data,{Cookie:cookie,'X-CSRF-Token':created.body.csrfToken})).status,201);
});
test('gateway bind failure closes backend and database',async t=>{
  const occupied=createServer();await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>occupied.close(resolve)));
  const db=database();
  await assert.rejects(startCloud({root,database:db,publicOrigin:'https://fixture.onrender.com',setupKey,port:occupied.address().port,host:'127.0.0.1'}),{code:'EADDRINUSE'});
  assert.throws(()=>db.countUsers());
});
