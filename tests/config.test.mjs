import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, validateSettings, elapsedParts, phrasesFor } from '../js/config.js';

test('原纪念时间按北京时间计算，不受设备时区影响', () => {
  assert.deepEqual(elapsedParts(defaults.anniversary, Date.parse('2024-05-25T18:23:04Z')), { days: 1, hours: 2, minutes: 3, seconds: 4, future: false });
});
test('未来日期显示正数倒计时，周年零时无负数', () => {
  const start = Date.parse('2024-05-24T16:20:00Z');
  assert.deepEqual(elapsedParts(defaults.anniversary, start - 61000), { days: 0, hours: 0, minutes: 1, seconds: 1, future: true });
  assert.deepEqual(elapsedParts(defaults.anniversary, start), { days: 0, hours: 0, minutes: 0, seconds: 0, future: false });
});
test('拒绝空姓名、假日期、日期溢出和无效音量', () => {
  for (const patch of [{nameOne:' '}, {nameTwo:'a'.repeat(21)}, {anniversary:'2025-02-29T00:00'}, {anniversary:'2024-13-01T00:00'}, {anniversary:'2024-01-01T24:00'}, {anniversary:'abc'}, {volume:NaN}, {volume:101}]) assert.throws(() => validateSettings({...defaults, ...patch}));
  assert.equal(validateSettings({...defaults, anniversary:'2024-02-29T00:00', nameOne:' 测试 '}).nameOne, '测试');
});
test('修改姓名日期同步应用到情话且不改变参考句库', () => {
  const words = phrasesFor({...defaults, nameOne:'甲', nameTwo:'乙', anniversary:'2026-01-02T12:00'});
  assert(words.includes('甲 ❤️ 乙'));
  assert(words.includes('2026年1月2日，我们的故事开始'));
  assert(!words.some(word => word.includes('梁桓伟') || word.includes('2024年5月25日')));
  assert(phrasesFor(defaults).includes('梁桓伟 ❤️ 王艳茹'));
});
