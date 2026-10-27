import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderConfiguration,startCloud} from './cloud.mjs';
import {connectPostgres} from './database-postgres.mjs';

try {
  const config = renderConfiguration(process.env);
  const database = await connectPostgres(process.env.DATABASE_URL);
  const app = await startCloud({root:resolve(dirname(fileURLToPath(import.meta.url)),'..'),database,...config});
  console.log(`心网已启动：${config.publicOrigin}；数据库使用外部 PostgreSQL。`);
  const stop = () => app.close().catch(() => {process.exitCode = 1;});
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
} catch {
  // Startup errors may contain connection credentials. Do not print raw exceptions.
  console.error('云端启动失败：请检查 Node 24、HTTPS 地址、数据库连接和初始化密钥。'); process.exitCode = 1;
}
