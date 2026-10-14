/**
 * 学情分析集成测试：知识点掌握度 / 学员排行 / 高频错题 / 讲评清单导出 / 权限。
 *
 * 重点验证三件事（都是产品原则，不是实现细节）：
 *   1. **主观题不计入**：correct=null 的作答不能被算成"错"，否则掌握度整体偏低；
 *   2. **样本不足不下结论**：作答 < 3 次的知识点标为"数据不足"，不能进"未掌握"；
 *   3. **没有数据时如实说明**：dataNote 必须直说"还没有作答记录"，而不是给一堆 0。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';
import { masteryOf, MASTERY } from '../src/services/analyticsService.js';

let app: FastifyInstance;
let db: Db;
let dataDir: string;
let adminCookie = '';
let studentCookie = '';
let studentId = 0;
let courseId = 0;
let emptyCourseId = 0;
const ids = new Map<string, number>();

const json = <T>(res: { json: () => unknown }): T => res.json() as T;

/** 写一条练习作答（与真实写入结构一致） */
function addPracticeAttempt(lessonId: number, userId: number, items: { qid: number; correct: boolean | null }[]): void {
  db.run('INSERT INTO attempts (client_id, user_id, lesson_id, answers, score, total) VALUES (?,?,?,?,?,?)', [
    `user:${userId}`,
    userId,
    lessonId,
    JSON.stringify(items.map((i) => ({ qid: i.qid, answer: 'x', correct: i.correct }))),
    items.filter((i) => i.correct === true).length,
    items.length,
  ]);
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-analytics-'));
  const config = loadConfig({
    ...process.env,
    MC_ENV: 'test',
    MC_DATA_DIR: dataDir,
    MC_LOG_LEVEL: 'silent',
    MC_ADMIN_USER: 'admin',
    MC_ADMIN_PASS: 'admin123',
    MC_ALLOW_REGISTER: 'true',
  });
  db = new Db(':memory:');
  const built = await buildApp(config, { db });
  app = built.app;
  await app.ready();

  const adminLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'admin123' },
  });
  adminCookie = `microclass_sid=${adminLogin.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;

  const student = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username: 'anastudent', password: 'student123', displayName: '学情小学员' },
  });
  expect(student.statusCode, student.body).toBe(200);
  studentId = json<{ user: { id: number } }>(student).user.id;
  studentCookie = `microclass_sid=${student.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;

  // 课程 + 课时 + 题库 + 4 道题（2 道有理数、1 道方程、1 道无知识点）
  const course = await app.inject({
    method: 'POST',
    url: '/api/v1/courses',
    payload: { name: '学情测试课程', published: true },
    headers: { cookie: adminCookie },
  });
  courseId = json<{ id: number }>(course).id;
  const emptyCourse = await app.inject({
    method: 'POST',
    url: '/api/v1/courses',
    payload: { name: '无数据课程', published: true },
    headers: { cookie: adminCookie },
  });
  emptyCourseId = json<{ id: number }>(emptyCourse).id;

  const lesson = await app.inject({
    method: 'POST',
    url: '/api/v1/lessons',
    payload: { title: '学情测试课时', videoKind: 'url', videoPath: 'https://example.com/a.mp4', courseId },
    headers: { cookie: adminCookie },
  });
  const lessonId = json<{ id: number }>(lesson).id;
  const bank = await app.inject({
    method: 'POST',
    url: '/api/v1/banks',
    payload: { name: '学情测试题库', courseId },
    headers: { cookie: adminCookie },
  });
  const bankId = json<{ id: number }>(bank).id;

  const specs = [
    { stem: '有理数-易错题', answer: 'A' },
    { stem: '有理数-掌握中', answer: 'A' },
    { stem: '方程-样本不足', answer: 'A' },
    { stem: '无知识点-题', answer: 'A' },
  ];
  for (const spec of specs) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions`,
      payload: { bankId, type: 'single', stem: spec.stem, options: ['A', 'B'], answer: spec.answer },
      headers: { cookie: adminCookie },
    });
    ids.set(spec.stem, json<{ id: number }>(res).id);
  }
  db.run("UPDATE questions SET point = '有理数' WHERE id IN (?,?)", [
    ids.get('有理数-易错题')!,
    ids.get('有理数-掌握中')!,
  ]);
  db.run("UPDATE questions SET point = '方程' WHERE id = ?", [ids.get('方程-样本不足')!]);

  // 作答：有理数-易错题 4 次错 3；有理数-掌握中 3 次错 1；方程 2 次全对；无知识点 1 次错
  for (let i = 0; i < 3; i += 1)
    addPracticeAttempt(lessonId, studentId, [{ qid: ids.get('有理数-易错题')!, correct: false }]);
  addPracticeAttempt(lessonId, studentId, [{ qid: ids.get('有理数-易错题')!, correct: true }]);
  for (let i = 0; i < 3; i += 1) {
    addPracticeAttempt(lessonId, studentId, [{ qid: ids.get('有理数-掌握中')!, correct: i !== 0 }]);
  }
  addPracticeAttempt(lessonId, studentId, [{ qid: ids.get('方程-样本不足')!, correct: true }]);
  addPracticeAttempt(lessonId, studentId, [{ qid: ids.get('方程-样本不足')!, correct: true }]);
  addPracticeAttempt(lessonId, studentId, [{ qid: ids.get('无知识点-题')!, correct: false }]);
  // 主观题：correct=null，绝不能计入错误率
  addPracticeAttempt(lessonId, studentId, [{ qid: ids.get('有理数-易错题')!, correct: null }]);

  // 一次考试作答：1 对 1 错（考试数据也要计入）
  const exam = await app.inject({
    method: 'POST',
    url: '/api/v1/exams',
    payload: { courseId, title: '学情测试考试', durationMinutes: 30, passScore: 60, status: 'published' },
    headers: { cookie: adminCookie },
  });
  const examId = json<{ id: number }>(exam).id;
  db.run('INSERT INTO exam_attempts (exam_id, user_id, answers, score, total, passed) VALUES (?,?,?,?,?,?)', [
    examId,
    studentId,
    JSON.stringify([
      { qid: ids.get('有理数-易错题')!, answer: 'B', correct: false },
      { qid: ids.get('有理数-掌握中')!, answer: 'A', correct: true },
    ]),
    1,
    2,
    0,
  ]);
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('掌握度分档（纯逻辑）', () => {
  it('少于阈值判为"数据不足"，不做结论', () => {
    expect(masteryOf(0, 0)).toBe('insufficient');
    expect(masteryOf(MASTERY.minGraded - 1, 0)).toBe('insufficient');
  });

  it('达到阈值后按正确率分档', () => {
    expect(masteryOf(10, 0.9)).toBe('mastered');
    expect(masteryOf(10, MASTERY.mastered)).toBe('mastered');
    expect(masteryOf(10, 0.7)).toBe('weak');
    expect(masteryOf(10, 0.5)).toBe('poor');
  });
});

describe('学情总览', () => {
  it('统计客观题作答（主观题不计入），并给出覆盖率与数据规模说明', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/overview?courseId=${courseId}`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = json<{
      kpi: {
        students: number;
        activeStudents: number;
        graded: number;
        wrong: number;
        accuracy: number;
        questionsWithData: number;
        pointsWithData: number;
        totalQuestions: number;
        practiceAttempts: number;
        examAttempts: number;
      };
      mastery: { level: string; points: number }[];
      dataNote: string;
    }>(res);

    // 练习 4+3+2+1 = 10 条客观题（主观题那条被排除）+ 考试 2 条 = 12
    expect(body.kpi.graded).toBe(12);
    expect(body.kpi.wrong).toBe(6); // 3 + 1 + 0 + 1（练习）+ 1（考试）
    expect(body.kpi.accuracy).toBeCloseTo(0.5, 3);
    expect(body.kpi.questionsWithData).toBe(4);
    expect(body.kpi.pointsWithData).toBe(2);
    expect(body.kpi.activeStudents).toBe(1);
    expect(body.kpi.students).toBeGreaterThanOrEqual(1);
    expect(body.kpi.totalQuestions).toBeGreaterThanOrEqual(4);
    expect(body.kpi.practiceAttempts).toBeGreaterThanOrEqual(8);
    expect(body.kpi.examAttempts).toBe(1);
    // 掌握度分布：有理数(poor) + 方程(insufficient) + 无知识点(排除)
    const poor = body.mastery.find((m) => m.level === 'poor')?.points ?? 0;
    const insufficient = body.mastery.find((m) => m.level === 'insufficient')?.points ?? 0;
    expect(poor).toBe(1);
    expect(insufficient).toBe(1);
    // 数据很少时必须如实提醒
    expect(body.dataNote).toMatch(/样本很少|覆盖/);
  });

  it('没有作答数据的课程会如实说"还没有作答记录"，而不是给一堆 0 结论', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/overview?courseId=${emptyCourseId}`,
      headers: { cookie: adminCookie },
    });
    const body = json<{ kpi: { graded: number }; mastery: { level: string; points: number }[]; dataNote: string }>(res);
    expect(body.kpi.graded).toBe(0);
    expect(body.dataNote).toContain('还没有任何客观题作答记录');
    expect(body.mastery.every((m) => m.points === 0)).toBe(true);
  });
});

describe('知识点掌握度', () => {
  it('薄弱优先排序，样本不足单独成档，并能下钻到典型错题', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/points?courseId=${courseId}&limit=10`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = json<{
      points: {
        point: string;
        graded: number;
        wrong: number;
        accuracy: number;
        mastery: string;
        topWrong: { question_id: number; wrong: number }[];
      }[];
      dataNote: string;
    }>(res);

    const fen = body.points.find((p) => p.point === '有理数');
    expect(fen).toMatchObject({ graded: 9, wrong: 5, mastery: 'poor' });
    const equation = body.points.find((p) => p.point === '方程');
    expect(equation?.mastery).toBe('insufficient'); // 只作答 2 次
    // 未掌握排在数据不足前面
    expect(body.points.findIndex((p) => p.mastery === 'poor')).toBeLessThan(
      body.points.findIndex((p) => p.mastery === 'insufficient'),
    );
    // 下钻到具体错题
    expect(fen?.topWrong.length).toBeGreaterThan(0);
    expect(fen?.topWrong[0]?.question_id).toBe(ids.get('有理数-易错题'));
    expect(body.dataNote).toContain(`${MASTERY.minGraded} 次作答`);
  });
});

describe('学员学情与高频错题', () => {
  it('学员排行带正确率与最弱知识点', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/students?courseId=${courseId}`,
      headers: { cookie: adminCookie },
    });
    const body = json<{
      students: { user_id: number; graded: number; wrong: number; weakest_point: string; accuracy: number }[];
    }>(res);
    const me = body.students.find((s) => s.user_id === studentId);
    expect(me).toBeDefined();
    expect(me?.graded).toBe(12);
    expect(me?.wrong).toBe(6);
    expect(me?.weakest_point).toBe('有理数');
    expect(me?.accuracy).toBeCloseTo(0.5, 3);
  });

  it('高频错题按威尔逊下界排序，minAttempts 过滤噪声', async () => {
    const strict = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/wrong-questions?courseId=${courseId}&minAttempts=3`,
      headers: { cookie: adminCookie },
    });
    const strictBody = json<{ questions: { question_id: number; graded: number }[]; minAttempts: number }>(strict);
    expect(strictBody.minAttempts).toBe(3);
    expect(strictBody.questions.map((q) => q.question_id)).toContain(ids.get('有理数-易错题'));
    expect(strictBody.questions.map((q) => q.question_id)).not.toContain(ids.get('无知识点-题')); // 只 1 次

    const loose = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/wrong-questions?courseId=${courseId}&minAttempts=1`,
      headers: { cookie: adminCookie },
    });
    const looseBody = json<{ questions: { question_id: number }[] }>(loose);
    expect(looseBody.questions.map((q) => q.question_id)).toContain(ids.get('无知识点-题'));
    // 错误率最高的排第一
    expect(looseBody.questions[0]?.question_id).toBe(ids.get('有理数-易错题'));
  });
});

describe('讲评清单导出', () => {
  it('Markdown 清单含数据规模、薄弱知识点与典型错题', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/review.md?courseId=${courseId}&limit=5`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    const md = res.body;
    expect(md).toContain('# 学情讲评清单');
    expect(md).toContain('数据规模');
    expect(md).toContain('需要重点讲的知识点');
    expect(md).toContain('有理数');
    expect(md).toContain('高频错题');
    expect(md).toContain('有理数-易错题');
  });

  it('CSV 带 BOM 与表头（Excel 直接打开不乱码）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/wrong-questions.csv?courseId=${courseId}&limit=50`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body.startsWith('\uFEFF')).toBe(true);
    expect(res.body.split('\n')[0]).toContain('题号,知识点,题型');
  });
});

describe('权限', () => {
  it('学员不能看全库学情（403）', async () => {
    for (const url of [
      '/analytics/overview',
      '/analytics/points',
      '/analytics/students',
      '/analytics/wrong-questions',
    ]) {
      const res = await app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie: studentCookie } });
      expect(res.statusCode, `${url} 应拒绝学员`).toBe(403);
    }
  });
});
