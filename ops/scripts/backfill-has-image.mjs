#!/usr/bin/env node
/**
 * 回填 `questions.has_image`（迁移 0009 新增的预计算列）。
 *
 * 为什么需要：题库体检要统计「带图 / 不带图」，原来靠三列 LIKE 全表扫描；
 * 36.6 万题 / 590MB 的库在 NAS 机械盘上要几十秒。导入器对新数据会直接写这一列，
 * 老数据用这个脚本补一次即可。
 *
 * 用法（容器内）：
 *   docker exec microclass-api node /app/ops/scripts/backfill-has-image.mjs
 *   docker exec microclass-api node /app/ops/scripts/backfill-has-image.mjs --data-dir /app/data
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const appRoot = process.env.MC_APP_ROOT || valueOf('--app-root', '/app');

const mod = async (rel) => import(pathToFileURL(path.join(appRoot, 'apps/api/dist', rel)).href);
const { loadConfig } = await mod('config/env.js');
const { openDb } = await mod('db/client.js');
const { QuestionRepository } = await mod('db/repositories/questionRepository.js');

const config = loadConfig();
if (valueOf('--data-dir', '')) config.dataDir = valueOf('--data-dir');
const db = openDb(config.dataDir);
const questions = new QuestionRepository(db);

const before = db.get('SELECT COUNT(*) AS c FROM questions').c;
const missing = db.get('SELECT COUNT(*) AS c FROM questions WHERE has_image = 0').c;
console.log(`题目 ${before} 道｜待回填 ${missing} 道（has_image = 0）`);
const t = Date.now();
const updated = questions.backfillHasImage(Number(valueOf('--batch', '5000')));
console.log(`已回填 ${updated} 道，用时 ${((Date.now() - t) / 1000).toFixed(1)} 秒`);
const stats = db.get('SELECT SUM(has_image) AS with_img, COUNT(*) AS total FROM questions');
console.log(`带图 ${stats.with_img} / ${stats.total}`);
db.close();
