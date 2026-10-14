#!/usr/bin/env node
/**
 * 全库（或指定题库）重算题目难度 —— 难度模型（内容特征先验）批量落库。
 *
 * 用法（容器内）：
 *   docker exec microclass-api node /app/ops/scripts/recompute-difficulty.mjs --dry-run
 *   docker exec microclass-api node /app/ops/scripts/recompute-difficulty.mjs
 *   docker exec microclass-api node /app/ops/scripts/recompute-difficulty.mjs --bank 1234
 *   docker exec microclass-api node /app/ops/scripts/recompute-difficulty.mjs --calibrate --dry-run
 *   docker exec microclass-api node /app/ops/scripts/recompute-difficulty.mjs --calibrate
 *
 * 说明：
 * - **人工标注（manual）与已校准（calibrated）的题默认不动**；`--force-all` 才会连它们一起重算；
 * - 全库 36 万题是读密集操作（题干 + 选项 + 答案），在 NAS 慢盘上要几分钟：
 *   关掉 `wal_autocheckpoint`、开大页缓存与 mmap，跑完做一次 `wal_checkpoint(TRUNCATE)`；
 * - 大批量执行建议停服独占（见 docs/ops-runbook.md），至少不要与其它写任务并发。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(name);
const appRoot = process.env.MC_APP_ROOT || valueOf('--app-root', '/app');

const mod = async (rel) => import(pathToFileURL(path.join(appRoot, 'apps/api/dist', rel)).href);
const { loadConfig } = await mod('config/env.js');
const { openDb } = await mod('db/client.js');
const { QuestionRepository } = await mod('db/repositories/questionRepository.js');
const { SettingsRepository } = await mod('db/repositories/settingsRepository.js');
const { AuditRepository } = await mod('db/repositories/auditRepository.js');
const { DifficultyService } = await mod('services/difficultyService.js');

const config = loadConfig();
if (valueOf('--data-dir', '')) config.dataDir = valueOf('--data-dir');
const db = openDb(config.dataDir);
db.exec('PRAGMA busy_timeout = 120000;');
db.exec('PRAGMA wal_autocheckpoint = 0;');
db.exec('PRAGMA cache_size = -262144;'); // ≈256MB
try {
  db.exec('PRAGMA mmap_size = 1073741824;');
} catch {
  /* 忽略 */
}

const questions = new QuestionRepository(db);
const service = new DifficultyService(questions, new SettingsRepository(db), new AuditRepository(db));

const bankId = valueOf('--bank', '') === '' ? undefined : Number(valueOf('--bank'));
const dryRun = has('--dry-run');
const calibrate = has('--calibrate');
const forceAll = has('--force-all');
const actor = { id: 1, username: 'system:difficulty', role: 'admin' };

const before = questions.difficultyStats(bankId, service.cuts());
console.log(
  `范围：${bankId === undefined ? '全库' : `题库 #${bankId}`}｜题量 ${before.total}｜未算过 ${before.unscored}`,
);
console.log(
  `当前三档：${before.buckets.map((b) => `${b.difficulty || '未标'}=${b.questions}`).join(' ')}｜来源：${before.sources
    .map((s) => `${s.source}=${s.questions}`)
    .join(' ')}`,
);

const t0 = Date.now();
if (calibrate) {
  const preview = service.calibrate(actor, { dryRun: true });
  console.log(
    `\n作答校准：达到样本量门槛的题 ${preview.candidates} 道（minSamples=${preview.minSamples}，k=${preview.k}）`,
  );
  for (const s of preview.samples.slice(0, 5)) {
    console.log(`  题 #${s.id}：先验 ${s.prior} → 校准 ${s.next}（${s.n} 次作答，正确率 ${(s.p * 100).toFixed(0)}%）`);
  }
  if (dryRun) {
    console.log('（--dry-run：未写库）');
  } else {
    const applied = service.calibrate(actor, { dryRun: false });
    console.log(`已校准 ${applied.calibrated} 道题，用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
  }
} else {
  const preview = service.preview(bankId, { keepManual: !forceAll, keepCalibrated: !forceAll });
  console.log(
    `\n预览：将评估 ${preview.willScore} 道（跳过人工 ${preview.skippedManual} / 已校准 ${preview.skippedCalibrated}）`,
  );
  console.log(
    `  预测三档：${preview.predicted.buckets.map((b) => `${b.difficulty}=${b.questions}(${b.ratio}%)`).join(' ')}`,
  );
  console.log(`  分档阈值（分位数）：基础 < ${preview.cuts.easyMax}｜中档 < ${preview.cuts.mediumMax}｜其余较难`);
  for (const s of preview.samples.hardest.slice(0, 3)) {
    console.log(`  最难样例 ${s.score} 分：${String(s.stem).replace(/\s+/g, ' ').slice(0, 60)}｜${s.reasons}`);
  }
  for (const s of preview.samples.easiest.slice(0, 2)) {
    console.log(`  最易样例 ${s.score} 分：${String(s.stem).replace(/\s+/g, ' ').slice(0, 60)}`);
  }
  if (dryRun) {
    console.log('（--dry-run：未写库）');
  } else {
    const applied = service.apply(actor, {
      ...(bankId === undefined ? {} : { bankId }),
      keepManual: !forceAll,
      keepCalibrated: !forceAll,
    });
    console.log(
      `\n已写回 ${applied.updated} 道题（评估 ${applied.scored}，保留人工 ${applied.skippedManual} / 已校准 ${applied.skippedCalibrated}），` +
        `用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`,
    );
  }
}

const after = questions.difficultyStats(bankId, service.cuts());
console.log(
  `\n三档：${after.buckets.map((b) => `${b.difficulty || '未标'}=${b.questions}`).join(' ')}｜未算过 ${after.unscored}`,
);
console.log(`五级：${after.levels.map((l) => `${l.level === 0 ? '未评估' : `${l.level}★`}=${l.questions}`).join(' ')}`);
console.log(`来源：${after.sources.map((s) => `${s.source}=${s.questions}`).join(' ')}`);

const t2 = Date.now();
const cp = db.get('PRAGMA wal_checkpoint(TRUNCATE)');
console.log(`WAL 检查点：${JSON.stringify(cp)}（${((Date.now() - t2) / 1000).toFixed(0)} 秒）`);
db.close();
