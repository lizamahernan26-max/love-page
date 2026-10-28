import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {packageNetlify,publicFiles} from '../scripts/package-netlify.mjs';

test('Netlify package excludes private data and publishes a CSP matching the actual inline script',async()=>{
  const root=await mkdtemp(join(tmpdir(),'xinwang-netlify-'));
  for(const path of publicFiles){await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),'PUBLIC_FIXTURE');}
  await writeFile(join(root,'pianai.mp3'),'MUSIC_FIXTURE');
  await writeFile(join(root,'.env'),'PRIVATE_CONFIGURATION_SENTINEL');
  await mkdir(join(root,'data'));await writeFile(join(root,'data/xinwang.sqlite'),'PRIVATE_DATABASE_SENTINEL');
  const script='window.fixture = true;',html=`<!doctype html><script data-xinwang-app>${script}</script>`;
  const result=await packageNetlify(root,{createHomepage:async()=>({html,revision:'fixture'})});
  assert.deepEqual((await readdir(result.directory)).sort(),['_headers','_redirects','index.html','pianai.mp3']);
  const combined=await Promise.all(result.files.map(file=>readFile(join(result.directory,file),'utf8')));
  assert(!combined.join('').includes('PRIVATE_CONFIGURATION_SENTINEL'));assert(!combined.join('').includes('PRIVATE_DATABASE_SENTINEL'));
  const policy=await readFile(join(result.directory,'_headers'),'utf8');
  assert(policy.includes("'sha256-"+createHash('sha256').update(script).digest('base64')+"'"));
  assert(policy.includes("connect-src 'self'"));assert(policy.includes('Cache-Control: no-store'));
  const proxy=await readFile(join(result.directory,'_redirects'),'utf8');assert.match(proxy,/^\/api\/\* https:\/\/[^\s]+\.neon\.tech\/api\/:splat 200!\n$/);
});
test('Netlify packaging preserves unrelated existing files and refuses to publish them',async()=>{
  const root=await mkdtemp(join(tmpdir(),'xinwang-netlify-existing-')),output=join(root,'netlify-output/public');
  await mkdir(output,{recursive:true});await writeFile(join(output,'unrelated.txt'),'KEEP_THIS_FILE');
  await assert.rejects(packageNetlify(root),/Unexpected publish file preserved/);
  assert.equal(await readFile(join(output,'unrelated.txt'),'utf8'),'KEEP_THIS_FILE');
});
