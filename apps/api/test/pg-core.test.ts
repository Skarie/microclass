/**
 * PG 集成测试（核心链路）：questions 读写 / banks 事务 / 交卷事务 / progress 区间 / analytics 方言。
 *
 * 只在 `MC_PG_TEST_URL` 存在时运行（默认 vitest 仍是纯 sqlite）：
 *   MC_PG_TEST_URL=postgres://microclass:***@db:5432/microclass_test \
 *     npx vitest run apps/api/test/pg-core.test.ts
 *
 * 每个用例都打**真 PG**（不是桩），schema 与生产同构（见 `test/fixtures/pg-schema.sql`）。
 * 重点验证此前只在 SQLite 上跑过的方言收口：
 *   #17 int8（COUNT/SUM/RETURNING 回字符串 → 仓储边界 Number）、#19 nowSeconds、
 *   #20 maxOf、#21 unixDay、#24 JSON 展开、#3 RETURNING id、#11 事务单连接。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../src/db/pg/pool.js'; // 副作用：int8（OID 20）→ number 的全局 parser
import type { AsyncDb } from '../src/db/async.js';
import { BankRepository } from '../src/db/repositories/bankRepository.js';
import { QuestionRepository } from '../src/db/repositories/questionRepository.js';
import { AttemptRepository, WrongQuestionRepository } from '../src/db/repositories/attemptRepository.js';
import { ProgressRepository } from '../src/db/repositories/progressRepository.js';
import { WatchIntervalRepository } from '../src/db/repositories/watchIntervalRepository.js';
import { AnalyticsRepository } from '../src/db/repositories/analyticsRepository.js';
import { setBankSections } from '../src/db/repositories/bankSectionQueries.js';
import { createAttempt, attemptCount } from '../src/db/repositories/exam-attempts.js';
import { closePg, pgEnabled, poisonSyncDb, resetPgSchema } from './helpers/pgTestDb.js';

const CUTS = { easyMax: 40, mediumMax: 70, five: [20, 40, 60, 80] as [number, number, number, number] };

describe.skipIf(!pgEnabled)('PG 核心链路', () => {
  let db: AsyncDb;
  let banks: BankRepository;
  let questions: QuestionRepository;
  let attempts: AttemptRepository;
  let wrongs: WrongQuestionRepository;
  let progress: ProgressRepository;
  let intervals: WatchIntervalRepository;
  let analytics: AnalyticsRepository;
  let courseId = 0;
  let lessonId = 0;
  let bankId = 0;
  let userId = 0;

  const question = (stem: string, answer = 'A'): Parameters<QuestionRepository['create']>[0] => ({
    bankId,
    type: 'single',
    stem,
    options: ['A. 甲', 'B. 乙'],
    answer,
    point: '加法',
    difficulty: 'easy',
  });

  beforeAll(async () => {
    db = await resetPgSchema();
    banks = new BankRepository(null, db);
    questions = new QuestionRepository(null, db);
    attempts = new AttemptRepository(poisonSyncDb(), db);
    wrongs = new WrongQuestionRepository(poisonSyncDb(), db);
    progress = new ProgressRepository(poisonSyncDb(), db);
    intervals = new WatchIntervalRepository(poisonSyncDb(), db);
    analytics = new AnalyticsRepository(poisonSyncDb(), db);

    const course = await db.get<{ id: number | string }>('INSERT INTO courses (name) VALUES (?) RETURNING id', [
      'PG 核心课程',
    ]);
    courseId = Number(course?.id ?? 0);
    const lesson = await db.get<{ id: number | string }>(
      `INSERT INTO lessons (title, video_kind, video_path, course_id, duration) VALUES (?,?,?,?,?) RETURNING id`,
      ['PG 核心课时', 'local', 'pg.mp4', courseId, 600],
    );
    lessonId = Number(lesson?.id ?? 0);
    const user = await db.get<{ id: number | string }>(
      'INSERT INTO users (username, pass_salt, pass_hash, role) VALUES (?,?,?,?) RETURNING id',
      ['pg-student', 's', 'h', 'student'],
    );
    userId = Number(user?.id ?? 0);
    bankId = await banks.create({ name: 'PG 核心题库', kind: 'chapter', subject: '数学', book: 'PG册', courseId });
  });

  afterAll(async () => {
    await closePg(db);
  });

  describe('questions 读写（RETURNING id + int8 收敛）', () => {
    it('create → findById / listByBank / countByBank 都返回数字', async () => {
      const id = await questions.create(question('PG 题目一'));
      expect(id).toBeGreaterThan(0);

      const row = await questions.findById(id);
      expect(row?.stem).toBe('PG 题目一');
      expect(row?.bank_id).toBe(bankId);
      expect(typeof row?.id).toBe('number');

      const list = await questions.listByBank(bankId);
      expect(list.map((q) => q.id)).toContain(id);
      expect(await questions.countByBank(bankId)).toBe(list.length);
      // banks.question_count 由写路径维护（预计算列，不是 Bank 类型字段）
      const counted = await db.get<{ c: number | string }>('SELECT question_count AS c FROM banks WHERE id = ?', [
        bankId,
      ]);
      expect(Number(counted?.c ?? 0)).toBe(list.length);
    });

    it('update 后再读是新值（写 PG 读 PG，不会串库）', async () => {
      const id = await questions.create(question('PG 题目二', 'B'));
      await questions.update(id, { ...question('PG 题目二（改）', 'A'), sort: 3 });
      expect((await questions.findById(id))?.stem).toBe('PG 题目二（改）');
      expect((await questions.findById(id))?.answer).toBe('A');
    });

    it('health / pointStats / difficultyStats 的聚合列是 number（#17）', async () => {
      const health = await questions.health();
      expect(typeof health.total).toBe('number');
      expect(health.total).toBeGreaterThanOrEqual(2);
      expect(typeof health.duplicateGroups).toBe('number');

      const points = await questions.pointStats({});
      const row = points.find((p) => p.point === '加法');
      expect(row?.questions).toBeGreaterThanOrEqual(2);
      expect(typeof row?.banks).toBe('number');

      const stats = await questions.difficultyStats(undefined, CUTS);
      expect(typeof stats.total).toBe('number');
      expect(stats.total).toBeGreaterThanOrEqual(2);
    });

    it('delete 之后读不到，题库题量同步减少', async () => {
      const before = await questions.countByBank(bankId);
      const id = await questions.create(question('PG 待删题'));
      await questions.delete(id);
      expect(await questions.findById(id)).toBeUndefined();
      expect(await questions.countByBank(bankId)).toBe(before);
    });
  });

  describe('banks 事务（单连接 BEGIN/ROLLBACK）', () => {
    it('事务内抛错 → 已执行的写全部回滚', async () => {
      const id = await banks.create({ name: 'PG 回滚题库', kind: 'chapter' });
      await expect(
        db.transaction(async (tx) => {
          await tx.run('UPDATE banks SET name = ? WHERE id = ?', ['被改过', id]);
          throw new Error('模拟中途失败');
        }),
      ).rejects.toThrow('模拟中途失败');
      expect((await banks.findById(id))?.name).toBe('PG 回滚题库');
    });

    it('setBankSections 一条违约 → 整批回滚（NOT NULL）', async () => {
      const a = await banks.create({ name: 'PG 章节A', kind: 'chapter' });
      const b = await banks.create({ name: 'PG 章节B', kind: 'chapter' });
      await expect(
        setBankSections(db, [
          { id: a, section: '第一章' },
          { id: b, section: null as unknown as string },
        ]),
      ).rejects.toThrow();
      expect((await banks.findById(a))?.section).toBe('');
      await setBankSections(db, [{ id: a, section: '第一章' }]);
      expect((await banks.findById(a))?.section).toBe('第一章');
    });
  });

  describe('交卷事务（attempts + 错题本 / exam_attempts）', () => {
    it('错题本写失败 → attempt 一并回滚（PG 触发器制造失败）', async () => {
      const input = {
        userId,
        clientId: `user:${userId}`,
        lessonId,
        answers: [{ qid: 1, answer: 'B', correct: false }],
        score: 0,
        total: 1,
      };
      const qid = await questions.create(question('PG 错题本题'));
      await db.run(
        `CREATE OR REPLACE FUNCTION pg_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END; $$ LANGUAGE plpgsql`,
      );
      await db.run(
        'CREATE TRIGGER pg_fail_wrong BEFORE INSERT ON wrong_questions FOR EACH ROW EXECUTE FUNCTION pg_fail()',
      );
      try {
        await expect(
          attempts.recordSubmission(input, [
            { questionId: qid, wrong: true },
            { questionId: qid + 1000, wrong: true },
          ]),
        ).rejects.toThrow();
        expect(await attempts.listByUser(userId)).toHaveLength(0);
      } finally {
        await db.run('DROP TRIGGER IF EXISTS pg_fail_wrong ON wrong_questions');
      }

      // 去掉故障：attempt + 错题本都落库，int8 收敛正确
      const attemptId = await attempts.recordSubmission(input, [{ questionId: qid, wrong: true }]);
      expect(attemptId).toBeGreaterThan(0);
      expect(await attempts.listByUser(userId)).toHaveLength(1);
      const wrong = await wrongs.list(userId);
      expect(wrong[0]?.question_id).toBe(qid);
      expect(wrong[0]?.wrong_count).toBe(1);
      expect(typeof wrong[0]?.last_at).toBe('number'); // 方言 #19：nowSeconds 落整数秒
      expect(await wrongs.count(userId)).toEqual({ total: 1, pending: 1 });
    });

    it('考试交卷：多语句事务失败不留成绩行；成功则 attemptCount 为 1', async () => {
      const exam = await db.get<{ id: number | string }>(
        'INSERT INTO exams (course_id, title, status) VALUES (?,?,?) RETURNING id',
        [courseId, 'PG 交卷考试', 'published'],
      );
      const examId = Number(exam?.id ?? 0);
      const input = {
        examId,
        userId,
        answers: [{ qid: 1, given: 'A', correct: true, score: 10 }],
        score: 10,
        total: 10,
        passed: true,
        usedSeconds: 30,
      };

      await expect(
        db.transaction(async (tx) => {
          await createAttempt(tx, input);
          throw new Error('模拟落库中途失败');
        }),
      ).rejects.toThrow('模拟落库中途失败');
      expect(await attemptCount(db, examId, userId)).toBe(0);

      const id = await createAttempt(db, input);
      expect(id).toBeGreaterThan(0);
      expect(await attemptCount(db, examId, userId)).toBe(1);
    });
  });

  describe('progress 区间（maxOf / nowSeconds / 先删后插事务）', () => {
    it('finished 只增不减（GREATEST），quiz_best 取大', async () => {
      await progress.upsert({ userId, lessonId, position: 600, duration: 600, finished: true });
      expect((await progress.get(userId, lessonId))?.finished).toBe(1);
      await progress.upsert({ userId, lessonId, position: 10, duration: 600, finished: false });
      const row = await progress.get(userId, lessonId);
      expect(row?.finished).toBe(1);
      expect(row?.position).toBe(10);
      expect(typeof row?.updated_at).toBe('number');

      await progress.markQuizDone(userId, lessonId, 60);
      await progress.markQuizDone(userId, lessonId, 40);
      expect((await progress.get(userId, lessonId))?.quiz_best).toBe(60);
    });

    it('watch_intervals 取并集累加；中途失败整批回滚（已看片段不被删掉）', async () => {
      await intervals.record(userId, lessonId, [{ start: 0, end: 120 }]);
      expect(await intervals.covered(userId, lessonId)).toBe(120);
      await intervals.record(userId, lessonId, [{ start: 120, end: 300 }]);
      expect(await intervals.covered(userId, lessonId)).toBe(300);

      await db.run(
        `CREATE OR REPLACE FUNCTION pg_fail2() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END; $$ LANGUAGE plpgsql`,
      );
      await db.run(
        'CREATE TRIGGER pg_fail_watch BEFORE INSERT ON watch_intervals FOR EACH ROW EXECUTE FUNCTION pg_fail2()',
      );
      try {
        await expect(intervals.record(userId, lessonId, [{ start: 400, end: 500 }])).rejects.toThrow();
        expect(await intervals.covered(userId, lessonId)).toBe(300);
      } finally {
        await db.run('DROP TRIGGER IF EXISTS pg_fail_watch ON watch_intervals');
      }
    });
  });

  describe('analytics 方言（#21 unixDay / #24 jsonArrayJoin / #17 int8）', () => {
    beforeAll(async () => {
      // 本文件的用例共用一份库：先清掉前面「交卷事务」用例留下的作答，避免 analytics 口径串味
      await db.run('DELETE FROM attempts');
      await db.run('DELETE FROM exam_attempts');
      const q = await questions.create(question('PG 分析题'));
      const now = Math.floor(Date.now() / 1000);
      // 课后练习：2 条客观题（1 对 1 错）+ 1 条主观题（correct:null，必须不计入）
      await db.run(
        'INSERT INTO attempts (client_id, user_id, lesson_id, answers, score, total, created_at) VALUES (?,?,?,?,?,?,?)',
        [
          `user:${userId}`,
          userId,
          lessonId,
          JSON.stringify([
            { qid: q, answer: 'A', correct: true },
            { qid: q, answer: 'B', correct: false },
            { qid: q, answer: 'C', correct: null },
          ]),
          1,
          2,
          now,
        ],
      );
      // 考试作答：另加 1 条错误
      const exam = await db.get<{ id: number | string }>(
        'INSERT INTO exams (course_id, title, status) VALUES (?,?,?) RETURNING id',
        [courseId, 'PG 分析考试', 'published'],
      );
      await db.run(
        'INSERT INTO exam_attempts (exam_id, user_id, answers, score, total, passed, used_seconds, created_at) VALUES (?,?,?,?,?,?,?,?)',
        [Number(exam?.id ?? 0), userId, JSON.stringify([{ qid: q, answer: 'B', correct: false }]), 0, 1, 0, 60, now],
      );
    });

    it('totals：练习 + 考试合并，主观题不计入，计数是 number', async () => {
      const totals = await analytics.totals({});
      expect(totals.graded).toBe(3); // 练习 2 客观 + 考试 1，主观题被排除
      expect(totals.wrong).toBe(2);
      expect(totals.students).toBe(1);
      expect(totals.practiceAttempts).toBe(1);
      expect(totals.examAttempts).toBe(1);
      for (const value of Object.values(totals)) expect(typeof value).toBe('number');
    });

    it('students / questions / points 走 JSON 展开后仍能正确分组（#24）', async () => {
      const students = await analytics.students({});
      expect(students).toHaveLength(1);
      expect(students[0]?.graded).toBe(3);
      expect(students[0]?.wrong).toBe(2);
      expect(students[0]?.weakest_point).toBe('加法');

      const questionRows = await analytics.questions({});
      expect(questionRows[0]?.graded).toBe(3);
      expect(questionRows[0]?.students).toBe(1);

      const points = await analytics.points({});
      expect(points[0]?.point).toBe('加法');
      expect(points[0]?.wrong).toBe(2);
    });

    it('trend 按 UTC 日聚合（#21 unixDay），day 形如 YYYY-MM-DD', async () => {
      const trend = await analytics.trend({});
      expect(trend.length).toBeGreaterThanOrEqual(1);
      expect(trend[0]?.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(trend[0]?.graded).toBe(3);
    });

    it('scopeSize / studentAccounts 返回数字（int8）', async () => {
      expect(await analytics.studentAccounts()).toBe(1);
      const size = await analytics.scopeSize({});
      expect(typeof size.questions).toBe('number');
      expect(typeof size.points).toBe('number');
    });
  });
});
