/**
 * 难度校准批量化回归。
 *
 * 迁移前 `calibrate` 对每个候选**逐题** `difficultyScoreOf`；现在改成按块 `IN` 查询 +
 * 内存计算。这里把旧逻辑原样保留成 `rowByRow()` 作对照：同一批题、同一份作答数据，
 * 两条路径的分数、三档等级、校准样例必须完全一致。
 *
 * 另外覆盖：分块边界（0 / 1 / 恰好一块 / 跨块）、题已删除、dry-run 不写库、
 * 以及 `setDifficulty` 跨 500 行分块写（含 n/p 为空的题）。
 */
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { User } from '@microclass/shared';
import { createSqliteAsyncDb } from '../src/db/async.js';
import { Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrations.js';
import { AuditRepository } from '../src/db/repositories/auditRepository.js';
import { QuestionRepository } from '../src/db/repositories/questionRepository.js';
import { SettingsRepository } from '../src/db/repositories/settingsRepository.js';
import { bucketFromScore, calibrateScore } from '../src/domain/difficulty.js';
import { DifficultyService } from '../src/services/difficultyService.js';

const migrationsDir = path.resolve(__dirname, '..', '..', '..', 'db', 'migrations');
const actor = { id: 1, username: 'tester' } as User;
const MIN_SAMPLES = 5;

let db: Db;
let questions: QuestionRepository;
let service: DifficultyService;
let seq = 0;

function addQuestion(prior: number, source = ''): number {
  seq += 1;
  return db.run(
    `INSERT INTO questions (bank_id, type, stem, options, answer, difficulty, subject, stage, book, chapter, point,
       content_hash, has_image, difficulty_score, difficulty_source)
     VALUES (1, 'fill', ?, '[]', '5', '', '数学', '初中', '七年级上册', '第一单元', '有理数', ?, 0, ?, ?)`,
    [`计算 $${seq}+3$ 的结果。`, `h${seq}`, prior, source],
  ).lastInsertRowid;
}

/** 给一道题造 `total` 次作答，其中 `correct` 次答对 */
function addAnswers(qid: number, total: number, correct: number): void {
  for (let i = 0; i < total; i += 1) {
    seq += 1;
    db.run('INSERT INTO attempts (client_id, lesson_id, answers, score, total) VALUES (?,1,?,0,1)', [
      `c${seq}`,
      JSON.stringify([{ qid, answer: 'x', correct: i < correct }]),
    ]);
  }
}

/** 迁移前的逐题路径（对照实现，不要「优化」它） */
async function rowByRow(k: number): Promise<Map<number, { score: number; difficulty: string; n: number; p: number }>> {
  const stats = await questions.answerStats();
  const cuts = service.cuts();
  const out = new Map<number, { score: number; difficulty: string; n: number; p: number }>();
  for (const stat of stats.values()) {
    if (stat.total < MIN_SAMPLES) continue;
    const row = await questions.difficultyScoreOf(stat.id);
    if (!row) continue;
    const prior = row.difficulty_score >= 0 ? row.difficulty_score : 50;
    const blended = calibrateScore(prior, stat, { k });
    out.set(stat.id, {
      score: blended.score,
      difficulty: bucketFromScore(blended.score, cuts),
      n: stat.total,
      p: blended.p,
    });
  }
  return out;
}

beforeEach(() => {
  seq = 0;
  db = new Db(':memory:');
  runMigrations(db, migrationsDir);
  const asyncDb = createSqliteAsyncDb(db);
  const settings = new SettingsRepository(asyncDb);
  questions = new QuestionRepository(db, asyncDb);
  service = new DifficultyService(questions, settings, new AuditRepository(db, asyncDb));
  db.run('INSERT INTO courses (id, name) VALUES (1, ?)', ['测试课程']);
  db.run('INSERT INTO lessons (id, title, course_id, group_name) VALUES (1, ?, 1, ?)', ['测试课时', '第一章']);
  db.run('INSERT INTO banks (id, name, kind, subject, book) VALUES (1, ?, ?, ?, ?)', [
    '七年级上册 · 期末测评',
    'paper',
    '数学',
    '七年级上册',
  ]);
});

afterEach(() => db.close());

describe('批量校准与逐题校准一致', () => {
  it('分数/等级/样本逐题相同，已删除的题跳过', async () => {
    const priors = [-1, 0, 25, 50, 74, 100];
    const seeded = new Map<number, number>();
    for (const [i, prior] of priors.entries()) {
      const id = addQuestion(prior, i === 5 ? 'manual' : '');
      seeded.set(id, prior);
      addAnswers(id, MIN_SAMPLES + i * 3, i % 3); // 样本与正确率都不同
    }
    seeded.set(addQuestion(60), 60); // 有先验分但样本不足 → 不校准
    addAnswers(999_999, MIN_SAMPLES, 0); // 作答里引用了已删除的题

    const expected = await rowByRow(20);
    expect(expected.size).toBe(priors.length);

    const res = await service.calibrate(actor, { dryRun: false, chunkSize: 2 });
    expect(res.candidates).toBe(priors.length + 1);
    expect(res.calibrated).toBe(expected.size);

    const rows = db.all<{
      id: number;
      difficulty_score: number;
      difficulty: string;
      difficulty_source: string;
      difficulty_n: number;
      difficulty_p: number;
    }>('SELECT id, difficulty_score, difficulty, difficulty_source, difficulty_n, difficulty_p FROM questions');
    for (const row of rows) {
      const want = expected.get(row.id);
      if (!want) {
        expect(row.difficulty_score).toBe(seeded.get(row.id)); // 样本不足的题保持原样
        expect(row.difficulty_source).not.toBe('calibrated');
        continue;
      }
      expect(row.difficulty_score).toBe(want.score);
      expect(row.difficulty).toBe(want.difficulty);
      expect(row.difficulty_n).toBe(want.n);
      expect(row.difficulty_p).toBeCloseTo(want.p, 5);
      expect(row.difficulty_source).toBe('calibrated');
    }
  });

  it('返回的样例按候选顺序取前 10 条，与逐题顺序一致', async () => {
    for (let i = 0; i < 12; i += 1) addAnswers(addQuestion(20 + i), MIN_SAMPLES + i, i % 4);
    const res = await service.calibrate(actor, { dryRun: true, chunkSize: 3 });
    const expected = await rowByRow(20);
    expect(res.samples).toHaveLength(10);
    const ids = [...expected.keys()].slice(0, 10);
    expect(res.samples.map((s) => s.id)).toEqual(ids);
    for (const sample of res.samples) {
      expect(sample.next).toBe(expected.get(sample.id)?.score);
    }
  });
});

describe('分块边界', () => {
  it('0 题：候选为空，直接返回空结果', async () => {
    const res = await service.calibrate(actor, { dryRun: false });
    expect(res).toMatchObject({ candidates: 0, calibrated: 0, samples: [] });
  });

  it('1 题：样本刚过门槛即可校准', async () => {
    const id = addQuestion(40);
    addAnswers(id, MIN_SAMPLES, 0);
    const res = await service.calibrate(actor, { dryRun: false });
    expect(res).toMatchObject({ candidates: 1, calibrated: 1 });
    expect(res.samples).toHaveLength(1);
    const row = db.get<{ difficulty_source: string; difficulty_n: number }>(
      'SELECT difficulty_source, difficulty_n FROM questions WHERE id = ?',
      [id],
    );
    expect(row).toMatchObject({ difficulty_source: 'calibrated', difficulty_n: MIN_SAMPLES });
  });

  it('恰好一块 / 跨块：chunkSize=2 时 2 题与 5 题都完整处理', async () => {
    for (let i = 0; i < 2; i += 1) addAnswers(addQuestion(30 + i * 10), MIN_SAMPLES, i);
    const oneChunk = await service.calibrate(actor, { dryRun: true, chunkSize: 2 });
    expect(oneChunk).toMatchObject({ candidates: 2, calibrated: 2 });

    for (let i = 0; i < 3; i += 1) addAnswers(addQuestion(50 + i * 10), MIN_SAMPLES, i);
    const crossChunk = await service.calibrate(actor, { dryRun: true, chunkSize: 2 });
    expect(crossChunk).toMatchObject({ candidates: 5, calibrated: 5 });
    expect(crossChunk.samples).toHaveLength(5);
  });

  it('dry-run 默认不写库（分跨块也一样）', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const id = addQuestion(70);
      addAnswers(id, MIN_SAMPLES * 2, 0);
      ids.push(id);
    }
    const res = await service.calibrate(actor, { chunkSize: 1 });
    expect(res.dryRun).toBe(true);
    expect(res.calibrated).toBe(4);
    const rows = db.all<{ difficulty_score: number; difficulty_source: string; difficulty_n: number }>(
      'SELECT difficulty_score, difficulty_source, difficulty_n FROM questions ORDER BY id',
    );
    expect(rows.every((r) => r.difficulty_score === 70 && r.difficulty_source === '' && r.difficulty_n === 0)).toBe(
      true,
    );
  });
});

describe('批量落库', () => {
  it('跨 500 行分块写：分数/三档/来源/样本数/正确率都落对', async () => {
    const items = Array.from({ length: 1001 }, (_, i) => ({
      id: addQuestion(-1),
      score: i % 101,
      difficulty: i % 3 === 0 ? 'easy' : i % 3 === 1 ? 'medium' : 'hard',
      source: 'calibrated' as const,
      n: i,
      p: i % 2 === 0 ? null : 0.5,
    }));
    await expect(questions.setDifficulty(items)).resolves.toBe(items.length);
    const rows = db.all<{
      id: number;
      difficulty_score: number;
      difficulty: string;
      difficulty_n: number;
      difficulty_p: number | null;
    }>('SELECT id, difficulty_score, difficulty, difficulty_n, difficulty_p FROM questions ORDER BY id');
    expect(rows).toHaveLength(items.length);
    for (const [i, row] of rows.entries()) {
      expect(row).toMatchObject({
        id: items[i]?.id,
        difficulty_score: items[i]?.score,
        difficulty: items[i]?.difficulty,
        difficulty_n: items[i]?.n,
      });
      expect(row.difficulty_p).toBe(items[i]?.p);
    }
  });
});
