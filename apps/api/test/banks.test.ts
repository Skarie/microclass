import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';

let app: FastifyInstance;
let dataDir: string;
/** 直接访问测试库（写入测试环境无法探测的视频时长等字段） */
let testDb: Db;
let adminCookie: string;
let studentCookie: string;
let lessonId = 0;

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
  const c = res.cookies.find((x) => x.name === 'microclass_sid');
  return c ? `microclass_sid=${c.value}` : '';
}

/** 构造 multipart 请求体 */
function multipart(fields: { name: string; filename: string; contentType: string; data: string | Buffer }[]): {
  body: Buffer;
  contentType: string;
} {
  const boundary = '----mc-test-boundary';
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

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-banks-'));
  const config = loadConfig({
    ...process.env,
    MC_ENV: 'test',
    MC_DATA_DIR: dataDir,
    MC_LOG_LEVEL: 'silent',
    MC_ADMIN_USER: 'admin',
    MC_ADMIN_PASS: 'admin123',
  });
  testDb = new Db(':memory:');
  const built = await buildApp(config, { db: testDb });
  app = built.app;
  await app.ready();
  adminCookie = await login('admin', 'admin123');
  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username: `stu_${Date.now().toString(36)}`, password: 'pass1234' },
  });
  const c = reg.cookies.find((x) => x.name === 'microclass_sid');
  studentCookie = c ? `microclass_sid=${c.value}` : '';
  // 直链课时：不受“看完 80% 才能刷题”的限制
  const lesson = await app.inject({
    method: 'POST',
    url: '/api/v1/lessons',
    headers: { cookie: adminCookie },
    payload: { title: 'Java 基础', videoKind: 'url', videoPath: 'https://example.com/v.mp4' },
  });
  lessonId = json<{ id: number }>(lesson).id;
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('题库与题目', () => {
  let bankId = 0;
  const questions: number[] = [];

  it('教师/管理员可建题库并关联课时', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/banks',
      headers: { cookie: adminCookie },
      payload: { name: 'Java 基础题库', lessonId },
    });
    expect(res.statusCode).toBe(200);
    bankId = json<{ id: number }>(res).id;
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/banks?lesson=${lessonId}`,
      headers: { cookie: adminCookie },
    });
    const body = json<{ banks: { id: number; lesson_title: string; question_count: number }[] }>(list);
    expect(body.banks[0]).toMatchObject({ id: bankId, lesson_title: 'Java 基础', question_count: 0 });
  });

  it('学生不能创建题库（403）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/banks',
      headers: { cookie: studentCookie },
      payload: { name: '越权题库' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('关联不存在的课时被拒绝（400）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/banks',
      headers: { cookie: adminCookie },
      payload: { name: '错误关联', lessonId: 99999 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('创建题目：字母答案被规范化为下标编码', async () => {
    const single = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions`,
      headers: { cookie: adminCookie },
      payload: { bankId, type: 'single', stem: '常量关键字是？', options: ['const', 'final', 'static'], answer: 'B' },
    });
    expect(single.statusCode).toBe(200);
    questions.push(json<{ id: number }>(single).id);

    const multiple = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions`,
      headers: { cookie: adminCookie },
      payload: { bankId, type: 'multiple', stem: '基本类型有？', options: ['int', 'String', 'boolean'], answer: 'AC' },
    });
    questions.push(json<{ id: number }>(multiple).id);

    const judge = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions`,
      headers: { cookie: adminCookie },
      payload: { bankId, type: 'judge', stem: 'Java 是纯面向对象语言。', answer: '错' },
    });
    questions.push(json<{ id: number }>(judge).id);

    const fill = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions`,
      headers: { cookie: adminCookie },
      payload: { bankId, type: 'fill', stem: '入口方法是 ___。', answer: 'main|Main' },
    });
    questions.push(json<{ id: number }>(fill).id);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/banks/${bankId}`,
      headers: { cookie: adminCookie },
    });
    const body = json<{ questions: { type: string; answer: string; options: string[] }[] }>(detail);
    expect(body.questions.map((q) => q.answer)).toEqual(['1', '0,2', 'F', 'main|Main']);
    expect(body.questions[0]?.options).toEqual(['const', 'final', 'static']);
  });

  it('选择题选项不足或答案非法时拒绝（400）', async () => {
    const tooFew = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions`,
      headers: { cookie: adminCookie },
      payload: { bankId, type: 'single', stem: 'x', options: ['只有一个'], answer: 'A' },
    });
    expect(tooFew.statusCode).toBe(400);
    const badJudge = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions`,
      headers: { cookie: adminCookie },
      payload: { bankId, type: 'judge', stem: 'y', answer: 'maybe' },
    });
    expect(badJudge.statusCode).toBe(400);
  });

  it('题目列表支持题型筛选与关键词搜索', async () => {
    const byType = await app.inject({
      method: 'GET',
      url: `/api/v1/banks/${bankId}/questions?type=judge`,
      headers: { cookie: adminCookie },
    });
    const t = json<{ total: number; questions: { type: string }[] }>(byType);
    expect(t.total).toBe(1);
    expect(t.questions[0]?.type).toBe('judge');

    const byKeyword = await app.inject({
      method: 'GET',
      url: `/api/v1/banks/${bankId}/questions?keyword=入口`,
      headers: { cookie: adminCookie },
    });
    expect(json<{ total: number }>(byKeyword).total).toBe(1);
  });

  it('题目配图：上传、绑定并可通过接口取回', async () => {
    const qid = questions[0] as number;
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const mp = multipart([{ name: 'file', filename: 'stem.png', contentType: 'image/png', data: png }]);
    const up = await app.inject({
      method: 'POST',
      url: `/api/v1/questions/${qid}/image`,
      headers: { cookie: adminCookie, 'content-type': mp.contentType },
      payload: mp.body,
    });
    expect(up.statusCode).toBe(200);
    const imagePath = json<{ imagePath: string }>(up).imagePath;
    expect(imagePath.startsWith('question-images/')).toBe(true);

    const got = await app.inject({
      method: 'GET',
      url: `/api/v1/question-images/${qid}`,
      headers: { cookie: studentCookie },
    });
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toContain('image/png');
    expect(Buffer.from(got.rawPayload).equals(png)).toBe(true);
  });

  it('非图片文件上传被拒绝（400）', async () => {
    const mp = multipart([{ name: 'file', filename: 'evil.txt', contentType: 'text/plain', data: 'not an image' }]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/questions/${questions[0] as number}/image`,
      headers: { cookie: adminCookie, 'content-type': mp.contentType },
      payload: mp.body,
    });
    expect(res.statusCode).toBe(400);
  });

  it('导出 CSV 使用字母答案与中文题型，可再次导入', async () => {
    const exp = await app.inject({
      method: 'GET',
      url: `/api/v1/banks/${bankId}/export.csv`,
      headers: { cookie: adminCookie },
    });
    expect(exp.statusCode).toBe(200);
    expect(exp.headers['content-type']).toContain('text/csv');
    const text = exp.body.replace(/^\uFEFF/, '');
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('题型,题干,选项A,选项B,选项C,选项D,选项E,选项F,答案,解析');
    expect(text).toContain('单选题,常量关键字是？,const,final,static,,,,B,');
    expect(text).toContain('多选题,基本类型有？,int,String,boolean,,,,AC,');
    expect(text).toContain('判断题,Java 是纯面向对象语言。,,,,,,,错,');

    // 导出内容导入到新题库，题目数量一致
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/banks',
      headers: { cookie: adminCookie },
      payload: { name: '导入副本', lessonId },
    });
    const copyId = json<{ id: number }>(created).id;
    const mp = multipart([{ name: 'file', filename: 'bank.csv', contentType: 'text/csv', data: exp.body }]);
    const imp = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${copyId}/import`,
      headers: { cookie: adminCookie, 'content-type': mp.contentType },
      payload: mp.body,
    });
    expect(imp.statusCode).toBe(200);
    expect(json<{ inserted: number; errors: string[] }>(imp)).toMatchObject({ inserted: 4, errors: [] });
  });

  it('导入模板可下载且包含 5 种题型示例', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/banks/template.csv',
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('单选题');
    expect(res.body).toContain('简答题');
    expect(res.headers['content-disposition']).toContain(encodeURIComponent('题目导入模板.csv'));
  });

  it('CSV 导入逐行报错并保留可导入的行', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/banks',
      headers: { cookie: adminCookie },
      payload: { name: '容错导入', lessonId },
    });
    const target = json<{ id: number }>(created).id;
    const csv = [
      '题型,题干,选项A,选项B,答案,解析',
      '单选题,正确一行,A,B,A,',
      '单选题,选项不足,A,,A,',
      '未知题型,无法识别的题型,A,B,A,',
      '判断题,,,,"对",', // 题干为空
    ].join('\r\n');
    const mp = multipart([{ name: 'file', filename: 'x.csv', contentType: 'text/csv', data: csv }]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${target}/import`,
      headers: { cookie: adminCookie, 'content-type': mp.contentType },
      payload: mp.body,
    });
    const body = json<{ inserted: number; errors: string[] }>(res);
    expect(body.inserted).toBe(1);
    expect(body.errors.length).toBe(3);
    expect(body.errors[0]).toContain('第 3 行');
  });

  it('删除题库级联删除题目', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/banks',
      headers: { cookie: adminCookie },
      payload: { name: '待删除题库', lessonId },
    });
    const tempId = json<{ id: number }>(created).id;
    const q = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${tempId}/questions`,
      headers: { cookie: adminCookie },
      payload: { bankId: tempId, type: 'judge', stem: '临时题', answer: '对' },
    });
    const qid = json<{ id: number }>(q).id;
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/banks/${tempId}`,
      headers: { cookie: adminCookie },
    });
    expect(del.statusCode).toBe(200);
    const gone = await app.inject({ method: 'GET', url: `/api/v1/questions/${qid}`, headers: { cookie: adminCookie } });
    expect(gone.statusCode).toBe(404);
  });

  it('学生可读题库但不能改题（403）', async () => {
    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/banks/${bankId}`,
      headers: { cookie: studentCookie },
    });
    expect(read.statusCode).toBe(200);
    const write = await app.inject({
      method: 'PUT',
      url: `/api/v1/questions/${questions[0] as number}`,
      headers: { cookie: studentCookie },
      payload: { bankId, type: 'single', stem: '改题', options: ['a', 'b'], answer: 'A' },
    });
    expect(write.statusCode).toBe(403);
  });
});

describe('刷题判分与错题本', () => {
  // 独立课时：避免与上面的题库用例相互影响题目集合
  let quizLessonId = 0;
  let bankId = 0;
  let singleQid = 0;
  let multiQid = 0;
  let judgeQid = 0;
  let fillQid = 0;

  beforeAll(async () => {
    const lesson = await app.inject({
      method: 'POST',
      url: '/api/v1/lessons',
      headers: { cookie: adminCookie },
      payload: { title: '刷题课时', videoKind: 'url', videoPath: 'https://example.com/quiz.mp4' },
    });
    quizLessonId = json<{ id: number }>(lesson).id;
    const bank = await app.inject({
      method: 'POST',
      url: '/api/v1/banks',
      headers: { cookie: adminCookie },
      payload: { name: '刷题题库', lessonId: quizLessonId },
    });
    bankId = json<{ id: number }>(bank).id;
    const specs = [
      { type: 'single', stem: '常量关键字？', options: ['const', 'final'], answer: 'B' },
      { type: 'multiple', stem: '基本类型？', options: ['int', 'String', 'boolean'], answer: 'AC' },
      { type: 'judge', stem: 'Java 是编译型语言。', answer: '对' },
      { type: 'fill', stem: '入口方法 ___', answer: 'main|Main' },
    ] as const;
    const ids: number[] = [];
    for (const s of specs) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/banks/${bankId}/questions`,
        headers: { cookie: adminCookie },
        payload: { bankId, ...s },
      });
      ids.push(json<{ id: number }>(res).id);
    }
    [singleQid, multiQid, judgeQid, fillQid] = ids as [number, number, number, number];
  });

  it('学生取题看不到答案与解析，管理员取题可见', async () => {
    const asStudent = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${quizLessonId}/quiz`,
      headers: { cookie: studentCookie },
    });
    const s = json<{
      questions: { id: number; type: string; answer?: string; analysis?: string; options: string[] }[];
      total: number;
    }>(asStudent);
    expect(s.total).toBe(4);
    // 取题顺序是随机的，因此按题型定位
    for (const q of s.questions) {
      expect(q.answer).toBeUndefined();
      expect(q.analysis).toBeUndefined();
    }
    expect(s.questions.find((q) => q.type === 'single')?.options).toEqual(['const', 'final']);

    const asAdmin = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${quizLessonId}/quiz`,
      headers: { cookie: adminCookie },
    });
    expect(json<{ questions: { answer?: string }[] }>(asAdmin).questions[0]?.answer).toBeDefined();
  });

  it('count 参数随机抽题', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${quizLessonId}/quiz?count=2`,
      headers: { cookie: studentCookie },
    });
    const body = json<{ total: number; mode: string }>(res);
    expect(body.total).toBe(2);
    expect(body.mode).toBe('random2');
  });

  it('提交判分：单选/多选/判断/填空规则与 V1 一致，答错自动进错题本', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${quizLessonId}/quiz/submit`,
      headers: { cookie: studentCookie },
      payload: {
        answers: [
          { qid: singleQid, answer: '1' }, // 对
          { qid: multiQid, answer: '0,1' }, // 错（应为 0,2）
          { qid: judgeQid, answer: 'T' }, // 对
          { qid: fillQid, answer: ' MAIN ' }, // 对（大小写/空格归一）
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = json<{
      score: number;
      total: number;
      manual: number;
      best: number;
      results: { qid: number; correct: boolean | null }[];
    }>(res);
    expect(body.score).toBe(3);
    expect(body.total).toBe(4);
    expect(body.manual).toBe(0);
    // best 使用百分比口径（3/4 = 75），不能返回原始分
    expect(body.best).toBe(75);
    expect(body.results.find((r) => r.qid === multiQid)?.correct).toBe(false);

    const wrong = await app.inject({
      method: 'GET',
      url: '/api/v1/me/wrong-questions',
      headers: { cookie: studentCookie },
    });
    const wb = json<{ total: number; pending: number; items: { id: number; wrong_count: number; answer: string }[] }>(
      wrong,
    );
    expect(wb.total).toBe(1);
    expect(wb.pending).toBe(1);
    expect(wb.items[0]?.id).toBe(multiQid);
    expect(wb.items[0]?.wrong_count).toBe(1);
    // 错题本里带答案解析，便于复盘
    expect(wb.items[0]?.answer).toBe('0,2');
  });

  it('简答题不自动判分（correct 为 null）', async () => {
    const short = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions`,
      headers: { cookie: adminCookie },
      payload: { bankId, type: 'short', stem: '简述三大特性', answer: '封装、继承、多态' },
    });
    const shortId = json<{ id: number }>(short).id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${quizLessonId}/quiz/submit`,
      headers: { cookie: studentCookie },
      payload: { answers: [{ qid: shortId, answer: '封装继承多态' }] },
    });
    const body = json<{ manual: number; results: { correct: boolean | null }[] }>(res);
    expect(body.manual).toBe(1);
    expect(body.results[0]?.correct).toBeNull();
  });

  it('答对错题后自动标记为已掌握', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${quizLessonId}/quiz/submit`,
      headers: { cookie: studentCookie },
      payload: { answers: [{ qid: multiQid, answer: '0,2' }] },
    });
    expect(res.statusCode).toBe(200);
    const wrong = await app.inject({
      method: 'GET',
      url: '/api/v1/me/wrong-questions',
      headers: { cookie: studentCookie },
    });
    const wb = json<{ total: number; pending: number; items: unknown[] }>(wrong);
    expect(wb.total).toBe(1);
    expect(wb.pending).toBe(0);
    expect(wb.items.length).toBe(0); // 默认只看未掌握

    const withMastered = await app.inject({
      method: 'GET',
      url: '/api/v1/me/wrong-questions?includeMastered=1',
      headers: { cookie: studentCookie },
    });
    expect(json<{ items: unknown[] }>(withMastered).items.length).toBe(1);
  });

  it('错题可手动标记掌握并移除', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/me/wrong-questions/${multiQid}/master`,
      headers: { cookie: studentCookie },
      payload: { mastered: false },
    });
    const pending = await app.inject({
      method: 'GET',
      url: '/api/v1/me/wrong-questions',
      headers: { cookie: studentCookie },
    });
    expect(json<{ pending: number }>(pending).pending).toBe(1);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/me/wrong-questions/${multiQid}`,
      headers: { cookie: studentCookie },
    });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/me/wrong-questions',
      headers: { cookie: studentCookie },
    });
    expect(json<{ total: number }>(after).total).toBe(0);
  });

  it('刷题记录累积并写入课时最佳成绩', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/me/attempts', headers: { cookie: studentCookie } });
    const body = json<{ attempts: { lesson_id: number; score: number; total: number; lesson_title: string }[] }>(res);
    expect(body.attempts.length).toBeGreaterThanOrEqual(3);
    expect(body.attempts[0]?.lesson_title).toBe('刷题课时');

    const lesson = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${quizLessonId}`,
      headers: { cookie: studentCookie },
    });
    const detail = json<{ lesson: { progress: { quiz_done: 0 | 1; quiz_best: number } | null } }>(lesson);
    expect(detail.lesson.progress?.quiz_done).toBe(1);
    expect(detail.lesson.progress?.quiz_best).toBeGreaterThan(0);
  });

  it('观看区间决定解锁：拖到结尾不算看完，看满 80% 才解锁', async () => {
    // 造一个本地视频课时，并把时长直接写库（测试环境没有 ffprobe）
    const dir = path.join(dataDir, 'media2');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'progress.mp4'), Buffer.from('x'.repeat(128)));
    const rootRes = await app.inject({
      method: 'POST',
      url: '/api/v1/media-roots',
      headers: { cookie: adminCookie },
      payload: { name: '区间测试目录', path: dir },
    });
    const rootId = json<{ root: { id: string } }>(rootRes).root.id;
    const lessonRes = await app.inject({
      method: 'POST',
      url: '/api/v1/lessons',
      headers: { cookie: adminCookie },
      payload: { title: '区间测试课时', videoKind: 'local', mediaRoot: rootId, videoPath: 'progress.mp4' },
    });
    const lid = json<{ id: number }>(lessonRes).id;
    testDb.run('UPDATE lessons SET duration = ? WHERE id = ?', [1000, lid]);

    const quiz = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${lid}/quiz`,
      headers: { cookie: adminCookie },
    });
    const bankId2 = json<{ id: number }>(
      await app.inject({
        method: 'POST',
        url: '/api/v1/banks',
        headers: { cookie: adminCookie },
        payload: { name: '区间测试题库', lessonId: lid },
      }),
    ).id;
    void quiz;
    const q = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId2}/questions`,
      headers: { cookie: adminCookie },
      payload: { bankId: bankId2, type: 'judge', stem: '区间测试题', answer: '对' },
    });
    const qid = json<{ id: number }>(q).id;

    const submit = async (): Promise<number> => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/lessons/${lid}/quiz/submit`,
        headers: { cookie: studentCookie },
        payload: { answers: [{ qid, answer: 'T' }] },
      });
      return res.statusCode;
    };

    // 1) 拖到结尾：position 拉满但区间只有最后 20 秒 → 仍锁定
    await app.inject({
      method: 'POST',
      url: '/api/v1/progress/intervals',
      headers: { cookie: studentCookie },
      payload: { lessonId: lid, intervals: [{ start: 980, end: 1000 }], position: 1000, duration: 1000 },
    });
    expect(await submit()).toBe(403);

    // 2) 正常看到 50% → 仍锁定
    await app.inject({
      method: 'POST',
      url: '/api/v1/progress/intervals',
      headers: { cookie: studentCookie },
      payload: { lessonId: lid, intervals: [{ start: 0, end: 500 }], position: 500, duration: 1000 },
    });
    expect(await submit()).toBe(403);

    // 3) 累计到 85%（分段上报，验证并集）→ 解锁
    await app.inject({
      method: 'POST',
      url: '/api/v1/progress/intervals',
      headers: { cookie: studentCookie },
      payload: { lessonId: lid, intervals: [{ start: 500, end: 850 }], position: 850, duration: 1000 },
    });
    const check = await app.inject({
      method: 'GET',
      url: `/api/v1/progress/intervals?lesson=${lid}`,
      headers: { cookie: studentCookie },
    });
    const body = json<{ coveredSeconds: number; percent: number; quizUnlocked: boolean }>(check);
    // 20（拖到结尾确实看过的那 20 秒）+ 500（0-500）+ 350（500-850）= 870，
    // 说明「看过的部分照实累计」，但单靠拖到结尾的 20 秒（2%）不足以解锁
    expect(body.coveredSeconds).toBe(870);
    expect(body.percent).toBe(87);
    expect(body.quizUnlocked).toBe(true);
    expect(await submit()).toBe(200);
  });

  it('空作答被拒绝（400）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${quizLessonId}/quiz/submit`,
      headers: { cookie: studentCookie },
      payload: { answers: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('本地视频未看完 80% 时禁止刷题（403）', async () => {
    const dir = path.join(dataDir, 'media');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'v.mp4'), Buffer.from('x'.repeat(64)));
    const rootRes = await app.inject({
      method: 'POST',
      url: '/api/v1/media-roots',
      headers: { cookie: adminCookie },
      payload: { name: '测试目录', path: dir },
    });
    expect(rootRes.statusCode).toBe(200);
    const rootId = json<{ root: { id: string } }>(rootRes).root.id;

    const lesson = await app.inject({
      method: 'POST',
      url: '/api/v1/lessons',
      headers: { cookie: adminCookie },
      payload: { title: '本地视频课时', videoKind: 'local', mediaRoot: rootId, videoPath: 'v.mp4' },
    });
    expect(lesson.statusCode).toBe(200);
    const localLessonId = json<{ id: number }>(lesson).id;
    const bank = await app.inject({
      method: 'POST',
      url: '/api/v1/banks',
      headers: { cookie: adminCookie },
      payload: { name: '本地课时题库', lessonId: localLessonId },
    });
    const localBankId = json<{ id: number }>(bank).id;
    const q = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${localBankId}/questions`,
      headers: { cookie: adminCookie },
      payload: { bankId: localBankId, type: 'judge', stem: '本地题', answer: '对' },
    });
    const lid = json<{ id: number }>(q).id;

    const blocked = await app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${localLessonId}/quiz/submit`,
      headers: { cookie: studentCookie },
      payload: { answers: [{ qid: lid, answer: 'T' }] },
    });
    expect(blocked.statusCode).toBe(403);

    // 上报 80% 观看后解锁
    await app.inject({
      method: 'POST',
      url: '/api/v1/progress',
      headers: { cookie: studentCookie },
      payload: { lessonId: localLessonId, position: 80, duration: 100, finished: false },
    });
    const ok = await app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${localLessonId}/quiz/submit`,
      headers: { cookie: studentCookie },
      payload: { answers: [{ qid: lid, answer: 'T' }] },
    });
    expect(ok.statusCode).toBe(200);
    expect(json<{ score: number }>(ok).score).toBe(1);
  });
});
