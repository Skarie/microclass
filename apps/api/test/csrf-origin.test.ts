/**
 * Origin 校验（CSRF 纵深防御）的行为测试。
 *
 * 四条规则：
 *   ① `MC_ALLOWED_ORIGINS=*` → 任意 Origin 的写请求都放行，且进程内只告警一次；
 *   ② 没有 `*` 时，未登记的 Origin 仍然 403；
 *   ③ 精确白名单（含端口）正常放行；
 *   ④ `*` 与具体域名混写时按「放行所有」处理。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from '../src/app.js';
import { Db } from '../src/db/client.js';
import { loadConfig } from '../src/config/env.js';
import { isOriginWildcardWarned, resetOriginWildcardWarning } from '../src/http/csrf.js';

let dataDir: string;
let built: BuiltApp;

async function makeApp(allowedOrigins: string): Promise<BuiltApp> {
  const config = loadConfig({
    ...process.env,
    MC_ENV: 'test',
    MC_DATA_DIR: dataDir,
    MC_ADMIN_USER: 'admin',
    MC_ADMIN_PASS: 'admin123',
    MC_LOG_LEVEL: 'silent',
    MC_ALLOWED_ORIGINS: allowedOrigins,
  });
  const builtApp = await buildApp(config, { db: new Db(':memory:') });
  await builtApp.app.ready();
  return builtApp;
}

/** 用错误密码打登录（只看 Origin 校验的结果：403 被拦，401 放行） */
function loginAttempt(app: BuiltApp['app'], headers: Record<string, string>) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { 'content-type': 'application/json', ...headers },
    payload: { username: '__probe__', password: '__probe__' },
  });
}

beforeAll(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-csrf-'));
});

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetOriginWildcardWarning();
});

describe('MC_ALLOWED_ORIGINS=*（显式放行所有 Origin）', () => {
  it('任意 Origin 都放行，且只告警一次', async () => {
    built = await makeApp('*');
    const first = await loginAttempt(built.app, { origin: 'https://evil.example.com' });
    expect(first.statusCode).not.toBe(403);
    expect(isOriginWildcardWarned()).toBe(true);

    // 再来一次其它 Origin：仍然放行，告警状态保持（不重复打）
    const second = await loginAttempt(built.app, { origin: 'https://another.example.org:9999' });
    expect(second.statusCode).not.toBe(403);
    expect(isOriginWildcardWarned()).toBe(true);

    await built.app.close();
  });

  it('与具体域名混写时，`*` 优先（等同放行所有）', async () => {
    built = await makeApp('https://mc.example.com,*,http://127.0.0.1:8091');
    const res = await loginAttempt(built.app, { origin: 'https://anything.example.net' });
    expect(res.statusCode).not.toBe(403);
    await built.app.close();
  });
});

describe('普通白名单（不配置 `*`）', () => {
  it('未登记的 Origin → 403', async () => {
    built = await makeApp('https://mc.example.com');
    const res = await loginAttempt(built.app, { origin: 'https://evil.example.com' });
    expect(res.statusCode).toBe(403);
    expect(isOriginWildcardWarned()).toBe(false);
    await built.app.close();
  });

  it('精确白名单（带非默认端口）→ 放行', async () => {
    built = await makeApp('https://office.app.example.com:38065');
    const res = await loginAttempt(built.app, { origin: 'https://office.app.example.com:38065' });
    expect(res.statusCode).not.toBe(403);
    await built.app.close();
  });

  it('白名单里没有该端口 → 仍 403（端口必须精确）', async () => {
    built = await makeApp('https://office.app.example.com:43175');
    const res = await loginAttempt(built.app, { origin: 'https://office.app.example.com:38065' });
    expect(res.statusCode).toBe(403);
    await built.app.close();
  });
});
