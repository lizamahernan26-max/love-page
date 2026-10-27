import {spawnSync} from 'node:child_process';
for (const file of ['server/app.mjs','server/database.mjs','server/database-postgres.mjs','server/cloud.mjs','server/start-cloud.mjs','js/online-api.js','js/online-space.js']) {
  const result = spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('部署入口语法检查通过；未连接数据库，未发布。');
