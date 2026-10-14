/**
 * 试卷打印渲染（服务端 HTML）：
 *   - A4/A3 纸张与横竖版写进 `@page`；
 *   - 题号跨大题连续、大题标题含「每小题 X 分」；
 *   - LaTeX 用 KaTeX 服务端渲染（`<span class="katex">`），图片转 `<img>`；
 *   - 答案/解析只在 `answers=1` 时出现；答题卡独立一页；密封线可选；
 *   - KaTeX 样式与字体自托管（离线可用）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';
import { hashPassword, newSalt } from '../src/security/password.js';

let app: FastifyInstance;
let db: Db;
let deps: Awaited<ReturnType<typeof buildApp>>['deps'];
let dataDir: string;
let cookie = '';
let studentCookie = '';
let examId = 0;

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
  return `microclass_sid=${res.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-paper-'));
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

  db.run('INSERT INTO courses (id, name) VALUES (1, ?)', ['三年级上册数学']);
  db.run('INSERT INTO lessons (id, title, course_id, group_name) VALUES (1, ?, 1, ?)', ['第一课时', '第一章']);
  db.run('INSERT INTO banks (id, name, lesson_id, course_id, kind, subject, book) VALUES (1, ?, 1, 1, ?, ?, ?)', [
    '第一章 · 第一课时',
    'lesson',
    '数学',
    '三年级上册',
  ]);
  const seed = [
    [
      'single',
      '计算 $\\frac{1}{2}+\\frac{1}{3}$ 的结果是（　）。',
      '["选项甲","选项乙","选项丙","选项丁"]',
      'B',
      '通分后相加。',
    ],
    ['single', '下列各数中最小的是（　）。![](/api/v1/question-media/aa.png)', '["$3$","$-2$","$0$","$-5$"]', 'D', ''],
    ['fill', '计算：$3+(-5)=$____。', '[]', '-2', ''],
    ['judge', '两个负数相加，和一定是负数。', '[]', 'T', ''],
    ['short', '说明为什么 $0$ 没有倒数。', '[]', '因为 0 与任何数的积都不是 1。', ''],
  ] as const;
  for (const [type, stem, options, answer, analysis] of seed) {
    db.run(
      `INSERT INTO questions (bank_id, type, stem, options, answer, analysis, difficulty, content_hash)
       VALUES (1, ?, ?, ?, ?, ?, 'medium', ?)`,
      [type, stem, options, answer, analysis, `h${stem.slice(0, 6)}`],
    );
  }
  const exam = await app.inject({
    method: 'POST',
    url: '/api/v1/exams',
    headers: { cookie },
    payload: {
      courseId: 1,
      title: '第一章单元测试',
      description: '',
      durationMinutes: 60,
      passScore: 60,
      status: 'draft',
    },
  });
  examId = json<{ id: number }>(exam).id;
  const ids = db.all<{ id: number }>('SELECT id FROM questions ORDER BY id').map((r) => r.id);
  await app.inject({
    method: 'POST',
    url: `/api/v1/exams/${examId}/questions`,
    headers: { cookie },
    payload: { questionIds: ids },
  });
  // 设大题与分值：单选 2 分、填空 3 分、判断 1 分、解答 6 分
  await app.inject({
    method: 'PUT',
    url: `/api/v1/exams/${examId}/structure`,
    headers: { cookie },
    payload: {
      structure: [
        { name: '一、选择题', type: 'single', score: 2 },
        { name: '二、判断题', type: 'judge', score: 1 },
        { name: '三、填空题', type: 'fill', score: 3 },
        { name: '四、解答题', type: 'short', score: 6 },
      ],
      totalScore: 100,
    },
  });
});

afterAll(async () => {
  await app.close();
});

describe('试卷打印 HTML', () => {
  it('A4 纵版：@page 尺寸、试卷头、大题、连续题号、分值都正确', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/exams/${examId}/paper.html`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    const html = res.body;
    expect(html).toContain('@page { size: A4 portrait;');
    expect(html).toContain('第一章单元测试');
    expect(html).toContain('满分 100 分');
    expect(html).toContain('60 分钟');
    // 大题标题 + 每小题分值
    expect(html).toContain('一、选择题');
    expect(html).toContain('每小题 2 分');
    expect(html).toContain('三、填空题');
    expect(html).toContain('每小题 3 分');
    // 题号跨大题连续：1..5
    for (const no of [1, 2, 3, 4, 5]) expect(html).toContain(`id="q${no}"`);
    // 选项
    expect(html).toContain('选项甲');
    expect(html).toContain('>A.<');
    // 不勾选答案时不出现答案块
    expect(html).not.toContain('【答案】');
    // 判断题给出作答括号
    expect(html).toContain('（　　）');
    // 自托管 KaTeX
    expect(html).toContain('/api/v1/paper-assets/katex.min.css');
  });

  it('LaTeX 服务端渲染成 KaTeX、图片转 img', async () => {
    const html = (await app.inject({ method: 'GET', url: `/api/v1/exams/${examId}/paper.html`, headers: { cookie } }))
      .body;
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('\\frac{1}{2}+\\frac{1}{3}$ 的结果'); // 公式已被渲染掉
    expect(html).toContain('<img class="pimg" src="/api/v1/question-media/aa.png"');
  });

  it('A3 横版 + 双栏 + 含答案 + 答题卡 + 密封线', async () => {
    const html = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/exams/${examId}/paper.html?size=A3&orientation=landscape&columns=2&answers=1&sheet=1&seal=1`,
        headers: { cookie },
      })
    ).body;
    expect(html).toContain('@page { size: A3 landscape;');
    expect(html).toContain('paper__body--cols');
    expect(html).toContain('【答案】');
    expect(html).toContain('【解析】');
    expect(html).toContain('答题卡');
    expect(html).toContain('bubble');
    expect(html).toContain('class="seal"');
    expect(html).toContain('密 封 线');
    // 密封线时左边距要留出装订区
    expect(html).toContain('margin: 14mm 12mm 14mm 26mm');
  });

  it('print=1 时自动弹打印对话框', async () => {
    const html = (
      await app.inject({ method: 'GET', url: `/api/v1/exams/${examId}/paper.html?print=1`, headers: { cookie } })
    ).body;
    expect(html).toContain('window.print()');
  });

  it('KaTeX 样式与字体自托管可访问（离线打印不掉字体）', async () => {
    const css = await app.inject({ method: 'GET', url: '/api/v1/paper-assets/katex.min.css' });
    expect(css.statusCode).toBe(200);
    expect(css.headers['content-type']).toContain('text/css');
    expect(css.body).toContain('@font-face');
    const font = await app.inject({ method: 'GET', url: '/api/v1/paper-assets/fonts/KaTeX_Main-Regular.woff2' });
    expect(font.statusCode).toBe(200);
    expect(font.headers['content-type']).toContain('font/woff2');
    const bad = await app.inject({ method: 'GET', url: '/api/v1/paper-assets/fonts/../../secret.txt' });
    expect([400, 404]).toContain(bad.statusCode);
  });

  it('权限：学生不能取打印页，匿名 401', async () => {
    const asStudent = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/paper.html`,
      headers: { cookie: studentCookie },
    });
    expect(asStudent.statusCode).toBe(403);
    const anon = await app.inject({ method: 'GET', url: `/api/v1/exams/${examId}/paper.html` });
    expect(anon.statusCode).toBe(401);
  });
});
