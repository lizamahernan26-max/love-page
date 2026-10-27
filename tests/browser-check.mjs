import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from '../scripts/serve.mjs';
import {createBackup, readBackup, MAX_BACKUP_BYTES} from '../js/whisper-backup.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = resolve(root, 'tests/artifacts');
await mkdir(artifacts, { recursive: true });
const server = createServer(root);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : { channel: 'chrome' }) });
const checks = [], errors = [], requests = [];
function record(name) { checks.push(name); console.log(`PASS ${name}`); }
function watch(page) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) requests.push(`${response.status()} ${response.url()}`); });
}
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
const page = await context.newPage();
watch(page);
async function openWhispers(target = page) { await target.locator('[data-dialog="whispersDialog"]').click(); await target.locator('#whisperText').waitFor(); }
async function submit(text, audience = 'personal', target = page) {
  await target.locator('#whisperText').fill(text);
  await target.locator('#whisperAudience').selectOption(audience);
  await target.locator('#whisperSubmit').click();
}
try {
  await page.goto(base);
  await page.waitForTimeout(3800);
  assert.equal(await page.title(), '心网 · 我们的小宇宙');
  assert.equal(await page.locator('#nameOne').textContent(), '梁桓伟');
  assert(await page.locator('.word').count() > 0);
  assert.equal(await page.locator('#canvas').evaluate(el => el.width > 0 && el.height > 0), true);
  const seconds = await page.locator('#seconds').textContent();
  await page.waitForTimeout(1150);
  assert.notEqual(await page.locator('#seconds').textContent(), seconds);
  record('原姓名、实时计时、粒子场景和漂浮情话可用');
  const fontMetrics = await page.evaluate(async () => {
    await document.fonts.ready;
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = '46px "LXGW WenKai Mono TC"';
    return {
      loaded: document.fonts.check('46px "LXGW WenKai Mono TC"', '0123456789'),
      widths: [...'0123456789'].map(char => ctx.measureText(char).width),
      family: getComputedStyle(document.getElementById('days')).fontFamily,
      variants: getComputedStyle(document.getElementById('days')).fontVariantNumeric
    };
  });
  assert(fontMetrics.loaded && fontMetrics.family.includes('LXGW WenKai Mono TC'));
  assert(Math.max(...fontMetrics.widths) - Math.min(...fontMetrics.widths) < .01, 'digits must have equal advance widths');
  assert(fontMetrics.variants.includes('lining-nums'));
  record('楷体数字文件已加载，0—9 等宽，启用齐线数字');

  await page.locator('#heartButton').click();
  await page.waitForFunction(() => !document.getElementById('music').paused && document.getElementById('music').readyState >= 2);
  assert.equal(await page.locator('#musicButton').getAttribute('aria-pressed'), 'true');
  await page.locator('#musicButton').click();
  await page.locator('#heartButton').click();
  assert.equal(await page.locator('#music').evaluate(el => el.paused), true);
  record('首次爱心触发音乐，手动暂停后再点爱心仍暂停');
  await page.screenshot({ path: resolve(artifacts, 'desktop.png'), fullPage: true });

  await openWhispers();
  const payload = '<img src=x onerror="window.__injected=true">测试心里话';
  await submit(payload);
  assert.equal(await page.locator('.whispers-note-text').textContent(), payload);
  assert.equal(await page.locator('.whispers-note-text img').count(), 0);
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  assert.equal(await page.evaluate(() => localStorage.getItem('xinwang.whispers.v1')), null);
  await page.locator('.whispers-note-actions button').first().click();
  await page.locator('#whisperText').fill('尚未保存的草稿');
  await page.locator('.whispers-note-actions button').first().click();
  assert.equal(await page.locator('#whisperText').inputValue(), '尚未保存的草稿');
  await page.locator('#whisperAudience').selectOption('shared');
  await page.locator('#whisperSubmit').click();
  assert.match(await page.locator('.whispers-note-meta').textContent(), /未发送/);
  await page.locator('#whisperFilter').selectOption('personal');
  assert.equal(await page.locator('.whispers-note').count(), 0);
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await openWhispers();
  assert.equal(await page.locator('.whispers-note').count(), 0);
  record('本页记录、文本注入防护、编辑草稿保护、分类、刷新即清空');

  await page.locator('#whisperPersist').check();
  await submit('浏览器保存测试，测试环境专用', 'shared');
  await page.reload();
  await openWhispers();
  assert.equal(await page.locator('.whispers-note').count(), 1);
  assert.equal(await page.locator('#whisperPersist').isChecked(), true);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '删除这条心里话', exact: true }).click();
  assert.equal(await page.locator('.whispers-note').count(), 1);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '删除这条心里话', exact: true }).click();
  assert.equal(await page.locator('.whispers-note').count(), 0);
  await page.locator('#whisperPersist').uncheck();
  assert.equal(await page.evaluate(() => localStorage.getItem('xinwang.whispers.v1')), null);
  record('明确开启本机保存后可恢复，删除有确认，取消保存移除副本');

  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#whispersDialog').evaluate(el => el.open), false);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.dialog), 'whispersDialog');
  await page.locator('[data-dialog="settingsDialog"]').click();
  await page.locator('#settingNameOne').fill('测试甲');
  await page.locator('#settingNameTwo').fill('测试乙');
  await page.locator('#settingDate').fill('2099-01-02T03:04');
  await page.locator('#settingVolume').fill('23');
  await page.locator('#settingsForm button[type=submit]').click();
  assert.match(await page.locator('#settingsStatus').textContent(), /已保存/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#nameOne').textContent(), '测试甲');
  assert.match(await page.locator('#togetherLabel').textContent(), /距离/);
  assert.equal(await page.locator('#music').evaluate(el => el.volume), .23);
  await page.reload();
  assert.equal(await page.locator('#nameOne').textContent(), '测试甲');
  await page.locator('[data-dialog="settingsDialog"]').click();
  await page.locator('#resetSettings').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#nameOne').textContent(), '梁桓伟');
  record('原生弹窗 Escape/焦点恢复，姓名日期音量保存、倒计时和恢复');

  const backupContext = await browser.newContext({viewport: {width: 390, height: 844}, locale: 'zh-CN', acceptDownloads: true});
  const backupPage = await backupContext.newPage(); watch(backupPage);
  await backupPage.goto(base); await openWhispers(backupPage);
  const backupNotes = [
    {id: 'fixture-personal', text: '测试记录：今天也值得被好好记住。', audience: 'personal', createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z'},
    {id: 'fixture-shared', text: '<img src=x onerror="window.__injected=true">导入只显示文字', audience: 'shared', createdAt: '2026-10-27T01:00:00.000Z', updatedAt: '2026-10-27T01:00:00.000Z'}
  ];
  const fixture = {name: '测试专用备份.json', mimeType: 'application/json', buffer: Buffer.from(createBackup(backupNotes))};
  await backupPage.locator('#whisperText').fill('测试草稿：导入和导出都不能清空我');
  await backupPage.locator('#whisperBackup summary').click();
  await backupPage.locator('#whisperImportFile').setInputFiles(fixture);
  await backupPage.locator('#whisperImportPreview').waitFor({state: 'visible'});
  assert.equal(await backupPage.locator('.whispers-note').count(), 0);
  assert.equal(await backupPage.locator('#whisperImportSamples img').count(), 0);
  assert.match(await backupPage.locator('#whisperImportSummary').textContent(), /新增 2 条/);
  await backupPage.screenshot({path: resolve(artifacts, 'phone-backup-preview-v03.png')});
  await backupPage.locator('#whisperImportCancel').click();
  await backupPage.locator('#whisperDone').click();
  assert.equal(await backupPage.locator('#whispersDialog').evaluate(el => el.open), false);
  await openWhispers(backupPage);
  assert.match(await backupPage.locator('#whisperText').inputValue(), /测试草稿/);
  assert.equal(await backupPage.locator('.whispers-note').count(), 0);
  await backupPage.locator('#whisperImportFile').setInputFiles(fixture);
  await backupPage.locator('#whisperImportConfirm').click();
  assert.equal(await backupPage.locator('.whispers-note').count(), 2);
  assert.match(await backupPage.locator('#whisperText').inputValue(), /测试草稿/);
  assert.equal(await backupPage.evaluate(() => localStorage.getItem('xinwang.whispers.v1')), null);
  assert.equal(await backupPage.locator('.whispers-note img').count(), 0);
  await backupPage.locator('#whisperImportFile').setInputFiles(fixture);
  await backupPage.locator('#whisperImportPreview').waitFor({state: 'visible'});
  assert.equal(await backupPage.locator('#whisperImportConfirm').isDisabled(), true);
  assert.match(await backupPage.locator('#whisperImportSummary').textContent(), /跳过重复 2 条/);
  await backupPage.locator('#whisperImportCancel').click();
  record('手机备份先预览后合并，取消不改记录，重复导入不重复，草稿保留且不自动开启存储');

  await backupPage.locator('#whisperImportFile').setInputFiles({name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{broken')});
  await backupPage.waitForFunction(() => document.getElementById('whisperBackupStatus').textContent.includes('不是有效'));
  await backupPage.locator('#whisperImportFile').setInputFiles({name: 'large.json', mimeType: 'application/json', buffer: Buffer.alloc(MAX_BACKUP_BYTES + 1, ' ')});
  await backupPage.waitForFunction(() => document.getElementById('whisperBackupStatus').textContent.includes('2 MB'));
  assert.equal(await backupPage.locator('.whispers-note').count(), 2);
  const downloading = backupPage.waitForEvent('download');
  await backupPage.locator('#whisperExport').click();
  const download = await downloading;
  const downloadedPath = resolve(artifacts, 'backup-fixture-v03.json');
  await download.saveAs(downloadedPath);
  const exported = readBackup(await readFile(downloadedPath, 'utf8'));
  assert.equal(exported.notes.length, 2);
  assert.equal(exported.notes.some(note => note.text.includes('测试草稿')), false);
  record('损坏/过大文件被拒绝，导出文件能重新读取且只包含已记录内容');

  await backupPage.locator('#whisperText').fill('');
  await backupPage.getByRole('button', {name: '编辑这条心里话', exact: true}).first().click();
  await backupPage.locator('#whisperText').fill('修改中的草稿');
  backupPage.once('dialog', dialog => dialog.dismiss());
  await backupPage.locator('#whisperCancel').click();
  assert.equal(await backupPage.locator('#whisperText').inputValue(), '修改中的草稿');
  const leaving = backupPage.waitForEvent('dialog');
  const attemptedReload = backupPage.reload().catch(() => {});
  const warning = await leaving;
  assert.equal(warning.type(), 'beforeunload');
  await warning.dismiss();
  await attemptedReload;
  assert.equal(await backupPage.locator('#whisperText').inputValue(), '修改中的草稿');
  backupPage.once('dialog', dialog => dialog.accept());
  await backupPage.locator('#whisperCancel').click();
  await backupPage.locator('#whisperPersist').check();
  let cleanReloadWarned = false;
  const cleanReloadHandler = async dialog => { cleanReloadWarned = true; await dialog.accept(); };
  backupPage.on('dialog', cleanReloadHandler);
  await backupPage.reload(); await openWhispers(backupPage);
  backupPage.off('dialog', cleanReloadHandler);
  assert.equal(cleanReloadWarned, false);
  assert.equal(await backupPage.locator('.whispers-note').count(), 2);
  assert.deepEqual(errors, []);
  await backupContext.close();
  record('取消编辑及刷新都有草稿保护，取消离开保留文字，保存完成后不再拦截刷新');

  await page.waitForTimeout(3000); // Wait for the retained particle entrance before final screenshots.
  for (const [width, height, name] of [[1440, 1000, 'desktop'], [1024, 768, 'laptop'], [768, 1024, 'tablet'], [390, 844, 'phone'], [320, 568, 'small-phone'], [812, 375, 'landscape']]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(250);
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${name} horizontal overflow`);
    const scene = await page.locator('#scene').boundingBox();
    assert(scene.height > 160, `${name} scene too small`);
    const layout = await page.evaluate(() => {
      const time = document.querySelector('.time-lead').getBoundingClientRect();
      const scene = document.getElementById('scene').getBoundingClientRect();
      const digits = ['hours', 'minutes', 'seconds'].map(id => document.getElementById(id).getBoundingClientRect());
      return {
        sceneCenter: scene.x + scene.width / 2,
        pageWidth: innerWidth,
        timerBelowHeart: time.top >= scene.bottom,
        clockTopSpread: Math.max(...digits.map(r => r.top)) - Math.min(...digits.map(r => r.top)),
        clockWidthSpread: Math.max(...digits.map(r => r.width)) - Math.min(...digits.map(r => r.width)),
        liliesClearOfTimer: [...document.querySelectorAll('.lily')].every(el => {
          const r = el.getBoundingClientRect();
          return r.right <= time.left || r.left >= time.right || r.bottom <= time.top || r.top >= time.bottom;
        })
      };
    });
    assert((name === 'landscape' || layout.timerBelowHeart) && layout.liliesClearOfTimer, `${name} heart/lily/timer overlaps`);
    assert(layout.clockTopSpread < .1 && layout.clockWidthSpread < .1, `${name} clock digits misaligned`);
    if (width <= 600) assert(Math.abs(layout.sceneCenter - layout.pageWidth / 2) < 1, `${name} heart not centered`);
    await page.evaluate(() => document.activeElement?.blur());
    await page.screenshot({ path: resolve(artifacts, `${name}.png`), fullPage: true });
    await openWhispers();
    assert.equal(await page.locator('#whispersDialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `${name} dialog overflow`);
    await page.locator('#whisperText').fill('布局验证后清空');
    await page.locator('#whisperSubmit').click();
    assert.equal(await page.locator('.whispers-note').count(), 1);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '删除这条心里话', exact: true }).click();
    await page.locator('#whispersDialog').evaluate(el => { el.scrollTop = 0; });
    if (name === 'phone') await page.screenshot({ path: resolve(artifacts, 'phone-whispers.png') });
    await page.locator('#whisperBackup summary').click();
    await page.locator('#whisperChooseFile').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#whispersDialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `${name} expanded backup overflow`);
    assert.equal(await page.locator('#whisperChooseFile').isVisible(), true);
    await page.locator('#whisperBackup summary').click();
    await page.locator('#whisperDone').click();
    assert.equal(await page.locator('#whispersDialog').evaluate(el => el.open), false);
    record(`${name} ${width}×${height} 无横向溢出，面板可滚动操作`);
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.word').count(), 0);
  const still = await page.locator('#canvas').evaluate(el => el.toDataURL());
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#canvas').evaluate(el => el.toDataURL()), still);
  record('动态切换减少动画，粒子停止连续重绘，情话停止漂浮');

  const denied = await browser.newContext();
  await denied.addInitScript(() => {
    Storage.prototype.getItem = function () { throw new DOMException('denied', 'SecurityError'); };
    Storage.prototype.setItem = function () { throw new DOMException('denied', 'SecurityError'); };
  });
  const deniedPage = await denied.newPage(); watch(deniedPage);
  await deniedPage.goto(base); await openWhispers(deniedPage);
  assert.match(await deniedPage.locator('#whisperStatus').textContent(), /不可用/);
  await submit('被禁用存储时仍可记在本页', 'personal', deniedPage);
  await deniedPage.locator('#whisperPersist').click();
  assert.equal(await deniedPage.locator('#whisperPersist').isChecked(), false);
  assert.equal(await deniedPage.locator('.whispers-note').count(), 1);
  await denied.close();
  record('存储被禁用时仍可本页记录，不误报已保存');

  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  record('无 JavaScript 异常、无资源加载错误');
  await writeFile(resolve(artifacts, 'browser-results.json'), JSON.stringify({ testedAt: new Date().toISOString(), browser: await browser.version(), origin: 'isolated temporary localhost port', checks, errors, requests }, null, 2));
  console.log(`${checks.length} browser checks passed; screenshots in tests/artifacts.`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
