import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createAppServer} from '../server/app.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),artifacts=join(root,'tests/artifacts');await mkdir(artifacts,{recursive:true});
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PATH || 'playwright');
const {server}=createAppServer({root,databasePath:':memory:'});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,errors=[],checks=[];
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});
const ownerContext=await browser.newContext({viewport:{width:1440,height:1000}}),guestContext=await browser.newContext({viewport:{width:390,height:844}});
const owner=await ownerContext.newPage(),guest=await guestContext.newPage();
for(const page of [owner,guest])page.on('pageerror',error=>errors.push(error.message));
const check=text=>{checks.push(text);console.log('PASS '+text);};
async function notes(page,text) {
  await page.locator('#accountDialog [data-close]').click();await page.locator('[data-dialog="whispersDialog"]').click();
  await page.locator('#onlineText').fill(text);await page.locator('#onlineSubmit').click();await page.waitForFunction(()=>document.getElementById('onlineText').value==='');
}
try {
  await owner.goto(origin);await owner.locator('#onlineEntry').click();
  for(const [name,value] of Object.entries({username:'device_owner',displayName:'演示甲',password:'browser-device-fixture-2026',passwordAgain:'browser-device-fixture-2026'}))await owner.locator(`#onlineRegisterForm [name="${name}"]`).fill(value);
  await owner.locator('#onlineRegisterForm button[type=submit]').click();await owner.locator('#onlineSignedIn').waitFor({state:'visible'});
  await owner.locator('#onlineQuickInvite').click();await owner.waitForFunction(()=>document.getElementById('onlineQuickLink').value.includes('#enter='));
  const link=await owner.locator('#onlineQuickLink').inputValue();
  await notes(owner,'OWNER_BROWSER_PRIVATE');
  await guest.goto(link);await guest.locator('#onlineDeviceEnter').waitFor({state:'visible'});
  assert.equal(new URL(guest.url()).hash,'');assert(await guest.locator('#onlineSignedOut').isHidden());
  await guest.screenshot({path:join(artifacts,'device-phone-entry-v05.png'),fullPage:true});
  await guest.locator('#onlineDeviceEnter').click();await guest.locator('#onlineRecoveryResult').waitFor({state:'visible'});
  const recovery=await guest.locator('#onlineRecoveryCode').inputValue();assert.equal(recovery.length,43);
  assert(await guest.locator('#onlinePasswordSection').isHidden());
  check('手机专属入口没有注册密码表单，链接片段及时移除，进入后显示自己的恢复码');
  await notes(guest,'GUEST_BROWSER_PRIVATE');
  assert(!(await guest.locator('#onlineList').innerText()).includes('OWNER_BROWSER_PRIVATE'));
  await owner.locator('#onlineRefresh').click();assert(!(await owner.locator('#onlineList').innerText()).includes('GUEST_BROWSER_PRIVATE'));
  await guest.reload();await guest.locator('#onlineTag').waitFor({state:'visible'});
  await guest.locator('[data-dialog="whispersDialog"]').click();await guest.locator('#onlineText').waitFor({state:'visible'});
  assert((await guest.locator('#onlineList').innerText()).includes('GUEST_BROWSER_PRIVATE'));
  check('同一手机刷新后自动识别，自己的记录持久可见，对方私密内容没有传到页面');
  for(const viewport of [{width:390,height:844},{width:320,height:568},{width:812,height:375}]){
    await guest.setViewportSize(viewport);assert(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await guest.setViewportSize({width:390,height:844});await guest.screenshot({path:join(artifacts,'device-phone-private-demo-v05.png'),fullPage:true});
  check('手机、窄屏、横屏面板没有横向溢出');
  const recoveredContext=await browser.newContext({viewport:{width:390,height:844}}),recovered=await recoveredContext.newPage();
  await recovered.goto(origin);await recovered.locator('#onlineEntry').click();await recovered.getByText('换手机／恢复自己的空间',{exact:true}).click();
  await recovered.locator('#onlineRecoveryInput').fill(recovery);await recovered.locator('#onlineRecoveryForm button[type=submit]').click();await recovered.locator('#onlineSignedIn').waitFor({state:'visible'});
  const next=await recovered.locator('#onlineRecoveryCode').inputValue();assert.equal(next.length,43);assert.notEqual(next,recovery);
  await guest.locator('#onlineRefresh').click();await guest.locator('#onlineMemberContent').waitFor({state:'hidden'});
  check('新设备使用恢复码进入同一身份，旧设备失效且旧记录清空');
  assert.deepEqual(errors,[]);check('免登录流程无 JavaScript 异常');
} finally {
  await writeFile(join(artifacts,'device-browser-results.json'),JSON.stringify({testedAt:new Date().toISOString(),checks,errors},null,2));
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
