import {readFile,writeFile,copyFile,mkdir,readdir,lstat} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
export const publicFiles=['index.html','assets/lily.svg','assets/fonts/OFL.txt','assets/fonts/lxgw-wenkai-mono-tc-numerals.woff2','js/app.js','js/config.js','js/heart.js','js/love-words.js','js/music.js','js/online-api.js','js/online-space.js','js/whisper-backup.js','js/whisper-store.js','js/whispers.js','styles/app.css','styles/online.css','styles/scene.css','styles/whispers.css'];
const apiOrigin='https://br-patient-silence-a1lthltq-xinwang.compute.c-1.ap-southeast-1.aws.neon.tech';
const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
async function folder(path){try{const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Unexpected build directory');}catch(error){if(error.code!=='ENOENT')throw error;await mkdir(path,{recursive:true});}}
export async function packageNetlify(root=projectRoot,{createHomepage}={}){
  const output=join(root,'netlify-output'),snapshot=join(output,'snapshot'),publish=join(output,'public');
  await folder(output);await folder(snapshot);await folder(publish);
  const allowed=new Set(['index.html','pianai.mp3','_headers','_redirects']);
  for(const item of await readdir(publish,{withFileTypes:true}))if(!item.isFile()||item.isSymbolicLink()||!allowed.has(item.name))throw new Error('Unexpected publish file preserved: '+item.name);
  const hashes={};
  for(const path of publicFiles){
    const source=join(root,path),target=join(snapshot,path),info=await lstat(source);if(!info.isFile()||info.isSymbolicLink())throw new Error('Unexpected source');
    await folder(dirname(target));await copyFile(source,target);hashes[path]=createHash('sha256').update(await readFile(source)).digest('hex');
  }
  await writeFile(join(snapshot,'source-manifest.json'),JSON.stringify({files:hashes},null,2));
  const builder=process.env.XINWANG_INLINE_BUILDER||join(root,'hosting/sites/scripts/inline-home.mjs');
  const inlineHome=createHomepage||(await import(pathToFileURL(builder))).inlineHome;
  const {html,revision}=await inlineHome(snapshot);
  await writeFile(join(publish,'index.html'),html);await copyFile(join(root,'pianai.mp3'),join(publish,'pianai.mp3'));
  await writeFile(join(publish,'_redirects'),`/api/* ${apiOrigin}/api/:splat 200!\n`);
  const script=html.match(/<script data-xinwang-app>([\s\S]*?)<\/script>/)?.[1];if(!script)throw new Error('Bundled script missing');
  const scriptHash=createHash('sha256').update(script).digest('base64');
  await writeFile(join(publish,'_headers'),`/*\n  Cache-Control: no-store\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  X-Xinwang-Build: ${revision}\n  Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-${scriptHash}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; media-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'\n`);
  return {directory:publish,files:[...allowed],revision,apiOrigin,privateDataIncluded:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(await packageNetlify()));
