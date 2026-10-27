import {createRequire} from 'node:module';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createAppServer} from '../server/app.mjs';
import {createBackup, readBackup} from '../js/whisper-backup.js';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = join(root,'tests/artifacts'); await mkdir(artifacts,{recursive:true});
const directory = await mkdtemp(join(tmpdir(),'xinwang-pair-browser-'));
const {server} = createAppServer({root,databasePath:join(directory,'test.sqlite')});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless:true,...(process.env.BROWSER_PATH ? {executablePath:process.env.BROWSER_PATH} : {channel:'chrome'})});
const checks = [], errors = [], requests = [];
const record = value => {checks.push(value); console.log(`PASS ${value}`);};
const password = 'browser-fixture-password-2026';
function watch(page) {
  page.on('pageerror',error => errors.push(error.message));
  page.on('response',response => {if (response.status() >= 500 || (response.status() >= 400 && !response.url().includes('/api/'))) requests.push(`${response.status()} ${new URL(response.url()).pathname}`);});
}
async function closePanel(page) {for (const id of ['whispersDialog','settingsDialog','accountDialog']) if (await page.locator(`#${id}`).evaluate(node => node.open)) await page.locator(`#${id} [data-close]`).click();}
async function account(page) {await closePanel(page); await page.locator('#onlineEntry').click();}
async function whispers(page) {await closePanel(page); await page.locator('[data-dialog="whispersDialog"]').click(); await page.locator('#onlineText').waitFor({state:'visible'});}
async function register(page, username, displayName, invite) {
  await account(page);
  if (await page.locator('#onlineRegisterForm').isHidden()) await page.locator('#onlineRegisterToggle').click();
  for (const [name,value] of Object.entries({username,displayName,password,passwordAgain:password,...(invite ? {inviteCode:invite} : {})})) await page.locator(`#onlineRegisterForm [name="${name}"]`).fill(value);
  await page.locator('#onlineRegisterForm button[type=submit]').click();
  await page.locator('#onlineSignedIn').waitFor({state:'visible'});
}
async function login(page, username) {
  await account(page);
  if (await page.locator('#onlineLoginForm').isHidden()) await page.locator('#onlineRegisterToggle').click();
  await page.locator('#onlineLoginForm [name=username]').fill(username);
  await page.locator('#onlineLoginForm [name=password]').fill(password);
  await page.locator('#onlineLoginForm button[type=submit]').click();
  await page.locator('#onlineSignedIn').waitFor({state:'visible'});
}
async function submit(page,text,audience='personal') {
  await page.locator('#onlineText').fill(text); await page.locator('#onlineAudience').selectOption(audience);
  await page.locator('#onlineSubmit').click();
  await page.waitForFunction(() => document.getElementById('onlineText').value === '' && !document.getElementById('onlineSubmit').disabled);
}
let a, b;
try {
  const aContext = await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',acceptDownloads:true});
  const bContext = await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN',acceptDownloads:true});
  await aContext.addInitScript(() => localStorage.setItem('xinwang.whispers.v1', JSON.stringify({schemaVersion:1,revision:'legacy-fixture',notes:[{id:'old',text:'LEGACY_LOCAL_PRIVATE_SENTINEL',audience:'personal',createdAt:'2026-10-27T00:00:00Z',updatedAt:'2026-10-27T00:00:00Z'}]})));
  a = await aContext.newPage(); b = await bContext.newPage(); watch(a); watch(b);
  await a.goto(base); await a.locator('#onlineEntry').waitFor({state:'visible'});
  await a.waitForTimeout(3300);
  await a.screenshot({path:join(artifacts,'pair-desktop-home-v04.png'),fullPage:true});
  await register(a,'fixture_a','测试甲');
  await a.locator('#onlineCreateInvite').click();
  await a.waitForFunction(() => document.getElementById('onlineInviteCode').value.length === 43);
  const invite = await a.locator('#onlineInviteCode').inputValue();
  await b.goto(base); await b.locator('#onlineEntry').waitFor({state:'visible'});
  await b.waitForTimeout(3300); await b.screenshot({path:join(artifacts,'pair-phone-home-v04.png'),fullPage:true});
  await register(b,'fixture_b','测试乙',invite);
  await a.waitForFunction(() => document.getElementById('onlinePairState').textContent.includes('测试乙'));
  assert.equal(await a.evaluate(() => document.cookie.includes('xinwang_session')),false);
  record('独立电脑/手机会话完成首个账号、邀请码、第二账号与绑定；会话 Cookie 对脚本不可读');

  await whispers(a); await submit(a,'A_PRIVATE_SENTINEL，仅作者可见');
  await whispers(b); await submit(b,'B_PRIVATE_SENTINEL，仅作者可见');
  await submit(a,'测试共享：今天的星空也想一起看。','shared');
  await b.getByText('测试共享：今天的星空也想一起看。',{exact:true}).waitFor({timeout:12000});
  assert.equal(await a.locator('body').innerText().then(text => text.includes('B_PRIVATE_SENTINEL')),false);
  assert.equal(await b.locator('body').innerText().then(text => text.includes('A_PRIVATE_SENTINEL')),false);
  assert.equal(await a.locator('body').innerText().then(text => text.includes('LEGACY_LOCAL_PRIVATE_SENTINEL')),false);
  assert.equal(await b.locator('.whispers-note').filter({hasText:'测试共享：'}).locator('button').count(),0);
  assert.equal(await a.evaluate(() => JSON.stringify(localStorage).includes('A_PRIVATE_SENTINEL')),false);
  await b.screenshot({path:join(artifacts,'pair-phone-notes-v04.png')});
  record('共享记录自动出现在另一手机；两人的私密内容互不可见，旧浏览器副本不自动读取，收件人没有修改按钮');

  const secondDeviceContext = await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN'});
  const secondDevice = await secondDeviceContext.newPage(); watch(secondDevice);
  await secondDevice.goto(base); await secondDevice.locator('#onlineEntry').waitFor({state:'visible'}); await login(secondDevice,'fixture_a'); await whispers(secondDevice);
  await a.locator('.whispers-note').filter({hasText:'A_PRIVATE_SENTINEL'}).getByRole('button',{name:'编辑自己的心里话'}).click();
  await a.locator('#onlineText').fill('第一台设备尚未提交的草稿');
  await secondDevice.locator('.whispers-note').filter({hasText:'A_PRIVATE_SENTINEL'}).getByRole('button',{name:'编辑自己的心里话'}).click();
  await secondDevice.locator('#onlineText').fill('A_PRIVATE_NEW_VERSION，来自另一台设备'); await secondDevice.locator('#onlineSubmit').click();
  await secondDevice.getByText('A_PRIVATE_NEW_VERSION，来自另一台设备',{exact:true}).waitFor();
  await a.locator('#onlineSubmit').click();
  await a.waitForFunction(() => document.getElementById('onlineStatus').textContent.includes('没有覆盖'));
  assert.equal(await a.locator('#onlineText').inputValue(),'第一台设备尚未提交的草稿');
  a.once('dialog',dialog => dialog.accept()); await a.locator('#onlineCancel').click();
  record('同一作者两台设备并发编辑时拒绝旧版本覆盖，并保留输入草稿');

  await bContext.setOffline(true);
  await b.locator('#onlineText').fill('断网测试草稿，恢复后只保存一条'); await b.locator('#onlineSubmit').click();
  await b.waitForFunction(() => document.getElementById('onlineStatus').textContent.includes('连不上'));
  assert.equal(await b.locator('#onlineText').inputValue(),'断网测试草稿，恢复后只保存一条');
  await bContext.setOffline(false); await b.locator('#onlineSubmit').click();
  await b.getByText('断网测试草稿，恢复后只保存一条',{exact:true}).waitFor();
  assert.equal(await b.locator('.whispers-note').filter({hasText:'断网测试草稿'}).count(),1);
  record('断网保存失败保留草稿，恢复后重试只产生一条记录');

  await a.locator('#onlineText').fill('导出不包含这条草稿');
  await a.getByText('备份与迁移旧记录',{exact:true}).click();
  const downloading = a.waitForEvent('download'); await a.locator('#onlineExport').click();
  const download = await downloading; const backupPath = join(artifacts,'pair-export-fixture-v04.json'); await download.saveAs(backupPath);
  const exported = readBackup(await readFile(backupPath,'utf8'));
  assert.equal(exported.notes.length,2);
  assert.equal(exported.notes.some(note => note.text.includes('B_PRIVATE') || note.text.includes('导出不包含')),false);
  await a.locator('#onlineText').fill('');
  const time = '2026-10-27T00:00:00Z';
  const file = {name:'旧版测试备份.json',mimeType:'application/json',buffer:Buffer.from(createBackup([{id:'legacy-shared',text:'B_IMPORTED_PRIVATE_SENTINEL',audience:'shared',createdAt:time,updatedAt:time}]))};
  await b.getByText('备份与迁移旧记录',{exact:true}).click(); await b.locator('#onlineBackupFile').setInputFiles(file);
  await b.locator('#onlineImportPreview').waitFor({state:'visible'});
  assert.equal(await b.locator('.whispers-note').filter({hasText:'B_IMPORTED_PRIVATE_SENTINEL'}).count(),0);
  await b.locator('#onlineImportConfirm').click();
  await b.locator('.whispers-note').filter({hasText:'B_IMPORTED_PRIVATE_SENTINEL'}).waitFor();
  assert.match(await b.locator('.whispers-note').filter({hasText:'B_IMPORTED_PRIVATE_SENTINEL'}).textContent(),/仅本人可见/);
  await a.locator('#onlineRefresh').click();
  assert.equal(await a.locator('body').innerText().then(text => text.includes('B_IMPORTED_PRIVATE_SENTINEL')),false);
  record('备份只导出自己写的已保存记录；旧共享备份经过预览后按私密记录导入');

  await closePanel(a); await a.locator('[data-dialog="settingsDialog"]').click();
  await a.locator('#settingNameOne').fill('测试共同姓名甲'); await a.locator('#settingNameTwo').fill('测试共同姓名乙');
  await a.locator('#settingVolume').fill('23'); await a.locator('#settingsForm button[type=submit]').click();
  await a.waitForFunction(() => document.getElementById('settingsStatus').textContent.includes('已同步'));
  await closePanel(b); await b.waitForFunction(() => document.getElementById('nameOne').textContent === '测试共同姓名甲',{timeout:12000});
  assert.equal(await a.locator('#music').evaluate(node => node.volume),.23);
  assert.equal(await b.locator('#music').evaluate(node => node.volume),.65);
  record('共同姓名与纪念日通过后端同步，音乐音量保持各设备独立');

  await closePanel(a);
  for (const [width,height,name] of [[1440,1000,'desktop'],[1024,768,'laptop'],[768,1024,'tablet'],[390,844,'phone'],[320,568,'small-phone'],[812,375,'landscape']]) {
    await a.setViewportSize({width,height}); await a.evaluate(() => window.scrollTo(0,0));
    assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),true,`${name} page overflow`);
    await whispers(a);
    assert.equal(await a.locator('#whispersDialog').evaluate(node => node.scrollWidth <= node.clientWidth + 1),true,`${name} notes overflow`);
    await account(a);
    assert.equal(await a.locator('#accountDialog').evaluate(node => node.scrollWidth <= node.clientWidth + 1),true,`${name} account overflow`);
    await closePanel(a);
    if (name === 'phone') await a.screenshot({path:join(artifacts,'pair-phone-home-fixture-v04.png'),fullPage:true});
  }
  record('电脑、笔记本、平板、普通手机、小手机与横屏下账号/心里话面板可操作，无横向溢出');

  await a.setViewportSize({width:1440,height:1000});
  const sibling = await aContext.newPage(); watch(sibling); await sibling.goto(base); await sibling.locator('#onlineEntry').waitFor({state:'visible'}); await account(sibling);
  await sibling.locator('#onlineLogout').click();
  await sibling.locator('#onlineSignedOut').waitFor({state:'visible'});
  await a.waitForFunction(() => document.querySelectorAll('#onlineList .whispers-note').length === 0 && document.getElementById('onlineText').value === '');
  assert.equal(await a.locator('body').textContent().then(text => text.includes('A_PRIVATE_NEW_VERSION')),false);
  await login(sibling,'fixture_b');
  await a.bringToFront(); await a.waitForFunction(() => document.getElementById('onlineAccountState').textContent.includes('测试乙'));
  await whispers(a); await a.locator('#onlineRefresh').click();
  assert.equal(await a.locator('body').textContent().then(text => text.includes('A_PRIVATE_NEW_VERSION')),false);
  record('同一浏览器另一标签页退出/换账号时清除旧记录与草稿，不把上一账号内容带给下一账号');

  const unavailableContext = await browser.newContext();
  await unavailableContext.addInitScript(() => localStorage.setItem('xinwang.whispers.v1','LEGACY_UNAVAILABLE_SENTINEL'));
  await unavailableContext.route('**/api/status',route => route.abort());
  const unavailable = await unavailableContext.newPage(); watch(unavailable); await unavailable.goto(base);
  await unavailable.locator('[data-dialog="whispersDialog"]').click();
  await unavailable.locator('#whisperContent').getByText('暂时无法确认服务',{exact:false}).waitFor();
  assert.equal(await unavailable.locator('body').textContent().then(text => text.includes('LEGACY_UNAVAILABLE_SENTINEL')),false);
  await unavailableContext.close();
  record('首次连接失败时不降级读取未隔离的旧本地副本');

  assert.deepEqual(errors,[]); assert.deepEqual(requests,[]);
  record('无页面 JavaScript 异常、无静态资源错误及服务器 5xx');
  await writeFile(join(artifacts,'pair-browser-results.json'),JSON.stringify({testedAt:new Date().toISOString(),browser:await browser.version(),checks,errors,requests,scope:'isolated test database and separate browser contexts, no real user accounts'},null,2));
  console.log(`${checks.length} pair browser checks passed.`);
} catch (error) {
  if (a) await a.screenshot({path:join(artifacts,'pair-failure-a.png'),fullPage:true}).catch(() => {});
  if (b) await b.screenshot({path:join(artifacts,'pair-failure-b.png'),fullPage:true}).catch(() => {});
  throw error;
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
  const actual = resolve(directory), prefix = resolve(tmpdir());
  if (actual.startsWith(prefix + '\\xinwang-pair-browser-') || actual.startsWith(prefix + '/xinwang-pair-browser-')) await rm(directory,{recursive:true,force:true});
}
