/**
 * 难度校准性能自测（本地临时 SQLite 库，跑完自动删除；**不连接任何现有数据库**）。
 *
 * 用法：
 *   npx tsx apps/api/test/perf-difficulty.ts               # 39.6 万题 / 10 万候选（默认）
 *   npx tsx apps/api/test/perf-difficulty.ts 120000 30000  # 自定义题数 / 有作答的题数
 *
 * 对比三件事：
 *   1. 旧实现：逐题 `difficultyScoreOf` 取先验分（PG 下每道题一次往返）；
 *   2. 新实现：按块 `IN (...)` 批量取 + 内存计算（500 / 1000 / 2000 三档块大小）；
 *   3. 落库：逐题 UPDATE vs 多行 CASE 批量 UPDATE。
 * 每道有作答的题造 5 次作答（刚过 `minSamples=5` 的门槛），全部做错/做对各半。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { User } from '@microclass/shared';
import { createSqliteAsyncDb, type AsyncDb } from '../src/db/async.js';
import { Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrations.js';
import { AuditRepository } from '../src/db/repositories/auditRepository.js';
import { QuestionRepository } from '../src/db/repositories/questionRepository.js';
import { SettingsRepository } from '../src/db/repositories/settingsRepository.js';
import type { DifficultyUpdateItem } from '../src/db/repositories/question-types.js';
import { withBusyRetry } from '../src/db/repositories/question-write.js';
import { bucketFromScore, calibrateScore } from '../src/domain/difficulty.js';
import { DifficultyService } from '../src/services/difficultyService.js';

const questionCount = Number(process.argv[2] ?? 396_000);
const candidateCount = Math.min(Number(process.argv[3] ?? 100_000), questionCount);
const answersPerQuestion = 5;
const now = () => performance.now();
const ms = (v: number) => `${Math.round(v)} ms`;
const out = (line: string) => process.stdout.write(`${line}\n`);

async function seed(db: Db): Promise<void> {
  db.run('INSERT INTO courses (id, name) VALUES (1, ?)', ['性能课']);
  db.run('INSERT INTO lessons (id, title, course_id, group_name) VALUES (1, ?, 1, ?)', ['性能课时', '第一章']);
  db.run('INSERT INTO banks (id, name, kind, subject, book) VALUES (1, ?, ?, ?, ?)', [
    '七年级上册 · 期末测评 · 综合卷',
    'paper',
    '数学',
    '七年级上册',
  ]);
  const t0 = now();
  db.transaction(() => {
    for (let i = 1; i <= questionCount; i += 1) {
      // 五分之一没算过先验分（-1），其余 0–100 循环，覆盖「没分时按 50 处理」的分支
      const prior = i % 5 === 0 ? -1 : i % 101;
      db.run(
        `INSERT INTO questions (bank_id, type, stem, options, answer, difficulty, subject, stage, book, chapter,
           point, content_hash, has_image, difficulty_score, difficulty_source)
         VALUES (1, 'fill', ?, '[]', '5', '', '数学', '初中', '七年级上册', '第一单元', '有理数', ?, 0, ?, '')`,
        [`计算 $${i % 97}+3$ 的结果。`, `h${i}`, prior],
      );
    }
    for (let qid = 1; qid <= candidateCount; qid += 1) {
      for (let n = 0; n < answersPerQuestion; n += 1) {
        db.run('INSERT INTO attempts (client_id, lesson_id, answers, score, total) VALUES (?,1,?,0,1)', [
          `c${qid}_${n}`,
          JSON.stringify([{ qid, answer: 'x', correct: n % 2 === 0 }]),
        ]);
      }
    }
  });
  out(
    `造数：${questionCount} 题 / ${candidateCount} 题有作答 / ${candidateCount * answersPerQuestion} 条 attempts，${ms(now() - t0)}`,
  );
}

/** 迁移前的逐题路径（对照实现，逐题查询先验分） */
async function rowByRow(
  questions: QuestionRepository,
  service: DifficultyService,
  k: number,
): Promise<{ items: DifficultyUpdateItem[]; ms: number; queries: number }> {
  const stats = await questions.answerStats();
  const cuts = service.cuts();
  const items: DifficultyUpdateItem[] = [];
  const t0 = now();
  let queries = 0;
  for (const stat of stats.values()) {
    if (stat.total < 5) continue;
    const row = await questions.difficultyScoreOf(stat.id);
    queries += 1;
    if (!row) continue;
    const prior = row.difficulty_score >= 0 ? row.difficulty_score : 50;
    const blended = calibrateScore(prior, stat, { k });
    items.push({
      id: stat.id,
      score: blended.score,
      difficulty: bucketFromScore(blended.score, cuts),
      source: 'calibrated',
      n: stat.total,
      p: blended.p,
    });
  }
  return { items, ms: now() - t0, queries };
}

/** 迁移前的逐题 UPDATE（对照实现） */
async function rowByRowWrite(asyncDb: AsyncDb, items: DifficultyUpdateItem[]): Promise<number> {
  const t0 = now();
  await withBusyRetry(() =>
    asyncDb.transaction(async (tx) => {
      for (const it of items) {
        await tx.run(
          `UPDATE questions SET difficulty_score = ?, difficulty = ?, difficulty_source = ?,
             difficulty_n = ?, difficulty_p = ?, difficulty_at = 1 WHERE id = ?`,
          [it.score, it.difficulty, it.source, it.n ?? 0, it.p ?? null, it.id],
        );
      }
    }),
  );
  return now() - t0;
}

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-perf-diff-'));
  const db = new Db(path.join(dir, 'perf.db'));
  try {
    runMigrations(db, path.resolve(process.cwd(), 'db', 'migrations'));
    await seed(db);
    const asyncDb = createSqliteAsyncDb(db);
    const questions = new QuestionRepository(db, asyncDb);
    const settings = new SettingsRepository(asyncDb);
    await settings.load();
    const service = new DifficultyService(questions, settings, new AuditRepository(db, asyncDb));
    const actor = { id: 1, username: 'perf' } as User;

    const statsT0 = now();
    await questions.answerStats();
    const statsMs = now() - statsT0;
    out(`answerStats（两条路径共用，不在下面的对比里）：${ms(statsMs)}`);

    const old = await rowByRow(questions, service, 20);
    out(`旧实现 逐题查询：${ms(old.ms)}（${old.queries} 次查询，平均 ${(old.ms / old.queries).toFixed(3)} ms/次）`);

    const chunkResults: { size: number; ms: number }[] = [];
    for (const size of [500, 1000, 2000]) {
      const t0 = now();
      const res = await service.calibrate(actor, { dryRun: true, chunkSize: size });
      const total = now() - t0;
      const fetchMs = total - statsMs;
      chunkResults.push({ size, ms: fetchMs });
      out(
        `新实现 chunk=${size}：${ms(fetchMs)}` +
          `（${res.calibrated} 题，${Math.ceil(res.candidates / 500)} 次 IN 查询；含 answerStats 共 ${ms(total)}）`,
      );
    }

    const oldWriteMs = await rowByRowWrite(asyncDb, old.items);
    out(`旧实现 逐题 UPDATE：${ms(oldWriteMs)}（${old.items.length} 条语句，一个事务）`);
    const newWriteT0 = now();
    await questions.setDifficulty(old.items);
    const newWriteMs = now() - newWriteT0;
    out(
      `新实现 临时表+一条 UPDATE：${ms(newWriteMs)}（${Math.ceil(old.items.length / 500)} 条 INSERT + 1 条 UPDATE，一个事务）`,
    );

    const best = chunkResults.reduce((a, b) => (a.ms <= b.ms ? a : b));
    out(
      `结论：本地 SQLite 最优块大小 = ${best.size}（${ms(best.ms)}）；逐题查询次数是批量的 ${old.queries} vs ${Math.ceil(old.queries / 500)}`,
    );
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

await main();
