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
let adminCookie = '';
let studentCookie = '';
let courseId = 0;
let lessonId = 0;
let examId = 0;
const questionIds: number[] = [];

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

function multipart(fields: { name: string; filename: string; contentType: string; data: string | Buffer }[]): {
  body: Buffer;
  contentType: string;
} {
  const boundary = '----mc-exam-boundary';
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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-exam-'));
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

  courseId = json<{ id: number }>(
    await app.inject({
      method: 'POST',
      url: '/api/v1/courses',
      headers: { cookie: adminCookie },
      payload: { name: 'Java 考试课程', published: true },
    }),
  ).id;

  lessonId = json<{ id: number }>(
    await app.inject({
      method: 'POST',
      url: '/api/v1/lessons',
      headers: { cookie: adminCookie },
      payload: { title: '考试课时', courseId, videoKind: 'url', videoPath: 'https://example.com/e.mp4' },
    }),
  ).id;

  const bankId = json<{ id: number }>(
    await app.inject({
      method: 'POST',
      url: '/api/v1/banks',
      headers: { cookie: adminCookie },
      payload: { name: '考试题库', lessonId },
    }),
  ).id;

  const specs = [
    { type: 'single', stem: '常量关键字', options: ['const', 'final'], answer: 'B' },
    { type: 'single', stem: 'JVM 含义', options: ['虚拟机', '编译器', '解释器'], answer: 'A' },
    { type: 'multiple', stem: '基本类型', options: ['int', 'String', 'boolean'], answer: 'AC' },
    { type: 'judge', stem: 'Java 跨平台', answer: '对' },
    { type: 'fill', stem: '入口方法', answer: 'main' },
  ] as const;
  for (const s of specs) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions`,
      headers: { cookie: adminCookie },
      payload: { bankId, ...s },
    });
    questionIds.push(json<{ id: number }>(res).id);
  }

  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username: `ex_${Date.now().toString(36)}`, password: 'pass1234', displayName: '考试学生' },
  });
  const c = reg.cookies.find((x) => x.name === 'microclass_sid');
  studentCookie = c ? `microclass_sid=${c.value}` : '';
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('考试：组卷与作答', () => {
  it('创建考试（默认草稿）并在课程下可见', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/exams',
      headers: { cookie: adminCookie },
      payload: { courseId, title: 'Java 期中考试', description: '第一章到第三章', durationMinutes: 30, passScore: 60 },
    });
    expect(res.statusCode).toBe(200);
    examId = json<{ id: number }>(res).id;

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/courses/${courseId}/exams`,
      headers: { cookie: adminCookie },
    });
    const body = json<{ exams: { id: number; title: string; status: string; qcount: number }[] }>(list);
    expect(body.exams[0]).toMatchObject({ id: examId, title: 'Java 期中考试', status: 'draft', qcount: 0 });
  });

  it('课程不存在时创建考试被拒绝（400）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/exams',
      headers: { cookie: adminCookie },
      payload: { courseId: 99999, title: '无效考试' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('手工加题与候选题池：只包含本课程的题目', async () => {
    const add = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/questions`,
      headers: { cookie: adminCookie },
      payload: { questionIds: questionIds.slice(0, 3) },
    });
    expect(json<{ added: number }>(add).added).toBe(3);

    // 重复添加不重复入卷
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/questions`,
      headers: { cookie: adminCookie },
      payload: { questionIds: questionIds.slice(0, 3) },
    });
    expect(json<{ added: number }>(again).added).toBe(0);

    const paper = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/paper`,
      headers: { cookie: adminCookie },
    });
    const body = json<{ questions: { id: number }[]; pool?: unknown }>(paper);
    expect(body.questions.length).toBe(3);
    // /paper 不再附送整门课的题池（性能）：题池请用 GET /exams/:id/pool 或挑题接口
    expect(body.pool).toBeUndefined();
  });

  it('按题型配额组卷：题型齐全且不超配额', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/questions/random`,
      headers: { cookie: adminCookie },
      payload: { quota: { judge: 1, fill: 1 } },
    });
    expect(json<{ added: number }>(res).added).toBe(2);
    const paper = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/paper`,
      headers: { cookie: adminCookie },
    });
    const body = json<{ questions: { type: string }[] }>(paper);
    expect(body.questions.length).toBe(5);
    expect(body.questions.map((q) => q.type)).toContain('judge');
    expect(body.questions.map((q) => q.type)).toContain('fill');
  });

  it('未发布的考试对学生不可见（404），发布后可作答', async () => {
    const before = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/take`,
      headers: { cookie: studentCookie },
    });
    expect(before.statusCode).toBe(404);

    const publish = await app.inject({
      method: 'PUT',
      url: `/api/v1/exams/${examId}`,
      headers: { cookie: adminCookie },
      payload: { courseId, title: 'Java 期中考试', durationMinutes: 30, passScore: 60, status: 'published' },
    });
    expect(publish.statusCode).toBe(200);

    const take = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/take`,
      headers: { cookie: studentCookie },
    });
    const body = json<{ already: boolean; total: number; questions: { answer?: string }[] }>(take);
    expect(body.already).toBe(false);
    expect(body.total).toBe(5);
    // 学生取卷不含答案
    expect(body.questions.every((q) => q.answer === undefined)).toBe(true);
  });

  it('交卷判分：及格线 = ceil(总分 × 及格比例)，重复交卷被拒', async () => {
    const take = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/take`,
      headers: { cookie: studentCookie },
    });
    const paper = json<{ questions: { id: number; type: string }[] }>(take);
    // 全对作答
    const correctAnswers: Record<string, string> = {};
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/paper`,
      headers: { cookie: adminCookie },
    });
    for (const q of json<{ questions: { id: number; answer: string }[] }>(detail).questions) {
      correctAnswers[String(q.id)] = q.answer;
    }
    const answers = paper.questions.map((q) => ({ qid: q.id, answer: correctAnswers[String(q.id)] ?? '' }));
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/submit`,
      headers: { cookie: studentCookie },
      payload: { answers, startedAt: Date.now() - 5000 },
    });
    expect(res.statusCode).toBe(200);
    const body = json<{ score: number; total: number; passed: boolean; need: number; usedSeconds: number }>(res);
    expect(body.score).toBe(5);
    expect(body.total).toBe(5);
    expect(body.need).toBe(3);
    expect(body.passed).toBe(true);
    expect(body.usedSeconds).toBeGreaterThanOrEqual(4);

    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/submit`,
      headers: { cookie: studentCookie },
      payload: { answers },
    });
    expect(again.statusCode).toBe(400);
  });

  it('成绩可复盘并出具成绩单与 CSV', async () => {
    const result = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/result`,
      headers: { cookie: studentCookie },
    });
    const body = json<{ score: number; passed: boolean; results: { qid: number; correct: boolean | null }[] }>(result);
    expect(body.score).toBe(5);
    expect(body.passed).toBe(true);
    expect(body.results.length).toBe(5);

    const sheet = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/scores`,
      headers: { cookie: adminCookie },
    });
    const s = json<{
      rows: { username: string; score: number }[];
      summary: { attempts: number; passed: number; pass_rate: number; avg: number };
    }>(sheet);
    expect(s.summary.attempts).toBe(1);
    expect(s.summary.passed).toBe(1);
    expect(s.summary.pass_rate).toBe(100);
    expect(s.summary.avg).toBe(5);

    const csv = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/scores.csv`,
      headers: { cookie: adminCookie },
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('学号,姓名,得分,总分,是否及格,用时(秒),交卷时间');
    expect(csv.body).toContain('考试学生');
  });

  it('学生不能组卷或查看成绩单（403）', async () => {
    const paper = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/paper`,
      headers: { cookie: studentCookie },
    });
    expect(paper.statusCode).toBe(403);
    const scores = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/scores`,
      headers: { cookie: studentCookie },
    });
    expect(scores.statusCode).toBe(403);
  });

  it('我的考试成绩汇总', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/me/exams', headers: { cookie: studentCookie } });
    const body = json<{
      exam_summary: { attempts: number; passed: number; avg: number };
      exams: { exam_title: string }[];
    }>(res);
    expect(body.exam_summary).toMatchObject({ attempts: 1, passed: 1, avg: 5 });
    expect(body.exams[0]?.exam_title).toBe('Java 期中考试');
    expect(body.exams[0]).toHaveProperty('course_name', 'Java 考试课程');
  });

  it('删除考试后不可再取卷', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/exams',
      headers: { cookie: adminCookie },
      payload: { courseId, title: '临时考试' },
    });
    const tempId = json<{ id: number }>(created).id;
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/exams/${tempId}`,
      headers: { cookie: adminCookie },
    });
    expect(del.statusCode).toBe(200);
    const gone = await app.inject({ method: 'GET', url: `/api/v1/exams/${tempId}`, headers: { cookie: adminCookie } });
    expect(gone.statusCode).toBe(404);
  });
});

describe('学习统计与导出', () => {
  it('课时统计：观看/完成/刷题人数与平均分', async () => {
    // 学生上报 100% 观看并刷题全对
    await app.inject({
      method: 'POST',
      url: '/api/v1/progress',
      headers: { cookie: studentCookie },
      payload: { lessonId, position: 600, duration: 600, finished: true },
    });
    const quiz = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${lessonId}/quiz`,
      headers: { cookie: studentCookie },
    });
    const qs = json<{ questions: { id: number; type: string }[] }>(quiz).questions;
    const answers = qs.map((q) => ({ qid: q.id, answer: q.type === 'judge' ? 'T' : q.type === 'fill' ? 'main' : '0' }));
    await app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${lessonId}/quiz/submit`,
      headers: { cookie: studentCookie },
      payload: { answers },
    });

    const stats = await app.inject({
      method: 'GET',
      url: `/api/v1/stats/lessons/${lessonId}`,
      headers: { cookie: adminCookie },
    });
    const body = json<{
      summary: { students: number; watched: number; finished: number; quizzed: number; avg: number };
      rows: { username: string; finished: boolean; percent: number; quiz_done: boolean; attempts: number }[];
    }>(stats);
    expect(body.summary.students).toBe(1);
    expect(body.summary.finished).toBe(1);
    expect(body.summary.watched).toBe(1);
    expect(body.summary.quizzed).toBe(1);
    const row = body.rows[0];
    expect(row?.finished).toBe(true);
    expect(row?.percent).toBe(100);
    expect(row?.attempts).toBeGreaterThanOrEqual(1);
  });

  it('课时统计 CSV 可下载且含表头', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/stats/lessons/${lessonId}.csv`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('学号,姓名,视频状态,观看进度%,是否刷题,最好成绩,刷题次数');
    expect(res.headers['content-disposition']).toContain(encodeURIComponent('考试课时_学习统计.csv'));
  });

  it('课程统计按课时聚合完成率', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/stats/courses/${courseId}`,
      headers: { cookie: adminCookie },
    });
    const body = json<{
      summary: { lessons: number; students: number; avg_finish_rate: number };
      lessons: { id: number; title: string; finish_rate: number; quiz_rate: number }[];
    }>(res);
    expect(body.summary.lessons).toBe(1);
    expect(body.summary.students).toBe(1);
    expect(body.lessons[0]).toMatchObject({ id: lessonId, title: '考试课时', finish_rate: 100, quiz_rate: 100 });
    expect(body.summary.avg_finish_rate).toBe(100);

    const csv = await app.inject({
      method: 'GET',
      url: `/api/v1/stats/courses/${courseId}.csv`,
      headers: { cookie: adminCookie },
    });
    expect(csv.body).toContain('章节,课时,观看人数,完成人数,刷题人数,完成率%,刷题率%,平均成绩');
  });

  it('学生不能查看统计（403）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/stats/lessons/${lessonId}`,
      headers: { cookie: studentCookie },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('课时笔记与知识点附件', () => {
  it('笔记：新增/列表/删除，且只能看自己的', async () => {
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${lessonId}/notes`,
      headers: { cookie: studentCookie },
      payload: { pos: 120, text: '这里讲的是 JVM 内存模型' },
    });
    expect(create.statusCode).toBe(200);
    const noteId = json<{ id: number }>(create).id;

    const adminNote = await app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${lessonId}/notes`,
      headers: { cookie: adminCookie },
      payload: { pos: 10, text: '管理员的笔记' },
    });
    expect(adminNote.statusCode).toBe(200);

    const mine = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${lessonId}/notes`,
      headers: { cookie: studentCookie },
    });
    const body = json<{ notes: { id: number; text: string; pos: number }[]; count: number }>(mine);
    expect(body.count).toBe(1);
    expect(body.notes[0]?.text).toContain('JVM');
    expect(body.notes[0]?.pos).toBe(120);

    // 学生不能删别人的笔记
    const adminNotes = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${lessonId}/notes`,
      headers: { cookie: adminCookie },
    });
    const adminNoteId = json<{ notes: { id: number }[] }>(adminNotes).notes[0]?.id as number;
    const forbidden = await app.inject({
      method: 'DELETE',
      url: `/api/v1/notes/${adminNoteId}`,
      headers: { cookie: studentCookie },
    });
    expect(forbidden.statusCode).toBe(404);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/notes/${noteId}`,
      headers: { cookie: studentCookie },
    });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${lessonId}/notes`,
      headers: { cookie: studentCookie },
    });
    expect(json<{ count: number }>(after).count).toBe(0);
  });

  it('空笔记被拒绝（400）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${lessonId}/notes`,
      headers: { cookie: studentCookie },
      payload: { pos: 0, text: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('知识点附件上传、下载（inline/attachment）与更新', async () => {
    const pdfLike = Buffer.from('%PDF-1.4 fake pdf content');
    const mp = multipart([{ name: 'file', filename: '第一章讲义.pdf', contentType: 'application/pdf', data: pdfLike }]);
    const up = await app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${lessonId}/knowledge/file`,
      headers: { cookie: adminCookie, 'content-type': mp.contentType },
      payload: mp.body,
    });
    expect(up.statusCode).toBe(200);
    const kid = json<{ id: number; fileName: string }>(up).id;
    expect(json<{ fileName: string }>(up).fileName).toBe('第一章讲义.pdf');

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${lessonId}`,
      headers: { cookie: studentCookie },
    });
    const knowledge = json<{ knowledge: { id: number; kind: string; title: string; file_name: string }[] }>(
      detail,
    ).knowledge;
    expect(knowledge[0]).toMatchObject({ id: kid, kind: 'file', title: '第一章讲义.pdf' });

    const dl = await app.inject({
      method: 'GET',
      url: `/api/v1/knowledge/${kid}/file`,
      headers: { cookie: studentCookie },
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toContain('application/pdf');
    // PDF 属于可内联类型
    expect(dl.headers['content-disposition']).toContain('inline');
    expect(Buffer.from(dl.rawPayload).equals(pdfLike)).toBe(true);

    const rename = await app.inject({
      method: 'PUT',
      url: `/api/v1/knowledge/${kid}`,
      headers: { cookie: adminCookie },
      payload: { title: '第一章讲义（修订）' },
    });
    expect(rename.statusCode).toBe(200);
    const detail2 = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${lessonId}`,
      headers: { cookie: studentCookie },
    });
    expect(json<{ knowledge: { title: string }[] }>(detail2).knowledge[0]?.title).toBe('第一章讲义（修订）');
  });

  it('删除知识点会同时清理落盘文件', async () => {
    const mp = multipart([{ name: 'file', filename: 'note.txt', contentType: 'text/plain', data: 'hello' }]);
    const up = await app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${lessonId}/knowledge/file`,
      headers: { cookie: adminCookie, 'content-type': mp.contentType },
      payload: mp.body,
    });
    const kid = json<{ id: number }>(up).id;
    const dl = await app.inject({
      method: 'GET',
      url: `/api/v1/knowledge/${kid}/file`,
      headers: { cookie: adminCookie },
    });
    expect(dl.headers['content-disposition']).toContain('inline'); // text/plain 也内联

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/knowledge/${kid}`,
      headers: { cookie: adminCookie },
    });
    expect(del.statusCode).toBe(200);
    const gone = await app.inject({
      method: 'GET',
      url: `/api/v1/knowledge/${kid}/file`,
      headers: { cookie: adminCookie },
    });
    expect(gone.statusCode).toBe(404);

    const uploaded = fs.readdirSync(path.join(dataDir, 'uploads', 'knowledge'));
    expect(uploaded.length).toBe(1); // 只剩 PDF 那一个
  });

  it('学生不能上传知识点附件（403）', async () => {
    const mp = multipart([{ name: 'file', filename: 'x.txt', contentType: 'text/plain', data: 'x' }]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${lessonId}/knowledge/file`,
      headers: { cookie: studentCookie, 'content-type': mp.contentType },
      payload: mp.body,
    });
    expect(res.statusCode).toBe(403);
  });
});
