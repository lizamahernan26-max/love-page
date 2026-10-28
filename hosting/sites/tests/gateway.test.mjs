import {test} from 'node:test';
import assert from 'node:assert/strict';
import gateway from '../worker/index.js';
const origin='https://xinwang.example',env={XINWANG_API_ORIGIN:'https://api.example'};
test('gateway forwards only app authentication, preserves secure cookies and never caches private responses',async t=>{
  let captured;
  t.mock.method(globalThis,'fetch',async(url,options)=>{captured={url:String(url),...options};return Response.json({ok:true},{headers:{'Set-Cookie':'__Host-xinwang_session=fixture; Path=/; HttpOnly; SameSite=Strict; Secure'}});});
  const response=await gateway.fetch(new Request(origin+'/api/notes',{method:'POST',headers:{Cookie:'platform_private=hidden; __Host-xinwang_session=fixture','oai-authenticated-user-id':'not-for-neon',Origin:origin,'Content-Type':'application/json','X-CSRF-Token':'fixture'},body:'{}'}),env);
  assert.equal(captured.url,'https://api.example/api/notes');assert.equal(captured.headers.get('cookie'),'__Host-xinwang_session=fixture');assert.equal(captured.headers.get('oai-authenticated-user-id'),null);assert.equal(captured.headers.get('origin'),origin);assert.equal(captured.headers.get('x-csrf-token'),'fixture');
  assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict; Secure/);assert.equal(response.headers.get('cache-control'),'no-store');
});
test('static gateway serves only reviewed public files and never forwards cookies to GitHub',async t=>{
  let captured,calls=0;t.mock.method(globalThis,'fetch',async(url,options)=>{calls++;captured={url:String(url),...options};return new Response('asset',{headers:{'Set-Cookie':'untrusted=1'}});});
  const response=await gateway.fetch(new Request(origin+'/pianai.mp3',{headers:{Cookie:'private=hidden',Range:'bytes=0-99'}}),env);
  assert.equal(new URL(captured.url).pathname,'/love-page/pianai.mp3');assert.equal(new URL(captured.url).searchParams.get('v'),'8bcd26e89c39');assert.equal(captured.headers.get('range'),'bytes=0-99');assert.equal(captured.headers.get('cookie'),null);assert.equal(response.headers.get('set-cookie'),null);
  for(const path of ['/.env','/server/app.mjs','/data/xinwang.sqlite','/unknown'])assert.equal((await gateway.fetch(new Request(origin+path),env)).status,404);
  assert.equal(calls,1);
  assert.equal((await gateway.fetch(new Request(origin+'/'),env)).status,200);
  assert.equal(new URL(captured.url).pathname,'/love-page/');
  assert.equal(captured.redirect,'manual');
});
test('missing backend and network failures remain unavailable rather than simulating successful saves',async t=>{
  assert.equal((await gateway.fetch(new Request(origin+'/api/status'),{})).status,503);
  assert.equal((await gateway.fetch(new Request('http://xinwang.example/'),env)).status,426);
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('network');});
  assert.equal((await gateway.fetch(new Request(origin+'/api/notes'),env)).status,503);
});
