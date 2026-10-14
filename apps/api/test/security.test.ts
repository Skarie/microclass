import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';

/**
 * 安全复核用例：
 * 1) 未登录 / 越权的接口矩阵（401 / 403）
 * 2) 会话 Cookie 篡改与伪造（签名校验）
 * 3) 上传白名单（脚本、SVG、HTML）
 * 4) 文件下载的 Content-Disposition 策略（可执行类型必须 attachment）
 * 5) 限流
 */
let app: FastifyInstance;
let dataDir: string;
let adminCookie = '';
let teacherCookie = '';
let studentCookie = '';
let lessonId = 0;
let questionId = 0;
let courseId = 0;

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

function multipart(fields: { name: string; filename: string; contentType: string; data: string | Buffer }[]): {
  body: Buffer;
  contentType: string;
} {
  const boundary = '----mc-security-boundary';
  const chunks: Buffer[] = [];
  for (const f of fields) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\nContent-Type: ${f.contentType}\r\n\r\n`,
      ),
      Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8'),
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
  const c = res.cookies.find((x) => x.name === 'microclass_sid');
  return c ? `microclass_sid=${c.value}` : '';
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-security-'));
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

  adminCookie = await login('admin', 'admin123');

  // 教师账号（管理员创建）
  await app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: { cookie: adminCookie },
    payload: { username: 'teacher1', password: 'pass1234', role: 'teacher', displayName: '张老师' },
  });
  teacherCookie = await login('teacher1', 'pass1234');

  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username: `sec_${Date.now().toString(36)}`, password: 'pass1234' },
  });
  const sc = reg.cookies.find((x) => x.name === 'microclass_sid');
  studentCookie = sc ? `microclass_sid=${sc.value}` : '';

  courseId = json<{ id: number }>(
    await app.inject({
      method: 'POST',
      url: '/api/v1/courses',
      headers: { cookie: adminCookie },
      payload: { name: '安全用例课程', published: true },
    }),
  ).id;
  lessonId = json<{ id: number }>(
    await app.inject({
      method: 'POST',
      url: '/api/v1/lessons',
      headers: { cookie: adminCookie },
      payload: { title: '安全用例课时', courseId, videoKind: 'url', videoPath: 'https://example.com/s.mp4' },
    }),
  ).id;
  const bankId = json<{ id: number }>(
    await app.inject({
      method: 'POST',
      url: '/api/v1/banks',
      headers: { cookie: adminCookie },
      payload: { name: '安全用例题库', lessonId },
    }),
  ).id;
  questionId = json<{ id: number }>(
    await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions`,
      headers: { cookie: adminCookie },
      payload: { bankId, type: 'judge', stem: '安全用例题目', answer: '对' },
    }),
  ).id;
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('安全：未登录访问受保护接口一律 401', () => {
  const protectedRoutes: [string, string][] = [
    ['GET', '/api/v1/me'],
    ['GET', '/api/v1/courses'],
    ['GET', `/api/v1/courses/${1}`],
    ['GET', '/api/v1/lessons'],
    ['GET', '/api/v1/banks'],
    ['GET', '/api/v1/me/summary'],
    ['GET', '/api/v1/me/wrong-questions'],
    ['GET', '/api/v1/me/attempts'],
    ['GET', '/api/v1/me/exams'],
    ['GET', '/api/v1/users'],
    ['GET', '/api/v1/audit-logs'],
    ['GET', '/api/v1/settings'],
    ['GET', '/api/v1/media-roots'],
    ['GET', '/api/v1/stats/lessons/1'],
    ['GET', '/api/v1/stats/courses/1'],
    ['POST', '/api/v1/courses'],
    ['POST', '/api/v1/lessons'],
    ['POST', '/api/v1/banks'],
    ['POST', '/api/v1/exams'],
    ['POST', '/api/v1/progress'],
  ];

  for (const [method, url] of protectedRoutes) {
    it(`${method} ${url} → 401`, async () => {
      const res = await app.inject({ method: method as 'GET' | 'POST', url, payload: {} });
      expect(res.statusCode).toBe(401);
      expect(json<{ error: { code: string } }>(res).error.code).toBe('UNAUTHORIZED');
    });
  }
});

describe('安全：越权矩阵（学生 / 教师 / 管理员）', () => {
  it('学生不能访问任何管理端写接口（403）', async () => {
    const cases: [string, string, unknown][] = [
      ['POST', '/api/v1/courses', { name: '越权课程' }],
      ['POST', '/api/v1/banks', { name: '越权题库' }],
      ['POST', '/api/v1/users', { username: 'hacker', password: 'pass1234', role: 'admin' }],
      ['PUT', '/api/v1/settings', { allowRegister: false }],
      ['POST', '/api/v1/media-roots', { name: '越权目录', path: '/tmp' }],
      ['POST', '/api/v1/exams', { courseId, title: '越权考试' }],
      ['DELETE', `/api/v1/lessons/${lessonId}`, undefined],
      ['GET', '/api/v1/users', undefined],
      ['GET', '/api/v1/audit-logs', undefined],
      ['GET', `/api/v1/stats/lessons/${lessonId}`, undefined],
      ['GET', `/api/v1/exams/1/scores`, undefined],
      ['GET', `/api/v1/banks/${1}/export.csv`, undefined],
    ];
    for (const [method, url, payload] of cases) {
      const options: InjectOptions = {
        method: method as InjectOptions['method'],
        url,
        headers: { cookie: studentCookie },
      };
      if (payload !== undefined) options.payload = payload as Record<string, unknown>;
      const res = await app.inject(options);
      expect([403, 404], `${method} ${url} 应为 403/404，实际 ${res.statusCode}`).toContain(res.statusCode);
    }
  });

  it('教师可以管理内容，但不能管理账号与系统设置（403）', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/courses',
      headers: { cookie: teacherCookie },
      payload: { name: '教师创建的课程', published: true },
    });
    expect(created.statusCode).toBe(200);

    const lessons = await app.inject({ method: 'GET', url: '/api/v1/lessons', headers: { cookie: teacherCookie } });
    expect(lessons.statusCode).toBe(200);

    const stats = await app.inject({
      method: 'GET',
      url: `/api/v1/stats/courses/${courseId}`,
      headers: { cookie: teacherCookie },
    });
    expect(stats.statusCode).toBe(200);

    for (const [method, url] of [
      ['GET', '/api/v1/users'],
      ['GET', '/api/v1/settings'],
      ['PUT', '/api/v1/settings'],
      ['GET', '/api/v1/audit-logs'],
    ] as [string, string][]) {
      const res = await app.inject({
        method: method as 'GET' | 'PUT',
        url,
        headers: { cookie: teacherCookie },
        ...(method === 'PUT' ? { payload: { allowRegister: false } } : {}),
      });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('学生只能看到自己的笔记与错题（横向越权防护）', async () => {
    const adminNote = await app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${lessonId}/notes`,
      headers: { cookie: adminCookie },
      payload: { pos: 10, text: '管理员笔记' },
    });
    const adminNoteId = json<{ id: number }>(adminNote).id;

    const studentNotes = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${lessonId}/notes`,
      headers: { cookie: studentCookie },
    });
    expect(json<{ count: number }>(studentNotes).count).toBe(0);

    const steal = await app.inject({
      method: 'DELETE',
      url: `/api/v1/notes/${adminNoteId}`,
      headers: { cookie: studentCookie },
    });
    expect(steal.statusCode).toBe(404);
  });
});

describe('安全：会话与 Cookie', () => {
  it('伪造/篡改的会话 Cookie 不被接受', async () => {
    const forged = [
      'microclass_sid=eyJ1aWQiOjF9.fake-signature',
      'microclass_sid=1',
      'microclass_sid=',
      'microclass_sid=eyJ1aWQiOjEsImV4cCI6OTk5OTk5OTk5OTk5OX0.deadbeef',
    ];
    for (const cookie of forged) {
      const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
      expect(res.statusCode, cookie).toBe(401);
    }
  });

  it('会话 Cookie 为 HttpOnly + SameSite=Lax', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'admin123' },
    });
    const setCookie = res.headers['set-cookie'];
    const value = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
    expect(value).toContain('HttpOnly');
    expect(value.toLowerCase()).toContain('samesite=lax');
    expect(value).toContain('Path=/');
  });

  it('登录失败不泄露账号是否存在', async () => {
    const wrongPass = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'nope-nope' },
    });
    const noUser = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'no-such-user-xyz', password: 'nope-nope' },
    });
    expect(wrongPass.statusCode).toBe(401);
    expect(noUser.statusCode).toBe(401);
    expect(json<{ error: { message: string } }>(wrongPass).error.message).toBe(
      json<{ error: { message: string } }>(noUser).error.message,
    );
  });
});

describe('安全：上传白名单与下载处置', () => {
  it('SVG 不能作为题目配图上传（存储型 XSS 防护）', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const mp = multipart([{ name: 'file', filename: 'evil.svg', contentType: 'image/svg+xml', data: svg }]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/questions/${questionId}/image`,
      headers: { cookie: adminCookie, 'content-type': mp.contentType },
      payload: mp.body,
    });
    expect(res.statusCode).toBe(400);
  });

  it('伪装成 PNG 的 SVG（改后缀）也会被拒绝', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const mp = multipart([{ name: 'file', filename: 'evil.png', contentType: 'image/svg+xml', data: svg }]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/questions/${questionId}/image`,
      headers: { cookie: adminCookie, 'content-type': mp.contentType },
      payload: mp.body,
    });
    expect(res.statusCode).toBe(400);
  });

  it('知识点附件不接受 HTML / SVG / 脚本类文件', async () => {
    for (const [filename, type] of [
      ['xss.html', 'text/html'],
      ['xss.svg', 'image/svg+xml'],
      ['run.js', 'text/javascript'],
      ['shell.php', 'application/x-php'],
    ] as [string, string][]) {
      const mp = multipart([{ name: 'file', filename, contentType: type, data: '<script>alert(1)</script>' }]);
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/lessons/${lessonId}/knowledge/file`,
        headers: { cookie: adminCookie, 'content-type': mp.contentType },
        payload: mp.body,
      });
      expect(res.statusCode, filename).toBe(400);
    }
  });

  it('图片与 PDF 附件正常上传，且下载处置符合类型（inline / attachment）', async () => {
    const pdf = multipart([
      { name: 'file', filename: '讲义.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF-1.4 x') },
    ]);
    const upPdf = await app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${lessonId}/knowledge/file`,
      headers: { cookie: adminCookie, 'content-type': pdf.contentType },
      payload: pdf.body,
    });
    expect(upPdf.statusCode).toBe(200);
    const pdfId = json<{ id: number }>(upPdf).id;

    const dlPdf = await app.inject({
      method: 'GET',
      url: `/api/v1/knowledge/${pdfId}/file`,
      headers: { cookie: studentCookie },
    });
    expect(dlPdf.headers['content-disposition']).toContain('inline');
    expect(dlPdf.headers['content-type']).toContain('application/pdf');

    const png = multipart([
      {
        name: 'file',
        filename: '图示.png',
        contentType: 'image/png',
        data: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
      },
    ]);
    const upPng = await app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${lessonId}/knowledge/file`,
      headers: { cookie: adminCookie, 'content-type': png.contentType },
      payload: png.body,
    });
    expect(upPng.statusCode).toBe(200);
  });

  it('历史遗留的 HTML 附件被强制以附件下载（而非内联执行）', async () => {
    // 模拟 V1 时期已经落盘、绕过当前白名单的文件
    const dir = path.join(dataDir, 'uploads', 'knowledge');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'legacy.html'), '<script>alert(1)</script>');
    const knowledgeId = json<{ id: number }>(
      await app.inject({
        method: 'POST',
        url: `/api/v1/lessons/${lessonId}/knowledge`,
        headers: { cookie: adminCookie },
        payload: { title: '遗留 HTML 课件', kind: 'file', fileName: 'legacy.html', filePath: 'knowledge/legacy.html' },
      }),
    ).id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/knowledge/${knowledgeId}/file`,
      headers: { cookie: studentCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    // 关键：必须 attachment，避免同源脚本执行
    expect(res.headers['content-disposition']).toContain('attachment');
  });

  it('响应带 nosniff，避免浏览器猜测类型', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/knowledge/${questionId}/file`,
      headers: { cookie: adminCookie },
    });
    // 该 id 不是知识点文件，返回 404 也应有安全头
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('安全：CSRF（Origin 校验）与 CSP', () => {
  it('跨站 Origin 的写请求被拒绝（403）', async () => {
    const cases: [string, string][] = [
      ['POST', '/api/v1/auth/login'],
      ['POST', '/api/v1/courses'],
      ['PUT', '/api/v1/settings'],
      ['DELETE', '/api/v1/lessons/1'],
    ];
    for (const [method, url] of cases) {
      const res = await app.inject({
        method: method as 'POST' | 'PUT' | 'DELETE',
        url,
        headers: { origin: 'https://evil.example.com', cookie: adminCookie },
        payload: {},
      });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(json<{ error: { code: string } }>(res).error.code).toBe('FORBIDDEN');
    }
  });

  it('同源写请求正常放行（Host 与 Origin 一致）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/courses',
      headers: { origin: 'http://localhost:80', cookie: adminCookie, host: 'localhost:80' },
      payload: { name: '同源创建的课程', published: true },
    });
    expect(res.statusCode).toBe(200);
  });

  it('反代场景下 x-forwarded-host/proto 与 Origin 一致时放行', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/courses',
      headers: {
        origin: 'https://class.example.com',
        'x-forwarded-host': 'class.example.com',
        'x-forwarded-proto': 'https',
        cookie: adminCookie,
      },
      payload: { name: '反代场景课程', published: true },
    });
    expect(res.statusCode).toBe(200);
  });

  it('无 Origin 的客户端（curl / 服务端调用）不受影响', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/courses',
      headers: { cookie: adminCookie },
      payload: { name: '脚本创建的课程', published: true },
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET 等安全方法不校验 Origin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/courses',
      headers: { origin: 'https://evil.example.com', cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it('MC_CSP=1 时下发严格 CSP；默认关闭', async () => {
    const defaultApp = await app.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(defaultApp.headers['content-security-policy']).toBeUndefined();

    const withCsp = await buildApp(
      loadConfig({
        ...process.env,
        MC_ENV: 'test',
        MC_DATA_DIR: dataDir,
        MC_LOG_LEVEL: 'silent',
        MC_CSP: '1',
        MC_ADMIN_PASS: 'admin123',
      }),
      { db: new Db(':memory:') },
    );
    await withCsp.app.ready();
    const res = await withCsp.app.inject({ method: 'GET', url: '/api/v1/meta' });
    const csp = String(res.headers['content-security-policy'] ?? '');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    await withCsp.app.close();
  });
});

describe('安全：限流', () => {
  it('超过窗口内请求上限返回 429 与统一错误信封', async () => {
    const limited = await buildApp(
      loadConfig({
        ...process.env,
        MC_ENV: 'test',
        MC_DATA_DIR: dataDir,
        MC_LOG_LEVEL: 'silent',
        MC_RATE_LIMIT_MAX: '5',
        MC_RATE_LIMIT_WINDOW: '1 minute',
        MC_ADMIN_PASS: 'admin123',
      }),
      { db: new Db(':memory:') },
    );
    await limited.app.ready();
    let sawTooMany = false;
    for (let i = 0; i < 12; i += 1) {
      const res = await limited.app.inject({ method: 'GET', url: '/api/v1/meta' });
      if (res.statusCode === 429) {
        sawTooMany = true;
        expect(json<{ error: { code: string } }>(res).error.code).toBe('RATE_LIMITED');
        break;
      }
    }
    await limited.app.close();
    expect(sawTooMany).toBe(true);
  });
});
