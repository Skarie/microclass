/**
 * 难度模型接口：预览（不写库）、应用（人工标注不被覆盖）、作答数据校准、权限。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';
import { questionFingerprint } from '../src/domain/question.js';
import { hashPassword, newSalt } from '../src/security/password.js';

let app: FastifyInstance;
let db: Db;
let deps: Awaited<ReturnType<typeof buildApp>>['deps'];
let dataDir: string;
let cookie = '';
let studentCookie = '';
let bankId = 0;

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
  return `microclass_sid=${res.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;
}

function addQuestion(stem: string, type = 'fill', answer = '1', difficulty = ''): number {
  return db.run(
    `INSERT INTO questions (bank_id, type, stem, options, answer, difficulty, subject, stage, book, chapter, point, content_hash, has_image)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`,
    [
      bankId,
      type,
      stem,
      '[]',
      answer,
      difficulty,
      '数学',
      '初中',
      '七年级上册',
      '第一单元',
      '有理数',
      questionFingerprint(stem, []),
    ],
  ).lastInsertRowid;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-diff-'));
  const config = loadConfig({
    ...process.env,
    MC_ENV: 'test',
    MC_DATA_DIR: dataDir,
    MC_LOG_LEVEL: 'silent',
    MC_ADMIN_USER: 'admin',
    MC_ADMIN_PASS: 'admin123',
  });
  db = new Db(':memory:');
  const built = await buildApp(config, { db });
  app = built.app;
  deps = built.deps;
  await app.ready();
  cookie = await login('admin', 'admin123');
  const salt = newSalt();
  deps.users.create({ username: 's1', salt, hash: hashPassword('stud12345', salt), role: 'student' });
  studentCookie = await login('s1', 'stud12345');

  db.run('INSERT INTO courses (id, name) VALUES (1, ?)', ['测试课程']);
  db.run('INSERT INTO lessons (id, title, course_id, group_name) VALUES (1, ?, 1, ?)', ['测试课时', '第一章']);
  db.run('INSERT INTO banks (id, name, kind, subject, book) VALUES (1, ?, ?, ?, ?)', [
    '七年级上册（新） · 期末测评 · 期末测试卷A',
    'paper',
    '数学',
    '七年级上册（新）',
  ]);
  bankId = 1;

  // 一整套覆盖难易两端的题：口算 vs 含参综合
  addQuestion('计算 $2+3$ 的结果。', 'fill', '5');
  addQuestion('填空：$12-7=$____。', 'fill', '5');
  addQuestion('已知关于 $x$ 的方程 $2x+a=3$ 的解是正数，求 $a$ 的取值范围。', 'fill', 'a<3');
  addQuestion('观察下列各数的规律：$1,3,6,10,15,\\cdots$，第 $n$ 个数是____；并说明理由。', 'fill', 'n(n+1)/2');
  addQuestion('两个三角形全等。', 'judge', 'T');
});

afterAll(async () => {
  await app.close();
});

describe('难度现状与预览', () => {
  it('现状接口返回分布/来源/阈值', async () => {
    const res = json<{ cuts: { easyMax: number }; stats: { total: number; unscored: number } }>(
      await app.inject({ method: 'GET', url: '/api/v1/questions/difficulty', headers: { cookie } }),
    );
    expect(res.stats.total).toBe(5);
    expect(res.stats.unscored).toBe(5); // 还没算过
    expect(res.cuts.easyMax).toBeGreaterThan(0);
  });

  it('预览不写库，但能算出合理的三档结构', async () => {
    const res = json<{
      willScore: number;
      skippedManual: number;
      predicted: { buckets: { difficulty: string; questions: number }[] };
      samples: { easiest: { score: number }[]; hardest: { score: number }[] };
    }>(await app.inject({ method: 'GET', url: '/api/v1/questions/difficulty/preview', headers: { cookie } }));
    expect(res.willScore).toBe(5);
    expect(res.skippedManual).toBe(0);
    const total = res.predicted.buckets.reduce((s, b) => s + b.questions, 0);
    expect(total).toBe(5);
    expect(res.samples.easiest[0]?.score).toBeLessThan(res.samples.hardest[0]?.score ?? 0);
    // 预览不写库
    const after = json<{ stats: { unscored: number } }>(
      await app.inject({ method: 'GET', url: '/api/v1/questions/difficulty', headers: { cookie } }),
    );
    expect(after.stats.unscored).toBe(5);
  });
});

describe('应用难度', () => {
  it('应用后写库：分数、三档、来源=auto，知识点难的题分数更高', async () => {
    const res = json<{ updated: number; scored: number; buckets: { difficulty: string; questions: number }[] }>(
      await app.inject({ method: 'POST', url: '/api/v1/questions/difficulty/apply', headers: { cookie } }),
    );
    expect(res.updated).toBe(5);
    expect(res.scored).toBe(5);
    const rows = db.all<{ id: number; difficulty_score: number; difficulty: string; difficulty_source: string }>(
      'SELECT id, difficulty_score, difficulty, difficulty_source FROM questions ORDER BY id',
    );
    expect(rows.every((r) => r.difficulty_source === 'auto')).toBe(true);
    expect(rows.every((r) => r.difficulty_score >= 0)).toBe(true);
    expect(rows.every((r) => ['easy', 'medium', 'hard'].includes(r.difficulty))).toBe(true);
    // 含参/规律题必须比口算题分数高
    const hard = rows[2]?.difficulty_score ?? 0;
    const easy = rows[0]?.difficulty_score ?? 0;
    expect(hard).toBeGreaterThan(easy);
  });

  it('人工标注的题不会被重算覆盖', async () => {
    // 模拟老师在界面上改难度（服务层会记 manual）
    const edit = await app.inject({
      method: 'PUT',
      url: `/api/v1/questions/${db.get<{ id: number }>('SELECT id FROM questions WHERE stem LIKE ?', ['计算%'])?.id}`,
      headers: { cookie },
      payload: {
        bankId,
        type: 'fill',
        stem: '计算 $2+3$ 的结果。',
        answer: '5',
        difficulty: 'hard',
      },
    });
    expect(edit.statusCode).toBe(200);
    const manual = db.get<{ difficulty: string; difficulty_source: string }>(
      "SELECT difficulty, difficulty_source FROM questions WHERE stem LIKE '计算%'",
    );
    expect(manual?.difficulty_source).toBe('manual');
    expect(manual?.difficulty).toBe('hard');

    const res = json<{ skippedManual: number; updated: number }>(
      await app.inject({ method: 'POST', url: '/api/v1/questions/difficulty/apply', headers: { cookie } }),
    );
    expect(res.skippedManual).toBe(1);
    const still = db.get<{ difficulty: string; difficulty_source: string }>(
      "SELECT difficulty, difficulty_source FROM questions WHERE stem LIKE '计算%'",
    );
    expect(still?.difficulty).toBe('hard');
    expect(still?.difficulty_source).toBe('manual');
  });

  it('按题库范围应用只影响该题库', async () => {
    db.run('INSERT INTO banks (id, name, kind) VALUES (2, ?, ?)', ['另一个题库', 'lesson']);
    const other = db.run(
      `INSERT INTO questions (bank_id, type, stem, options, answer, difficulty, content_hash)
       VALUES (2,'fill','另一题库的题 $1+1=$____','[]','2','', ?)`,
      [questionFingerprint('另一题库的题', [])],
    ).lastInsertRowid;
    const res = json<{ updated: number }>(
      await app.inject({
        method: 'POST',
        url: `/api/v1/questions/difficulty/apply?bankId=${bankId}`,
        headers: { cookie },
      }),
    );
    expect(res.updated).toBe(4); // 5 道里 1 道是人工标注，跳过
    const untouched = db.get<{ difficulty_score: number }>('SELECT difficulty_score FROM questions WHERE id = ?', [
      other,
    ]);
    expect(untouched?.difficulty_score).toBe(-1); // 别的题库没被动
  });
});

describe('作答数据校准', () => {
  it('样本不足时不动；达到门槛后按正确率下调/上调难度', async () => {
    const qid = db.get<{ id: number }>('SELECT id FROM questions ORDER BY id LIMIT 1')?.id ?? 0;
    // 只有 1 次作答 → 不校准
    db.run('INSERT INTO attempts (client_id, lesson_id, answers, score, total, user_id) VALUES (?,?,?,?,?,?)', [
      'c1',
      1,
      JSON.stringify([{ qid, answer: '5', correct: true }]),
      1,
      1,
      1,
    ]);
    const few = json<{ calibrated: number; candidates: number }>(
      await app.inject({ method: 'POST', url: '/api/v1/questions/difficulty/calibrate', headers: { cookie } }),
    );
    expect(few.calibrated).toBe(0);

    // 补到 25 次作答且全部做错 → 应当被判定更难
    for (let i = 0; i < 24; i += 1) {
      db.run('INSERT INTO attempts (client_id, lesson_id, answers, score, total, user_id) VALUES (?,?,?,?,?,?)', [
        `c${i + 2}`,
        1,
        JSON.stringify([{ qid, answer: 'x', correct: false }]),
        0,
        1,
        1,
      ]);
    }
    const before = db.get<{ difficulty_score: number }>('SELECT difficulty_score FROM questions WHERE id = ?', [qid]);
    const applied = json<{ calibrated: number }>(
      await app.inject({ method: 'POST', url: '/api/v1/questions/difficulty/calibrate?dryRun=0', headers: { cookie } }),
    );
    expect(applied.calibrated).toBe(1);
    const after = db.get<{ difficulty_score: number; difficulty_source: string; difficulty_n: number }>(
      'SELECT difficulty_score, difficulty_source, difficulty_n FROM questions WHERE id = ?',
      [qid],
    );
    expect(after?.difficulty_source).toBe('calibrated');
    expect(after?.difficulty_n).toBe(25);
    expect(after?.difficulty_score ?? 0).toBeGreaterThan(before?.difficulty_score ?? 0);

    // 校准过的题不会被普通重算打回去
    const reapply = json<{ skippedCalibrated: number }>(
      await app.inject({ method: 'POST', url: '/api/v1/questions/difficulty/apply', headers: { cookie } }),
    );
    expect(reapply.skippedCalibrated).toBe(1);
  });

  it('简答题（不自动判分）不作为难度证据', async () => {
    const qid = db.run(
      `INSERT INTO questions (bank_id, type, stem, options, answer, difficulty, content_hash)
       VALUES (?, 'short', ?, '[]', '参考答案', '', ?)`,
      [bankId, '简答：说明理由。', questionFingerprint('简答：说明理由。', [])],
    ).lastInsertRowid;
    for (let i = 0; i < 10; i += 1) {
      db.run('INSERT INTO attempts (client_id, lesson_id, answers, score, total, user_id) VALUES (?,?,?,?,?,?)', [
        `s${i}`,
        1,
        JSON.stringify([{ qid, answer: '随便写', correct: null }]),
        0,
        1,
        1,
      ]);
    }
    const res = json<{ calibrated: number }>(
      await app.inject({ method: 'POST', url: '/api/v1/questions/difficulty/calibrate?dryRun=0', headers: { cookie } }),
    );
    expect(res.calibrated).toBe(1); // 仍然只有前面那道被判错的填空题
  });
});

describe('权限', () => {
  it('学生可以看现状，不能重算/校准', async () => {
    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/questions/difficulty',
      headers: { cookie: studentCookie },
    });
    expect(read.statusCode).toBe(200);

    const preview = await app.inject({
      method: 'GET',
      url: '/api/v1/questions/difficulty/preview',
      headers: { cookie: studentCookie },
    });
    expect(preview.statusCode).toBe(403);

    const apply = await app.inject({
      method: 'POST',
      url: '/api/v1/questions/difficulty/apply',
      headers: { cookie: studentCookie },
    });
    expect(apply.statusCode).toBe(403);

    const anon = await app.inject({ method: 'POST', url: '/api/v1/questions/difficulty/apply' });
    expect(anon.statusCode).toBe(401);
  });
});
