import {DatabaseSync, backup} from 'node:sqlite';
import {lstat, mkdir, open} from 'node:fs/promises';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function backupDatabase(source, output) {
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('数据库必须为普通文件。');
  await mkdir(dirname(output), {recursive:true,mode:0o700});
  const reservation = await open(output, 'wx', 0o600); await reservation.close();
  const database = new DatabaseSync(source, {readOnly:true});
  try {await backup(database,output);}
  finally {database.close();}
  return output;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.env.DATABASE_URL) throw new Error('云端使用 PostgreSQL，请按 docs/免费上线.md 备份 Neon；本命令仅备份本机 SQLite。');
  const source = resolve(process.env.XINWANG_DB_PATH || join(projectRoot,'data/xinwang.sqlite'));
  const name = `xinwang-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomBytes(4).toString('hex')}.sqlite`;
  const output = resolve(process.argv[2] || join(projectRoot,'data-backups',name));
  await backupDatabase(source,output);
  console.log(`数据库备份完成：${output}`);
  console.log('备份包含账号、会话和全部记录，未做端到端加密。请置于受控目录，不要上传到静态网站。');
}
