import { defaults, settingsKey, validateSettings, elapsedParts, phrasesFor } from './config.js';
import { initHeart } from './heart.js';
import { initMusic } from './music.js';
import { initWhispers } from './whispers.js';
import { initOnlineSpace } from './online-space.js';

const byId = id => document.getElementById(id);
let settings = { ...defaults };
const status = byId('settingsStatus');
let online = null;
let settingsFormVersion = null;
let settingsBusy = false;
function lockSettings(locked) {
  settingsBusy = locked;
  for (const control of byId('settingsForm').elements) if ('disabled' in control) control.disabled = locked;
}
try {
  const saved = localStorage.getItem(settingsKey);
  if (saved !== null) settings = validateSettings(JSON.parse(saved));
} catch {
  status.textContent = '浏览器设定不可读取，已临时使用参考设定。原存储未被更改。';
}
const music = initMusic();
const heart = initHeart(phrasesFor(settings), music.onHeart);

function updateTime() {
  const value = elapsedParts(settings.anniversary);
  for (const unit of ['days', 'hours', 'minutes', 'seconds']) byId(unit).textContent = unit === 'days' ? String(value[unit]) : String(value[unit]).padStart(2, '0');
  byId('togetherLabel').textContent = value.future ? '距离我们的约定还有' : '我们已经相伴';
  byId('sinceLabel').textContent = value.future ? '约定的那一天 ·' : '我们的故事开始于';
  byId('time').setAttribute('aria-label', `${value.future ? '距离约定还有' : '已经相伴'} ${value.days} 天 ${value.hours} 时 ${value.minutes} 分 ${value.seconds} 秒`);
}

function applySettings() {
  byId('nameOne').textContent = settings.nameOne;
  byId('nameTwo').textContent = settings.nameTwo;
  const [day, time] = settings.anniversary.split('T');
  byId('anniversary').textContent = `${day.replaceAll('-', '.')} · ${time}`;
  byId('anniversary').dateTime = settings.anniversary + ':00+08:00';
  music.setVolume(settings.volume);
  heart.setWords(phrasesFor(settings));
  byId('reply').textContent = '把漫天星光，聚成一颗为你跳动的心。';
  updateTime();
}
function fillForm() {
  settingsFormVersion = online?.couple?.profile.version ?? null;
  byId('settingNameOne').value = settings.nameOne;
  byId('settingNameTwo').value = settings.nameTwo;
  byId('settingDate').value = settings.anniversary;
  byId('settingVolume').value = settings.volume;
  byId('volumeValue').textContent = `${settings.volume}%`;
}
applySettings();
fillForm();
setInterval(updateTime, 1000);
online = initOnlineSpace({
  initLocal: () => initWhispers(byId('whisperContent')),
  onProfile: profile => {
    settings = {...settings, ...(profile || defaults)};
    try {const volume = localStorage.getItem('xinwang.device.volume.v1'); if (volume !== null) settings.volume = Math.max(0, Math.min(100, Number(volume) || 0));} catch {}
    applySettings();
  }
});

document.querySelectorAll('[data-dialog]').forEach(button => {
  button.addEventListener('click', () => {
    if (button.dataset.dialog === 'settingsDialog') fillForm();
    byId(button.dataset.dialog).showModal();
  });
});
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
byId('settingVolume').addEventListener('input', event => { byId('volumeValue').textContent = `${event.target.value}%`; });

byId('settingsForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (settingsBusy) return;
  lockSettings(true);
  try {
    const next = validateSettings({ nameOne: byId('settingNameOne').value, nameTwo: byId('settingNameTwo').value, anniversary: byId('settingDate').value, volume: Number(byId('settingVolume').value) });
    await online.ready;
    if (online.enabled) {
      if (!online.user || !online.couple) throw new Error('请先登录并完成双人绑定，再保存共同设定。');
      await online.saveProfile({nameOne:next.nameOne, nameTwo:next.nameTwo, anniversary:next.anniversary, version:settingsFormVersion});
      settings = next; applySettings(); fillForm();
      try {localStorage.setItem('xinwang.device.volume.v1', String(next.volume)); status.textContent = '共同姓名与纪念日已同步；音量保存在本设备。';}
      catch {status.textContent = '共同设定已同步；浏览器无法保存音量，音量暂只在本页生效。';}
      return;
    }
    // 只在用户明确保存时写入，失败则保留当前页面的有效设定。
    localStorage.setItem(settingsKey, JSON.stringify(next));
    settings = next;
    applySettings();
    fillForm();
    status.textContent = '已保存到当前浏览器。关闭面板即可看到新设定。';
  } catch (error) {
    status.textContent = error.name === 'QuotaExceededError' || error.name === 'SecurityError'
      ? '浏览器不允许保存，设定尚未更改。请检查浏览器存储设置。' : error.message;
  } finally {lockSettings(false);}
});
byId('resetSettings').addEventListener('click', async () => {
  if (settingsBusy) return;
  lockSettings(true);
  try {
    await online.ready;
    if (online.enabled) {
      if (!online.user || !online.couple) throw new Error('请先登录并绑定，再恢复共同设定。');
      if (!confirm('恢复会同步改变两人的姓名与纪念日，确定吗？')) return;
      await online.saveProfile({nameOne:defaults.nameOne,nameTwo:defaults.nameTwo,anniversary:defaults.anniversary,version:settingsFormVersion});
      settings = {...defaults}; applySettings(); fillForm(); status.textContent = '已同步恢复参考姓名与纪念日。';
      try {localStorage.setItem('xinwang.device.volume.v1', String(defaults.volume));} catch {status.textContent += '音量暂只在本页生效。';}
      return;
    }
    localStorage.removeItem(settingsKey);
    settings = { ...defaults };
    applySettings();
    fillForm();
    status.textContent = '已恢复参考页面的设定，心里话未受影响。';
  } catch (error) { status.textContent = online?.enabled ? error.message : '无法清除浏览器中的设定，当前设定保持不变。'; }
  finally {lockSettings(false);}
});
