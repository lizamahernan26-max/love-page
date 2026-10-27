import {networkInterfaces} from 'node:os';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAppServer} from '../server/app.mjs';

if (process.env.NODE_ENV === 'production' || process.env.PUBLIC_ORIGIN) throw new Error('正式环境不启动未加密手机开发入口，请使用配置好的 HTTPS 网址。');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entries = Object.entries(networkInterfaces()).flatMap(([name, values]) => (values || []).filter(value => value.family === 'IPv4' && !value.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value.address)).map(value => ({name,address:value.address})));
const preferred = entries.filter(value => /^(wi-?fi|wlan|ethernet|以太网|无线局域网)/i.test(value.name));
const candidates = [...new Set((preferred.length ? preferred : entries.filter(value => !/virtual|vmware|wsl|tailscale|clash|vethernet/i.test(value.name))).map(value => value.address))];
const host = process.argv[2] || (candidates.length === 1 ? candidates[0] : null);
const port = Number(process.env.XINWANG_PHONE_PORT || 8791);
if (!host || !entries.some(value => value.address === host)) throw new Error('请连接 Wi-Fi，或指定本机私有 IPv4：node scripts/serve-pair-phone.mjs 192.168.x.x');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('手机预览端口无效。');
const {server} = createAppServer({root, databasePath: resolve(process.env.XINWANG_DB_PATH || join(root,'data/xinwang.sqlite')), developmentHost: host, allowInsecureLan: true});
server.on('error', error => {console.error(`手机开发预览未启动：${error.code || 'UNKNOWN'}`); process.exitCode = 1;});
server.listen(port, host, () => {
  console.log(`心网双人开发预览：http://${host}:${port}/`);
  console.log('同 Wi-Fi 测试使用。HTTP 未加密，不要在这里输入真实私密内容。');
  console.log('先在电脑本机 http://127.0.0.1:8790/ 创建第一个账号，再让另一测试设备用邀请码注册。');
});
