#!/usr/bin/env node
/**
 * 回填题目标准化元数据：
 *   1) `questions.content_hash`：查重与「同题不同答案」体检的判据（导入器会写，手工新增的题目历史上没写）；
 *   2) `questions.has_image`：体检用的预计算列（迁移 0009 新增）；
 *   3) `questions.analysis_media_only`：解析「只有图片、没有一个字」的标记（迁移 0020 新增）；
 *   4) `--only rehash`：指纹算法升级后**全量重算**（例如图片从「忽略」改成「按地址参与」）。
 *
 * 用法（容器内）：
 *   docker exec microclass-api node /app/ops/scripts/backfill-question-meta.mjs
 *   docker exec microclass-api node /app/ops/scripts/backfill-question-meta.mjs --data-dir /app/data
 *   docker exec microclass-api node /app/ops/scripts/backfill-question-meta.mjs --only hash
 *   docker exec microclass-api node /app/ops/scripts/backfill-question-meta.mjs --only analysis-media
 *   docker exec microclass-api node /app/ops/scripts/backfill-question-meta.mjs --only rehash
 *
 * 幂等：跑第二遍不会再有可回填的行；`--only rehash` 重复跑结果一致。
 * 注意：全量重算会改写 30+ 万行，WAL 会涨得比较大，建议先 `npm run backup`；
 *       重算完要重新扫一次冲突台账（`POST /api/v1/question-conflicts/sync`）。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const appRoot = process.env.MC_APP_ROOT || valueOf('--app-root', '/app');
const only = valueOf('--only', '');

const mod = async (rel) => import(pathToFileURL(path.join(appRoot, 'apps/api/dist', rel)).href);
const { loadConfig } = await mod('config/env.js');
const { openDb } = await mod('db/client.js');
const { QuestionRepository } = await mod('db/repositories/questionRepository.js');

const config = loadConfig();
if (valueOf('--data-dir', '')) config.dataDir = valueOf('--data-dir');
const db = openDb(config.dataDir);
// 批量写脚本可能与运行中的服务撞写锁：NAS 慢盘上一次批次提交可能超过默认的 5 秒 busy_timeout，
// 这里放宽到 2 分钟，配合仓储层的退避重试（SQLITE_BUSY）。
db.exec('PRAGMA busy_timeout = 120000;');
const questions = new QuestionRepository(db);

const total = db.get('SELECT COUNT(*) AS c FROM questions').c;
console.log(`题目总数 ${total} 道`);

if (only === 'rehash') {
  console.log('\n全量重算内容指纹（指纹算法升级时用，会改写所有行）…');
  const t = Date.now();
  let lastLog = 0;
  const updated = questions.rehashContentHash(Number(valueOf('--batch', '2000')), (done, all) => {
    if (done - lastLog >= 50000 || done === all) {
      lastLog = done;
      console.log(`  ${done}/${all}（${((Date.now() - t) / 1000).toFixed(0)} 秒）`);
    }
  });
  console.log(`已重算 ${updated} 道，用时 ${((Date.now() - t) / 1000).toFixed(1)} 秒`);
  console.log('提醒：重算后请重新扫一次冲突台账（POST /api/v1/question-conflicts/sync）。');
} else {
  if (only === '' || only === 'hash') {
    const missing = questions.countMissingContentHash();
    console.log(`\n[1/2] 内容指纹：缺 ${missing} 道`);
    if (missing > 0) {
      const t = Date.now();
      const updated = questions.backfillContentHash(Number(valueOf('--batch', '2000')));
      console.log(`  已回填 ${updated} 道，用时 ${((Date.now() - t) / 1000).toFixed(1)} 秒`);
    }
  }

  if (only === '' || only === 'image') {
    const withoutImage = db.get('SELECT COUNT(*) AS c FROM questions WHERE has_image = 0').c;
    console.log(`\n[2/3] 带图标记：has_image = 0 的有 ${withoutImage} 道`);
    const t = Date.now();
    const updated = questions.backfillHasImage(Number(valueOf('--batch', '5000')));
    console.log(`  已回填 ${updated} 道，用时 ${((Date.now() - t) / 1000).toFixed(1)} 秒`);
  }

  if (only === '' || only === 'analysis-media') {
    // 「解析只有图片」= 去掉 ![](图) 之后一个字都不剩：图片里是解析文字，
    // 按关键字搜解析搜不到、老师也没法在题面上改（迁移 0020）。
    console.log('\n[3/3] 解析纯图片标记（analysis_media_only）…');
    const t = Date.now();
    const updated = questions.backfillAnalysisMediaOnly(Number(valueOf('--batch', '2000')));
    console.log(`  已标记 ${updated} 道，用时 ${((Date.now() - t) / 1000).toFixed(1)} 秒`);
  }
}

const after = db.get(
  "SELECT SUM(has_image) AS with_img, SUM(analysis_media_only) AS media_only, COUNT(*) AS total, SUM(CASE WHEN content_hash IS NULL OR content_hash = '' THEN 1 ELSE 0 END) AS no_hash FROM questions",
);
console.log(`\n结果：带图 ${after.with_img} / ${after.total}｜解析纯图片 ${after.media_only}｜缺指纹 ${after.no_hash}`);
db.close();
