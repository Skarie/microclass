import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';

/**
 * 课时归属管理：媒体文件夹批量导入（可指定/新建课程）与批量改绑。
 * 对应用户诉求：「一个文件夹全部导入，并把该文件夹下的课时归类为一门课程」。
 */
let app: FastifyInstance;
let dataDir: string;
let mediaDir: string;
let adminCookie = '';
let studentCookie = '';
let rootId = '';

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

interface LessonRow {
  id: number;
  title: string;
  group_name: string;
  course_id: number | null;
}

async function lessons(query: string): Promise<LessonRow[]> {
  const res = await app.inject({ method: 'GET', url: `/api/v1/lessons${query}`, headers: { cookie: adminCookie } });
  return json<{ lessons: LessonRow[] }>(res).lessons;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-assign-'));
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-media-'));
  // 造两级文件夹：两个章节各 2 个视频 + 根目录 1 个视频
  for (const [folder, files] of [
    ['第一章 Java 基础', ['01 环境搭建.mp4', '02 语法入门.mp4']],
    ['第二章 面向对象', ['03 类与对象.mp4', '04 继承.mp4']],
  ] as [string, string[]][]) {
    fs.mkdirSync(path.join(mediaDir, folder), { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(mediaDir, folder, f), Buffer.from('x'));
  }
  fs.writeFileSync(path.join(mediaDir, '00 课程介绍.mp4'), Buffer.from('x'));

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

  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username: `asg_${Date.now().toString(36)}`, password: 'pass1234' },
  });
  studentCookie = `microclass_sid=${reg.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;

  const root = await app.inject({
    method: 'POST',
    url: '/api/v1/media-roots',
    headers: { cookie: adminCookie },
    payload: { name: '测试视频库', path: mediaDir },
  });
  rootId = json<{ root: { id: string } }>(root).root.id;
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(mediaDir, { recursive: true, force: true });
});

describe('媒体文件夹导入：子文件夹 → 章节', () => {
  it('扫描能看到文件夹结构与视频数', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/media-roots/${rootId}/scan`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = json<{ folders: { folder: string; videos: string[] }[]; total: number }>(res);
    expect(body.total).toBe(5);
    // scan 会同时返回根层（folder=''）与各子文件夹\n    expect(body.folders.map((f) => f.folder).sort()).toEqual(['', '第一章 Java 基础', '第二章 面向对象']);
  });

  it('用文件夹名新建课程并一次性导入（一个文件夹 = 一门课程）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/media-roots/${rootId}/import`,
      headers: { cookie: adminCookie },
      payload: { courseName: 'Java 入门（文件夹导入）' },
    });
    expect(res.statusCode).toBe(200);
    const body = json<{ added: number; skipped: number; folders: number; course: { id: number; name: string } }>(res);
    expect(body.added).toBe(5);
    expect(body.skipped).toBe(0);
    expect(body.folders).toBe(3);
    expect(body.course.name).toBe('Java 入门（文件夹导入）');

    const rows = await lessons(`?course=${body.course.id}`);
    expect(rows.length).toBe(5);
    // 子文件夹成为章节
    const chapters = [...new Set(rows.map((r) => r.group_name))].sort();
    expect(chapters).toEqual(['', '第一章 Java 基础', '第二章 面向对象']);
    expect(rows.every((r) => r.course_id === body.course.id)).toBe(true);
  });

  it('导入到已有课程时不会重复创建课程；重复导入会跳过', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/courses',
      headers: { cookie: adminCookie },
      payload: { name: '已存在的课程', published: true },
    });
    const courseId = json<{ id: number }>(created).id;

    // 换一个只有 1 个视频的空文件夹导入，避免与上一用例的重复判定互相干扰
    const sub = path.join(mediaDir, '第三章 集合');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, '05 List.mp4'), Buffer.from('x'));
    const before = await lessons(`?course=${courseId}`);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/media-roots/${rootId}/import`,
      headers: { cookie: adminCookie },
      payload: { path: '第三章 集合', courseId },
    });
    expect(res.statusCode).toBe(200);
    const body = json<{ added: number; course: unknown }>(res);
    expect(body.added).toBe(1);
    expect(body.course).toBeNull();

    const after = await lessons(`?course=${courseId}`);
    expect(after.length).toBe(before.length + 1);
    // 选中的文件夹自身成为章节名
    expect(after.some((l) => l.title === '05 List' && l.group_name === '第三章 集合')).toBe(true);

    // 再导一次：重复视频被跳过
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/media-roots/${rootId}/import`,
      headers: { cookie: adminCookie },
      payload: { path: '第三章 集合', courseId },
    });
    expect(json<{ added: number; skipped: number }>(again)).toMatchObject({ added: 0, skipped: 1 });
  });

  it('onDuplicate=assign：把已存在的课时收编到目标课程（先导入、后建课程的真实场景）', async () => {
    // 1) 先整包导入但**不归类**（这就是用户先做的操作）
    const seeded = await app.inject({
      method: 'POST',
      url: `/api/v1/media-roots/${rootId}/import`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(seeded.statusCode).toBe(200);
    expect(json<{ added: number }>(seeded).added).toBeGreaterThan(0);

    // 2) 之后才新建课程，并按默认 skip 再导一次：一个都进不来（这正是此前的困惑点）
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/courses',
      headers: { cookie: adminCookie },
      payload: { name: '事后建的课程', published: true },
    });
    const courseId = json<{ id: number }>(created).id;

    const skippedRun = await app.inject({
      method: 'POST',
      url: `/api/v1/media-roots/${rootId}/import`,
      headers: { cookie: adminCookie },
      payload: { courseId },
    });
    expect(json<{ added: number; assigned?: number }>(skippedRun)).toMatchObject({ added: 0 });

    // 3) 选「收编」再导一次：已有课时被改绑到该课程，章节按文件夹名设置
    const claimRun = await app.inject({
      method: 'POST',
      url: `/api/v1/media-roots/${rootId}/import`,
      headers: { cookie: adminCookie },
      payload: { courseId, onDuplicate: 'assign' },
    });
    expect(claimRun.statusCode).toBe(200);
    const claimed = json<{ added: number; assigned: number; skipped: number }>(claimRun);
    expect(claimed.added).toBe(0);
    expect(claimed.assigned).toBeGreaterThan(0);

    const rows = await lessons(`?course=${courseId}`);
    expect(rows.length).toBe(claimed.assigned);
    // 章节按文件夹名归类（根层文件用媒体目录名或空、子文件夹用文件夹名）
    expect(rows.some((l) => l.group_name === '第三章 集合')).toBe(true);
    expect(rows.some((l) => l.group_name === '第一章 Java 基础')).toBe(true);
  });

  it('onDuplicate 取值非法时拒绝（400）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/media-roots/${rootId}/import`,
      headers: { cookie: adminCookie },
      payload: { courseId: 1, onDuplicate: 'merge' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('courseId 与 courseName 同时传被拒绝（400）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/media-roots/${rootId}/import`,
      headers: { cookie: adminCookie },
      payload: { courseId: 1, courseName: '冲突' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('学生不能导入（403）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/media-roots/${rootId}/import`,
      headers: { cookie: studentCookie },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('网页直接上传视频（无需挂载宿主机目录）', () => {
  function videoForm(
    fields: { name: string; value: string }[],
    file: { filename: string; contentType: string; data: Buffer },
  ): { body: Buffer; contentType: string } {
    const boundary = '----mc-upload-boundary';
    const chunks: Buffer[] = [];
    for (const f of fields) {
      chunks.push(
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"\r\n\r\n${f.value}\r\n`),
      );
    }
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      ),
      file.data,
      Buffer.from('\r\n'),
    );
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
  }

  it('上传视频即建成课时，并自动登记到「站内上传」媒体目录', async () => {
    const form = videoForm([{ name: 'groupName', value: '第一章 上传测试' }], {
      filename: '第01讲 变量.mp4',
      contentType: 'video/mp4',
      data: Buffer.from('fake-mp4-bytes-0123456789'),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/lessons/upload',
      headers: { cookie: adminCookie, 'content-type': form.contentType },
      payload: form.body,
    });
    expect(res.statusCode).toBe(200);
    const body = json<{ ok: boolean; id: number; size: number; fileName: string }>(res);
    expect(body.fileName).toBe('第01讲 变量.mp4');
    expect(body.size).toBeGreaterThan(0);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${body.id}`,
      headers: { cookie: adminCookie },
    });
    const lesson = json<{
      lesson: { title: string; video_kind: string; media_root: string; group_name: string };
    }>(detail).lesson;
    expect(lesson.title).toBe('第01讲 变量'); // 去掉扩展名
    expect(lesson.video_kind).toBe('local');
    expect(lesson.media_root).toBe('uploads');
    expect(lesson.group_name).toBe('第一章 上传测试');

    // 站内上传目录应出现在媒体目录列表里且标记为内置
    const roots = await app.inject({ method: 'GET', url: '/api/v1/media-roots', headers: { cookie: adminCookie } });
    const uploadRoot = json<{ mediaRoots: { id: string; internal?: boolean }[] }>(roots).mediaRoots.find(
      (r) => r.id === 'uploads',
    );
    expect(uploadRoot?.internal).toBe(true);

    // 内置目录不允许移除
    const remove = await app.inject({
      method: 'DELETE',
      url: '/api/v1/media-roots/uploads',
      headers: { cookie: adminCookie },
    });
    expect(remove.statusCode).toBe(400);

    // 上传的视频可通过既有的 Range 流播放
    const play = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${body.id}/video`,
      headers: { cookie: adminCookie, range: 'bytes=0-3' },
    });
    expect(play.statusCode).toBe(206);
    expect(play.headers['content-type']).toContain('video/mp4');
    expect(Buffer.from(play.rawPayload).toString()).toBe('fake');
  });

  it('拖拽整个文件夹上传时按相对路径自动分章', async () => {
    const form = videoForm([{ name: 'relPath', value: '第二章 集合/01 List.mp4' }], {
      filename: '01 List.mp4',
      contentType: 'video/mp4',
      data: Buffer.from('x'.repeat(64)),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/lessons/upload',
      headers: { cookie: adminCookie, 'content-type': form.contentType },
      payload: form.body,
    });
    expect(res.statusCode).toBe(200);
    const id = json<{ id: number }>(res).id;
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${id}`,
      headers: { cookie: adminCookie },
    });
    expect(json<{ lesson: { group_name: string } }>(detail).lesson.group_name).toBe('第二章 集合');
  });

  it('拒绝非视频扩展名（即使 content-type 伪装成 video/mp4）', async () => {
    const form = videoForm([], {
      filename: 'evil.mp4.exe',
      contentType: 'video/mp4',
      data: Buffer.from('not a video'),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/lessons/upload',
      headers: { cookie: adminCookie, 'content-type': form.contentType },
      payload: form.body,
    });
    expect(res.statusCode).toBe(400);
  });

  it('不存在的目标课程被拒绝（400）', async () => {
    const form = videoForm([{ name: 'courseId', value: '999999' }], {
      filename: 'v.mp4',
      contentType: 'video/mp4',
      data: Buffer.from('x'.repeat(16)),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/lessons/upload',
      headers: { cookie: adminCookie, 'content-type': form.contentType },
      payload: form.body,
    });
    expect(res.statusCode).toBe(400);
  });

  it('学生不能上传（403），未登录 401', async () => {
    const form = videoForm([], {
      filename: 'v.mp4',
      contentType: 'video/mp4',
      data: Buffer.from('x'.repeat(16)),
    });
    const asStudent = await app.inject({
      method: 'POST',
      url: '/api/v1/lessons/upload',
      headers: { cookie: studentCookie, 'content-type': form.contentType },
      payload: form.body,
    });
    expect(asStudent.statusCode).toBe(403);

    const anon = await app.inject({
      method: 'POST',
      url: '/api/v1/lessons/upload',
      headers: { 'content-type': form.contentType },
      payload: form.body,
    });
    expect(anon.statusCode).toBe(401);
  });
});

describe('课时批量改绑', () => {
  it('把未归类课时批量挂到课程并统一章节名', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/courses',
      headers: { cookie: adminCookie },
      payload: { name: '批量改绑目标课程', published: true },
    });
    const courseId = json<{ id: number }>(created).id;

    // 直接创建 5 个未归类课时（不依赖媒体导入的重复判定，保证确定性）
    const ids: number[] = [];
    for (let i = 1; i <= 5; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/lessons',
        headers: { cookie: adminCookie },
        payload: { title: `批量改绑样例 ${i}`, videoKind: 'url', videoPath: `https://example.com/assign-${i}.mp4` },
      });
      expect(res.statusCode).toBe(200);
      ids.push(json<{ id: number }>(res).id);
    }
    expect((await lessons('?course=orphan')).length).toBeGreaterThanOrEqual(5);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/lessons/batch-assign',
      headers: { cookie: adminCookie },
      payload: { lessonIds: ids, courseId, groupName: '第一章 批量归入' },
    });
    expect(res.statusCode).toBe(200);
    expect(json<{ updated: number; courseId: number; groupName: string }>(res)).toMatchObject({
      updated: ids.length,
      courseId,
      groupName: '第一章 批量归入',
    });

    const moved = await lessons(`?course=${courseId}`);
    expect(moved.length).toBe(ids.length);
    expect(moved.every((l) => l.group_name === '第一章 批量归入')).toBe(true);
    // 本批课时不应再出现在未归类里（其他用例可能另有未归类课时，故只断言本批）
    const stillOrphan = (await lessons('?course=orphan')).filter((l) => ids.includes(l.id));
    expect(stillOrphan).toEqual([]);
  });

  it('不传 groupName 时保留各自原章节', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/courses',
      headers: { cookie: adminCookie },
      payload: { name: '保留章节的课程', published: true },
    });
    const courseId = json<{ id: number }>(created).id;

    // 先在这门课程下建两条不同章节的课时
    const rows: LessonRow[] = [];
    for (const [title, group] of [
      ['保留章节 A', '第一章 集合'],
      ['保留章节 B', '第二章 泛型'],
    ] as [string, string][]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/lessons',
        headers: { cookie: adminCookie },
        payload: {
          title,
          videoKind: 'url',
          videoPath: `https://example.com/${encodeURIComponent(title)}.mp4`,
          courseId,
          groupName: group,
        },
      });
      expect(res.statusCode).toBe(200);
      rows.push({ id: json<{ id: number }>(res).id, title, group_name: group, course_id: courseId });
    }
    const chaptersBefore = rows.map((l) => l.group_name).sort();

    const target = await app.inject({
      method: 'POST',
      url: '/api/v1/courses',
      headers: { cookie: adminCookie },
      payload: { name: '另一个课程', published: true },
    });
    const targetId = json<{ id: number }>(target).id;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/lessons/batch-assign',
      headers: { cookie: adminCookie },
      payload: { lessonIds: rows.map((l) => l.id), courseId: targetId },
    });
    expect(res.statusCode).toBe(200);

    const movedRows = await lessons(`?course=${targetId}`);
    expect(movedRows.map((l) => l.group_name).sort()).toEqual(chaptersBefore);
  });

  it('courseId 传 null 可把课时移回「未归类」', async () => {
    const anyCourse = await app.inject({
      method: 'GET',
      url: '/api/v1/lessons',
      headers: { cookie: adminCookie },
    });
    const first = json<{ lessons: LessonRow[] }>(anyCourse).lessons.find((l) => l.course_id !== null);
    expect(first).toBeDefined();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/lessons/batch-assign',
      headers: { cookie: adminCookie },
      payload: { lessonIds: [first?.id], courseId: null },
    });
    expect(res.statusCode).toBe(200);
    const orphans = await lessons('?course=orphan');
    expect(orphans.some((l) => l.id === first?.id)).toBe(true);
  });

  it('参数校验：空列表 / 不存在的课程 / 不存在的课时 / 学生越权', async () => {
    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/lessons/batch-assign',
      headers: { cookie: adminCookie },
      payload: { lessonIds: [], courseId: null },
    });
    expect(empty.statusCode).toBe(400);

    const badCourse = await app.inject({
      method: 'POST',
      url: '/api/v1/lessons/batch-assign',
      headers: { cookie: adminCookie },
      payload: { lessonIds: [1], courseId: 999999 },
    });
    expect(badCourse.statusCode).toBe(400);

    const badLesson = await app.inject({
      method: 'POST',
      url: '/api/v1/lessons/batch-assign',
      headers: { cookie: adminCookie },
      payload: { lessonIds: [999999], courseId: null },
    });
    expect(badLesson.statusCode).toBe(404);

    const asStudent = await app.inject({
      method: 'POST',
      url: '/api/v1/lessons/batch-assign',
      headers: { cookie: studentCookie },
      payload: { lessonIds: [1], courseId: null },
    });
    expect(asStudent.statusCode).toBe(403);
  });

  it('批量改绑会写入审计日志', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-logs?limit=50',
      headers: { cookie: adminCookie },
    });
    const logs = json<{ logs: { action: string; detail: string }[] }>(res).logs;
    expect(logs.some((l) => l.action === 'lesson.batch_assign')).toBe(true);
    expect(logs.some((l) => l.action === 'lesson.import_folder')).toBe(true);
  });
});
