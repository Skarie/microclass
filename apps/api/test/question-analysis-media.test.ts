/**
 * 「解析只有图片、没有一个字」的判定与用法：
 *   - 判定口径（`hasMediaOnlyAnalysis`）：去掉 `![](图)` 之后什么都不剩才算；
 *   - 写库时算好存进 `questions.analysis_media_only`（迁移 0020），体检给数量、题库里能筛出来；
 *   - 真机背景：全库 366,867 题里 167,137 题解析含图，其中 19,507 题解析**只有图**（图里是解析文字）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';
import { QuestionRepository } from '../src/db/repositories/questionRepository.js';
import { hasMediaOnlyAnalysis, textWithoutImages } from '../src/domain/question.js';

const SHA = 'a'.repeat(40);
const IMG = `/api/v1/question-media/${SHA}.jpeg`;

describe('解析纯图片判定', () => {
  it('只有图片（哪怕带换行/空格）算纯图片', () => {
    expect(hasMediaOnlyAnalysis(`![](${IMG})`)).toBe(true);
    expect(hasMediaOnlyAnalysis(`\n\n![](${IMG})\n\n`)).toBe(true);
  });

  it('图 + 一个字以上就不算（本题库绝大多数是有文字的，别误判）', () => {
    expect(hasMediaOnlyAnalysis(`![](${IMG})\n\n故答案为 4`)).toBe(false);
    expect(hasMediaOnlyAnalysis('解：原式 = 4')).toBe(false);
  });

  it('空解析、没有图片的解析都不算「只有图片」', () => {
    expect(hasMediaOnlyAnalysis('')).toBe(false);
    expect(hasMediaOnlyAnalysis('解：原式 = 4')).toBe(false);
  });

  it('图片来源是外部图床也算（真机有 11 道题的解析指向阿里云 OSS）', () => {
    expect(hasMediaOnlyAnalysis('![题目图片](https://oss.example.com/a/b.png)')).toBe(true);
    expect(hasMediaOnlyAnalysis('![题目图片](https://oss.example.com/a/b.png) 故答案为 4')).toBe(false);
  });

  it('剥离图片后剩下的字数按「去掉空白」算', () => {
    expect(textWithoutImages(`\n ![](${IMG}) \n`)).toBe('');
    expect(textWithoutImages(`![](${IMG})x`)).toBe('x');
  });
});

let app: FastifyInstance;
let db: Db;
let dataDir: string;
let cookie = '';
let bankId = 0;

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

/** 直接调 inject：包一层会把 fastify 的重载推断成 `void & Promise & Chain`（见 catalog 测试的写法） */
const post = (url: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url, payload, headers: { cookie } });

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-analysis-media-'));
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
  await app.ready();
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'admin123' },
  });
  cookie = `microclass_sid=${login.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;
  const bank = await post('/api/v1/banks', { name: '解析图片测试库', subject: '数学', book: '七年级上册（新）' });
  expect(bank.statusCode, `建题库失败（HTTP ${bank.statusCode}）`).toBe(200);
  bankId = json<{ id: number }>(bank).id;
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('解析纯图片标记（写库 + 筛选 + 体检）', () => {
  it('新增时自动算好标记', async () => {
    const a = await post(`/api/v1/banks/${bankId}/questions`, {
      bankId,
      type: 'fill',
      stem: '看图作答 $1+1=$____',
      answer: '2',
      analysis: `![](${IMG})`,
    });
    expect(a.statusCode, `建题失败（HTTP ${a.statusCode}）`).toBe(200);
    const b = await post(`/api/v1/banks/${bankId}/questions`, {
      bankId,
      type: 'fill',
      stem: '有文字的题 $2+2=$____',
      answer: '4',
      analysis: `![](${IMG})\n\n故答案为 4`,
    });
    expect(b.statusCode, `建题失败（HTTP ${b.statusCode}）`).toBe(200);

    const flagged = await app.inject({
      method: 'GET',
      url: `/api/v1/banks/${bankId}/questions?mediaOnlyAnalysis=1`,
      headers: { cookie },
    });
    const body = json<{ total: number; questions: { stem: string; analysis: string }[] }>(flagged);
    expect(body.total).toBe(1);
    expect(body.questions[0]?.stem).toContain('看图作答');
    // 解析原样返回（图片地址还在），前端 RichText 才能把图渲染出来
    expect(body.questions[0]?.analysis).toContain('/api/v1/question-media/');
  });

  it('不筛选时两道题都在（标记不影响正常列表）', async () => {
    const all = await app.inject({
      method: 'GET',
      url: `/api/v1/banks/${bankId}/questions`,
      headers: { cookie },
    });
    expect(json<{ total: number }>(all).total).toBe(2);
  });

  it('体检给出「解析只有图片」的数量', async () => {
    const health = await app.inject({
      method: 'GET',
      url: `/api/v1/banks/health?bankId=${bankId}&refresh=1`,
      headers: { cookie },
    });
    const stats = json<{ stats: { total: number; mediaOnlyAnalysis: number; withImage: number } }>(health).stats;
    expect(stats.total).toBe(2);
    expect(stats.withImage).toBe(2);
    expect(stats.mediaOnlyAnalysis).toBe(1);
  });

  it('把解析改成有文字后，标记跟着消失（不是一次性的）', async () => {
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/banks/${bankId}/questions?mediaOnlyAnalysis=1`,
      headers: { cookie },
    });
    const q = json<{ questions: { id: number; stem: string; analysis: string }[] }>(list).questions[0];
    expect(q).toBeDefined();
    const updated = await app.inject({
      method: 'PUT',
      url: `/api/v1/questions/${q?.id}`,
      payload: {
        bankId,
        type: 'fill',
        stem: q?.stem ?? '',
        options: [],
        answer: '2',
        analysis: '把图片换成了文字解析：原式 = 2。',
      },
      headers: { cookie },
    });
    expect(updated.statusCode).toBe(200);
    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/banks/${bankId}/questions?mediaOnlyAnalysis=1`,
      headers: { cookie },
    });
    expect(json<{ total: number }>(after).total).toBe(0);
  });

  it('回填历史数据：外部图床的「纯图片解析」也要标上（真机有 11 道）', () => {
    // 直接造一条老数据（绕过写库逻辑，模拟导入进来的历史行）
    db.run(
      `INSERT INTO questions (bank_id, type, stem, options, answer, analysis, content_hash, has_image, analysis_media_only)
       VALUES (?, 'fill', ?, '[]', '4', ?, 'legacy-hash', 1, 0)`,
      [bankId, '历史题（外链图解析）', '![题目图片](https://oss.example.com/a/b.png)'],
    );
    const repo = new QuestionRepository(db);
    const updated = repo.backfillAnalysisMediaOnly(500);
    expect(updated).toBeGreaterThanOrEqual(1);
    const flagged = db.get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM questions WHERE analysis_media_only = 1 AND analysis LIKE '%oss.example.com%'",
    );
    expect(flagged?.c).toBe(1);
  });
});
