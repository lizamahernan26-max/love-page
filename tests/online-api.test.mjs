import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OnlineApi} from '../js/online-api.js';

test('out-of-order session replies cannot restore the previous account after switching', async t => {
  const pending = [];
  t.mock.method(globalThis,'fetch',() => new Promise(resolve => pending.push(resolve)));
  const api = new OnlineApi(); api.user = {id:'first'};
  const old = api.loadSession(), fresh = api.loadSession();
  pending[1](new Response(JSON.stringify({user:{id:'second'},csrfToken:'second-token'}),{status:200}));
  await fresh;
  pending[0](new Response(JSON.stringify({user:{id:'first'},csrfToken:'first-token'}),{status:200}));
  await old;
  assert.equal(api.user.id,'second'); assert.equal(api.csrf,'second-token');
});

test('cross-account and expired responses never retain private records; old replies cannot clear a newer account', async t => {
  let resolveResponse;
  t.mock.method(globalThis,'fetch',() => new Promise(resolve => {resolveResponse = resolve;}));
  const api = new OnlineApi(); api.user = {id:'first'}; api.notes = [{text:'first-private'}];
  const mismatch = api.refreshNotes();
  resolveResponse(new Response(JSON.stringify({viewerId:'second',notes:[{text:'second-private'}]}),{status:200,headers:{'X-Xinwang-User':'second'}}));
  await assert.rejects(mismatch,/账号已切换/);
  assert.equal(api.user,null); assert.deepEqual(api.notes,[]);
  api.user = {id:'first'};
  const old = api.refreshNotes(); api.clear(); api.user = {id:'second'}; api.notes = [{text:'second-private'}];
  resolveResponse(new Response(JSON.stringify({viewerId:'first',notes:[{text:'first-private'}]}),{status:200,headers:{'X-Xinwang-User':'first'}}));
  await assert.rejects(old,/上一会话/);
  assert.equal(api.user.id,'second'); assert.deepEqual(api.notes,[{text:'second-private'}]);
  const expired = api.refreshNotes();
  resolveResponse(new Response(JSON.stringify({error:{code:'login',message:'expired'}}),{status:401}));
  await assert.rejects(expired,/expired/); assert.equal(api.user,null); assert.deepEqual(api.notes,[]);
});
