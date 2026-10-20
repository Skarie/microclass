/**
 * 判分单测（拆服务前先钉住口径）：
 *   ① 纯判分：有分值按分值累加；没分值按题数（1 题 1 分）折算；
 *      部分题有分值、部分没有时，缺省分值 = total_score / 题数（fallbackScore）；
 *   ② 及格线 = ceil(总分 × pass_score / 100)（pass_score 是百分比）；
 *   ③ 漏交的题不进 results；简答（correct === null）不得分但计入 manual；
 *   ④ 交卷编排：重复交卷被拒、作答只落四元组、成绩页按卷面重建完整结果、结束时间 2 分钟缓冲。
 *
 * 纯函数部分直接调 exam-grade；服务部分用内存库 + ExamService（与现有集成测试同一套搭库方式）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { QuestionType, User } from '@microclass/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';
import type { ExamRepository } from '../src/db/repositories/examRepository.js';
import type { ExamService } from '../src/services/examService.js';
import { gradeSubmission, type GradingPaperRow } from '../src/services/exam-grade.js';

type AnswerInput = { qid: number; answer: string };

/** 造一条判分用的卷面行（只填判分与复盘需要的列） */
function paperRow(input: {
  id: number;
  type: QuestionType;
  answer: string;
  score?: number;
  options?: string;
  stem?: string;
  analysis?: string;
  image_path?: string;
}): GradingPaperRow {
  return {
    id: input.id,
    type: input.type,
    answer: input.answer,
    score: input.score ?? 0,
    options: input.options ?? '["A","B"]',
    stem: input.stem ?? `第 ${input.id} 题`,
    analysis: input.analysis ?? '',
    image_path: input.image_path ?? '',
  };
}

function gradePaper(
  paper: GradingPaperRow[],
  answers: AnswerInput[],
  options: { totalScore?: number; passScore?: number } = {},
): ReturnType<typeof gradeSubmission> {
  return gradeSubmission({
    paper,
    answers,
    totalScore: options.totalScore ?? 100,
    passScore: options.passScore ?? 60,
  });
}

describe('判分：有分值（按每题分值累加）', () => {
  const paper: GradingPaperRow[] = [
    paperRow({ id: 1, type: 'single', answer: 'A', score: 10, options: '["A","B"]' }),
    paperRow({ id: 2, type: 'multiple', answer: '0,2', score: 10, options: '["A","B","C"]' }),
    paperRow({ id: 3, type: 'judge', answer: 'T', score: 10 }),
    paperRow({ id: 4, type: 'fill', answer: 'main', score: 10 }),
    paperRow({ id: 5, type: 'short', answer: '参考答案', score: 20, stem: '简述题' }),
  ];

  it('单选/多选/判断/填空判对得分，简答计入 manual 不得分', () => {
    const out = gradePaper(paper, [
      { qid: 1, answer: 'A' },
      { qid: 2, answer: '2,0' },
      { qid: 3, answer: 't' },
      { qid: 4, answer: ' MAIN ' },
      { qid: 5, answer: '我的论述' },
    ]);
    expect(out.score).toBe(40);
    expect(out.total).toBe(60);
    expect(out.need).toBe(36); // ceil(60 × 60%)
    expect(out.passed).toBe(true);
    expect(out.manual).toBe(1);
    expect(out.results.map((r) => r.correct)).toEqual([true, true, true, true, null]);
    expect(out.results.map((r) => r.score)).toEqual([10, 10, 10, 10, 20]);
    expect(out.results[4]?.given).toBe('我的论述');
  });

  it('答错不得分，简答仍然计入 manual', () => {
    const out = gradePaper(paper, [
      { qid: 1, answer: 'B' },
      { qid: 2, answer: '0' },
      { qid: 3, answer: 'F' },
      { qid: 4, answer: 'mian' },
      { qid: 5, answer: '随便写写' },
    ]);
    expect(out.score).toBe(0);
    expect(out.total).toBe(60);
    expect(out.need).toBe(36);
    expect(out.passed).toBe(false);
    expect(out.manual).toBe(1);
    expect(out.results.map((r) => r.correct)).toEqual([false, false, false, false, null]);
  });

  it('结果项回到判分前的题面字段，供成绩页复盘', () => {
    const out = gradePaper(
      [
        paperRow({
          id: 7,
          type: 'single',
          answer: 'B',
          score: 5,
          options: '["A","B"]',
          stem: '题干文本',
          analysis: '解析文本',
          image_path: 'abc.png',
        }),
      ],
      [{ qid: 7, answer: 'B' }],
    );
    expect(out.results[0]).toMatchObject({
      qid: 7,
      type: 'single',
      stem: '题干文本',
      options: ['A', 'B'],
      image_path: 'abc.png',
      answer: 'B',
      analysis: '解析文本',
      given: 'B',
      correct: true,
      score: 5,
    });
  });
});

describe('判分：部分题没分值（fallbackScore 折算）', () => {
  it('缺省分值 = total_score / 题数，得分与总分按同一口径取整', () => {
    const paper = [
      paperRow({ id: 1, type: 'single', answer: 'A', score: 20 }),
      paperRow({ id: 2, type: 'single', answer: 'B', score: 0 }),
      paperRow({ id: 3, type: 'single', answer: 'C', score: 0 }),
    ];
    const out = gradePaper(
      paper,
      [
        { qid: 1, answer: 'A' },
        { qid: 2, answer: 'B' },
        { qid: 3, answer: 'C' },
      ],
      { totalScore: 100, passScore: 60 },
    );
    // 缺省分值 = 100 / 3 = 33.333…，逐题展示保留 1 位小数
    expect(out.results.map((r) => r.score)).toEqual([20, 33.3, 33.3]);
    expect(out.score).toBe(87); // round(20 + 33.333… + 33.333…)
    expect(out.total).toBe(87);
    expect(out.need).toBe(53); // ceil(87 × 60%)
    expect(out.passed).toBe(true);
  });
});

describe('判分：无分值（按题数折算）', () => {
  const paper = [
    paperRow({ id: 1, type: 'single', answer: 'A' }),
    paperRow({ id: 2, type: 'single', answer: 'B' }),
    paperRow({ id: 3, type: 'judge', answer: 'T' }),
    paperRow({ id: 4, type: 'short', answer: '参考答案' }),
  ];

  it('1 题 1 分；简答不给分但计入 manual', () => {
    const out = gradePaper(
      paper,
      [
        { qid: 1, answer: 'A' },
        { qid: 2, answer: 'B' },
        { qid: 3, answer: 't' },
        { qid: 4, answer: '论述' },
      ],
      { totalScore: 100, passScore: 60 },
    );
    expect(out.score).toBe(3);
    expect(out.total).toBe(4);
    expect(out.need).toBe(3); // ceil(4 × 60%) = 3
    expect(out.passed).toBe(true);
    expect(out.manual).toBe(1);
    expect(out.results.map((r) => r.score)).toEqual([1, 1, 1, 1]);
  });

  it('差一题不到 60%（2/4）判不及格', () => {
    const out = gradePaper(
      paper,
      [
        { qid: 1, answer: 'A' },
        { qid: 2, answer: 'B' },
      ],
      { totalScore: 100, passScore: 60 },
    );
    expect(out.score).toBe(2);
    expect(out.total).toBe(4);
    expect(out.need).toBe(3);
    expect(out.passed).toBe(false);
  });
});

describe('判分：总分与及格线（pass_score 百分比取整）', () => {
  it('及格线向上取整：70 分卷 × 65% = 45.5 → 46', () => {
    const paper = [paperRow({ id: 1, type: 'single', answer: 'A', score: 70 })];
    const right = gradePaper(paper, [{ qid: 1, answer: 'A' }], { passScore: 65 });
    expect(right.total).toBe(70);
    expect(right.score).toBe(70);
    expect(right.need).toBe(46);
    expect(right.passed).toBe(true);

    const wrong = gradePaper(paper, [{ qid: 1, answer: 'B' }], { passScore: 65 });
    expect(wrong.score).toBe(0);
    expect(wrong.need).toBe(46);
    expect(wrong.passed).toBe(false);
  });

  it('得分恰好等于及格线算及格（>=）', () => {
    const paper = [
      paperRow({ id: 1, type: 'single', answer: 'A', score: 30 }),
      paperRow({ id: 2, type: 'single', answer: 'B', score: 30 }),
    ];
    const out = gradePaper(paper, [{ qid: 1, answer: 'A' }], { passScore: 50 });
    expect(out.total).toBe(60);
    expect(out.score).toBe(30);
    expect(out.need).toBe(30);
    expect(out.passed).toBe(true);
  });
});

describe('判分：未作答（漏交）', () => {
  it('只判已提交的题，未作答题目不进 results，但计入总分', () => {
    const paper = [
      paperRow({ id: 1, type: 'single', answer: 'A', score: 10 }),
      paperRow({ id: 2, type: 'single', answer: 'B', score: 20 }),
      paperRow({ id: 3, type: 'single', answer: 'C', score: 30 }),
    ];
    // 只交了第 2 题；qid=999 不在卷内，直接忽略
    const out = gradePaper(paper, [
      { qid: 2, answer: 'B' },
      { qid: 999, answer: 'A' },
    ]);
    expect(out.results.map((r) => r.qid)).toEqual([2]);
    expect(out.score).toBe(20);
    expect(out.total).toBe(60);
    expect(out.manual).toBe(0);
  });

  it('未作答的简答题不计入 manual', () => {
    const paper = [
      paperRow({ id: 1, type: 'short', answer: '参考答案', score: 30 }),
      paperRow({ id: 2, type: 'single', answer: 'A', score: 10 }),
    ];
    const out = gradePaper(paper, [{ qid: 2, answer: 'A' }]);
    expect(out.manual).toBe(0);
    expect(out.results.map((r) => r.qid)).toEqual([2]);
  });
});

describe('交卷编排（ExamService，内存库）', () => {
  let app: FastifyInstance;
  let dataDir: string;
  let examService: ExamService;
  let exams: ExamRepository;
  let admin: User;
  let courseId = 0;
  let scoredExamId = 0;
  const scoredQids: number[] = [];
  let stu1: User;
  let stu2: User;
  let stu3: User;
  let stu4: User;
  let stu5: User;

  const allAnswers = (): AnswerInput[] => [
    { qid: scoredQids[0] ?? 0, answer: 'A' },
    { qid: scoredQids[1] ?? 0, answer: '2,0' },
    { qid: scoredQids[2] ?? 0, answer: 't' },
    { qid: scoredQids[3] ?? 0, answer: ' MAIN ' },
    { qid: scoredQids[4] ?? 0, answer: '我的论述' },
  ];

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-exam-grading-'));
    const config = loadConfig({
      ...process.env,
      MC_ENV: 'test',
      MC_DATA_DIR: dataDir,
      MC_LOG_LEVEL: 'silent',
      MC_ADMIN_USER: 'admin',
      MC_ADMIN_PASS: 'admin123',
    });
    const built = await buildApp(config, { db: new Db(':memory:') });
    app = built.app;
    await app.ready();
    examService = built.deps.examService;
    exams = built.deps.exams;

    const adminRow = built.deps.users.findByUsername('admin');
    if (!adminRow) throw new Error('引导管理员未创建');
    admin = adminRow;

    const makeUser = (username: string): User => {
      const id = built.deps.users.create({
        username,
        salt: 'salt',
        hash: 'hash',
        role: 'student',
        displayName: username,
      });
      const row = built.deps.users.findById(id);
      if (!row) throw new Error(`用户 ${username} 创建失败`);
      return row;
    };
    stu1 = makeUser('判分学生1');
    stu2 = makeUser('判分学生2');
    stu3 = makeUser('判分学生3');
    stu4 = makeUser('判分学生4');
    stu5 = makeUser('判分学生5');

    courseId = built.deps.courses.create({ name: '判分测试课程' });
    const bankId = built.deps.banks.create({ name: '判分测试题库', courseId });
    const specs: { type: QuestionType; stem: string; options: string[]; answer: string; score: number }[] = [
      { type: 'single', stem: '单选：常量关键字', options: ['const', 'final'], answer: 'A', score: 10 },
      { type: 'multiple', stem: '多选：基本类型', options: ['int', 'String', 'boolean'], answer: '0,2', score: 10 },
      { type: 'judge', stem: '判断：Java 跨平台', options: [], answer: 'T', score: 10 },
      { type: 'fill', stem: '填空：入口方法', options: [], answer: 'main', score: 10 },
      { type: 'short', stem: '简述：JVM 是什么', options: [], answer: '参考答案', score: 20 },
    ];
    for (const spec of specs) {
      scoredQids.push(
        built.deps.questions.create({
          bankId,
          type: spec.type,
          stem: spec.stem,
          options: spec.options,
          answer: spec.answer,
        }),
      );
    }
    scoredExamId = examService.create(admin, {
      courseId,
      title: '判分测试考试',
      durationMinutes: 30,
      passScore: 60,
      status: 'published',
    });
    expect(examService.addQuestions(admin, scoredExamId, scoredQids)).toBe(5);
    scoredQids.forEach((qid, index) => {
      examService.setQuestionMeta(admin, scoredExamId, qid, { score: specs[index]?.score ?? 0 });
    });
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('同一试卷重复交卷被拒，且只落一条成绩', () => {
    const first = examService.submit(stu1, scoredExamId, allAnswers(), Date.now() - 5000);
    expect(first).toMatchObject({ score: 40, total: 60, need: 36, passed: true, manual: 1 });
    expect(first.results).toBeUndefined();
    expect(exams.attemptCount(scoredExamId, stu1.id)).toBe(1);

    expect(() => examService.submit(stu1, scoredExamId, allAnswers())).toThrow('本场考试已交卷，不能重复作答');
    expect(exams.attemptCount(scoredExamId, stu1.id)).toBe(1);
  });

  it('作答只落四元组，成绩页按缓存的卷面重建完整结果', () => {
    const submitted = examService.submit(stu2, scoredExamId, allAnswers());
    expect(submitted.score).toBe(40);

    const attempt = exams.findAttempt(scoredExamId, stu2.id);
    expect(attempt).toBeTruthy();
    const stored = JSON.parse(attempt?.answers ?? '[]') as Record<string, unknown>[];
    expect(stored).toHaveLength(5);
    for (const item of stored) {
      expect(Object.keys(item).sort()).toEqual(['correct', 'given', 'qid', 'score']);
    }

    const result = examService.myResult(stu2, scoredExamId);
    expect(result.results).toHaveLength(5);
    expect(result.need).toBe(36);
    expect(result.manual).toBe(1);
    expect(result.created_at).toBe(attempt?.created_at);
    const short = result.results?.find((r) => r.qid === scoredQids[4]);
    expect(short).toMatchObject({
      type: 'short',
      stem: '简述：JVM 是什么',
      correct: null,
      score: 20,
      given: '我的论述',
    });
    const single = result.results?.find((r) => r.qid === scoredQids[0]);
    expect(single).toMatchObject({
      type: 'single',
      stem: '单选：常量关键字',
      options: ['const', 'final'],
      correct: true,
    });
  });

  it('漏交的题不写进判分结果', () => {
    examService.submit(stu3, scoredExamId, allAnswers().slice(0, 2));
    const result = examService.myResult(stu3, scoredExamId);
    expect(result.results?.map((r) => r.qid)).toEqual(scoredQids.slice(0, 2));
    expect(result.score).toBe(20);
    expect(result.total).toBe(60);
    expect(result.manual).toBe(0);
  });

  it('结束时间后 2 分钟缓冲内仍可交卷，超过缓冲则拒绝', () => {
    const now = Math.floor(Date.now() / 1000);
    const firstQid = scoredQids[0];
    if (firstQid === undefined) throw new Error('测试题目未创建');

    const withinBuffer = examService.create(admin, {
      courseId,
      title: '结束时间缓冲考试',
      endAt: now - 60,
      status: 'published',
    });
    examService.addQuestions(admin, withinBuffer, [firstQid]);
    // 新考试只有 1 道题且未设分值 → 按题数折算：1 题 1 分，及格线 ceil(1 × 60%) = 1
    const ok = examService.submit(stu4, withinBuffer, [{ qid: firstQid, answer: 'A' }]);
    expect(ok).toMatchObject({ score: 1, total: 1, need: 1, passed: true });

    const expired = examService.create(admin, {
      courseId,
      title: '已过缓冲考试',
      endAt: now - 200,
      status: 'published',
    });
    examService.addQuestions(admin, expired, [firstQid]);
    expect(() => examService.submit(stu5, expired, [{ qid: firstQid, answer: 'A' }])).toThrow('考试已结束，不能再交卷');
  });
});
