import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAppServer} from './app.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8790);
const host = process.env.XINWANG_HOST || '127.0.0.1';
const publicOrigin = process.env.PUBLIC_ORIGIN || '';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须为 1—65535。');
if (process.env.NODE_ENV === 'production' && !publicOrigin.startsWith('https://')) throw new Error('正式部署必须设置 HTTPS 的 PUBLIC_ORIGIN。');
if (host !== '127.0.0.1' && host !== '::1' && !publicOrigin && process.env.XINWANG_DEV_LAN !== '1') throw new Error('非本机 HTTP 仅限显式开发测试，不适合真实密码和私密内容。');
const {server} = createAppServer({
  root, databasePath: resolve(process.env.XINWANG_DB_PATH || join(root, 'data/xinwang.sqlite')),
  publicOrigin, developmentHost: host, allowInsecureLan: process.env.XINWANG_DEV_LAN === '1',
  setupKey: process.env.XINWANG_SETUP_KEY || '', trustLoopbackProxy: process.env.XINWANG_TRUST_PROXY === 'loopback'
});
server.on('error', error => { console.error(`双人版启动失败：${error.code || 'UNKNOWN'}。如端口已占用，请检查已有服务。`); process.exitCode = 1; });
server.listen(port, host, () => {
  console.log(`心网双人版：${publicOrigin || `http://${host}:${port}/`}`);
  console.log(publicOrigin ? '请通过配置的 HTTPS 网址访问。' : '当前为本机开发验证；真实手机长期使用需完成 HTTPS 部署。');
  console.log('数据库保存在 data/ 或 XINWANG_DB_PATH 指定位置。按 Ctrl+C 停止。');
});
function shutdown() { server.close(); }
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
