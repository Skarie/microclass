/**
 * 全库体检“缓存 + 后台 worker + 202”契约（迁移 0031）。
 *
 * 生产事故背景：`GET /banks/health` 同步扫 39.6 万题，冷缓存阻塞事件循环约 6.5 分钟，
 * 期间全站接口超时、健康检查 unhealthy。修法：worker 线程算 + 持久缓存 + 202 轮询。
 *
 * 本文件用**可注入 runner** 覆盖契约（真实 worker 线程在部署后由 /banks/health 冷请求验证）：
 *   - 冷缓存 202、算完 200，结果落 `bank_health_cache`；
 *   - 缓存命中不重复算；过期重新 202；
 *   - `/banks/health/status` 的 ready / computing / stale；
 *   - `refresh=1` 强制重算 + 教师权限 + 审计；
 *   - 并发只启动一个 worker；
 *   - 冷请求 < 200ms 且期间 /healthz 仍 200。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, type BuiltApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';
import type { BankHealthPayload } from '../src/db/repositories/bankHealthPayload.js';

let app: FastifyInstance;
let built: BuiltApp;
let dataDir: string;
let adminCookie = '';
let teacherCookie = '';
let studentCookie = '';

/** 假 runner 的控制面：手动决定何时完成、统计调用次数 */
let runnerCalls = 0;
let releaseRunner: ((payload: BankHealthPayload) => void) | null = null;

function samplePayload(total: number): BankHealthPayload {
  return {
    scope: { bankId: null, name: '全库' },
    stats: {
      total,
      missingDifficulty: 3,
      emptyAnswer: 1,
      withImage: 2,
      withoutImage: total - 2,
      mediaOnlyAnalysis: 0,
      duplicateGroups: 1,
      duplicateQuestions: 3,
      conflictGroups: 1,
      noFingerprint: 0,
    },
    metadata: { withSubject: total, withBook: total, withPoint: total, withHash: total },
    duplicates: [],
    kinds: [{ kind: 'lesson', banks: 1, questions: total }],
    difficulty: { unscored: 0, buckets: [], levels: [], sources: [], histogram: [] },
  };
}

/** 装一个“卡住”的 runner：调用后停在 releaseRunner 上，便于观察 202/并发/耗时 */
function installHangingRunner(): void {
  runnerCalls = 0;
  built.deps.bankHealth.runner = () =>
    new Promise<BankHealthPayload>((resolve) => {
      runnerCalls += 1;
      releaseRunner = resolve;
    });
}

/** 等当前这次计算彻底结束（含写缓存） */
function idle(): Promise<void> {
  return built.deps.bankHealth.whenIdle();
}

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
  const c = res.cookies.find((x) => x.name === 'microclass_sid');
  return c ? `microclass_sid=${c.value}` : '';
}

function getHealth(cookie = adminCookie): Promise<{ statusCode: number; json: () => unknown }> {
  return app.inject({ method: 'GET', url: '/api/v1/banks/health', headers: { cookie } });
}

async function clearCache(): Promise<void> {
  built.deps.db.run('DELETE FROM bank_health_cache');
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-health-cache-'));
  const config = loadConfig({
    ...process.env,
    MC_ENV: 'test',
    MC_DATA_DIR: dataDir,
    MC_ADMIN_USER: 'admin',
    MC_ADMIN_PASS: 'admin123',
    MC_LOG_LEVEL: 'silent',
  });
  built = await buildApp(config, { db: new Db(':memory:') });
  app = built.app;
  await app.ready();

  adminCookie = await login('admin', 'admin123');
  await app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: { cookie: adminCookie },
    payload: { username: 'health_teacher', password: 'pass1234', role: 'teacher' },
  });
  teacherCookie = await login('health_teacher', 'pass1234');
  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username: `health_stu_${Date.now().toString(36)}`, password: 'pass1234' },
  });
  const c = reg.cookies.find((x) => x.name === 'microclass_sid');
  studentCookie = c ? `microclass_sid=${c.value}` : '';
});

beforeEach(async () => {
  await clearCache();
  releaseRunner = null;
  runnerCalls = 0;
  // 每个用例默认用「立即完成」的 runner；需要观察中间态时自行换 hanging runner
  built.deps.bankHealth.runner = () => {
    runnerCalls += 1;
    return Promise.resolve(samplePayload(42));
  };
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('冷缓存 → 202 → 算完 200', () => {
  it('冷请求返回 202 computing，算完落库并返回 200 ready', async () => {
    installHangingRunner();
    const cold = await getHealth();
    expect(cold.statusCode).toBe(202);
    const coldBody = json<{ status: string; startedAt: number; retryAfterMs: number }>(cold);
    expect(coldBody.status).toBe('computing');
    expect(coldBody.retryAfterMs).toBe(3000);
    expect(typeof coldBody.startedAt).toBe('number');

    const pending = idle();
    releaseRunner?.(samplePayload(42));
    await pending;

    const warm = await getHealth();
    expect(warm.statusCode).toBe(200);
    const body = json<{ status: string; cachedAt: number; stats: { total: number } }>(warm);
    expect(body.status).toBe('ready');
    expect(body.stats.total).toBe(42);
    expect(body.cachedAt).toBeGreaterThan(0);

    // 结果写进持久缓存表（迁移 0031）
    const row = built.deps.db.get<{ computed_at: string; payload: string }>(
      'SELECT computed_at, payload FROM bank_health_cache WHERE id = 1',
    );
    expect(row).toBeDefined();
    const cached = JSON.parse(row?.payload ?? '{}') as { stats?: { total?: number } };
    expect(cached.stats?.total).toBe(42);
    expect(Number.isFinite(Date.parse(row?.computed_at ?? ''))).toBe(true);
  });

  it('缓存命中时不再调用 runner', async () => {
    installHangingRunner();
    const pending = idle();
    const cold = await getHealth();
    expect(cold.statusCode).toBe(202);
    releaseRunner?.(samplePayload(7));
    await pending;
    const callsAfterCompute = runnerCalls;

    const warm = await getHealth();
    expect(warm.statusCode).toBe(200);
    expect(runnerCalls).toBe(callsAfterCompute); // 命中缓存没有再算
  });

  it('缓存过期（computed_at 很旧）→ 重新 202', async () => {
    // 先写一条两天前的缓存
    built.deps.db.run('INSERT INTO bank_health_cache (id, computed_at, payload) VALUES (1, ?, ?)', [
      new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      JSON.stringify(samplePayload(5)),
    ]);
    const res = await getHealth();
    expect(res.statusCode).toBe(202);
    expect(json<{ status: string }>(res).status).toBe('computing');
  });

  it('冷请求耗时 < 200ms，且计算期间 /healthz 仍 200', async () => {
    installHangingRunner();
    const started = Date.now();
    const cold = await getHealth();
    const elapsed = Date.now() - started;
    expect(cold.statusCode).toBe(202);
    expect(elapsed).toBeLessThan(200);

    // 计算“还在跑”的期间，健康检查必须正常（旧实现在这里会整体卡住）
    const healthz = await app.inject({ method: 'GET', url: '/api/v1/healthz' });
    expect(healthz.statusCode).toBe(200);

    const pending = idle();
    releaseRunner?.(samplePayload(42));
    await pending;
  });
});

describe('status 轻量查询', () => {
  it('computing → ready；过期且无计算 → stale', async () => {
    installHangingRunner();
    const cold = await getHealth();
    expect(cold.statusCode).toBe(202);

    const computing = await app.inject({
      method: 'GET',
      url: '/api/v1/banks/health/status',
      headers: { cookie: adminCookie },
    });
    expect(computing.statusCode).toBe(200);
    expect(json<{ status: string }>(computing).status).toBe('computing');

    const pending = idle();
    releaseRunner?.(samplePayload(11));
    await pending;

    const ready = await app.inject({
      method: 'GET',
      url: '/api/v1/banks/health/status',
      headers: { cookie: adminCookie },
    });
    const readyBody = json<{ status: string; computedAt: number }>(ready);
    expect(readyBody.status).toBe('ready');
    expect(readyBody.computedAt).toBeGreaterThan(0);

    built.deps.db.run("UPDATE bank_health_cache SET computed_at = '2020-01-01T00:00:00.000Z' WHERE id = 1");
    const stale = await app.inject({
      method: 'GET',
      url: '/api/v1/banks/health/status',
      headers: { cookie: adminCookie },
    });
    expect(json<{ status: string }>(stale).status).toBe('stale');
  });
});

describe('refresh 与权限', () => {
  it('refresh=1 即使缓存新鲜也强制重算，并写审计', async () => {
    // 先热一次缓存
    const first = await getHealth();
    expect(first.statusCode).toBe(202);
    await idle();

    const callsBefore = runnerCalls;
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/banks/health?refresh=1',
      headers: { cookie: teacherCookie },
    });
    expect(res.statusCode).toBe(202);
    await idle();
    expect(runnerCalls).toBeGreaterThan(callsBefore);

    const audit = built.deps.db.get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'bank.health.refresh'",
    );
    expect(audit?.c).toBeGreaterThan(0);
  });

  it('学员不能访问体检与状态接口；未登录 401', async () => {
    const studentHealth = await getHealth(studentCookie);
    expect(studentHealth.statusCode).toBe(403);
    const studentStatus = await app.inject({
      method: 'GET',
      url: '/api/v1/banks/health/status',
      headers: { cookie: studentCookie },
    });
    expect(studentStatus.statusCode).toBe(403);

    const anon = await app.inject({ method: 'GET', url: '/api/v1/banks/health' });
    expect(anon.statusCode).toBe(401);
    const anonStatus = await app.inject({ method: 'GET', url: '/api/v1/banks/health/status' });
    expect(anonStatus.statusCode).toBe(401);
  });

  it('按题库体检（带 bankId）仍是同步 200，保持旧契约', async () => {
    built.deps.db.run("INSERT INTO banks (id, name) VALUES (1, '体检小库')");
    built.deps.db.run("INSERT INTO questions (id, bank_id, type, stem) VALUES (1, 1, 'fill', '题一')");
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/banks/health?bankId=1',
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = json<{ scope: { name: string }; stats: { total: number } }>(res);
    expect(body.stats.total).toBe(1);
    expect(body.scope.name).toBe('体检小库');
  });
});

describe('并发与迁移约束', () => {
  it('并发请求只启动一个计算', async () => {
    installHangingRunner();
    const [a, b] = await Promise.all([getHealth(), getHealth()]);
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    expect(runnerCalls).toBe(1);
    const pending = idle();
    releaseRunner?.(samplePayload(1));
    await pending;
  });

  it('bank_health_cache 是单行表（id 只能为 1）', () => {
    const write = (): void => {
      built.deps.db.run('INSERT INTO bank_health_cache (id, computed_at, payload) VALUES (2, ?, ?)', [
        new Date().toISOString(),
        '{}',
      ]);
    };
    expect(write).toThrow();
  });
});
