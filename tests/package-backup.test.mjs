import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {backupDatabase} from '../scripts/backup-database.mjs';
import {packageServer} from '../scripts/package-server.mjs';

async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(),'xinwang-package-test-'));
  t.after(async () => {
    const prefix = resolve(tmpdir());
    if (resolve(root).startsWith(prefix + '\\xinwang-package-test-') || resolve(root).startsWith(prefix + '/xinwang-package-test-')) await rm(root,{recursive:true,force:true});
  });
  return root;
}
test('online database backup includes committed WAL data and refuses overwriting an existing file', async t => {
  const root = await temporary(t), source = join(root,'live.sqlite'), output = join(root,'snapshot.sqlite');
  const database = new DatabaseSync(source); database.exec('PRAGMA journal_mode=WAL; CREATE TABLE notes (text TEXT);');
  database.prepare('INSERT INTO notes VALUES (?)').run('test-private-content');
  await backupDatabase(source,output);
  const snapshot = new DatabaseSync(output,{readOnly:true});
  assert.equal(snapshot.prepare('SELECT text FROM notes').get().text,'test-private-content'); snapshot.close();
  const before = await readFile(output);
  await assert.rejects(backupDatabase(source,output), {code:'EEXIST'});
  assert.deepEqual(await readFile(output),before); database.close();
});
test('server package excludes databases, real env, backups and tests; extra output stops safely', async t => {
  const root = await temporary(t);
  const files = ['index.html','pianai.mp3','js/app.js','styles/app.css','assets/lily.svg','server/app.mjs','server/database.mjs','server/security.mjs','server/start.mjs','scripts/serve.mjs','scripts/backup-database.mjs','scripts/build.mjs','scripts/check-deploy.mjs','server/database-postgres.mjs','server/cloud.mjs','server/start-cloud.mjs','render.yaml','package-lock.json','docs/免费上线.md','package.json','.env.example','docs/双人版部署.md',
    'data/xinwang.sqlite','data-backups/private.sqlite','.env','backup-before-test/index.html','tests/private-fixture.json'];
  for (const file of files) {await mkdir(dirname(join(root,file)),{recursive:true}); await writeFile(join(root,file),file.includes('private') || file === '.env' ? 'DO_NOT_PACKAGE_PRIVATE' : 'fixture');}
  const result = await packageServer(root);
  assert(!result.files.some(file => /^(data\/|data-backups\/|tests\/|backup-)|^\.env$/.test(file)));
  for (const file of result.files) assert(!(await readFile(join(result.directory,file),'utf8')).includes('DO_NOT_PACKAGE_PRIVATE'));
  await writeFile(join(result.directory,'keep.txt'),'preserve this user file');
  await assert.rejects(packageServer(root),/额外文件/);
  assert.equal(await readFile(join(result.directory,'keep.txt'),'utf8'),'preserve this user file');
});
