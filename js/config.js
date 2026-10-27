import { loveWords } from './love-words.js';

// 参考页面的原始设定；日期始终按北京时间解释。
export const defaults = Object.freeze({
  nameOne: '梁桓伟',
  nameTwo: '王艳茹',
  anniversary: '2024-05-25T00:20',
  volume: 65
});
export const settingsKey = 'xinwang.settings.v1';

export function validateSettings(value) {
  if (!value || typeof value !== 'object') throw new Error('设定格式不正确。');
  const names = [value.nameOne, value.nameTwo];
  if (names.some(name => typeof name !== 'string' || !name.trim() || name.trim().length > 20)) {
    throw new Error('请填写两个人的名字，每个名字最多 20 个字符。');
  }
  const date = value.anniversary;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(date)) throw new Error('请填写完整的纪念日期和时间。');
  const [year, month, day, hour, minute] = date.split(/[-T:]/).map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (year < 1900 || year > 2100 || utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day || hour > 23 || minute > 59) {
    throw new Error('纪念日期无效，请选择 1900—2100 年的有效时间。');
  }
  if (typeof value.volume !== 'number' || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 100) throw new Error('音量应在 0—100 之间。');
  return { nameOne: value.nameOne.trim(), nameTwo: value.nameTwo.trim(), anniversary: date, volume: value.volume };
}

export function elapsedParts(anniversary, now = Date.now()) {
  const start = Date.parse(anniversary + ':00+08:00');
  if (!Number.isFinite(start) || !Number.isFinite(now)) throw new Error('无法计算纪念时间。');
  const future = start > now;
  const total = Math.floor(Math.abs(now - start) / 1000);
  return { days: Math.floor(total / 86400), hours: Math.floor(total % 86400 / 3600), minutes: Math.floor(total % 3600 / 60), seconds: total % 60, future };
}

export function phrasesFor(settings) {
  const [date] = settings.anniversary.split('T');
  const [year, month, day] = date.split('-').map(Number);
  return loveWords.map(word => word
    .replace('梁桓伟 ❤️ 王艳茹', `${settings.nameOne} ❤️ ${settings.nameTwo}`)
    .replace('2024年5月25日，我们的故事开始', `${year}年${month}月${day}日，我们的故事开始`));
}
