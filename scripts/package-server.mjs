import {copyFile, lstat, mkdir, readdir, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from './build.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function packageServer(root = projectRoot) {
  const output = join(root,'deploy-output');
  const built = await build(root);
  const files = [...built.files, 'server/app.mjs', 'server/database.mjs', 'server/security.mjs', 'server/start.mjs', 'server/database-postgres.mjs', 'server/cloud.mjs', 'server/start-cloud.mjs', 'scripts/build.mjs', 'scripts/check-deploy.mjs', 'render.yaml', 'package-lock.json', 'docs/免费上线.md', 'scripts/serve.mjs', 'scripts/backup-database.mjs', 'package.json', '.env.example', 'docs/双人版部署.md'];
  const allowed = new Set([...files,'README.md']);
  async function directory(path) {
    try {const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('部署目录含非普通目录，请先移走：' + path);}
    catch (error) {if (error.code !== 'ENOENT') throw error; await mkdir(path);}
  }
  await directory(output);
  async function inspect(relative = '') {
    for (const entry of await readdir(join(output,relative),{withFileTypes:true})) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error('部署目录含链接，请先移走：' + name);
      if (entry.isDirectory()) await inspect(name);
      else if (!entry.isFile() || !allowed.has(name)) throw new Error('部署目录含额外文件，已停止且不会删除：' + name);
    }
  }
  await inspect();
  for (const file of files) {
    const source = join(root,file), target = join(output,file);
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('不允许打包链接或非普通文件：' + file);
    let folder = output;
    for (const part of file.split('/').slice(0,-1)) {folder = join(folder,part); await directory(folder);}
    await copyFile(source,target);
  }
  await writeFile(join(output,'README.md'), '# 心网双人版部署包\n\n需要 Node.js 24。SQLite 本机入口仍不需要运行依赖；Render + Neon 云端使用 npm ci 安装锁定的 pg 驱动。先阅读 docs/免费上线.md。npm start 是本机入口；云端使用 npm run start:cloud。\n\n本包不包含真实数据库、账号、密码、Cookie 或 .env。dist 静态文件不能单独实现双人功能。\n');
  return {directory:output,files:[...files,'README.md']};
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await packageServer(); console.log(`Packaged ${result.files.length} files into ${result.directory}. Nothing published.`);
}
