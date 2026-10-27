import { networkInterfaces } from 'node:os';
import { createServer } from './serve.mjs';

function isPrivateIPv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168);
}

const interfaces = Object.entries(networkInterfaces()).flatMap(([name, entries]) =>
  (entries || []).filter(entry => entry.family === 'IPv4' && !entry.internal && isPrivateIPv4(entry.address))
    .map(entry => ({ name, address: entry.address }))
);
const preferred = interfaces.filter(entry => !/virtual|vethernet|vmware|tailscale|clash|wsl|loopback/i.test(entry.name));
const physical = preferred.filter(entry => /^(wi-?fi|wlan|ethernet|以太网|无线局域网)/i.test(entry.name));
const candidates = [...new Set((physical.length ? physical : preferred).map(entry => entry.address))];
const host = process.argv[2] || process.env.XINWANG_PHONE_HOST || (candidates.length === 1 ? candidates[0] : null);
const port = Number(process.env.XINWANG_PHONE_PORT || 8788);

if (!host || !interfaces.some(entry => entry.address === host)) {
  console.error('无法确定手机可访问的局域网地址。请先连接 Wi-Fi。');
  if (interfaces.length) console.error('可用地址：' + interfaces.map(entry => `${entry.name}: ${entry.address}`).join('，'));
  console.error('多个地址时可指定：node scripts/serve-phone.mjs 192.168.x.x');
  process.exitCode = 1;
} else if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('XINWANG_PHONE_PORT 必须为 1—65535 的整数。');
  process.exitCode = 1;
} else {
  const server = createServer();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。如果手机预览已经运行，可直接打开下面的网址。` : `手机预览启动失败：${error.code || 'unknown error'}`);
    console.error(`http://${host}:${port}/`);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.log(`心网手机预览：http://${host}:${port}/`);
    console.log('手机与电脑连接同一 Wi-Fi，用手机浏览器打开上面的网址。');
    console.log('本机保持运行；按 Ctrl+C 关闭手机预览。');
  });
}
