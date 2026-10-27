import assert from 'node:assert/strict';
import {request} from 'node:http';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createAppServer} from '../../server/app.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export async function fixture(t,database) {
  const app = createAppServer({root,...(database ? {database} : {databasePath:':memory:'})});
  await new Promise(resolve => app.server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => app.server.close(resolve)));
  const port=app.server.address().port;
  function client() {
    let cookie='', csrf='';
    return {get cookie(){return cookie;}, set cookie(value){cookie=value;},
      async call(path,{method='GET',data,headers={}}={}) {
        const payload=data===undefined ? '' : JSON.stringify(data);
        return new Promise((resolve,reject) => {
          const req=request({host:'127.0.0.1',port,path:'/api/'+path,method,headers:{Host:`127.0.0.1:${port}`,Cookie:cookie,...(method==='GET'?{}:{Origin:`http://127.0.0.1:${port}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload),'X-CSRF-Token':csrf}),...headers}},res=>{
            let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('end',()=>{
              let body;try{body=JSON.parse(text);}catch{body=text;}
              if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];
              if(body.csrfToken)csrf=body.csrfToken;
              resolve({status:res.statusCode,body,headers:res.headers,text});
            });
          });req.on('error',reject);req.end(payload);
        });
      }};
  }
  const a=client();
  const first=await a.call('auth/register',{method:'POST',data:{username:'owner_fixture',displayName:'测试甲',password:'only-fixture-password-2026'}});
  assert.equal(first.status,201,first.text);
  const invite=await a.call('couple/invite',{method:'POST',data:{}});
  assert.equal(invite.status,201,invite.text);
  return {...app,a,client,code:invite.body.code,first};
}
export const post=(client,text,audience='personal',couple)=>client.call('notes',{method:'POST',data:{text,audience,requestId:randomUUID(),...(couple?{expectedCoupleId:couple.id}:{})}});
export async function devicePrivacyScenario(t,database) {
  const f=await fixture(t,database),b=f.client();
  const ownerPrivate=await post(f.a,'OWNER_PRIVATE_SENTINEL');
  const entered=await b.call('auth/device-enter',{method:'POST',data:{code:f.code}});
  assert.equal(entered.status,201,entered.text);assert.equal(entered.body.user.passwordless,true);
  assert.match(entered.body.recoveryCode,/^[A-Za-z0-9_-]{43}$/);
  assert.match(entered.headers['set-cookie'][0],/Max-Age=7776000/);
  const privateNote=await post(b,'GUEST_PRIVATE_SENTINEL');
  assert.equal(privateNote.status,201,privateNote.text);
  const shared=await post(b,'SHARED_SENTINEL','shared',entered.body.couple);
  assert.equal(shared.status,201,shared.text);
  const ownerList=await f.a.call('notes'),guestList=await b.call('notes');
  assert(!ownerList.text.includes('GUEST_PRIVATE_SENTINEL'));assert(!guestList.text.includes('OWNER_PRIVATE_SENTINEL'));
  assert(ownerList.text.includes('SHARED_SENTINEL'));
  assert.equal((await f.a.call('notes/'+privateNote.body.note.id)).status,404);
  assert.equal((await b.call('notes/'+ownerPrivate.body.note.id)).status,404);
  assert.equal((await f.a.call('auth/device-backup',{method:'POST',data:{}})).status,403);
  assert(!(await f.a.call('session')).text.includes(entered.body.recoveryCode));
  assert.equal((await f.client().call('auth/device-enter',{method:'POST',data:{code:f.code}})).status,400);
  const c=f.client();
  assert.equal((await c.call('auth/device-recover',{method:'POST',data:{code:'x'.repeat(43)}})).status,401);
  const recovered=await c.call('auth/device-recover',{method:'POST',data:{code:entered.body.recoveryCode}});
  assert.equal(recovered.status,201,recovered.text);assert.equal(recovered.body.user.id,entered.body.user.id);
  assert.notEqual(recovered.body.recoveryCode,entered.body.recoveryCode);
  assert.equal((await b.call('notes')).status,401);
  assert.equal((await f.client().call('auth/device-recover',{method:'POST',data:{code:entered.body.recoveryCode}})).status,401);
  assert((await c.call('notes')).text.includes('GUEST_PRIVATE_SENTINEL'));
  const renewed=await c.call('auth/device-backup',{method:'POST',data:{}});
  assert.equal(renewed.status,200);assert.notEqual(renewed.body.recoveryCode,recovered.body.recoveryCode);
  assert.equal((await f.client().call('auth/device-recover',{method:'POST',data:{code:recovered.body.recoveryCode}})).status,401);
  assert.equal((await f.database.countUsers()),2);
  assert(!(JSON.stringify(await f.database.all('SELECT recovery_hash FROM device_users'))).includes(renewed.body.recoveryCode));
}
