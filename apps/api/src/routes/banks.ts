/**
 * 题库与题目路由：题库/题目 CRUD、CSV / Markdown / Word 导入导出与模板、题目配图。
 */
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import { AppError, type QuestionType } from '@microclass/shared';
import { requireTeacherOrAdmin, requireUser } from '../http/guards.js';
import { sendFileWithRange } from '../utils/range.js';
import { mimeFor } from '../utils/mime.js';
import { csvHeaders } from '../utils/csv.js';
import { textHeaders, docxHeaders } from '../utils/download.js';
import type { Deps } from '../app.js';
import type { BankDto, QuestionDto } from '../services/bankService.js';

const bankBodySchema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    lessonId: { type: ['integer', 'null'] },
    // 标准化元数据：新建题目会继承题库的学科/书册，难度模型据此判断学段基准
    kind: { type: 'string', enum: ['lesson', 'chapter', 'paper', ''] },
    subject: { type: 'string', maxLength: 40 },
    book: { type: 'string', maxLength: 80 },
    /** 归属课程（目录树/组卷题池用）；`null` = 移出课程 */
    courseId: { type: ['integer', 'null'] },
  },
  additionalProperties: false,
} as const;

const questionBodySchema = {
  type: 'object',
  required: ['bankId', 'type', 'stem'],
  properties: {
    bankId: { type: 'integer' },
    lessonId: { type: ['integer', 'null'] },
    type: { type: 'string', enum: ['single', 'multiple', 'judge', 'fill', 'short'] },
    stem: { type: 'string', minLength: 1, maxLength: 4000 },
    options: { type: 'array', items: { type: 'string', maxLength: 1000 }, maxItems: 26 },
    answer: { type: 'string', maxLength: 2000 },
    analysis: { type: 'string', maxLength: 4000 },
    sort: { type: 'integer' },
    imagePath: { type: 'string', maxLength: 300 },
    /**
     * 难度：easy / medium / hard（空串 = 不指定，交给难度模型）。
     * 注意：这个字段以前**漏在 schema 里**，而 schema 是 `additionalProperties: false`
     * + `removeAdditional`，于是老师从界面提交的难度被静默丢掉 —— 这就是「有难度下拉框但
     * 题目难度一直没被划分」的原因。
     */
    difficulty: { type: 'string', enum: ['', 'easy', 'medium', 'hard'] },
    /**
     * 标准化元数据（学科 / 学段 / 册次 / 章节 / 知识点）。
     * 和上面 difficulty 是**同一类坑**：schema 是 additionalProperties:false + removeAdditional，
     * 漏声明就会被静默丢掉 —— 而"按章节/知识点组卷"完全依赖这几个字段，
     * 丢了以后老师在组卷页勾章节永远是空结果。`QuestionDto` 一直都支持它们，是 schema 漏了。
     */
    subject: { type: 'string', maxLength: 40 },
    stage: { type: 'string', maxLength: 20 },
    book: { type: 'string', maxLength: 80 },
    chapter: { type: 'string', maxLength: 120 },
    point: { type: 'string', maxLength: 120 },
  },
  additionalProperties: false,
} as const;

export async function registerBankRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /**
   * 题库列表。
   * `lesson=orphan` 只看没有课时归属的题库；`kind=lesson|chapter|paper` 按题库类型筛选
   * （章节题库 / 整卷试卷是「全量导入」进来的，量很大，管理端要能筛）。
   */
  app.get('/banks', async (req, reply) => {
    requireUser(req, reply);
    const q = req.query as {
      lesson?: string;
      kind?: string;
      subject?: string;
      book?: string;
      keyword?: string;
      courseId?: string;
      limit?: string;
      offset?: string;
    };
    const filter: {
      lessonId?: number | null;
      kind?: 'lesson' | 'chapter' | 'paper';
      subject?: string;
      book?: string;
      keyword?: string;
      courseId?: number | null;
      limit?: number;
      offset?: number;
    } = {};
    if (q.lesson === 'orphan') filter.lessonId = null;
    else if (q.lesson !== undefined && q.lesson !== '') {
      const lessonId = Number.parseInt(q.lesson, 10);
      if (Number.isNaN(lessonId)) throw AppError.badRequest('lesson 参数非法');
      filter.lessonId = lessonId;
    }
    if (q.kind) {
      if (!['lesson', 'chapter', 'paper'].includes(q.kind))
        throw AppError.badRequest('kind 只能是 lesson/chapter/paper');
      filter.kind = q.kind as 'lesson' | 'chapter' | 'paper';
    }
    if (q.subject) filter.subject = q.subject;
    if (q.book) filter.book = q.book;
    if (q.keyword) filter.keyword = q.keyword;
    if (q.courseId === 'unbound') filter.courseId = null;
    else if (q.courseId) {
      const courseId = Number.parseInt(q.courseId, 10);
      if (Number.isNaN(courseId)) throw AppError.badRequest('courseId 参数非法');
      filter.courseId = courseId;
    }
    // 分页：全库 1.2 万个题库，一次全拉既慢又没法用（页面默认取前 300 个）
    const limit = q.limit === undefined || q.limit === '' ? 300 : Number.parseInt(q.limit, 10);
    if (Number.isNaN(limit) || limit < 1) throw AppError.badRequest('limit 参数非法');
    const offset = q.offset === undefined || q.offset === '' ? 0 : Number.parseInt(q.offset, 10);
    if (Number.isNaN(offset) || offset < 0) throw AppError.badRequest('offset 参数非法');
    filter.limit = limit;
    filter.offset = offset;
    return { banks: deps.bankService.list(filter), total: deps.bankService.countBanks(filter) };
  });

  /**
   * 题库目录树（筛选用）：
   *   - 不带 `courseId`：返回课程列表（含题库数/题量）+ 未归属课程统计；
   *   - 带 `courseId`：返回该课程的「章节（课时分组）→ 小节 → 题库」以及不挂课时的章节题库/整卷试卷。
   */
  app.get('/banks/catalog', async (req, reply) => {
    requireUser(req, reply);
    const q = req.query as { courseId?: string };
    if (q.courseId) {
      const courseId = Number.parseInt(q.courseId, 10);
      if (Number.isNaN(courseId)) throw AppError.badRequest('courseId 参数非法');
      return deps.bankService.catalogCourse(courseId);
    }
    return deps.bankService.catalog();
  });

  /** 一键回填题库归属课程（课时推导 + 册次匹配），匹配不上的留在「未归属」 */
  /** 按册次批量挂课程（未归属题库的批量归类） */
  app.post(
    '/banks/bind-by-book',
    {
      schema: {
        body: {
          type: 'object',
          required: ['book'],
          properties: {
            book: { type: 'string', minLength: 1, maxLength: 120 },
            courseId: { type: ['integer', 'null'] },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const actor = requireTeacherOrAdmin(req, reply);
      const { book, courseId } = req.body as { book: string; courseId?: number | null };
      return deps.bankService.bindUnboundByBook(actor, book, courseId ?? null);
    },
  );

  app.post('/banks/rebind-courses', async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    return deps.bankService.rebindCourses(actor);
  });

  /**
   * 兜底重算题库题量（迁移 0019 的预计算列）。
   * 正常写题目都会维护这一列；只有运维脚本直接用 SQL 改题目后才需要跑一次。
   */
  app.post('/banks/fix-question-counts', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const fixed = deps.questions.fixBankQuestionCounts();
    return { ok: true, fixed };
  });

  /** 题库体检（教师/管理员）：标准化元数据覆盖率 + 质量统计 + 重复题明细；结果缓存 5 分钟，`refresh=1` 强制重算 */
  app.get('/banks/health', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const q = req.query as { bankId?: string; limit?: string; refresh?: string };
    const bankId = q.bankId ? Number.parseInt(q.bankId, 10) : undefined;
    if (q.bankId !== undefined && !Number.isInteger(bankId)) throw AppError.badRequest('bankId 参数非法');
    const limit = q.limit ? Math.min(100, Math.max(1, Number.parseInt(q.limit, 10))) : 20;
    return deps.bankService.health(bankId, limit, { refresh: q.refresh === '1' });
  });

  app.post('/banks', { schema: { body: bankBodySchema } }, async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    return { ok: true, id: deps.bankService.create(user, req.body as BankDto) };
  });

  app.get('/banks/:id', async (req, reply) => {
    requireUser(req, reply);
    return deps.bankService.detail(Number((req.params as { id: string }).id));
  });

  app.put('/banks/:id', { schema: { body: bankBodySchema } }, async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    deps.bankService.update(user, Number((req.params as { id: string }).id), req.body as BankDto);
    return { ok: true };
  });

  app.delete('/banks/:id', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    deps.bankService.remove(user, Number((req.params as { id: string }).id));
    return { ok: true };
  });

  /** 整卷试卷题库 → 一键建考试（多样化：期中/期末/单元测试卷直接变成考试） */
  app.post('/banks/:id/exam', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as {
      courseId?: number;
      title?: string;
      durationMinutes?: number;
      passScore?: number;
      publish?: boolean;
    };
    return {
      ok: true,
      ...deps.bankService.createExamFromBank(
        user,
        id,
        {
          courseId: Number(body.courseId),
          ...(body.title === undefined ? {} : { title: String(body.title) }),
          ...(body.durationMinutes === undefined ? {} : { durationMinutes: Number(body.durationMinutes) }),
          ...(body.passScore === undefined ? {} : { passScore: Number(body.passScore) }),
          ...(body.publish === undefined ? {} : { publish: Boolean(body.publish) }),
        },
        deps.examService,
      ),
    };
  });

  /** 题库内去重（「题干+选项」指纹相同且答案一致的重复题只保留一条）；默认 dry-run 预览 */
  app.post('/banks/:id/dedupe', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { dryRun?: boolean };
    return { ok: true, ...deps.bankService.dedupeBank(user, id, { dryRun: body.dryRun !== false }) };
  });

  /** 跨题库按知识点/书册/难度找题（聚合浏览、组卷选题用） */
  app.get('/questions/search', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const q = req.query as {
      subject?: string;
      book?: string;
      chapter?: string;
      point?: string;
      difficulty?: string;
      type?: string;
      page?: string;
      pageSize?: string;
    };
    return deps.bankService.searchQuestions({
      ...(q.subject ? { subject: q.subject } : {}),
      ...(q.book ? { book: q.book } : {}),
      ...(q.chapter ? { chapter: q.chapter } : {}),
      ...(q.point ? { point: q.point } : {}),
      ...(q.difficulty ? { difficulty: q.difficulty } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.page ? { page: Number.parseInt(q.page, 10) } : {}),
      ...(q.pageSize ? { pageSize: Number.parseInt(q.pageSize, 10) } : {}),
    });
  });

  /** 题库内题目列表（支持题型/难度筛选、关键词搜索、分页） */
  app.get('/banks/:id/questions', async (req, reply) => {
    requireUser(req, reply);
    const q = req.query as {
      type?: string;
      keyword?: string;
      difficulty?: string;
      mediaOnlyAnalysis?: string;
      page?: string;
      pageSize?: string;
    };
    return deps.bankService.listQuestions(Number((req.params as { id: string }).id), {
      ...(q.type ? { type: q.type as QuestionType } : {}),
      ...(q.keyword ? { keyword: q.keyword } : {}),
      ...(q.difficulty ? { difficulty: q.difficulty } : {}),
      // 「解析只有图片」的题：图片里是解析文字，搜不到也改不了，教师需要能把它们筛出来
      ...(q.mediaOnlyAnalysis === '1' ? { mediaOnlyAnalysis: true } : {}),
      ...(q.page ? { page: Number.parseInt(q.page, 10) } : {}),
      ...(q.pageSize ? { pageSize: Number.parseInt(q.pageSize, 10) } : {}),
    });
  });

  app.post('/banks/:id/questions', { schema: { body: questionBodySchema } }, async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const bankId = Number((req.params as { id: string }).id);
    const body = req.body as QuestionDto;
    return { ok: true, id: deps.bankService.createQuestion(user, { ...body, bankId }) };
  });

  app.get('/questions/:id', async (req, reply) => {
    requireUser(req, reply);
    const id = Number((req.params as { id: string }).id);
    return { question: deps.bankService.findQuestion(id) ?? throwNotFound() };
  });

  /** 批量操作的 body：ids 上限 500（一次多选一页以内的量级） */
  const bulkIdsSchema = {
    type: 'object',
    required: ['ids'],
    properties: {
      ids: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'integer' } },
    },
    additionalProperties: false,
  };

  const bulkDifficultySchema = {
    type: 'object',
    required: ['ids', 'difficulty'],
    properties: {
      ids: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'integer' } },
      difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
    },
    additionalProperties: false,
  };

  /** 批量删除所选题目 */
  app.post('/banks/:id/questions/bulk-delete', { schema: { body: bulkIdsSchema } }, async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const bankId = Number((req.params as { id: string }).id);
    const { ids } = req.body as { ids: number[] };
    return deps.bankService.removeQuestions(user, bankId, ids);
  });

  /** 批量设置难度（人工标注，重算难度不会覆盖） */
  app.post('/banks/:id/questions/bulk-difficulty', { schema: { body: bulkDifficultySchema } }, async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const bankId = Number((req.params as { id: string }).id);
    const { ids, difficulty } = req.body as { ids: number[]; difficulty: 'easy' | 'medium' | 'hard' };
    return deps.bankService.setQuestionsDifficulty(user, bankId, ids, difficulty);
  });

  app.put('/questions/:id', { schema: { body: questionBodySchema } }, async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    deps.bankService.updateQuestion(user, Number((req.params as { id: string }).id), req.body as QuestionDto);
    return { ok: true };
  });

  app.delete('/questions/:id', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    deps.bankService.removeQuestion(user, Number((req.params as { id: string }).id));
    return { ok: true };
  });

  /** 题目配图上传（multipart，仅图片） */
  app.post('/questions/:id/image', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    const file = await req.file();
    if (!file) throw AppError.badRequest('请选择图片文件');
    const data = await file.toBuffer();
    const imagePath = deps.bankService.attachImage(user, id, {
      fileName: file.filename,
      data,
      mimeType: file.mimetype,
    });
    return { ok: true, imagePath };
  });

  /**
   * 批量导入题目（含图片）：资料提炼结果一次灌进题库。
   * multipart：`manifest`（JSON）+ 若干文件字段（字段名对应 manifest 里每题的 `image`）。
   * 逐题独立处理，单题失败不影响其它题，返回失败清单。
   */
  app.post('/banks/:id/questions/batch', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const bankId = Number((req.params as { id: string }).id);
    if (!req.isMultipart()) throw AppError.badRequest('请以 multipart 方式上传（字段 manifest + 图片文件）');
    let manifest = '';
    const files = new Map<string, { fileName: string; data: Buffer; mimeType: string }>();
    /** `mediaN` 字段 = 题干里 `[[img:N]]` 对应的图片（一份资料一个请求，避免限流） */
    const mediaFiles = new Map<number, { fileName: string; data: Buffer; mimeType: string }>();
    let parts: AsyncIterable<unknown>;
    try {
      parts = req.parts() as AsyncIterable<unknown>;
    } catch {
      throw AppError.badRequest('请以 multipart 方式上传');
    }
    try {
      for await (const part of parts as AsyncIterable<{
        type: string;
        fieldname: string;
        filename?: string;
        mimetype?: string;
        toBuffer: () => Promise<Buffer>;
        value?: unknown;
      }>) {
        if (part.type === 'file') {
          const value = {
            fileName: part.filename ?? 'upload',
            data: await part.toBuffer(),
            mimeType: part.mimetype ?? 'application/octet-stream',
          };
          const mediaIdx = /^media(\d+)$/.exec(part.fieldname);
          if (mediaIdx) mediaFiles.set(Number(mediaIdx[1]), value);
          else files.set(part.fieldname, value);
        } else if (part.fieldname === 'manifest') {
          const raw: unknown = part.value;
          if (typeof raw === 'string') manifest = raw;
          else if (Buffer.isBuffer(raw)) manifest = raw.toString('utf8');
        }
      }
    } catch (e) {
      // busboy 的文件数/分片超限要变成可读的 4xx，而不是 500
      const code = (e as { code?: string }).code ?? '';
      if (code === 'FST_FILES_LIMIT' || code === 'FST_PARTS_LIMIT') {
        throw AppError.badRequest('这次携带的图片太多，请把资料分成几批导入（每批 ≤ 400 张图）');
      }
      throw e;
    }
    if (mediaFiles.size > 400) {
      throw AppError.badRequest(`一次最多携带 400 张题图（本次 ${mediaFiles.size} 张），请分批导入`);
    }
    if (manifest.trim() === '') throw AppError.badRequest('缺少 manifest（题目清单 JSON）');
    let parsed: { questions?: unknown };
    try {
      parsed = JSON.parse(manifest) as { questions?: unknown };
    } catch {
      throw AppError.badRequest('manifest 不是合法 JSON');
    }
    if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      throw AppError.badRequest('manifest.questions 必须是非空数组');
    }
    if (parsed.questions.length > 500) throw AppError.badRequest('一次最多导入 500 题，请分批');
    return deps.bankService.importQuestions(user, bankId, parsed.questions, files, mediaFiles);
  });

  /** 题目配图访问（内联） */
  app.get('/question-images/:id', async (req, reply) => {
    requireUser(req, reply);
    const id = Number((req.params as { id: string }).id);
    const question = deps.bankService.findQuestion(id);
    if (!question) throw AppError.notFound('题目不存在');
    const abs = deps.bankService.resolveImage(question);
    if (!abs) throw AppError.notFound('配图不存在');
    return sendFileWithRange(req, reply, abs);
  });

  /**
   * 上传题图（内容寻址，自动去重）：返回可直接写进题干的 `![](url)` 用法。
   * 用于"资料里的公式/图形是一张图"的场景 —— 只有把图按原位内联，题目才完整。
   */
  app.post('/question-media', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    if (!req.isMultipart()) throw AppError.badRequest('请以 multipart 方式上传（文件字段名 file）');
    const file = await req.file();
    if (!file) throw AppError.badRequest('请选择图片文件');
    const data = await file.toBuffer();
    const saved = deps.questionMedia.save(data);
    if (!saved) throw AppError.badRequest('只支持 PNG / JPEG / GIF / WebP 图片');
    deps.audit.write({
      actorId: user.id,
      actorName: user.username,
      action: 'question_media.upload',
      targetType: 'media',
      detail: { file: saved.file, bytes: data.length },
    });
    return { url: saved.url, relPath: saved.relPath, file: saved.file, deduped: saved.deduped };
  });

  /**
   * 题目图片（内容寻址）：题干/选项/解析里的 `![](/api/v1/question-media/<sha1>.png)` 走这里。
   * 文件名严格校验（40 位 sha1 + 白名单扩展名），内容不会变所以可长缓存。
   */
  app.get('/question-media/:file', async (req, reply) => {
    requireUser(req, reply);
    const file = (req.params as { file: string }).file;
    const abs = deps.questionMedia.resolve(file);
    if (!abs) throw AppError.notFound('图片不存在');
    reply.header('content-type', mimeFor(abs));
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    return reply.send(fs.createReadStream(abs));
  });

  /** 导出题库 CSV */
  app.get('/banks/:id/export.csv', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const { filename, body } = deps.bankService.exportCsv(Number((req.params as { id: string }).id));
    return reply.headers(csvHeaders(filename)).send(body);
  });

  /** 下载导入模板 CSV */
  app.get('/banks/template.csv', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const { filename, body } = deps.bankService.templateCsv();
    return reply.headers(csvHeaders(filename)).send(body);
  });

  /** 导出题库 Markdown（人可读，可再次导入） */
  app.get('/banks/:id/export.md', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const withAnswers = (req.query as { answers?: string }).answers !== '0';
    const { filename, body } = deps.bankService.exportMarkdown(Number((req.params as { id: string }).id), {
      withAnswers,
    });
    return reply.headers(textHeaders(filename, 'text/markdown; charset=utf-8')).send(body);
  });

  /** 下载 Markdown 导入模板（Markdown / Word 通用写法） */
  app.get('/banks/template.md', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const { filename, body } = deps.bankService.templateMarkdown();
    return reply.headers(textHeaders(filename, 'text/markdown; charset=utf-8')).send(body);
  });

  /** 导出题库 Word（.docx，含内嵌配图；`?answers=0` 导出不含答案解析的试卷） */
  app.get('/banks/:id/export.docx', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const withAnswers = (req.query as { answers?: string }).answers !== '0';
    const { filename, body } = deps.bankService.exportDocx(Number((req.params as { id: string }).id), { withAnswers });
    return reply.headers(docxHeaders(filename)).send(body);
  });

  /**
   * 导入题目（multipart 上传文件）：
   * `.csv`（Excel）/ `.md`、`.txt`（纯文本题块）/ `.docx`（Word，抽出正文后按同一套规则解析）
   */
  app.post('/banks/:id/import', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    const file = await req.file();
    if (!file) throw AppError.badRequest('请选择要导入的文件');
    const name = file.filename.toLowerCase();
    const allowed = /\.(csv|md|markdown|txt|docx)$/i.test(name);
    if (!allowed) {
      throw AppError.badRequest('支持 CSV（Excel）、Markdown（.md/.txt）与 Word（.docx）');
    }
    const data = await file.toBuffer();
    if (data.length === 0) throw AppError.badRequest('文件内容为空');
    if (data.length > 20 * 1024 * 1024) throw AppError.badRequest('文件过大（上限 20MB）');

    const result = deps.bankService.importFile(user, id, { filename: name, data });
    return { ok: true, ...result };
  });
}

function throwNotFound(): never {
  throw AppError.notFound('题目不存在');
}
