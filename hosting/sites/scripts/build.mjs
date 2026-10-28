import {copyFile,mkdir,readdir,lstat,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inlineHome} from './inline-home.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)),'..'),output = join(root,'dist');
const allowed = new Set(['server/index.js','.openai/hosting.json']);
async function inspect(path='') {
  try {for(const entry of await readdir(join(output,path),{withFileTypes:true})) {
    const name = path ? path+'/'+entry.name : entry.name;
    if(entry.isSymbolicLink())throw new Error('Unexpected link in build output');
    if(entry.isDirectory())await inspect(name);
    else if(!entry.isFile() || !allowed.has(name))throw new Error('Unexpected output preserved: '+name);
  }}catch(error){if(error.code!=='ENOENT')throw error;}
}
await inspect();
for(const [source,target] of [['.openai/hosting.json','.openai/hosting.json']]){
  await mkdir(dirname(join(output,target)),{recursive:true});
  const info = await lstat(join(root,source));if(!info.isFile()||info.isSymbolicLink())throw new Error('Unexpected source');
  await copyFile(join(root,source),join(output,target));
}
const {html,revision}=await inlineHome(join(root,'frontend'));
const source=await readFile(join(root,'worker/index.js'),'utf8');
const marker='const embeddedHome = null; // Replaced by the build.';
if(!source.includes(marker))throw new Error('Missing homepage build marker');
await mkdir(join(output,'server'),{recursive:true});
await writeFile(join(output,'server/index.js'),source.replace(marker,'const embeddedHome = '+JSON.stringify({html,revision})+';'));
console.log('Built self-contained homepage '+revision+' with the unchanged API gateway; existing files preserved.');
