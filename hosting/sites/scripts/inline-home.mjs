import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';

export async function inlineHome(frontendRoot){
  const root=resolve(frontendRoot),manifest=JSON.parse(await readFile(join(root,'source-manifest.json'),'utf8'));
  for(const [path,sha] of Object.entries(manifest.files)){
    if(!/^(index\.html|(?:assets|styles|js)\/[\w./-]+)$/.test(path)||path.split('/').includes('..'))throw new Error('Invalid public path');
    if(createHash('sha256').update(await readFile(join(root,path))).digest('hex')!==sha)throw new Error('Frontend snapshot changed: '+path);
  }
  const lily='data:image/svg+xml;base64,'+(await readFile(join(root,'assets/lily.svg'))).toString('base64');
  const font='data:font/woff2;base64,'+(await readFile(join(root,'assets/fonts/lxgw-wenkai-mono-tc-numerals.woff2'))).toString('base64');
  let html=await readFile(join(root,'index.html'),'utf8');
  for(const name of ['scene','app','whispers','online']){
    const css=(await readFile(join(root,`styles/${name}.css`),'utf8')).replaceAll('../assets/fonts/lxgw-wenkai-mono-tc-numerals.woff2',font).replace(/<\/style/gi,'<\\/style');
    const tag=`<link rel="stylesheet" href="styles/${name}.css">`;
    if(!html.includes(tag))throw new Error('Missing stylesheet: '+name);
    html=html.replace(tag,`<style data-xinwang-style="${name}">${css}</style>`);
  }
  html=html.replace(/\s*<link rel="preload" href="assets\/fonts\/[^>]+>/,'').replaceAll('assets/lily.svg',lily);
  const result=await build({entryPoints:[join(root,'js/app.js')],bundle:true,write:false,format:'iife',platform:'browser',target:['safari15','chrome100'],charset:'utf8',minify:false,metafile:true,legalComments:'inline',logLevel:'silent'});
  if(result.outputFiles.length!==1||Object.values(result.metafile.outputs).some(value=>value.imports.length))throw new Error('Bundle still has external imports');
  const script=result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
  html=html.replace('<script type="module" src="js/app.js"></script>',`<script data-xinwang-app>${script}</script>`);
  const revision=createHash('sha256').update(html).digest('hex').slice(0,16);
  html=html.replace('<head>',`<head>\n<meta name="xinwang-build" content="${revision}">`);
  return {html,revision};
}
