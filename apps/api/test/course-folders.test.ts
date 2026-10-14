import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';

/**
 * 课程文件夹工作流：先建课程 → 绑定目录 → 扫描导入 → 重新扫描只补新视频，
 * 以及拖拽排序、缺失文件清理。对应用户诉求：
 * 「导入课时就在对应课程里面操作，直接读取目录，以后加了新课扫描一下就好」。
 *
 * 说明：一个文件夹只能绑定一门课程，因此每个用例用自己的目录，互不干扰。
 */
let app: FastifyInstance;
let db: Db;
let dataDir: string;
let mediaDir: string;
let adminCookie = '';
let teacherCookie = '';
let studentCookie = '';
let rootId = '';

interface FolderScanBody {
  dryRun: boolean;
  onDisk: number;
  folders: number;
  added: number;
  assigned: number;
  updated: number;
  skipped: number;
  missing: { id: number; title: string; videoPath: string; source: string }[];
  removed: number;
  total: number;
  newLessonIds: number[];
  folder: { rootId: string; path: string };
}

interface LessonRow {
  id: number;
  title: string;
  group_name: string;
  course_id: number | null;
  source: string;
  sort: number;
  video_path: string;
}

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

/** 直接插一条课时行：用于构造「课时在、磁盘文件不在」这类无法用接口造出来的场景 */
function insertLesson(input: {
  title: string;
  videoPath: string;
  courseId: number;
  source: 'manual' | 'folder';
}): number {
  return db.run(
    `INSERT INTO lessons (title, description, video_kind, media_root, video_path, sort, group_name, course_id, source)
     VALUES (?, '', 'local', ?, ?, 99, '', ?, ?)`,
    [input.title, rootId, input.videoPath, input.courseId, input.source],
  ).lastInsertRowid;
}

/** 目录：Java 课（冲突用例占用）/ 扫描主目录 / 排序目录 / 解绑目录 / 收编目录 / 缺失目录 / 手工目录 */
const JAVA = 'Java 课';
const SCAN = 'Java 程序设计';
const SORT = '排序目录';
const UNBIND = '解绑目录';
const CLAIM = '收编目录';
const MISSING = '缺失目录';
const MANUAL = '手工目录';
const NESTED = '嵌套目录';

function writeMedia(rel: string, content = 'x'): void {
  const abs = path.join(mediaDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.from(content));
}

async function createCourse(cookie: string, name: string): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/courses',
    headers: { cookie },
    payload: { name, published: true },
  });
  expect(res.statusCode).toBe(200);
  return json<{ id: number }>(res).id;
}

async function bindFolder(courseId: number, body: Record<string, unknown>, cookie = adminCookie) {
  return await app.inject({
    method: 'PUT',
    url: `/api/v1/courses/${courseId}/folder`,
    headers: { cookie },
    payload: body,
  });
}

async function scan(courseId: number, body: Record<string, unknown> = {}, cookie = adminCookie) {
  return await app.inject({
    method: 'POST',
    url: `/api/v1/courses/${courseId}/scan`,
    headers: { cookie },
    payload: body,
  });
}

async function manageLessons(courseId: number, cookie = adminCookie): Promise<LessonRow[]> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/courses/${courseId}/manage`,
    headers: { cookie },
  });
  return json<{ lessons: LessonRow[] }>(res).lessons;
}

async function createLocalLesson(input: {
  title: string;
  videoPath: string;
  courseId: number | null;
}): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/lessons',
    headers: { cookie: adminCookie },
    payload: {
      title: input.title,
      videoKind: 'local',
      mediaRoot: rootId,
      videoPath: input.videoPath,
      courseId: input.courseId,
    },
  });
  expect(res.statusCode).toBe(200);
  return json<{ id: number }>(res).id;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-folder-'));
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-folder-media-'));
  writeMedia(`${JAVA}/01 课程介绍.mp4`);
  writeMedia(`${JAVA}/第一章 基础/1.1 环境搭建.mp4`);
  writeMedia(`${SCAN}/01 课程介绍.mp4`);
  writeMedia(`${SCAN}/第一章 基础/1.1 环境搭建.mp4`);
  writeMedia(`${SCAN}/第一章 基础/1.2 语法入门.mp4`);
  writeMedia(`${SCAN}/第二章 面向对象/2.1 类与对象.mp4`);
  writeMedia(`${SCAN}/第二章 面向对象/2.2 继承.mp4`);
  writeMedia(`${SORT}/01 甲.mp4`);
  writeMedia(`${SORT}/02 乙.mp4`);
  writeMedia(`${SORT}/03 丙.mp4`);
  writeMedia(`${UNBIND}/唯一一节.mp4`);
  writeMedia(`${CLAIM}/收编.mp4`);
  writeMedia(`${MISSING}/保留.mp4`);
  writeMedia(`${MANUAL}/占位.mp4`);
  writeMedia(`${NESTED}/第一章 甲/1.1 小节/a.mp4`);
  writeMedia(`${NESTED}/第一章 甲/b.mp4`);
  writeMedia(`${NESTED}/第二章 乙/c.mp4`);

  const config = loadConfig({
    ...process.env,
    MC_ENV: 'test',
    MC_DATA_DIR: dataDir,
    MC_LOG_LEVEL: 'silent',
    MC_ADMIN_USER: 'admin',
    MC_ADMIN_PASS: 'admin123',
  });
  const db0 = new Db(':memory:');
  db = db0;
  const built = await buildApp(config, { db: db0 });
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
    payload: { username: `cf_${Date.now().toString(36)}`, password: 'pass1234' },
  });
  studentCookie = `microclass_sid=${reg.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;

  const t = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username: `cft_${Date.now().toString(36)}`, password: 'pass1234' },
  });
  teacherCookie = `microclass_sid=${t.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;
  // 注册接口只建学生账号，提权直接改库
  const teacherId = json<{ user: { id: number } }>(t).user.id;
  db.run("UPDATE users SET role = 'teacher' WHERE id = ?", [teacherId]);

  const root = await app.inject({
    method: 'POST',
    url: '/api/v1/media-roots',
    headers: { cookie: adminCookie },
    payload: { name: '课程视频库', path: mediaDir },
  });
  rootId = json<{ root: { id: string } }>(root).root.id;
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(mediaDir, { recursive: true, force: true });
});

describe('课程文件夹：绑定', () => {
  it('未绑定文件夹时扫描会被明确拒绝（而不是静默导入 0 个）', async () => {
    const courseId = await createCourse(adminCookie, '未绑定课程');
    const res = await scan(courseId);
    expect(res.statusCode).toBe(400);
    expect(json<{ error: { message: string } }>(res).error.message).toContain('绑定视频文件夹');
  });

  it('绑定不存在的文件夹 / 越界路径会被拒绝', async () => {
    const courseId = await createCourse(adminCookie, '路径校验课程');
    expect((await bindFolder(courseId, { rootId, path: '不存在的目录' })).statusCode).toBe(400);
    expect((await bindFolder(courseId, { rootId, path: '../../etc' })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await bindFolder(courseId, { rootId: 'nope', path: '' })).statusCode).toBe(400);
  });

  it('同一个文件夹不能绑定到两门课程', async () => {
    const a = await createCourse(adminCookie, '冲突课程 A');
    const b = await createCourse(adminCookie, '冲突课程 B');
    expect((await bindFolder(a, { rootId, path: JAVA })).statusCode).toBe(200);
    const conflict = await bindFolder(b, { rootId, path: JAVA });
    expect(conflict.statusCode).toBe(409);
    expect(json<{ error: { message: string } }>(conflict).error.message).toContain('已绑定到课程');
  });

  it('学生无权绑定 / 扫描 / 查看管理数据', async () => {
    const courseId = await createCourse(adminCookie, '权限课程');
    expect((await bindFolder(courseId, { rootId, path: JAVA }, studentCookie)).statusCode).toBe(403);
    expect((await scan(courseId, {}, studentCookie)).statusCode).toBe(403);
    const manage = await app.inject({
      method: 'GET',
      url: `/api/v1/courses/${courseId}/manage`,
      headers: { cookie: studentCookie },
    });
    expect(manage.statusCode).toBe(403);
  });
});

describe('课程文件夹：扫描导入', () => {
  let courseId = 0;

  it('先建课程 → 绑定目录 → dryRun 只统计不写库', async () => {
    courseId = await createCourse(adminCookie, '扫描流程课程');
    const bind = await bindFolder(courseId, { rootId, path: SCAN });
    expect(bind.statusCode).toBe(200);
    expect(json<{ folder: { path: string } }>(bind).folder.path).toBe(SCAN);

    const preview = await scan(courseId, { dryRun: true });
    expect(preview.statusCode).toBe(200);
    const body = json<FolderScanBody>(preview);
    expect(body.dryRun).toBe(true);
    expect(body.onDisk).toBe(5);
    expect(body.added).toBe(5);
    expect(await manageLessons(courseId)).toHaveLength(0);
  });

  it('正式扫描：子文件夹 → 章节，文件名 → 课时标题', async () => {
    const body = json<FolderScanBody>(await scan(courseId));
    expect(body.added).toBe(5);
    expect(body.total).toBe(5);
    expect(body.missing).toHaveLength(0);

    const lessons = await manageLessons(courseId);
    expect(lessons).toHaveLength(5);
    expect(lessons.every((l) => l.source === 'folder')).toBe(true);
    expect(lessons.every((l) => l.course_id === courseId)).toBe(true);
    expect(new Set(lessons.map((l) => l.group_name))).toEqual(new Set(['', '第一章 基础', '第二章 面向对象']));
    // 标题去掉扩展名
    expect(lessons.some((l) => l.title === '1.1 环境搭建')).toBe(true);
  });

  it('再次扫描：不重复导入，全部计入 skipped', async () => {
    const body = json<FolderScanBody>(await scan(courseId));
    expect(body.added).toBe(0);
    expect(body.skipped).toBe(5);
    expect(body.total).toBe(5);
    expect(await manageLessons(courseId)).toHaveLength(5);
  });

  it('「以后加了新课」：往文件夹里丢一个新视频，扫描只补这一个', async () => {
    writeMedia(`${SCAN}/第三章 集合/3.1 List.mp4`);

    const body = json<FolderScanBody>(await scan(courseId));
    expect(body.added).toBe(1);
    expect(body.skipped).toBe(5);
    expect(body.total).toBe(6);

    const lessons = await manageLessons(courseId);
    const fresh = lessons.find((l) => l.title === '3.1 List');
    expect(fresh?.group_name).toBe('第三章 集合');
    // 本课程原本没有该章节 → 新课时追加到同章节（此处即末尾），不打乱已有顺序
    expect(lessons[lessons.length - 1]?.title).toBe('3.1 List');
  });

  it('新视频插到同章节的最后一条之后，而不是乱序插入', async () => {
    writeMedia(`${SCAN}/第一章 基础/1.3 补充.mp4`);
    const body = json<FolderScanBody>(await scan(courseId));
    expect(body.added).toBe(1);

    const titles = (await manageLessons(courseId)).map((l) => l.title);
    expect(titles.indexOf('1.3 补充')).toBe(titles.indexOf('1.2 语法入门') + 1);
  });
});

describe('课程文件夹：收编与缺失', () => {
  it('同一路径的课时若挂在别的课程下，扫描时收编到本课程', async () => {
    const owner = await createCourse(adminCookie, '临时归属课程');
    const target = await createCourse(adminCookie, '收编目标课程');
    const lessonId = await createLocalLesson({
      title: '手工挂的课时',
      videoPath: `${CLAIM}/收编.mp4`,
      courseId: owner,
    });

    expect((await bindFolder(target, { rootId, path: CLAIM })).statusCode).toBe(200);
    const body = json<FolderScanBody>(await scan(target));
    expect(body.assigned).toBe(1);

    const moved = (await manageLessons(target)).find((l) => l.id === lessonId);
    expect(moved?.course_id).toBe(target);
    // 手工课时的来源不会被改写成 folder（否则下次扫描会把它当成可清理的扫描课时）
    expect(moved?.source).toBe('manual');
  });

  it('课时对应的文件已不在磁盘上：先报告 missing，确认后才清理（只清理扫描导入的课时）', async () => {
    const courseId = await createCourse(adminCookie, '缺失清理课程');
    await bindFolder(courseId, { rootId, path: MISSING });
    expect(json<FolderScanBody>(await scan(courseId)).added).toBe(1);

    // 模拟「视频被手工从磁盘删掉了」：直接插一条指向不存在文件的扫描课时
    insertLesson({ title: '待删除', videoPath: `${MISSING}/待删除.mp4`, courseId, source: 'folder' });

    const preview = json<FolderScanBody>(await scan(courseId, { dryRun: true }));
    expect(preview.missing.map((m) => m.title)).toContain('待删除');
    expect(preview.removed).toBe(0);
    expect(await manageLessons(courseId)).toHaveLength(2);

    const applied = json<FolderScanBody>(await scan(courseId, { removeMissing: true }));
    expect(applied.removed).toBe(1);
    expect(applied.total).toBe(1);
  });

  it('手工建在同一目录下的课时绝不会被自动删除', async () => {
    const courseId = await createCourse(adminCookie, '保护手工课时');
    await bindFolder(courseId, { rootId, path: MANUAL });
    await scan(courseId);
    // 手工课时指向一个磁盘上不存在的文件：只应被提示，不该被清理
    const manualId = insertLesson({
      title: '手工课时（文件不在磁盘上）',
      videoPath: `${MANUAL}/手工文件.mp4`,
      courseId,
      source: 'manual',
    });

    const body = json<FolderScanBody>(await scan(courseId, { removeMissing: true }));
    expect(body.missing.some((m) => m.id === manualId && m.source === 'manual')).toBe(true);
    expect(body.removed).toBe(0);
    expect((await manageLessons(courseId)).some((l) => l.id === manualId)).toBe(true);
  });
});

describe('课程课时：拖拽排序', () => {
  let courseId = 0;

  it('保存排序后列表顺序与提交顺序一致', async () => {
    courseId = await createCourse(adminCookie, '排序课程');
    await bindFolder(courseId, { rootId, path: SORT });
    await scan(courseId);

    const before = await manageLessons(courseId);
    expect(before).toHaveLength(3);
    const reversed = [...before].reverse().map((l) => l.id);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/courses/${courseId}/lessons/order`,
      headers: { cookie: adminCookie },
      payload: { ids: reversed },
    });
    expect(res.statusCode).toBe(200);
    expect(json<{ updated: number }>(res).updated).toBe(3);

    const after = await manageLessons(courseId);
    expect(after.map((l) => l.id)).toEqual(reversed);
    expect(after.map((l) => l.sort)).toEqual([0, 1, 2]);
  });

  it('排序列表与课程课时不一致时拒绝（避免部分排序造成错乱）', async () => {
    const lessons = await manageLessons(courseId);
    const partial = await app.inject({
      method: 'PUT',
      url: `/api/v1/courses/${courseId}/lessons/order`,
      headers: { cookie: adminCookie },
      payload: { ids: lessons.slice(0, 2).map((l) => l.id) },
    });
    expect(partial.statusCode).toBe(400);

    const dup = await app.inject({
      method: 'PUT',
      url: `/api/v1/courses/${courseId}/lessons/order`,
      headers: { cookie: adminCookie },
      payload: { ids: lessons.map(() => lessons[0]?.id) },
    });
    expect(dup.statusCode).toBe(400);

    const notArray = await app.inject({
      method: 'PUT',
      url: `/api/v1/courses/${courseId}/lessons/order`,
      headers: { cookie: adminCookie },
      payload: { ids: 'nope' },
    });
    expect(notArray.statusCode).toBe(400);
  });

  it('拖拽排序教师可用、学生不可用', async () => {
    const ids = (await manageLessons(courseId)).map((l) => l.id);
    const ok = await app.inject({
      method: 'PUT',
      url: `/api/v1/courses/${courseId}/lessons/order`,
      headers: { cookie: teacherCookie },
      payload: { ids },
    });
    expect(ok.statusCode).toBe(200);

    const denied = await app.inject({
      method: 'PUT',
      url: `/api/v1/courses/${courseId}/lessons/order`,
      headers: { cookie: studentCookie },
      payload: { ids },
    });
    expect(denied.statusCode).toBe(403);
  });
});

describe('章节怎么定：第一层目录 / 完整层级 / 不设章节', () => {
  let courseId = 0;

  it('默认取第一层目录（素材是「章/节/视频」时不会一节一个章节）', async () => {
    courseId = await createCourse(adminCookie, 'NESTED 章节策略');
    await bindFolder(courseId, { rootId, path: NESTED });
    const body = json<FolderScanBody>(await scan(courseId));
    expect(body.added).toBe(3);

    const lessons = await manageLessons(courseId);
    // 第一章 甲/1.1 小节/a.mp4 → 章节「第一章 甲」；章目录下的直接文件也是「第一章 甲」
    expect(lessons.map((l) => l.group_name)).toEqual(['第一章 甲', '第一章 甲', '第二章 乙']);
    // video_path 仍是相对媒体根的完整路径（播放按它定位文件）
    expect([...lessons.map((l) => l.video_path)].sort()).toEqual([
      `${NESTED}/第一章 甲/1.1 小节/a.mp4`,
      `${NESTED}/第一章 甲/b.mp4`,
      `${NESTED}/第二章 乙/c.mp4`,
    ]);
  });

  it('改成「完整目录层级」后重新扫描：章节名同步成完整相对路径', async () => {
    const dry = json<FolderScanBody>(await scan(courseId, { dryRun: true, chapterMode: 'full' }));
    expect(dry.added).toBe(0);
    expect(dry.updated).toBe(1); // 只有嵌套那一层需要改章节名

    const applied = json<FolderScanBody>(await scan(courseId, { chapterMode: 'full' }));
    expect(applied.updated).toBe(1);
    const chapters = (await manageLessons(courseId)).map((l) => l.group_name);
    expect(chapters.sort()).toEqual(['第一章 甲', '第一章 甲/1.1 小节', '第二章 乙'].sort());
  });

  it('改成「不设章节」后重新扫描：全部归入未分章', async () => {
    const applied = json<FolderScanBody>(await scan(courseId, { chapterMode: 'none' }));
    expect(applied.updated).toBe(3);
    expect((await manageLessons(courseId)).every((l) => l.group_name === '')).toBe(true);
  });

  it('手工课时的章节不受扫描策略影响', async () => {
    const manualId = await createLocalLesson({
      title: '手工课时（自定义章节）',
      videoPath: `${NESTED}/第二章 乙/c.mp4`,
      courseId,
    });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/lessons/${manualId}`,
      headers: { cookie: adminCookie },
      payload: {
        title: '手工课时（自定义章节）',
        videoKind: 'local',
        mediaRoot: rootId,
        videoPath: `${NESTED}/第二章 乙/c.mp4`,
        groupName: '我自己定的章节',
        courseId,
      },
    });
    await scan(courseId, { chapterMode: 'first' });
    const manual = (await manageLessons(courseId)).find((l) => l.id === manualId);
    expect(manual?.group_name).toBe('我自己定的章节');
  });

  it('非法 chapterMode 被拒绝', async () => {
    const res = await scan(courseId, { chapterMode: 'deep' });
    expect(res.statusCode).toBe(400);
    expect(json<{ error: { message: string } }>(res).error.message).toContain('chapterMode');
  });
});

describe('课程文件夹：解绑与展示', () => {
  it('manage 返回绑定信息；解绑后课时仍在，只是不再联动', async () => {
    const courseId = await createCourse(adminCookie, '解绑课程');
    await bindFolder(courseId, { rootId, path: UNBIND });
    await scan(courseId);

    const manage = json<{ folder: { rootId: string; path: string; available: boolean; lastScanAt: number | null } }>(
      await app.inject({ method: 'GET', url: `/api/v1/courses/${courseId}/manage`, headers: { cookie: adminCookie } }),
    );
    expect(manage.folder.rootId).toBe(rootId);
    expect(manage.folder.path).toBe(UNBIND);
    expect(manage.folder.available).toBe(true);
    expect(manage.folder.lastScanAt).toBeGreaterThan(0);

    const unbound = await bindFolder(courseId, { rootId: null });
    expect(unbound.statusCode).toBe(200);
    expect(json<{ folder: unknown }>(unbound).folder).toBeNull();
    expect(await manageLessons(courseId)).toHaveLength(1);
    expect((await scan(courseId)).statusCode).toBe(400);
  });
});
