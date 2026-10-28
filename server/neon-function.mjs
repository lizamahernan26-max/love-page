import {request as httpRequest} from 'node:http';
import {Readable} from 'node:stream';
import {createAppServer} from './app.mjs';
import {connectPostgres} from './database-postgres.mjs';

export function neonFunctionConfiguration(env) {
  function origin(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) throw new Error('Invalid HTTPS origin');
    return url;
  }
  const site = origin(env.PUBLIC_ORIGIN), api = origin(env.XINWANG_API_ORIGIN);
  if (!env.NEON_BRANCH || !env.XINWANG_SETUP_KEY || env.XINWANG_SETUP_KEY.length < 32) throw new Error('Missing runtime configuration');
  return {publicOrigin:site.origin, apiOrigin:api.origin, setupKey:env.XINWANG_SETUP_KEY};
}

// Neon provides Web Requests; the existing Node API keeps all of its permission checks.
export function createNeonFunction({root, env = process.env, databaseFactory = connectPostgres}) {
  let application;
  async function getApplication(config) {
    if (!application) application = (async () => {
      const database = await databaseFactory(env.DATABASE_URL_UNPOOLED || env.DATABASE_URL);
      const app = createAppServer({root,database,publicOrigin:config.publicOrigin,setupKey:config.setupKey,trustLoopbackProxy:true});
      await new Promise((resolve,reject) => {app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
      return app;
    })().catch(error => {application = null;throw error;});
    return application;
  }
  return {
    async fetch(request) {
      try {
        const config = neonFunctionConfiguration(env), url = new URL(request.url);
        if (url.origin !== config.apiOrigin) return new Response('Use the configured HTTPS endpoint.',{status:421});
        if (!url.pathname.startsWith('/api/')) return new Response('Not found',{status:404});
        const app = await getApplication(config);
        const headers = {host:new URL(config.publicOrigin).host,'x-forwarded-proto':'https'};
        for (const name of ['content-type','content-length','cookie','origin','sec-fetch-site','x-csrf-token']) {
          const value = request.headers.get(name); if (value !== null) headers[name] = value;
        }
        return await new Promise((resolve,reject) => {
          const upstream = httpRequest({host:'127.0.0.1',port:app.server.address().port,path:url.pathname + url.search,method:request.method,headers}, response => {
            const outputHeaders = new Headers();
            for (const [name,value] of Object.entries(response.headers)) {
              if (['connection','keep-alive','transfer-encoding'].includes(name) || value === undefined) continue;
              for (const item of Array.isArray(value) ? value : [value]) outputHeaders.append(name,item);
            }
            resolve(new Response(request.method === 'HEAD' ? null : Readable.toWeb(response), {status:response.statusCode,headers:outputHeaders}));
          });
          upstream.setTimeout(18000,() => upstream.destroy(new Error('Upstream timeout')));
          upstream.on('error',reject);
          if (request.body) {const input = Readable.fromWeb(request.body);input.on('error',error => upstream.destroy(error));input.pipe(upstream);}
          else upstream.end();
        });
      } catch {
        // Never log database addresses, request bodies, cookies or initialization credentials.
        return Response.json({error:{code:'service',message:'双人服务暂时无法连接，请保留草稿后重试。'}},{status:503,headers:{'Cache-Control':'no-store'}});
      }
    },
    async close() {
      if (!application) return;
      const app = await application;
      await new Promise(resolve => app.server.close(resolve));
      await app.database.close();
      application = null;
    }
  };
}
