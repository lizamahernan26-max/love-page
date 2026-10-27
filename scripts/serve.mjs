import { createServer as createHttpServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
};

export function isPublicFile(path) {
  const parts = path.split('/');
  if (parts.some(part => !part || part.startsWith('.') || part.includes('\\'))) return false;
  if (path === 'index.html' || path === 'pianai.mp3' || path === 'assets/fonts/OFL.txt') return true;
  const extension = extname(path).toLowerCase();
  if (parts[0] === 'js') return ['.js', '.mjs'].includes(extension);
  if (parts[0] === 'styles') return extension === '.css';
  if (parts[0] === 'assets') {
    return ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.woff', '.woff2', '.mp3'].includes(extension);
  }
  return false;
}

function insideRoot(root, file) {
  const child = relative(root, file);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

export function createServer(root = projectRoot) {
  const rootPath = resolve(root);
  return createHttpServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    function error(status, message) {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : message);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      error(405, 'Method not allowed');
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      error(400, 'Invalid URL');
      return;
    }
    if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part === '.' || part === '..')) {
      error(403, 'Forbidden');
      return;
    }
    if (pathname === '/api/status') {
      const body = JSON.stringify({online: false});
      res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body)});
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    const publicPath = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!isPublicFile(publicPath)) {
      error(403, 'Forbidden');
      return;
    }

    let file;
    let info;
    try {
      const actualRoot = await realpath(rootPath);
      file = await realpath(resolve(rootPath, publicPath));
      if (!insideRoot(actualRoot, file) || !isPublicFile(relative(actualRoot, file).split(sep).join('/'))) {
        error(403, 'Forbidden');
        return;
      }
      info = await stat(file);
      if (!info.isFile()) {
        error(404, 'Not found');
        return;
      }
    } catch (cause) {
      error(['ENOENT', 'ENOTDIR'].includes(cause.code) ? 404 : 500, 'File unavailable');
      return;
    }

    res.setHeader('Content-Type', mimeTypes[extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    let range;
    if (req.headers.range) {
      range = parseRange(req.headers.range, info.size);
      if (!range) {
        res.setHeader('Content-Range', `bytes */${info.size}`);
        error(416, 'Range not satisfiable');
        return;
      }
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${info.size}`);
    }
    res.setHeader('Content-Length', range ? range.end - range.start + 1 : info.size);
    res.statusCode = range ? 206 : 200;
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = createReadStream(file, range || {});
    stream.on('error', () => {
      if (res.headersSent) res.destroy();
      else {
        res.removeHeader('Content-Length');
        error(500, 'File unavailable');
      }
    });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be an integer between 1 and 65535.');
    process.exitCode = 1;
  } else {
    const server = createServer();
    server.on('error', error => {
      console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Close the previous preview or choose another PORT.` : `Preview failed: ${error.code || 'unknown error'}`);
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => {
      console.log(`心网本地预览: http://127.0.0.1:${port}`);
      console.log('仅此电脑可访问。按 Ctrl+C 关闭预览。');
    });
  }
}
