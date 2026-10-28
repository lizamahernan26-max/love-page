import {readFile,writeFile,mkdir,copyFile,lstat} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=process.argv[2]&&resolve(process.argv[2]);
if(!source)throw new Error('Provide the canonical hajiru source directory.');
const files=['index.html','assets/lily.svg','assets/fonts/OFL.txt','assets/fonts/lxgw-wenkai-mono-tc-numerals.woff2','js/app.js','js/config.js','js/heart.js','js/love-words.js','js/music.js','js/online-api.js','js/online-space.js','js/whisper-backup.js','js/whisper-store.js','js/whispers.js','styles/app.css','styles/online.css','styles/scene.css','styles/whispers.css'];
const hashes={};
for(const path of files){
  const input=join(source,path),output=join(root,'frontend',path);
  const info=await lstat(input);if(!info.isFile()||info.isSymbolicLink())throw new Error('Unexpected public source: '+path);
  await mkdir(dirname(output),{recursive:true});
  try{const target=await lstat(output);if(!target.isFile()||target.isSymbolicLink())throw new Error('Unexpected output: '+path);}catch(error){if(error.code!=='ENOENT')throw error;}
  await copyFile(input,output);hashes[path]=createHash('sha256').update(await readFile(input)).digest('hex');
}
await writeFile(join(root,'frontend/source-manifest.json'),JSON.stringify({files:hashes},null,2)+'\n');
console.log('Copied '+files.length+' reviewed public files; no credentials, database or user content.');
