import {createServer, request} from 'node:http';
import {createAppServer} from './app.mjs';

export function renderConfiguration(env) {
  if (env.RENDER !== 'true' || !env.RENDER_SERVICE_ID) throw new Error('云端入口只用于 Render Web Service。');
  const publicOrigin = env.PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL;
  let origin;
  try {origin = new URL(publicOrigin);} catch {throw new Error('未配置正式 HTTPS 地址。');}
  if (origin.protocol !== 'https:' || origin.origin !== publicOrigin || origin.username || origin.password || !origin.hostname.endsWith('.onrender.com')) throw new Error('请使用 Render 自动提供的 HTTPS 网址。');
  if (!env.DATABASE_URL) throw new Error('未配置 DATABASE_URL；拒绝把正式数据存到临时磁盘。');
  if (!env.XINWANG_SETUP_KEY || env.XINWANG_SETUP_KEY.length < 32) throw new Error('请在平台环境变量中生成至少 32 字符的初始化密钥。');
  const port = Number(env.PORT || 10000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('无效的 PORT。');
  return {publicOrigin, port, setupKey:env.XINWANG_SETUP_KEY};
}

export async function startCloud({root, database, publicOrigin, setupKey, port, host = '0.0.0.0'}) {
  const app = createAppServer({root,database,publicOrigin,setupKey,trustLoopbackProxy:true});
  await new Promise((resolve,reject) => {app.server.once('error',reject); app.server.listen(0,'127.0.0.1',resolve);});
  const canonical = new URL(publicOrigin).host;
  const gateway = createServer({maxHeaderSize:8192,requestTimeout:20000,headersTimeout:10000}, (req,res) => {
    if (req.url === '/healthz' && ['GET','HEAD'].includes(req.method)) {
      res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'}); res.end(req.method === 'HEAD' ? undefined : 'ready'); return;
    }
    if (req.headers.host !== canonical || req.headers['x-forwarded-proto'] !== 'https') {
      res.writeHead(421,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}); res.end('请使用本站的 HTTPS 地址。'); return;
    }
    const headers = {...req.headers};
    const connectionHeaders = (headers.connection || '').split(',').map(value => value.trim().toLowerCase());
    for (const key of [...connectionHeaders,'connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','forwarded','x-forwarded-host','x-forwarded-for','x-real-ip','x-forwarded-proto']) delete headers[key];
    headers.host = canonical; headers['x-forwarded-proto'] = 'https';
    const upstream = request({host:'127.0.0.1',port:app.server.address().port,path:req.url,method:req.method,headers}, response => {
      res.writeHead(response.statusCode,response.headers); response.pipe(res);
    });
    upstream.setTimeout(18000,() => upstream.destroy());
    upstream.on('error',() => {if (!res.headersSent) {res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8'}); res.end('服务暂时无法连接，请稍后重试。');} else res.destroy();});
    req.on('aborted',() => upstream.destroy());
    res.on('close',() => {if (!res.writableEnded) upstream.destroy();});
    req.pipe(upstream);
  });
  let closing;
  function close() {
    return closing ||= (async () => {
      if (gateway.listening) await new Promise(resolve => gateway.close(resolve));
      await new Promise(resolve => app.server.close(resolve));
      await database.close();
    })();
  }
  try {await new Promise((resolve,reject) => {gateway.once('error',reject); gateway.listen(port,host,resolve);});}
  catch (error) {await close(); throw error;}
  return {server:gateway,close};
}
