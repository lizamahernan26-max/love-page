import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createServer } from '../scripts/serve.mjs';
import { build } from '../scripts/build.mjs';

let root;
let server;
let port;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'xinwang-server-test-'));
  await Promise.all(['js', 'styles', 'assets', 'docs', 'reference'].map(name => mkdir(join(root, name))));
  await Promise.all([
    writeFile(join(root, 'index.html'), '<!doctype html><title>心网测试</title>'),
    writeFile(join(root, 'pianai.mp3'), '0123456789'),
    writeFile(join(root, 'js', 'app.js'), 'export const value = 1;'),
    writeFile(join(root, 'styles', 'main.css'), 'body { color: pink; }'),
    writeFile(join(root, 'assets', 'lily.svg'), '<svg></svg>'),
    writeFile(join(root, 'docs', 'secret.md'), 'not public'),
    writeFile(join(root, 'reference', 'index.original.html'), 'not public'),
    writeFile(join(root, '.env'), 'test fixture, not a secret'),
  ]);
  server = createServer(root);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  // This is a directory made by this test, never the project or user data.
  if (root && root.startsWith(join(tmpdir(), 'xinwang-server-test-'))) await rm(root, { recursive: true, force: true });
});

function fetchRaw(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, ...options }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('serves the homepage and JS with the correct content types', async () => {
  const page = await fetchRaw('/');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.body, /心网测试/);
  const js = await fetchRaw('/js/app.js?v=1');
  assert.equal(js.status, 200);
  assert.match(js.headers['content-type'], /text\/javascript/);
});

test('audio byte ranges include prefix, suffix, open-ended and clamped ranges', async () => {
  for (const [range, body, contentRange] of [
    ['bytes=2-5', '2345', 'bytes 2-5/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'],
    ['bytes=7-', '789', 'bytes 7-9/10'],
    ['bytes=8-99', '89', 'bytes 8-9/10'],
  ]) {
    const result = await fetchRaw('/pianai.mp3', { headers: { Range: range } });
    assert.equal(result.status, 206);
    assert.equal(result.body, body);
    assert.equal(result.headers['content-range'], contentRange);
    assert.equal(Number(result.headers['content-length']), body.length);
    assert.equal(result.headers['content-type'], 'audio/mpeg');
  }
});

test('invalid and unsatisfiable audio ranges return 416', async () => {
  for (const range of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5', 'items=0-1', 'bytes=9007199254740992-']) {
    const result = await fetchRaw('/pianai.mp3', { headers: { Range: range } });
    assert.equal(result.status, 416, range);
    assert.equal(result.headers['content-range'], 'bytes */10');
  }
});

test('HEAD has the same content length and no body, including range responses', async () => {
  const whole = await fetchRaw('/pianai.mp3', { method: 'HEAD' });
  assert.equal(whole.status, 200);
  assert.equal(whole.headers['content-length'], '10');
  assert.equal(whole.body, '');
  const partial = await fetchRaw('/pianai.mp3', { method: 'HEAD', headers: { Range: 'bytes=1-2' } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers['content-length'], '2');
  assert.equal(partial.body, '');
});

test('rejects methods that can mutate data', async () => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const result = await fetchRaw('/', { method });
    assert.equal(result.status, 405);
    assert.equal(result.headers.allow, 'GET, HEAD');
  }
});

test('blocks traversal and files outside the public allowlist', async () => {
  for (const path of ['/../index.html', '/%2e%2e/index.html', '/js/%2e%2e/index.html', '/js%5c..%5cindex.html', '/.env', '/docs/secret.md', '/reference/index.original.html', '/scripts/serve.mjs', '/js/.secret.js', '/assets/data.json', '/index.html%00']) {
    const result = await fetchRaw(path);
    assert.equal(result.status, 403, path);
    assert(!result.body.includes('not public'));
  }
  assert.equal((await fetchRaw('/%ZZ')).status, 400);
});

test('missing allowed public files return 404', async () => {
  assert.equal((await fetchRaw('/assets/missing.svg')).status, 404);
  assert.equal((await fetchRaw('/js/missing.js')).status, 404);
});

test('build includes only public source assets and refuses unrelated output without deleting it', async () => {
  const result = await build(root);
  assert.deepEqual(result.files.sort(), ['assets/lily.svg', 'index.html', 'js/app.js', 'pianai.mp3', 'styles/main.css']);
  assert.equal(await readFile(join(result.directory, 'pianai.mp3'), 'utf8'), '0123456789');
  await assert.rejects(readFile(join(result.directory, 'docs', 'secret.md')), { code: 'ENOENT' });
  await writeFile(join(result.directory, 'keep.txt'), 'existing unrelated file');
  await assert.rejects(build(root), /Unexpected file in dist/);
  assert.equal(await readFile(join(result.directory, 'keep.txt'), 'utf8'), 'existing unrelated file');
});
