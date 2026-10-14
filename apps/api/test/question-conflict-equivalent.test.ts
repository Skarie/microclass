/**
 * 「同题不同答案」批量合并同义写法：
 *   - 等价写法（`\left(2,0\right)`/`(2,0)`、`\frac{2}{5}(或)0.4`/`\frac{2}{5}`、`7|七`/`7`）
 *     合并成可接受写法 `A|B`，而不是投票二选一（二选一会把另一种正确写法判错）；
 *   - 真的不同答案（`1260`/`12600`、`圆心`/`圆心上`）必须跳过，留人工 —— 真机上多数票也可能是错的。
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
let bankId = 0;

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-conflict-equiv-'));
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
  const bank = await app.inject({
    method: 'POST',
    url: '/api/v1/banks',
    payload: { name: '冲突合并测试库' },
    headers: { cookie },
  });
  bankId = json<{ id: number }>(bank).id;
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const addQuestion = async (stem: string, answer: string) => {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/banks/${bankId}/questions`,
    payload: { bankId, type: 'fill', stem, answer },
    headers: { cookie },
  });
  expect(res.statusCode, `建题失败（HTTP ${res.statusCode}）`).toBe(200);
};

describe('批量合并同义写法', () => {
  it('等价写法合并成 `A|B`，不等价的组跳过', async () => {
    // 组 1：同一答案的不同写法（坐标的 LaTeX 装饰）
    await addQuestion('合并用例 A：点 P 的坐标是 ____', '\\left(2,0\\right)');
    await addQuestion('合并用例 A：点 P 的坐标是 ____', '(2,0)');
    // 组 2：分数与小数两种写法
    await addQuestion('合并用例 B：化简结果是 ____', '\\frac{2}{5}(或)0.4');
    await addQuestion('合并用例 B：化简结果是 ____', '\\frac{2}{5}');
    // 组 3：真的不同答案（多数票在这里是错的：两因数分别乘 10，积应是 12600）
    await addQuestion('合并用例 C：积是 ____（不可自动处理）', '1260');
    await addQuestion('合并用例 C：积是 ____（不可自动处理）', '1260');
    await addQuestion('合并用例 C：积是 ____（不可自动处理）', '12600');

    const sync = await app.inject({ method: 'POST', url: '/api/v1/question-conflicts/sync', headers: { cookie } });
    expect(sync.statusCode).toBe(200);

    // 预演：等价的两组会被合并，第三组跳过
    const dry = await app.inject({
      method: 'POST',
      url: '/api/v1/question-conflicts/resolve-equivalent',
      headers: { cookie },
    });
    const preview = json<{ groups: number; questions: number; skipped: number; dryRun: boolean }>(dry);
    expect(preview.dryRun).toBe(true);
    expect(preview.groups).toBe(2);
    expect(preview.questions).toBe(4);
    expect(preview.skipped).toBeGreaterThanOrEqual(1);

    // 落库
    const applied = await app.inject({
      method: 'POST',
      url: '/api/v1/question-conflicts/resolve-equivalent?dryRun=0',
      headers: { cookie },
    });
    expect(json<{ groups: number }>(applied).groups).toBe(2);

    // 合并后的答案要能让两种写法都判对
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/banks/${bankId}/questions?keyword=合并用例 A&pageSize=10`,
      headers: { cookie },
    });
    const rows = json<{ questions: { answer: string }[] }>(list).questions;
    for (const q of rows) expect(q.answer).toBe('(2,0)'); // 装饰被归一化掉

    const listB = await app.inject({
      method: 'GET',
      url: `/api/v1/banks/${bankId}/questions?keyword=合并用例 B&pageSize=10`,
      headers: { cookie },
    });
    const rowsB = json<{ questions: { answer: string }[] }>(listB).questions;
    for (const q of rowsB) expect(q.answer.split('|').sort()).toEqual(['0.4', '\\frac{2}{5}']);

    // 第三组仍在待核对（没被自动"多数票"处理掉）
    const pending = await app.inject({
      method: 'GET',
      url: '/api/v1/question-conflicts?status=pending&pageSize=50',
      headers: { cookie },
    });
    const items = json<{ items: { stem: string }[] }>(pending).items;
    expect(items.some((i) => i.stem.includes('合并用例 C'))).toBe(true);
  });
});
