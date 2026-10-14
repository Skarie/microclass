import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';
import { normalizeExternalVideoUrl } from '../src/services/lessonService.js';

/**
 * 外部平台视频（video_kind = embed 嵌入 / url 直链）：
 * 老师从 B 站等平台复制到的是**整段 `<iframe>` 代码**，直接存进去浏览器播不了，
 * 因此入库前必须取出 src 并补全协议；同时校验非法输入被拒绝。
 */
describe('外部视频地址归一化（纯函数）', () => {
  it('从整段 iframe 嵌入代码里取出 src', () => {
    const snippet =
      '<iframe src="//player.bilibili.com/player.html?bvid=BV1xx411c7mD&page=1" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true"> </iframe>';
    expect(normalizeExternalVideoUrl(snippet)).toBe('https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&page=1');
  });

  it('协议相对地址（//host/…）补成 https', () => {
    expect(normalizeExternalVideoUrl('//player.bilibili.com/player.html?bvid=BV1')).toBe(
      'https://player.bilibili.com/player.html?bvid=BV1',
    );
  });

  it('普通 http(s) 地址原样保留（含查询串与端口）', () => {
    expect(normalizeExternalVideoUrl('https://cdn.example.com/a/b.mp4?token=x')).toBe(
      'https://cdn.example.com/a/b.mp4?token=x',
    );
    expect(normalizeExternalVideoUrl('  http://10.0.0.5:8080/v.mp4  ')).toBe('http://10.0.0.5:8080/v.mp4');
  });

  it('单引号 / 大写标签的 iframe 同样能识别', () => {
    expect(normalizeExternalVideoUrl("<IFRAME SRC='https://v.qq.com/txp/iframe/player.html?vid=abc'></IFRAME>")).toBe(
      'https://v.qq.com/txp/iframe/player.html?vid=abc',
    );
  });

  it('不可用的输入返回 null（没有 src 的 iframe / 非 http 协议 / 空值 / 超长）', () => {
    expect(normalizeExternalVideoUrl('')).toBeNull();
    expect(normalizeExternalVideoUrl('   ')).toBeNull();
    expect(normalizeExternalVideoUrl('<iframe frameborder="0"></iframe>')).toBeNull();
    expect(normalizeExternalVideoUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeExternalVideoUrl('ftp://example.com/a.mp4')).toBeNull();
    expect(normalizeExternalVideoUrl(`https://example.com/${'a'.repeat(1200)}.mp4`)).toBeNull();
  });
});

describe('外部视频课时：经接口入库时被归一化', () => {
  let app: FastifyInstance;
  let dataDir: string;
  let adminCookie = '';
  let courseId = 0;

  interface LessonRow {
    id: number;
    title: string;
    video_kind: string;
    video_path: string;
    media_root: string;
  }

  async function createLesson(payload: Record<string, unknown>) {
    return await app.inject({
      method: 'POST',
      url: '/api/v1/lessons',
      headers: { cookie: adminCookie },
      payload,
    });
  }

  function json<T>(res: { json: () => unknown }): T {
    return res.json() as T;
  }

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-extvideo-'));
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

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'admin123' },
    });
    adminCookie = `microclass_sid=${login.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;

    const course = await app.inject({
      method: 'POST',
      url: '/api/v1/courses',
      headers: { cookie: adminCookie },
      payload: { name: '外部视频课程', published: true },
    });
    courseId = json<{ id: number }>(course).id;
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('粘贴 B 站嵌入代码：入库的是干净的 https 播放器地址', async () => {
    const res = await createLesson({
      title: '外部嵌入课时',
      videoKind: 'embed',
      videoPath:
        '<iframe src="//player.bilibili.com/player.html?bvid=BV1xx411c7mD&page=1" allowfullscreen="true"></iframe>',
      courseId,
    });
    expect(res.statusCode).toBe(200);
    const id = json<{ id: number }>(res).id;

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons?course=${courseId}`,
      headers: { cookie: adminCookie },
    });
    const lesson = json<{ lessons: LessonRow[] }>(list).lessons.find((l) => l.id === id);
    expect(lesson?.video_kind).toBe('embed');
    expect(lesson?.video_path).toBe('https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&page=1');
  });

  it('外部直链：原样保存，且不需要 media_root', async () => {
    const res = await createLesson({
      title: '外部直链课时',
      videoKind: 'url',
      videoPath: '  https://cdn.example.com/lesson-1.mp4  ',
      courseId,
    });
    expect(res.statusCode).toBe(200);
    const id = json<{ id: number }>(res).id;
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons?course=${courseId}`,
      headers: { cookie: adminCookie },
    });
    const lesson = json<{ lessons: LessonRow[] }>(list).lessons.find((l) => l.id === id);
    expect(lesson?.video_path).toBe('https://cdn.example.com/lesson-1.mp4');
    expect(lesson?.media_root).toBe('');
  });

  it('本地视频不受影响：仍然要求媒体目录 + 真实文件', async () => {
    const res = await createLesson({
      title: '本地课时（缺文件）',
      videoKind: 'local',
      mediaRoot: 'uploads',
      videoPath: '不存在.mp4',
      courseId,
    });
    expect(res.statusCode).toBe(400);
  });

  it('非法外部地址被拒绝，并提示可以粘贴嵌入代码', async () => {
    const bad = await createLesson({
      title: '非法链接课时',
      videoKind: 'embed',
      videoPath: '<iframe frameborder="0"></iframe>',
      courseId,
    });
    expect(bad.statusCode).toBe(400);
    expect(json<{ error: { message: string } }>(bad).error.message).toContain('iframe');

    const js = await createLesson({
      title: 'javascript 协议',
      videoKind: 'url',
      videoPath: 'javascript:alert(1)',
      courseId,
    });
    expect(js.statusCode).toBe(400);
  });

  it('编辑课时同样会归一化（换掉嵌入地址）', async () => {
    const created = await createLesson({
      title: '待改成嵌入',
      videoKind: 'url',
      videoPath: 'https://cdn.example.com/old.mp4',
      courseId,
    });
    const id = json<{ id: number }>(created).id;

    const update = await app.inject({
      method: 'PUT',
      url: `/api/v1/lessons/${id}`,
      headers: { cookie: adminCookie },
      payload: {
        title: '待改成嵌入',
        videoKind: 'embed',
        videoPath: '<iframe src="https://v.qq.com/txp/iframe/player.html?vid=abc"></iframe>',
        courseId,
      },
    });
    expect(update.statusCode).toBe(200);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${id}`,
      headers: { cookie: adminCookie },
    });
    const lesson = json<{ lesson: LessonRow }>(detail).lesson;
    expect(lesson.video_kind).toBe('embed');
    expect(lesson.video_path).toBe('https://v.qq.com/txp/iframe/player.html?vid=abc');
  });

  it('外部视频不需要（也不能）抽取时长/封面', async () => {
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons?course=${courseId}`,
      headers: { cookie: adminCookie },
    });
    const embed = json<{ lessons: LessonRow[] }>(list).lessons.find((l) => l.video_kind === 'embed');
    const probe = await app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${embed?.id}/probe`,
      headers: { cookie: adminCookie },
    });
    expect(probe.statusCode).toBe(400);
    expect(json<{ error: { message: string } }>(probe).error.message).toContain('本地视频');
  });
});
