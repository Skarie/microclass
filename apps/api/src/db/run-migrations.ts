/**
 * 迁移 CLI：npm run migrate（apps/api）
 * 兼容 V1 数据：0001 使用 IF NOT EXISTS，可直接在既有 microclass.db 上执行。
 */
import { loadConfig } from '../config/env.js';
import { openDb } from './client.js';
import { runMigrations } from './migrations.js';

const config = loadConfig();
const db = openDb(config.dataDir);

try {
  const result = runMigrations(db, config.migrationsDir);
  if (result.applied.length === 0) {
    process.stderr.write(`✓ 数据库已是最新（${result.skipped.length} 个迁移此前已应用）\n`);
  } else {
    for (const m of result.applied) {
      process.stderr.write(`✓ 应用迁移 ${m.version}_${m.name}\n`);
    }
    process.stderr.write(
      `完成：应用 ${result.applied.length} 个，跳过 ${result.skipped.length} 个，用时 ${result.durationMs}ms\n`,
    );
  }
} catch (e) {
  process.stderr.write(`✗ 迁移失败：${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
} finally {
  db.close();
}
