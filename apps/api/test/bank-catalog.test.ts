/**
 * 题库按课程归属与目录树：
 *   - `POST /banks/rebind-courses`：课时推导 + 册次匹配，匹配不上的如实报告；
 *   - `GET /banks/catalog`：课程列表（第一层）与「课程 → 章节 → 小节 → 题库」目录；
 *   - `GET /banks?courseId=`：按课程/未归属筛选题库。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';
import {
  bookKeyOfCourseName,
  chapterKeyFromBankName,
  normalizeBookKey,
} from '../src/db/repositories/bankRepository.js';
import { hashPassword, newSalt } from '../src/security/password.js';

let app: FastifyInstance;
let db: Db;
let deps: Awaited<ReturnType<typeof buildApp>>['deps'];
let dataDir: string;
let cookie = '';
let studentCookie = '';

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
  return `microclass_sid=${res.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-catalog-'));
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

  // 两门课：一门数学（册次可匹配），一门语文（册次匹配不上）
  db.run('INSERT INTO courses (id, name) VALUES (1, ?)', ['小学数学·三年级上册（新）']);
  db.run('INSERT INTO courses (id, name) VALUES (2, ?)', ['初中语文·七年级上册']);
  db.run('INSERT INTO lessons (id, title, course_id, group_name, sort) VALUES (1, ?, 1, ?, 1)', [
    '1 时、分、秒',
    '一 时、分、秒',
  ]);
  db.run('INSERT INTO lessons (id, title, course_id, group_name, sort) VALUES (2, ?, 1, ?, 2)', [
    '2 时间的计算',
    '一 时、分、秒',
  ]);
  db.run('INSERT INTO lessons (id, title, course_id, group_name, sort) VALUES (3, ?, 1, ?, 3)', ['3 测量', '二 测量']);

  // 课时配套题库（挂课时，无 course_id → 由 rebind 推导）
  db.run('INSERT INTO banks (id, name, lesson_id, kind, subject, book) VALUES (1, ?, 1, ?, ?, ?)', [
    '一 时、分、秒 · 1 时、分、秒',
    'lesson',
    '数学',
    '三年级上册（新）',
  ]);
  db.run('INSERT INTO banks (id, name, lesson_id, kind, subject, book) VALUES (2, ?, 2, ?, ?, ?)', [
    '一 时、分、秒 · 2 时间的计算',
    'lesson',
    '数学',
    '三年级上册（新）',
  ]);
  // 章节题库 / 整卷试卷（不挂课时，靠 book 匹配；归章看题库名第二段）
  db.run('INSERT INTO banks (id, name, kind, subject, book) VALUES (3, ?, ?, ?, ?)', [
    '三年级上册（新） · 一 时、分、秒 · 时间的推算',
    'chapter',
    '数学',
    '三年级上册（新）',
  ]);
  db.run('INSERT INTO banks (id, name, kind, subject, book) VALUES (4, ?, ?, ?, ?)', [
    '三年级上册（新） · 一 时、分、秒 · 期末测评',
    'paper',
    '数学',
    '三年级上册（新）',
  ]);
  // 匹配不上任何课程的（册次名对不上）
  db.run('INSERT INTO banks (id, name, kind, subject, book) VALUES (5, ?, ?, ?, ?)', [
    '未知册次题库',
    'chapter',
    '物理',
    '九年级全一册（外研版）',
  ]);

  // 原生 SQL 造题绕过了写路径，按运维脚本同样的做法重算一次题库题量（迁移 0019 的预计算列）
  for (const bankId of [1, 2, 3, 4, 5]) {
    db.run(
      `INSERT INTO questions (bank_id, type, stem, options, answer, difficulty, content_hash)
       VALUES (?, 'fill', ?, '[]', '1', 'easy', ?)`,
      [bankId, `题库 ${bankId} 的题`, `hash-${bankId}`],
    );
  }
  deps.questions.fixBankQuestionCounts();
});

afterAll(async () => {
  await app.close();
});

describe('册次匹配的辅助函数', () => {
  it('课程名 → 册次关键字', () => {
    expect(bookKeyOfCourseName('小学数学·三年级上册（新）')).toBe('三年级上册（新）');
    expect(bookKeyOfCourseName('高中数学·新必修1')).toBe('新必修1');
    expect(bookKeyOfCourseName('三年级上册数学')).toBe('三年级上册');
    expect(bookKeyOfCourseName('java')).toBe('');
  });

  it('册次写法归一化：必修一 = 新必修1 = 必修第二册', () => {
    expect(normalizeBookKey('必修一')).toBe('必修1');
    expect(normalizeBookKey('新必修1')).toBe('必修1');
    expect(normalizeBookKey('必修第二册')).toBe('必修2');
    expect(normalizeBookKey('选择性必修一')).toBe('选择性必修1');
    // 中文数字统一成阿拉伯数字（两侧都归一化，所以册次仍能对上）
    expect(normalizeBookKey('三年级上册（新）')).toBe('3年级上（新）');
  });

  it('章节题库归章依据：题库名的第二段', () => {
    expect(chapterKeyFromBankName('三年级上册（新） · 一 时、分、秒 · 时间的推算')).toBe('一 时、分、秒');
    expect(chapterKeyFromBankName('单独一段')).toBe('单独一段');
    expect(chapterKeyFromBankName('')).toBe('');
  });
});

describe('归属回填', () => {
  it('课时推导 + 册次匹配，匹配不上的如实报出来', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/banks/rebind-courses', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = json<{
      byLesson: number;
      byBook: number;
      unmatched: number;
      unmatchedBooks: { book: string; banks: number }[];
      binding: { bound: number; unbound: number; banks: number };
    }>(res);
    expect(body.byLesson).toBe(2); // 两个课时配套题库
    expect(body.byBook).toBe(2); // 章节题库 + 整卷试卷
    expect(body.unmatched).toBe(1);
    expect(body.unmatchedBooks[0]?.book).toContain('九年级全一册');
    expect(body.binding).toMatchObject({ bound: 4, unbound: 1, banks: 5 });

    const rows = db.all<{ id: number; course_id: number | null }>('SELECT id, course_id FROM banks ORDER BY id');
    expect(rows.map((r) => r.course_id)).toEqual([1, 1, 1, 1, null]);
  });

  it('重复执行是幂等的（不会反复改）', async () => {
    const first = json<{ byLesson: number; byBook: number }>(
      await app.inject({ method: 'POST', url: '/api/v1/banks/rebind-courses', headers: { cookie } }),
    );
    expect(first.byLesson + first.byBook).toBe(0);
  });
});

describe('目录树', () => {
  it('第一层：课程列表带题库数/题量 + 未归属统计', async () => {
    const res = json<{
      courses: { id: number; name: string; bankCount: number; questionCount: number; chapterCount: number }[];
      unbound: { bankCount: number; questionCount: number };
      binding: { bound: number; unbound: number; banks: number };
    }>(await app.inject({ method: 'GET', url: '/api/v1/banks/catalog', headers: { cookie } }));
    expect(res.courses).toHaveLength(1); // 只有数学课有题库
    expect(res.courses[0]).toMatchObject({ id: 1, bankCount: 4, questionCount: 4, chapterCount: 1 });
    expect(res.unbound.bankCount).toBe(1);
    expect(res.binding).toMatchObject({ bound: 4, unbound: 1, banks: 5 });
  });

  it('第二层：章节 → 小节 → 题库，章节题库/整卷归到对应章节', async () => {
    const res = json<{
      course: { id: number; name: string };
      chapters: {
        name: string;
        lessonCount: number;
        bankCount: number;
        lessons: { id: number; title: string; bankCount: number }[];
        banks: { id: number; name: string; kind: string }[];
      }[];
    }>(await app.inject({ method: 'GET', url: '/api/v1/banks/catalog?courseId=1', headers: { cookie } }));
    expect(res.course.name).toContain('三年级上册');
    const chapterNames = res.chapters.map((c) => c.name);
    expect(chapterNames).toContain('一 时、分、秒');
    const chapter = res.chapters.find((c) => c.name === '一 时、分、秒');
    expect(chapter?.lessons.map((l) => l.id)).toEqual([1, 2]);
    // 章节题库（chapter/paper，未挂课时）按 chapter 归入本章，而不是消失
    expect(chapter?.banks.map((b) => b.id).sort()).toEqual([3, 4]);
    expect(chapter?.bankCount).toBe(4);
    // 没有题库的课时不进树
    expect(res.chapters.flatMap((c) => c.lessons).map((l) => l.id)).not.toContain(3);
  });

  it('课程不存在 → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/banks/catalog?courseId=999', headers: { cookie } });
    expect(res.statusCode).toBe(404);
  });
});

describe('按课程筛选题库', () => {
  it('courseId 过滤 + 未归属过滤', async () => {
    const byCourse = json<{ banks: { id: number }[] }>(
      await app.inject({ method: 'GET', url: '/api/v1/banks?courseId=1', headers: { cookie } }),
    );
    /**
     * 契约变更（有意）：题库列表由 `ORDER BY id` 改为 `ORDER BY id DESC`（新建的排最前）。
     * 原因：真机 1.2 万题库、接口一次只取前 300 条，升序时新建题库 id 最大 → 永远排不进列表，
     * 老师"建完就找不到"。回归用例见 apps/api/test/bank-list-order.test.ts。
     */
    expect(byCourse.banks.map((b) => b.id)).toEqual([4, 3, 2, 1]);

    const unbound = json<{ banks: { id: number }[] }>(
      await app.inject({ method: 'GET', url: '/api/v1/banks?courseId=unbound', headers: { cookie } }),
    );
    expect(unbound.banks.map((b) => b.id)).toEqual([5]);

    const bad = await app.inject({ method: 'GET', url: '/api/v1/banks?courseId=abc', headers: { cookie } });
    expect(bad.statusCode).toBe(400);
  });

  it('手工挂课程与解绑（未归属 ↔ 某门课）', async () => {
    // 把未归属的 #5 挂到课程 1
    const bind = await app.inject({
      method: 'PUT',
      url: '/api/v1/banks/5',
      headers: { cookie },
      payload: { name: '未知册次题库', lessonId: null, courseId: 1 },
    });
    expect(bind.statusCode).toBe(200);
    expect(db.get<{ course_id: number }>('SELECT course_id FROM banks WHERE id = 5')?.course_id).toBe(1);
    const afterBind = json<{ banks: { id: number }[] }>(
      await app.inject({ method: 'GET', url: '/api/v1/banks?courseId=1', headers: { cookie } }),
    );
    expect(afterBind.banks.map((b) => b.id)).toContain(5);

    // 再解绑（courseId: null 必须真的清空，不能被 COALESCE 留住）
    const unbind = await app.inject({
      method: 'PUT',
      url: '/api/v1/banks/5',
      headers: { cookie },
      payload: { name: '未知册次题库', lessonId: null, courseId: null },
    });
    expect(unbind.statusCode).toBe(200);
    expect(db.get<{ course_id: number | null }>('SELECT course_id FROM banks WHERE id = 5')?.course_id).toBeNull();
    const afterUnbind = json<{ banks: { id: number }[] }>(
      await app.inject({ method: 'GET', url: '/api/v1/banks?courseId=unbound', headers: { cookie } }),
    );
    expect(afterUnbind.banks.map((b) => b.id)).toEqual([5]);

    // 不传 courseId 时不动归属（只重命名）
    const rename = await app.inject({
      method: 'PUT',
      url: '/api/v1/banks/1',
      headers: { cookie },
      payload: { name: '一 时、分、秒 · 1 时、分、秒（改名）', lessonId: 1 },
    });
    expect(rename.statusCode).toBe(200);
    expect(db.get<{ course_id: number }>('SELECT course_id FROM banks WHERE id = 1')?.course_id).toBe(1);
  });

  it('分页：默认只取前 N 个题库，并返回总数（全库 1.2 万个，不能一次全拉）', async () => {
    const paged = json<{ banks: { id: number }[]; total: number }>(
      await app.inject({ method: 'GET', url: '/api/v1/banks?limit=2', headers: { cookie } }),
    );
    expect(paged.banks).toHaveLength(2);
    expect(paged.total).toBe(5); // 本测试库里共 5 个题库

    const offset = json<{ banks: { id: number }[]; total: number }>(
      await app.inject({ method: 'GET', url: '/api/v1/banks?limit=2&offset=2', headers: { cookie } }),
    );
    expect(offset.banks).toHaveLength(2);
    expect(offset.banks[0]?.id).not.toBe(paged.banks[0]?.id);
    expect(offset.total).toBe(5);

    const bad = await app.inject({ method: 'GET', url: '/api/v1/banks?limit=abc', headers: { cookie } });
    expect(bad.statusCode).toBe(400);
  });

  it('题量统计用预计算列，与真实题量一致（不再现场扫全表）', async () => {
    const list = json<{ banks: { id: number; question_count: number }[] }>(
      await app.inject({ method: 'GET', url: '/api/v1/banks?limit=50', headers: { cookie } }),
    );
    for (const bank of list.banks) {
      const real = db.get<{ c: number }>('SELECT COUNT(*) AS c FROM questions WHERE bank_id = ?', [bank.id])?.c ?? 0;
      expect(bank.question_count, `题库 ${bank.id} 的题量应与实际一致`).toBe(real);
    }
  });

  it('题量维护：加题/改归属/删题都会同步（迁移 0019 的预计算列）', async () => {
    const bankId = 1;
    const before = db.get<{ question_count: number }>('SELECT question_count FROM banks WHERE id = ?', [
      bankId,
    ])?.question_count;
    const created = json<{ id: number }>(
      await app.inject({
        method: 'POST',
        url: `/api/v1/banks/${bankId}/questions`,
        headers: { cookie },
        payload: { bankId, type: 'fill', stem: '题量维护测试题 $1+1=$____', answer: '2' },
      }),
    );
    expect(
      db.get<{ question_count: number }>('SELECT question_count FROM banks WHERE id = ?', [bankId])?.question_count,
    ).toBe((before ?? 0) + 1);

    // 换题库：旧库 -1、新库 +1
    const otherBefore = db.get<{ question_count: number }>(
      'SELECT question_count FROM banks WHERE id = 5',
    )?.question_count;
    await app.inject({
      method: 'PUT',
      url: `/api/v1/questions/${created.id}`,
      headers: { cookie },
      payload: { bankId: 5, type: 'fill', stem: '题量维护测试题 $1+1=$____', answer: '2' },
    });
    expect(
      db.get<{ question_count: number }>('SELECT question_count FROM banks WHERE id = ?', [bankId])?.question_count,
    ).toBe(before ?? 0);
    expect(db.get<{ question_count: number }>('SELECT question_count FROM banks WHERE id = 5')?.question_count).toBe(
      (otherBefore ?? 0) + 1,
    );

    // 删除
    await app.inject({ method: 'DELETE', url: `/api/v1/questions/${created.id}`, headers: { cookie } });
    expect(db.get<{ question_count: number }>('SELECT question_count FROM banks WHERE id = 5')?.question_count).toBe(
      otherBefore ?? 0,
    );
  });

  it('兜底修复：绕过写路径改了题目后，一键重算能对齐', async () => {
    const bankId = 2;
    const stale =
      db.get<{ question_count: number }>('SELECT question_count FROM banks WHERE id = ?', [bankId])?.question_count ??
      0;
    db.run(
      'INSERT INTO questions (bank_id, type, stem, options, answer, difficulty, content_hash) VALUES (?,?,?,?,?,?,?)',
      [bankId, 'fill', '绕过写路径插入的题', '[]', '1', 'easy', 'raw-insert-hash'],
    );
    // 预计算列还是旧值 —— 这正是需要兜底修复的场景
    expect(
      db.get<{ question_count: number }>('SELECT question_count FROM banks WHERE id = ?', [bankId])?.question_count,
    ).toBe(stale);
    const real = db.get<{ c: number }>('SELECT COUNT(*) AS c FROM questions WHERE bank_id = ?', [bankId])?.c ?? 0;
    expect(real).toBe(stale + 1);

    const fixed = json<{ fixed: number }>(
      await app.inject({ method: 'POST', url: '/api/v1/banks/fix-question-counts', headers: { cookie } }),
    );
    expect(fixed.fixed).toBeGreaterThanOrEqual(1);
    expect(
      db.get<{ question_count: number }>('SELECT question_count FROM banks WHERE id = ?', [bankId])?.question_count,
    ).toBe(real);
    db.run('DELETE FROM questions WHERE content_hash = ?', ['raw-insert-hash']);
    await app.inject({ method: 'POST', url: '/api/v1/banks/fix-question-counts', headers: { cookie } });
  });

  it('权限：学生可读目录，回填归属需要教师', async () => {
    const readAsStudent = await app.inject({
      method: 'GET',
      url: '/api/v1/banks/catalog',
      headers: { cookie: studentCookie },
    });
    expect(readAsStudent.statusCode).toBe(200);

    const rebindAsStudent = await app.inject({
      method: 'POST',
      url: '/api/v1/banks/rebind-courses',
      headers: { cookie: studentCookie },
    });
    expect(rebindAsStudent.statusCode).toBe(403);

    const anon = await app.inject({ method: 'POST', url: '/api/v1/banks/rebind-courses' });
    expect(anon.statusCode).toBe(401);
  });
});
