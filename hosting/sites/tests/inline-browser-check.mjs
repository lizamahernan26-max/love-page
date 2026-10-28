import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import gateway from '../dist/server/index.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const project=resolve(process.env.XINWANG_SOURCE || '../xinwang-hosting');
const {createAppServer}=await import(pathToFileURL(join(project,'server/app.mjs')));
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PATH || 'playwright');
const response=await gateway.fetch(new Request('https://xinwang.example/'),{}),html=await response.text();
assert.equal(response.headers.get('cache-control'),'no-store');
assert(!/<link[^>]+rel="stylesheet"/.test(html));assert(!/<script[^>]+src=/.test(html));
assert(html.includes('data:image/svg+xml;base64,'));assert(html.includes('data:font/woff2;base64,'));
const app=createAppServer({root:project,databasePath:':memory:',setupKey:'inline-browser-only-setup-key-2026'});
const handler=app.server.listeners('request')[0],blocked=[];
app.server.removeAllListeners('request');app.server.on('request',(req,res)=>{
  const path=req.url.split('?')[0];
  if(path==='/'||path==='/index.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);}
  else if(path.startsWith('/api/')||path==='/pianai.mp3')handler(req,res);
  else{blocked.push(path);res.writeHead(503);res.end('External frontend files deliberately unavailable.');}
});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${app.server.address().port}`,errors=[],checks=[],artifacts=join(root,'tests/artifacts');await mkdir(artifacts,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});
const check=message=>{checks.push(message);console.log('PASS '+message);};
const context=await browser.newContext({viewport:{width:390,height:844},userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.65',isMobile:true,hasTouch:true,deviceScaleFactor:1});
const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto(origin);await page.waitForFunction(()=>Number(document.querySelector('#days').textContent)>0);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(11, 7, 16)');
  assert(await page.locator('.lily-left').evaluate(img=>img.complete&&img.naturalWidth>0));
  assert(await page.locator('.lily-right').evaluate(img=>img.complete&&img.naturalWidth>0));
  await page.evaluate(()=>document.fonts.ready);
  assert(await page.evaluate(()=>document.fonts.check('16px "LXGW WenKai Mono TC"','0123456789')));
  const before=await page.locator('#seconds').innerText();await page.waitForFunction(value=>document.querySelector('#seconds').textContent!==value,before);
  assert(await page.locator('#canvas').evaluate(canvas=>{const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>0)return true;return false;}));
  check('With external CSS, JS, fonts and images unavailable, the inline homepage still renders stars, heart, lilies, Kai numerals and a live timer.');
  for(const viewport of [{width:390,height:844},{width:320,height:568},{width:812,height:375},{width:1440,height:1000}]){
    await page.setViewportSize(viewport);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(3500);await page.screenshot({path:join(artifacts,'inline-phone-390.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:join(artifacts,'inline-desktop.png'),fullPage:true});
  check('Phone, narrow phone, landscape and desktop layouts do not overflow.');
  await page.goto('about:blank');await page.goto(origin+'/#setup=inline-browser-only-setup-key-2026');await page.locator('#onlineRegisterForm').waitFor({state:'visible'});
  for(const [name,value] of Object.entries({username:'inline_fixture',displayName:'测试甲',password:'inline-only-test-password-2026',passwordAgain:'inline-only-test-password-2026'}))await page.locator(`#onlineRegisterForm [name="${name}"]`).fill(value);
  await page.locator('#onlineRegisterForm button[type=submit]').click();await page.locator('#onlineSignedIn').waitFor({state:'visible'});
  await page.locator('#onlineQuickInvite').click();await page.waitForFunction(()=>document.querySelector('#onlineQuickLink').value.includes('#enter='));
  const invite=await page.locator('#onlineQuickLink').inputValue();
  const guestContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),guest=await guestContext.newPage();guest.on('pageerror',error=>errors.push(error.message));
  await guest.goto(invite);await guest.locator('#onlineDeviceEnter').click();await guest.locator('#onlineRecoveryResult').waitFor({state:'visible'});
  for(const [target,text] of [[page,'INLINE_OWNER_PRIVATE'],[guest,'INLINE_GUEST_PRIVATE']]){
    await target.locator('#accountDialog [data-close]').click();await target.locator('[data-dialog="whispersDialog"]').click();
    await target.locator('#onlineText').fill(text);await target.locator('#onlineSubmit').click();await target.waitForFunction(()=>document.querySelector('#onlineText').value==='');
  }
  await page.locator('#onlineRefresh').click();assert(!(await page.locator('#onlineList').innerText()).includes('INLINE_GUEST_PRIVATE'));
  assert(!(await guest.locator('#onlineList').innerText()).includes('INLINE_OWNER_PRIVATE'));
  await guest.locator('#onlineAudience').selectOption('shared');await guest.locator('#onlineText').fill('INLINE_SHARED_MESSAGE');await guest.locator('#onlineSubmit').click();await guest.waitForFunction(()=>document.querySelector('#onlineText').value==='');
  await page.locator('#onlineRefresh').click();await page.getByText('INLINE_SHARED_MESSAGE',{exact:true}).waitFor({state:'visible'});
  check('Bundled first setup, girlfriend entry, private isolation and shared message delivery retain the original backend behavior.');
  assert.deepEqual(blocked,[]);assert.deepEqual(errors,[]);
  check('No external frontend subrequests and no page JavaScript errors.');
}finally{
  await writeFile(join(artifacts,'inline-results.json'),JSON.stringify({testedAt:new Date().toISOString(),build:response.headers.get('x-xinwang-build'),checks,errors,blocked,physicalPhone:false},null,2));
  await browser.close();await new Promise(resolve=>app.server.close(resolve));
}
