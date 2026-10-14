import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';
import { parseQuestionText, questionsToMarkdown, typeFromHeading } from '../src/domain/questionText.js';
import { QuestionMediaStore } from '../src/services/questionMediaStore.js';
import { buildDocx, imageSize, readDocx, readDocxText } from '../src/utils/docx.js';
import { createZip, crc32, readZip } from '../src/utils/zip.js';
import type { Question } from '@microclass/shared';

/**
 * 题目导入导出：Markdown 与 Word（.docx）。
 * 关键约定——**同一套纯文本规则**：Markdown 与 Word 抽出正文后走同一解析器，
 * 且导出的文件都能再次导入（往返一致）。
 */

const q = (type: Question['type'], stem: string, options: string[], answer: string, analysis = ''): Question => ({
  id: 1,
  bank_id: 1,
  lesson_id: null,
  type,
  stem,
  image_path: '',
  options: JSON.stringify(options),
  answer,
  analysis,
  sort: 0,
  created_at: 0,
  difficulty: '',
});

/** 8x5 的最小 PNG（头部足够读出 IHDR 宽高），也用于「Word 配图导入」用例 */
function tinyPng(width = 8, height = 5): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 13]),
    Buffer.from('IHDR', 'utf8'),
    (() => {
      const b = Buffer.alloc(8);
      b.writeUInt32BE(width, 0);
      b.writeUInt32BE(height, 4);
      return b;
    })(),
  ]);
}

describe('纯文本题块解析（Markdown / Word 共用）', () => {
  const md = [
    '# 我的题库',
    '',
    '### 1. 单选题',
    'Java 中定义常量的关键字是？',
    'A. const',
    'B. final',
    'C. static',
    'D. define',
    '答案：B',
    '解析：final 修饰的变量为常量',
    '',
    '### 2. 多选题',
    '属于 Java 基本数据类型的有？',
    'A、int',
    'B、String',
    'C、boolean',
    'D、double',
    '答案：ACD',
    '',
    '### 3. 判断题',
    'Java 是纯面向对象语言。',
    '答案：错',
    '',
    '### 4. 填空题',
    'Java 程序的入口方法是 ___ 。',
    '答案：main|Main',
    '',
    '### 5. 简答题',
    '简述面向对象三大特性。',
    '答案：封装、继承、多态',
  ].join('\n');

  it('五种题型都能解析，答案编码正确', () => {
    const res = parseQuestionText(md);
    expect(res.errors).toEqual([]);
    expect(res.questions).toHaveLength(5);
    expect(res.questions[0]).toMatchObject({
      type: 'single',
      answer: '1',
      options: ['const', 'final', 'static', 'define'],
    });
    expect(res.questions[1]).toMatchObject({ type: 'multiple', answer: '0,2,3' });
    expect(res.questions[2]).toMatchObject({ type: 'judge', answer: 'F' });
    expect(res.questions[3]).toMatchObject({ type: 'fill', answer: 'main|Main' });
    expect(res.questions[4]).toMatchObject({ type: 'short', answer: '封装、继承、多态' });
    // 题干与解析都保留
    expect(res.questions[0]?.stem).toBe('Java 中定义常量的关键字是？');
    expect(res.questions[0]?.analysis).toContain('final');
  });

  it('题型写法很宽容：**加粗** / [方括号] / 序号 / 第 N 题 / 纯文字行', () => {
    expect(typeFromHeading('## 单选题')).toBe('single');
    expect(typeFromHeading('**多选题**')).toBe('multiple');
    expect(typeFromHeading('[判断题]')).toBe('judge');
    expect(typeFromHeading('第 3 题 · 填空')).toBe('fill');
    expect(typeFromHeading('4. 简答题')).toBe('short');
    expect(typeFromHeading('单选题')).toBe('single');
    expect(typeFromHeading('Multiple')).toBe('multiple');
    expect(typeFromHeading('这是一段普通说明')).toBeNull();
  });

  it('题型写在题干开头（【判断题】…）也能识别', () => {
    const res = parseQuestionText('【判断题】Java 是编译型语言。\n答案：对');
    expect(res.errors).toEqual([]);
    expect(res.questions[0]).toMatchObject({ type: 'judge', stem: 'Java 是编译型语言。', answer: 'T' });
  });

  it('选项/答案/解析顺序任意；选项写法 A. A、 A) （A） 都行', () => {
    const res = parseQuestionText(
      ['答案：A', '解析：因为所以', '题干在这里？', '（A）甲', 'B) 乙', 'C、丙', 'D. 丁'].join('\n'),
    );
    // 没有题型 → 忽略（题型必填）
    expect(res.questions).toHaveLength(0);
    expect(res.errors[0]).toContain('没有解析到任何题目');

    const withType = parseQuestionText(
      ['单选题', '答案：C', '题干在这里？', '（A）甲', 'B) 乙', 'C、丙', 'D. 丁'].join('\n'),
    );
    expect(withType.errors).toEqual([]);
    expect(withType.questions[0]).toMatchObject({ answer: '2', options: ['甲', '乙', '丙', '丁'] });
  });

  it('错误逐题报告，不影响其它题', () => {
    const res = parseQuestionText(
      ['单选题', '题一？', 'A. 甲', 'B. 乙', '答案：Z', '', '单选题', '题二？', 'A. 甲', 'B. 乙', '答案：A'].join('\n'),
    );
    expect(res.questions).toHaveLength(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain('第 1 题');
    expect(res.errors[0]).toContain('单选答案应为单个字母');
    expect(res.questions[0]?.stem).toBe('题二？');
  });

  it('题干里的图片链接被忽略，并给出提示（图片请单独上传）', () => {
    const res = parseQuestionText(
      ['单选题', '看图选择 ![图](https://example.com/a.png) 哪个对？', 'A. 甲', 'B. 乙', '答案：A'].join('\n'),
    );
    expect(res.questions[0]?.stem).toBe('看图选择  哪个对？');
    expect(res.warnings[0]).toContain('忽略了 1 个图片链接');
  });

  it('导出的 Markdown 能再次导入（往返一致）', () => {
    const original = [
      q('single', '单选题题干', ['甲', '乙', '丙'], '1', '解析一'),
      q('multiple', '多选题题干', ['甲', '乙', '丙', '丁'], '0,3'),
      q('judge', '判断题题干', [], 'T'),
      q('fill', '填空题题干', [], 'main|Main'),
      q('short', '简答题题干', [], '封装、继承、多态'),
    ];
    const md = questionsToMarkdown({ title: '往返测试', questions: original });
    const back = parseQuestionText(md);
    expect(back.errors).toEqual([]);
    expect(back.questions).toHaveLength(5);
    expect(back.questions.map((r) => [r.type, r.stem, r.options.length, r.answer, r.analysis])).toEqual(
      original.map((o) => [o.type, o.stem, (JSON.parse(o.options) as string[]).length, o.answer, o.analysis]),
    );
  });

  it('不含答案导出（学生版试卷）不会带 答案/解析 行', () => {
    const md = questionsToMarkdown({
      title: '学生版',
      questions: [q('single', '题', ['甲', '乙'], '0', '解析')],
      withAnswers: false,
    });
    expect(md).not.toContain('答案：');
    expect(md).not.toContain('解析：');
  });
});

describe('ZIP 与 docx 读写（零依赖）', () => {
  it('ZIP 写读往返（含中文文件名与二进制内容）', () => {
    const data = Buffer.from([0, 1, 2, 253, 254, 255]);
    const zip = createZip([
      { name: 'word/document.xml', data: Buffer.from('<xml>中文</xml>', 'utf8') },
      { name: 'word/media/图片.png', data },
    ]);
    const back = readZip(zip);
    expect(back.get('word/document.xml')?.toString('utf8')).toBe('<xml>中文</xml>');
    expect(back.get('word/media/图片.png')).toEqual(data);
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926); // 标准 CRC32 测试向量
  });

  it('docx 写出后能读回文本（段落与换行保留）', () => {
    const docx = buildDocx({
      title: '题库',
      blocks: [
        { type: 'title', text: '题库' },
        { type: 'subtitle', text: '共 1 题' },
        { type: 'heading', text: '1. 单选题' },
        { type: 'text', text: '题干第一行\n题干第二行' },
        { type: 'option', text: 'A. 甲' },
        { type: 'option', text: 'B. 乙' },
        { type: 'answer', text: '答案：A' },
        { type: 'analysis', text: '解析：因为' },
      ],
      images: [],
    });
    expect(docx.subarray(0, 2).toString('utf8')).toBe('PK');
    const text = readDocxText(docx);
    expect(text).toContain('1. 单选题');
    expect(text).toContain('题干第一行\n题干第二行');
    expect(text).toContain('答案：A');
    expect(text).toContain('解析：因为');
  });

  it('docx 里的文本能按同一套规则解析成题目（Word 往返）', () => {
    const questions = [q('single', 'Word 里的题？', ['甲', '乙'], '1', '解析'), q('judge', '判断？', [], 'T')];
    const md = questionsToMarkdown({ title: 'T', questions });
    // 模拟「Markdown 转成 Word」：按行变成段落
    const docx = buildDocx({
      title: 'T',
      blocks: md
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => ({ type: 'text' as const, text: l })),
      images: [],
    });
    const parsed = parseQuestionText(readDocxText(docx));
    expect(parsed.errors).toEqual([]);
    expect(parsed.questions.map((r) => [r.type, r.stem, r.answer])).toEqual([
      ['single', 'Word 里的题？', '1'],
      ['judge', '判断？', 'T'],
    ]);
  });

  it('能读出 PNG / JPEG 像素尺寸（用于按比例插图）', () => {
    expect(imageSize(tinyPng())).toEqual({ width: 8, height: 5 });
    expect(imageSize(Buffer.from('不是图片'))).toBeNull();
  });

  it('docx 里的内嵌图片会被读出来，并在文本流里留下 [[img:N]] 标记', () => {
    const png = tinyPng(64, 32);
    const docx = buildDocx({
      title: '带图试卷',
      blocks: [
        { type: 'heading', text: '1. 单选题' },
        { type: 'text', text: '看下图，哪个是对的？' },
        { type: 'text', text: '[[img:1]]' },
        { type: 'option', text: 'A. 甲' },
        { type: 'option', text: 'B. 乙' },
        { type: 'answer', text: '答案：A' },
      ],
      images: [{ name: 'image1.png', data: png, widthPx: 64, heightPx: 32 }],
    });
    const content = readDocx(docx);
    expect(content.images).toHaveLength(1);
    expect(content.images[0]?.name).toBe('image1.png');
    expect(content.images[0]?.data.equals(png)).toBe(true);
    expect(content.paragraphs.join('\n')).toContain('[[img:1]]');
    // readDocxText 是纯文本视图，不带标记
    expect(readDocxText(docx)).not.toContain('[[img:');
  });

  it('图片标记会绑定到所在题目上（并提示只保留第一张）', () => {
    const parsed = parseQuestionText(
      [
        '### 1. 单选题',
        '看图？',
        '[[img:1]]',
        'A. 甲',
        'B. 乙',
        '答案：A',
        '',
        '### 2. 判断题',
        '两图？',
        '[[img:2]]',
        '[[img:3]]',
        '答案：对',
      ].join('\n'),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.questions[0]?.imageIndex).toBe(1);
    expect(parsed.questions[1]?.imageIndex).toBe(2);
    expect(parsed.warnings.some((w) => w.includes('只保留第一张'))).toBe(true);
    // 标记不能混进题干
    expect(parsed.questions[0]?.stem).toBe('看图？');
  });
});

describe('题库导入导出接口', () => {
  let app: FastifyInstance;
  let dataDir: string;
  let cookie = '';
  let bankId = 0;

  interface QuestionRow {
    id: number;
    type: string;
    stem: string;
    answer: string;
    image_path: string;
  }

  function json<T>(res: { json: () => unknown }): T {
    return res.json() as T;
  }

  async function listQuestions(): Promise<QuestionRow[]> {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/banks/${bankId}/questions`,
      headers: { cookie },
    });
    return json<{ questions?: QuestionRow[]; items?: QuestionRow[] }>(res).questions ?? [];
  }

  async function importFile(filename: string, data: Buffer, contentType = 'text/plain') {
    const boundary = '----mcTestBoundary';
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
        'utf8',
      ),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
    ]);
    return await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/import`,
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
  }

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-qformat-'));
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
    cookie = `microclass_sid=${login.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;
    const bank = await app.inject({
      method: 'POST',
      url: '/api/v1/banks',
      headers: { cookie },
      payload: { name: '格式测试题库' },
    });
    bankId = json<{ id: number }>(bank).id;
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('导入 Markdown：入库并可读回', async () => {
    const md = ['### 1. 单选题', 'MD 题干？', 'A. 甲', 'B. 乙', '答案：B'].join('\n');
    const res = await importFile('题目.md', Buffer.from(md, 'utf8'), 'text/markdown');
    expect(res.statusCode).toBe(200);
    expect(json<{ inserted: number }>(res).inserted).toBe(1);
    const rows = await listQuestions();
    expect(rows.some((r) => r.stem === 'MD 题干？' && r.answer === '1')).toBe(true);
  });

  it('导入 .docx（Word）：抽出正文后按同一套规则解析', async () => {
    const docx = buildDocx({
      title: '教师手写题库',
      blocks: [
        { type: 'heading', text: '第 1 题 · 多选题' },
        { type: 'text', text: 'Word 多选题题干？' },
        { type: 'option', text: 'A. 甲' },
        { type: 'option', text: 'B. 乙' },
        { type: 'option', text: 'C. 丙' },
        { type: 'answer', text: '答案：AC' },
      ],
      images: [],
    });
    const res = await importFile(
      '题库.docx',
      docx,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(res.statusCode).toBe(200);
    expect(json<{ inserted: number }>(res).inserted).toBe(1);
    const rows = await listQuestions();
    expect(rows.some((r) => r.stem === 'Word 多选题题干？' && r.answer === '0,2')).toBe(true);
  });

  it('导入失败逐题报错，不阻断其它题', async () => {
    const md = ['单选题', '坏题？', 'A. 甲', 'B. 乙', '答案：X', '', '判断题', '好题。', '答案：对'].join('\n');
    const res = await importFile('混合.md', Buffer.from(md, 'utf8'), 'text/markdown');
    const body = json<{ inserted: number; errors: string[] }>(res);
    expect(body.inserted).toBe(1);
    expect(body.errors[0]).toContain('单选答案应为单个字母');
  });

  it('不支持的扩展名被拒绝，并说明支持哪些格式', async () => {
    const res = await importFile('题库.xlsx', Buffer.from('x'), 'application/vnd.ms-excel');
    expect(res.statusCode).toBe(400);
    expect(json<{ error: { message: string } }>(res).error.message).toContain('docx');
  });

  it('导出 Markdown 与 Word，且 Word 可再次导入', async () => {
    const md = await app.inject({ method: 'GET', url: `/api/v1/banks/${bankId}/export.md`, headers: { cookie } });
    expect(md.statusCode).toBe(200);
    expect(md.headers['content-type']).toContain('text/markdown');
    expect(md.body).toContain('# 格式测试题库');
    expect(md.body).toContain('答案：');

    const docx = await app.inject({ method: 'GET', url: `/api/v1/banks/${bankId}/export.docx`, headers: { cookie } });
    expect(docx.statusCode).toBe(200);
    expect(docx.headers['content-type']).toContain('wordprocessingml.document');
    expect(docx.rawPayload.subarray(0, 2).toString('utf8')).toBe('PK');

    // 导出的试卷（不含答案）也不能带「答案：」
    const paper = await app.inject({
      method: 'GET',
      url: `/api/v1/banks/${bankId}/export.docx?answers=0`,
      headers: { cookie },
    });
    expect(readDocxText(paper.rawPayload)).not.toContain('答案：');

    // Word 往返：导出的 docx 再导入到新题库，题目数量一致
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/banks',
      headers: { cookie },
      payload: { name: '往返题库' },
    });
    const targetId = json<{ id: number }>(created).id;
    const before = (await listQuestions()).length;
    bankId = targetId;
    const back = await importFile(
      '往返.docx',
      docx.rawPayload,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(json<{ inserted: number }>(back).inserted).toBe(before);
    bankId = bankId === targetId ? targetId : bankId;
  });

  it('导入带配图的 Word：图片按题落库，并能通过 /question-images/:id 取回', async () => {
    const png = tinyPng(64, 32);
    const docx = buildDocx({
      title: '带图试卷',
      blocks: [
        { type: 'heading', text: '1. 单选题' },
        { type: 'text', text: '看图选一个？' },
        { type: 'text', text: '[[img:1]]' },
        { type: 'option', text: 'A. 甲' },
        { type: 'option', text: 'B. 乙' },
        { type: 'answer', text: '答案：B' },
      ],
      images: [{ name: 'image1.png', data: png, widthPx: 64, heightPx: 32 }],
    });
    const res = await importFile(
      '带图.docx',
      docx,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(res.statusCode).toBe(200);
    expect(json<{ inserted: number }>(res).inserted).toBe(1);

    const rows = await listQuestions();
    const hit = rows.find((r) => r.stem === '看图选一个？');
    expect(hit?.image_path).toBeTruthy();

    const img = await app.inject({
      method: 'GET',
      url: `/api/v1/question-images/${hit?.id}`,
      headers: { cookie },
    });
    expect(img.statusCode).toBe(200);
    expect(img.rawPayload.equals(png)).toBe(true);
  });

  it('导出 Word：题面里的内联题图（内容寻址）会被内嵌，而不是留成 Markdown 文本', async () => {
    // 题库导入的图片存在 uploads/question-media 下（内容寻址），先按同样的方式存一张
    const png = tinyPng(96, 48);
    const media = new QuestionMediaStore(dataDir);
    const saved = media.save(png);
    expect(saved).not.toBeNull();
    const url = saved?.url ?? '';

    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions`,
      headers: { cookie },
      payload: {
        bankId,
        type: 'fill',
        stem: `如图，求 $x$ 的值。\n\n![](${url})`,
        answer: '42',
        difficulty: 'easy',
      },
    });
    expect(created.statusCode).toBe(200);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/banks/${bankId}/export.docx`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const content = readDocx(res.rawPayload);
    // 题库里还有别的带图题，这里只要求「我们这张内联题图被内嵌进来」
    const embedded = content.images.filter((img) => img.data.equals(png));
    expect(embedded).toHaveLength(1);
    const text = content.paragraphs.join('\n');
    expect(text).toContain('如图，求');
    expect(text).not.toContain('question-media'); // 图片链接已被换成内嵌图片
    // 图片是按 sha1 存的内容寻址文件名
    const digest = createHash('sha1').update(png).digest('hex');
    expect(saved?.file.startsWith(digest)).toBe(true);
  });

  it('Word 里的图片格式不受支持时只提示，题目照常导入', async () => {
    const docx = buildDocx({
      title: '不支持的图',
      blocks: [
        { type: 'heading', text: '1. 判断题' },
        { type: 'text', text: '图文题？' },
        { type: 'text', text: '[[img:1]]' },
        { type: 'answer', text: '答案：对' },
      ],
      images: [{ name: 'image1.wmf', data: Buffer.from('not-an-image'), widthPx: 10, heightPx: 10 }],
    });
    const res = await importFile(
      'wmf.docx',
      docx,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    const body = json<{ inserted: number; warnings: string[] }>(res);
    expect(body.inserted).toBe(1);
    expect(body.warnings.some((w) => w.includes('格式不受支持'))).toBe(true);

    const rows = await listQuestions();
    expect(rows.find((r) => r.stem === '图文题？')?.image_path ?? '').toBe('');
  });

  it('模板可下载（CSV 与 Markdown）', async () => {
    const csv = await app.inject({ method: 'GET', url: '/api/v1/banks/template.csv', headers: { cookie } });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain('题型');
    const tpl = await app.inject({ method: 'GET', url: '/api/v1/banks/template.md', headers: { cookie } });
    expect(tpl.statusCode).toBe(200);
    expect(tpl.body).toContain('题目导入模板');
    expect(tpl.body).toContain('答案：');
  });

  it('学生不能导入/导出（越权矩阵）', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: `qs_${Date.now().toString(36)}`, password: 'pass1234' },
    });
    const studentCookie = `microclass_sid=${reg.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;
    const exp = await app.inject({
      method: 'GET',
      url: `/api/v1/banks/${bankId}/export.docx`,
      headers: { cookie: studentCookie },
    });
    expect(exp.statusCode).toBe(403);
    const imp = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/import`,
      headers: { cookie: studentCookie, 'content-type': 'text/plain' },
      payload: 'x',
    });
    expect(imp.statusCode).toBe(403);
  });
});
