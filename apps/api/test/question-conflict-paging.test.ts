/**
 * 批量处理的翻页回归测试。
 *
 * 真机踩到的 bug：`conflicts.list()` 单页上限 100，而「合并同义写法」「按多数答案」都用
 * `pageSize: limit` 只取一页 —— 207 组里第 101 组往后被**静默跳过**（真机上 73 组可合并只处理了 50 组）。
 * 这个测试造 120 组冲突，断言批量处理必须覆盖全部。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';

let app: FastifyInstance;
let db: Db;
let dataDir: string;
let cookie = '';

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

const GROUPS = 120;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-conflict-paging-'));
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

  // 直接插库造 120 组冲突（每组两道题，答案写法不同但等价），比走接口快得多
  const insert = db.handle.prepare(
    `INSERT INTO questions
       (bank_id, lesson_id, type, stem, image_path, options, answer, analysis, sort, difficulty,
        subject, stage, book, chapter, point, source_path, source_no, content_hash, has_image, analysis_media_only)
     VALUES (1, NULL, 'fill', ?, '', '[]', ?, '', 0, '', '', '', '', '', '', '', '', ?, 0, 0)`,
  );
  db.handle.exec(
    'INSERT INTO banks (id, name, question_count) VALUES (1, ?, ?)'
      .replace('?', "'分页测试库'")
      .replace('?', String(GROUPS * 2)),
  );
  for (let i = 0; i < GROUPS; i += 1) {
    insert.run(`分页测试题 ${i}：答案是 ____`, '\\left(2,0\\right)', `paging-hash-${i}`);
    insert.run(`分页测试题 ${i}：答案是 ____`, '(2,0)', `paging-hash-${i}`);
  }
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('批量处理必须翻页（单页上限 100）', () => {
  it(`造了 ${GROUPS} 组冲突，合并同义写法要全部覆盖`, async () => {
    const sync = await app.inject({ method: 'POST', url: '/api/v1/question-conflicts/sync', headers: { cookie } });
    expect(sync.statusCode).toBe(200);

    const pendingBefore = await app.inject({
      method: 'GET',
      url: '/api/v1/question-conflicts?status=pending&pageSize=1',
      headers: { cookie },
    });
    expect(json<{ counts: { pending: number } }>(pendingBefore).counts.pending).toBe(GROUPS);

    const dry = await app.inject({
      method: 'POST',
      url: '/api/v1/question-conflicts/resolve-equivalent',
      headers: { cookie },
    });
    expect(json<{ groups: number }>(dry).groups).toBe(GROUPS);

    const applied = await app.inject({
      method: 'POST',
      url: '/api/v1/question-conflicts/resolve-equivalent?dryRun=0',
      headers: { cookie },
    });
    expect(json<{ groups: number }>(applied).groups).toBe(GROUPS);

    const pendingAfter = await app.inject({
      method: 'GET',
      url: '/api/v1/question-conflicts?status=pending&pageSize=1',
      headers: { cookie },
    });
    expect(json<{ counts: { pending: number; resolved: number } }>(pendingAfter).counts.pending).toBe(0);
    expect(json<{ counts: { resolved: number } }>(pendingAfter).counts.resolved).toBeGreaterThanOrEqual(GROUPS);
  });
});
