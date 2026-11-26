/**
 * exams 写 + attempts / 错题本（P0 阶段 2 批次 2）的事务与回滚测试。
 *
 * 钉住四件事：
 *   1. 写方法改 AsyncDb 后仍然「该写的都写进去」（`RETURNING id`、卷内去重加题、换题保位置）；
 *   2. **组卷**（清空 + 加题 + 逐题分值/大题）在同一个事务：中途失败整批回滚，
 *      不会留下「清空后只加了一半」的残卷（用临时触发器制造失败，口径同
 *      `progress-write-transaction.test.ts` / `lesson-course-write-transaction.test.ts`）；
 *   3. **刷题交卷**（attempt + 错题本）同事务：错题本写失败时 attempt 也不能留下；
 *   4. **考试交卷**：落库失败时既没有成绩行、也不能留下「已交卷」审计；
 *      写卷成功后卷面缓存立即失效（紧接着的交卷必须按新卷判分）。
 *
 * 本文件默认只跑 sqlite（内存库）；PG 分支需要 `MC_PG_TEST_URL`（按硬规则不在生产机器上跑）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { User } from '@microclass/shared';
import { buildApp, type BuiltApp } from '../src/app.js';
import { Db } from '../src/db/client.js';
import { loadConfig } from '../src/config/env.js';
import { getAsyncDb, resetAsyncDbCache } from '../src/db/driver.js';
import type { AsyncDb } from '../src/db/async.js';
import type { ExamRepository } from '../src/db/repositories/examRepository.js';
import type { AttemptRepository, WrongQuestionRepository } from '../src/db/repositories/attemptRepository.js';
import type { ExamService } from '../src/services/examService.js';
import type { QuizService } from '../src/services/quizService.js';
import type { ProgressRepository } from '../src/db/repositories/progressRepository.js';

let dataDir: string;
let built: BuiltApp;
let app: FastifyInstance;
let db: Db;
let asyncDb: AsyncDb;
let exams: ExamRepository;
let attempts: AttemptRepository;
let wrongs: WrongQuestionRepository;
let examService: ExamService;
let quizService: QuizService;
let progress: ProgressRepository;
let admin: User;
let stuA: User;
let stuB: User;
let stuC: User;
let courseId = 0;
let bankId = 0;
/** 卷面用题（都在 courseId 的题池里） */
let q1 = 0;
let q2 = 0;
let q3 = 0;
let q4 = 0;
/** 刷题课时与其题目（挂在 lessonId 上） */
let lessonId = 0;
let lessonQid = 0;
const LESSON_Q_ANSWER = 'A';

async function makeUser(username: string): Promise<User> {
  const id = await built.deps.users.create({
    username,
    salt: 'salt',
    hash: 'hash',
    role: 'student',
    displayName: username,
  });
  const row = await built.deps.users.findById(id);
  if (!row) throw new Error(`用户 ${username} 创建失败`);
  return row;
}

/** 建一场已发布考试并按需加题 */
async function makeExam(title: string, questionIds: number[]): Promise<number> {
  const id = await examService.create(admin, {
    courseId,
    title,
    durationMinutes: 30,
    passScore: 60,
    status: 'published',
  });
  if (questionIds.length > 0) await examService.addQuestions(admin, id, questionIds);
  return id;
}

async function dropTrigger(name: string): Promise<void> {
  await asyncDb.run(`DROP TRIGGER IF EXISTS ${name}`);
}

async function auditCount(action: string, targetId: number): Promise<number> {
  // 审计是缓冲写：先 flush，再按 action + target 精确数（别的用例也会写 exam.submit）
  await built.deps.audit.flush();
  const row = await asyncDb.get<{ n: number | string }>(
    'SELECT COUNT(*) AS n FROM audit_logs WHERE action = ? AND target_id = ?',
    [action, String(targetId)],
  );
  return Number(row?.n ?? 0);
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-exam-tx-'));
  const config = loadConfig({
    ...process.env,
    MC_ENV: 'test',
    MC_DATA_DIR: dataDir,
    MC_LOG_LEVEL: 'silent',
    MC_ADMIN_USER: 'admin',
    MC_ADMIN_PASS: 'admin123',
  });
  db = new Db(':memory:');
  built = await buildApp(config, { db });
  app = built.app;
  await app.ready();
  asyncDb = getAsyncDb(config, db);
  exams = built.deps.exams;
  attempts = built.deps.attempts;
  wrongs = built.deps.wrongs;
  examService = built.deps.examService;
  quizService = built.deps.quizService;
  progress = built.deps.progress;

  const adminRow = await built.deps.users.findByUsername('admin');
  if (!adminRow) throw new Error('引导管理员未创建');
  admin = adminRow;
  stuA = await makeUser('写事务学生A');
  stuB = await makeUser('写事务学生B');
  stuC = await makeUser('写事务学生C');

  courseId = await built.deps.courses.create({ name: '写事务课程' });
  bankId = await built.deps.banks.create({ name: '写事务题库', courseId });
  const makeQuestion = async (stem: string, answer: string, type: 'single' | 'judge' = 'single'): Promise<number> =>
    built.deps.questions.create({
      bankId,
      type,
      stem,
      options: type === 'single' ? ['A', 'B'] : [],
      answer,
    });
  q1 = await makeQuestion('写事务题1', 'A');
  q2 = await makeQuestion('写事务题2', 'B');
  q3 = await makeQuestion('写事务题3', 'A');
  q4 = await makeQuestion('写事务题4', 'B');

  // 刷题课时 + 挂在课时上的题目（刷题交卷要按 lesson 取题）
  lessonId = 1;
  await asyncDb.run(
    `INSERT INTO lessons (id, title, video_kind, media_root, video_path, duration)
     VALUES (?,?,?,?,?,?)`,
    [lessonId, '写事务课时', 'local', 'root-a', 'tx.mp4', 600],
  );
  lessonQid = await built.deps.questions.create({
    bankId,
    lessonId,
    type: 'single',
    stem: '刷题交卷题',
    options: ['A', 'B'],
    answer: LESSON_Q_ANSWER,
  });
});

afterAll(async () => {
  await app.close();
  resetAsyncDbCache();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('考试写路径：RETURNING id 与更新/删除', () => {
  it('create 返回数字 id；update 不传结构时保留原值；delete 后读不到', async () => {
    const id = await examService.create(admin, {
      courseId,
      title: '写路径考试',
      durationMinutes: 45,
      status: 'published',
    });
    expect(Number.isInteger(id)).toBe(true);
    expect(id).toBeGreaterThan(0);

    await examService.update(admin, id, { courseId, title: '写路径考试（改）' });
    const row = await exams.findById(id);
    expect(row?.title).toBe('写路径考试（改）');
    expect(row?.structure).toBe('[]'); // 未传 structure/difficulty_target → 保持原值，不写 NULL
    expect(Number(row?.show_answers)).toBe(1);

    await examService.remove(admin, id);
    expect(await exams.findById(id)).toBeUndefined();
  });
});

describe('卷内题目：去重加题、换题保位置', () => {
  it('addQuestions 跳过已入卷的题并保持 sort 连续', async () => {
    const examId = await makeExam('卷内顺序考试', []);
    expect(await exams.addQuestions(examId, [q1, q2, q2])).toBe(2);
    expect(await exams.addQuestions(examId, [q2, q3])).toBe(1);
    const rows = await exams.listQuestions(examId);
    expect(rows.map((r) => r.id)).toEqual([q1, q2, q3]);
    expect(rows.map((r) => Number(r.sort))).toEqual([0, 1, 2]);
  });

  it('replaceQuestion 保持原题的位置/分值/大题（ON CONFLICT DO UPDATE 等价 REPLACE）', async () => {
    const examId = await makeExam('换题考试', [q1, q2]);
    await exams.setQuestionMeta(examId, q2, { score: 7.5, section: '一、单选' });
    await exams.replaceQuestion(examId, q2, q4);
    const rows = await exams.listQuestions(examId);
    expect(rows.map((r) => r.id)).toEqual([q1, q4]);
    expect(Number(rows[1]?.sort)).toBe(1);
    expect(Number(rows[1]?.score)).toBe(7.5);
    expect(rows[1]?.section).toBe('一、单选');

    // 目标题已在卷内：删除旧题 + 覆盖目标题行（与旧 INSERT OR REPLACE 语义一致）
    await exams.replaceQuestion(examId, q1, q4);
    const conflictRows = await exams.listQuestions(examId);
    expect(conflictRows.map((r) => r.id)).toEqual([q4]);
    expect(Number(conflictRows[0]?.sort)).toBe(0);
  });
});

describe('组卷事务：清空 + 加题 + 逐题分值同事务', () => {
  it('中途失败整批回滚（旧卷不被清空）；成功后分值/大题落到卷面', async () => {
    const examId = await makeExam('组卷事务考试', [q1, q2]);
    await asyncDb.run(
      "CREATE TRIGGER tx_fail_exam_question BEFORE INSERT ON exam_questions BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    try {
      await expect(
        examService.autoCompose(admin, examId, { quota: { single: 2 }, replaceExisting: true }),
      ).rejects.toThrow();
      // 关键断言：前面的 DELETE（清空）也回滚了，旧卷原样还在
      const rows = await exams.listQuestions(examId);
      expect(rows.map((r) => r.id)).toEqual([q1, q2]);
    } finally {
      await dropTrigger('tx_fail_exam_question');
    }

    const result = await examService.autoCompose(admin, examId, {
      quota: { single: 2 },
      replaceExisting: true,
      sectionName: '一、单选',
      scorePerQuestion: 10,
    });
    expect(result.added).toBe(2);
    const after = await exams.listQuestions(examId);
    expect(after).toHaveLength(2);
    expect(after.every((r) => Number(r.score) === 10 && r.section === '一、单选')).toBe(true);
  });
});

describe('刷题交卷：attempt + 错题本同事务', () => {
  it('错题本写失败时 attempt 也回滚；答对标记掌握、答错累加次数', async () => {
    const base = {
      userId: stuA.id,
      clientId: `user:${stuA.id}`,
      lessonId,
      answers: [{ qid: lessonQid, answer: 'B', correct: false }],
      score: 0,
      total: 1,
    };
    const firstId = await attempts.recordSubmission(base, [{ questionId: lessonQid, wrong: true }]);
    expect(firstId).toBeGreaterThan(0);
    expect(await wrongs.count(stuA.id)).toEqual({ total: 1, pending: 1 });

    // 让「错题本 upsert」这一步失败：attempt 行必须一起回滚
    await asyncDb.run(
      "CREATE TRIGGER tx_fail_wrong_question BEFORE INSERT ON wrong_questions BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    try {
      await expect(
        attempts.recordSubmission(base, [
          { questionId: lessonQid, wrong: true },
          { questionId: q1, wrong: true },
        ]),
      ).rejects.toThrow();
      expect(await attempts.listByUser(stuA.id)).toHaveLength(1);
      const row = (await wrongs.list(stuA.id))[0];
      expect(Number(row?.wrong_count)).toBe(1); // 次数没被加
    } finally {
      await dropTrigger('tx_fail_wrong_question');
    }

    // 答对 → 未掌握标记为已掌握（last_at 仍是数字，方言 #19）
    await attempts.recordSubmission({ ...base, answers: [{ qid: lessonQid, answer: 'A', correct: true }], score: 1 }, [
      { questionId: lessonQid, wrong: false },
    ]);
    expect(await wrongs.count(stuA.id)).toEqual({ total: 1, pending: 0 });
    const mastered = (await wrongs.list(stuA.id, { includeMastered: true }))[0];
    expect(mastered?.mastered).toBe(1);
    expect(typeof mastered?.last_at).toBe('number');
  });

  it('错题本并发 upsert 不丢次数（ON CONFLICT 累加）', async () => {
    await Promise.all(Array.from({ length: 5 }, () => wrongs.upsertWrong(stuB.id, q2)));
    const row = (await wrongs.list(stuB.id))[0];
    expect(row?.question_id).toBe(q2);
    expect(Number(row?.wrong_count)).toBe(5);
    expect(await wrongs.count(stuB.id)).toEqual({ total: 1, pending: 1 });
  });

  it('QuizService.submit 走同一事务：attempt 与错题本都落库，best 为真实数值', async () => {
    await progress.upsert({ userId: stuC.id, lessonId, position: 600, duration: 600, finished: true });
    const wrong = await quizService.submit(stuC, lessonId, [{ qid: lessonQid, answer: 'B' }]);
    expect(wrong.attemptId).toBeGreaterThan(0);
    expect(wrong.total).toBe(1);
    expect(typeof wrong.best).toBe('number');
    expect(await attempts.listByUser(stuC.id)).toHaveLength(1);
    expect(await wrongs.count(stuC.id)).toEqual({ total: 1, pending: 1 });

    const right = await quizService.submit(stuC, lessonId, [{ qid: lessonQid, answer: LESSON_Q_ANSWER }]);
    expect(right.best).toBe(100);
    expect(await wrongs.count(stuC.id)).toEqual({ total: 1, pending: 0 });
  });
});

describe('考试交卷：落库失败不留成绩与审计', () => {
  it('触发器造失败 → 无 attempt、无「已交卷」审计；恢复后交卷成功并留审计', async () => {
    const examId = await makeExam('交卷事务考试', [q1]);
    await asyncDb.run(
      "CREATE TRIGGER tx_fail_exam_attempt BEFORE INSERT ON exam_attempts BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    try {
      await expect(examService.submit(stuA, examId, [{ qid: q1, answer: 'A' }])).rejects.toThrow();
      expect(await exams.attemptCount(examId, stuA.id)).toBe(0);
      expect(await auditCount('exam.submit', examId)).toBe(0);
    } finally {
      await dropTrigger('tx_fail_exam_attempt');
    }

    const ok = await examService.submit(stuA, examId, [{ qid: q1, answer: 'A' }]);
    expect(ok.attemptId).toBeGreaterThan(0);
    expect(await exams.attemptCount(examId, stuA.id)).toBe(1);
    expect(await auditCount('exam.submit', examId)).toBe(1);
  });
});

describe('卷面缓存：写成功后失效', () => {
  it('加题后紧接着的交卷按新卷判分（未失效会按缓存旧卷算）', async () => {
    const examId = await makeExam('缓存失效考试', [q1]);
    const first = await examService.submit(stuB, examId, [{ qid: q1, answer: 'A' }]);
    expect(first.total).toBe(1); // 首次交卷把「只有 1 题」的卷面写进缓存

    await examService.addQuestions(admin, examId, [q2]); // 写成功后必须失效缓存

    const second = await examService.submit(stuC, examId, [
      { qid: q1, answer: 'A' },
      { qid: q2, answer: 'B' },
    ]);
    expect(second.total).toBe(2);
    expect(second.score).toBe(2);
  });
});
