const frontend = 'https://lizamahernan26-max.github.io/love-page/';
const publicFiles = new Set(['index.html','pianai.mp3','assets/lily.svg','assets/fonts/OFL.txt','assets/fonts/lxgw-wenkai-mono-tc-numerals.woff2','js/app.js','js/config.js','js/heart.js','js/love-words.js','js/music.js','js/online-api.js','js/online-space.js','js/whisper-backup.js','js/whisper-store.js','js/whispers.js','styles/app.css','styles/online.css','styles/scene.css','styles/whispers.css']);

export default {
  async fetch(request,env) {
    const url = new URL(request.url);
    if (url.protocol !== 'https:') return new Response('HTTPS required',{status:426});
    if (url.pathname.startsWith('/api/')) {
      let api;
      try {api = new URL(env.XINWANG_API_ORIGIN);if (api.protocol !== 'https:' || api.origin !== env.XINWANG_API_ORIGIN || api.username || api.password) throw new Error('Invalid backend');}
      catch {return Response.json({error:{code:'service',message:'双人服务正在连接，请稍后刷新。'}},{status:503,headers:{'Cache-Control':'no-store'}});}
      const headers = new Headers();
      for (const name of ['content-type','origin','sec-fetch-site','x-csrf-token']) {
        const value = request.headers.get(name);if (value !== null) headers.set(name,value);
      }
      // Only the app cookie reaches Neon; platform sign-in cookies and identity headers never do.
      const cookies = (request.headers.get('cookie') || '').split(';').map(value => value.trim()).filter(value => value.startsWith('__Host-xinwang_session='));
      if (cookies.length) headers.set('cookie',cookies.join('; '));
      try {
        const upstream = await fetch(new URL(url.pathname + url.search,api),{method:request.method,headers,body:['GET','HEAD'].includes(request.method) ? undefined : request.body,redirect:'manual'});
        const result = new Response(upstream.body,upstream);
        result.headers.set('Cache-Control','no-store');
        return result;
      } catch {return Response.json({error:{code:'service',message:'双人服务暂时无法连接，请保留草稿。'}},{status:503,headers:{'Cache-Control':'no-store'}});}
    }
    if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405});
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!publicFiles.has(file)) return new Response('Not found',{status:404});
    const headers = new Headers();
    for (const name of ['range','if-none-match','if-modified-since']) {const value = request.headers.get(name);if (value !== null) headers.set(name,value);}
    try {
      const upstream = await fetch(new URL(file === 'index.html' ? '' : file,frontend),{method:request.method,headers,redirect:'manual'});
      if (upstream.status >= 300 && upstream.status < 400 && upstream.status !== 304) return new Response('页面资源地址暂时不可用。',{status:503});
      const result = new Response(upstream.body,upstream);
      result.headers.delete('set-cookie');
      result.headers.set('Referrer-Policy','no-referrer');
      result.headers.set('X-Content-Type-Options','nosniff');
      return result;
    } catch {return new Response('页面暂时无法连接，请稍后重试。',{status:503});}
  }
};
