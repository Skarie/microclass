/**
 * 考试中心路由：课程考试列表、考试 CRUD、组卷、作答、成绩单。
 */
import type { FastifyInstance } from 'fastify';
import { normalizeBlueprintCells, type BlueprintCell } from '../domain/blueprint.js';
import { AppError, type QuestionType } from '@microclass/shared';
import { requireTeacherOrAdmin, requireUser } from '../http/guards.js';
import { csvHeaders, toCsv } from '../utils/csv.js';
import type { Deps } from '../app.js';
import type { ExamDto } from '../services/examService.js';

/**
 * 选题筛选：册次/章节/知识点/题型/难度都支持**多选**（左树勾选多个节点是常态）。
 * 兼容两种传法：`?points=a&points=b`（重复参数）与 `?points=a,b`（逗号分隔）。
 */
const TYPES = ['single', 'multiple', 'judge', 'fill', 'short'] as const;
const LEVELS = ['easy', 'medium', 'hard'] as const;

function listParam(source: Record<string, unknown>, key: string): string[] {
  const raw = source[key];
  const out: string[] = [];
  const push = (v: unknown): void => {
    if (typeof v !== 'string') return;
    for (const part of v.split(',')) {
      const t = part.trim();
      if (t !== '') out.push(t);
    }
  };
  if (Array.isArray(raw)) raw.forEach(push);
  else push(raw);
  return [...new Set(out)];
}

/** 从查询串/请求体里解析出题库筛选条件（与 ExamRepository.pick 的参数同名） */
function poolFiltersFrom(source: Record<string, unknown>): {
  courseId?: number;
  type?: string;
  books?: string[];
  chapters?: string[];
  points?: string[];
  types?: string[];
  levels?: ('easy' | 'medium' | 'hard')[];
  keyword?: string;
  hasImage?: boolean;
  orderBy?: 'default' | 'difficulty_asc' | 'difficulty_desc' | 'error_desc';
} {
  const num = (key: string): number | undefined => {
    const v = source[key];
    if (typeof v !== 'string' || v === '') return undefined;
    const parsed = Number.parseInt(v, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  };
  const first = (key: string): string | undefined => {
    const v = source[key];
    if (typeof v === 'string' && v !== '') return v;
    if (Array.isArray(v) && typeof v[0] === 'string' && v[0] !== '') return v[0];
    return undefined;
  };
  const courseId = num('courseId');
  const types = listParam(source, 'types').filter((t) => (TYPES as readonly string[]).includes(t));
  const singleType = first('type');
  const levels = listParam(source, 'levels').filter((l): l is 'easy' | 'medium' | 'hard' =>
    (LEVELS as readonly string[]).includes(l),
  );
  const orderByRaw = first('orderBy');
  const keyword = first('keyword');
  const orderBy =
    orderByRaw === 'difficulty_asc' || orderByRaw === 'difficulty_desc' || orderByRaw === 'error_desc'
      ? orderByRaw
      : undefined;
  return {
    ...(courseId === undefined ? {} : { courseId }),
    ...(singleType ? { type: singleType } : {}),
    ...(listParam(source, 'books').length > 0 ? { books: listParam(source, 'books') } : {}),
    ...(listParam(source, 'chapters').length > 0 ? { chapters: listParam(source, 'chapters') } : {}),
    ...(listParam(source, 'points').length > 0 ? { points: listParam(source, 'points') } : {}),
    ...(types.length > 0 ? { types } : {}),
    ...(levels.length > 0 ? { levels } : {}),
    ...(keyword ? { keyword } : {}),
    ...(source['hasImage'] === '1' || source['hasImage'] === true ? { hasImage: true } : {}),
    ...(source['hasImage'] === '0' || source['hasImage'] === false ? { hasImage: false } : {}),
    ...(orderBy ? { orderBy } : {}),
  };
}

const examBodySchema = {
  type: 'object',
  required: ['courseId', 'title'],
  properties: {
    courseId: { type: 'integer' },
    title: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', maxLength: 4000 },
    durationMinutes: { type: 'integer', minimum: 1, maximum: 600 },
    passScore: { type: 'integer', minimum: 0, maximum: 100 },
    status: { type: 'string', enum: ['draft', 'published'] },
    // 考试设置（对标学习通）
    startAt: { type: 'integer', minimum: 0 },
    endAt: { type: 'integer', minimum: 0 },
    attemptLimit: { type: 'integer', minimum: 0, maximum: 99 },
    shuffleQuestions: { type: 'boolean' },
    showAnswers: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

const submitSchema = {
  type: 'object',
  required: ['answers'],
  properties: {
    answers: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['qid'],
        properties: {
          qid: { type: 'integer' },
          answer: { type: 'string', maxLength: 4000 },
        },
        additionalProperties: false,
      },
    },
    startedAt: { type: 'integer' },
  },
  additionalProperties: false,
} as const;

export async function registerExamRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /** 课程下的考试列表（学生仅见已发布，并带本人成绩） */
  app.get('/courses/:id/exams', async (req, reply) => {
    const user = requireUser(req, reply);
    return deps.examService.listForCourse(user, Number((req.params as { id: string }).id));
  });

  /** 我的全部考试成绩 */
  app.get('/me/exams', async (req, reply) => {
    const user = requireUser(req, reply);
    return deps.statsService.meOverview(user);
  });

  app.post('/exams', { schema: { body: examBodySchema } }, async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    return { ok: true, id: deps.examService.create(user, req.body as ExamDto) };
  });

  app.get('/exams/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    const id = Number((req.params as { id: string }).id);
    const exam = deps.examService.findById(id);
    if (exam.status !== 'published' && user.role === 'student') throw AppError.notFound('考试未发布');
    return { exam };
  });

  app.put('/exams/:id', { schema: { body: examBodySchema } }, async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    deps.examService.update(user, Number((req.params as { id: string }).id), req.body as ExamDto);
    return { ok: true };
  });

  app.delete('/exams/:id', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    deps.examService.remove(user, Number((req.params as { id: string }).id));
    return { ok: true };
  });

  /** 组卷视图：已选题目 + 候选题池 */
  app.get('/exams/:id/paper', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    return deps.examService.paper(Number((req.params as { id: string }).id));
  });

  /**
   * 手工加题：两种方式
   *   ① `{ questionIds: [...] }` —— 勾选加入（前端已选中的题）；
   *   ② `{ filters: {...}, limit? }` —— **按当前筛选整批加入**（"全选筛选结果 N 题"），
   *      服务端自己取 id，避免把成千上万个 id 传到前端再传回来。
   */
  app.post('/exams/:id/questions', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    const body = req.body as { questionIds?: unknown; filters?: unknown; limit?: unknown };

    if (body?.filters && typeof body.filters === 'object') {
      const filters = poolFiltersFrom(body.filters as Record<string, unknown>);
      const limit = Math.min(5000, Math.max(1, Number(body.limit ?? 2000) || 2000));
      const ids = deps.exams.pickIds({ ...filters, cap: limit });
      if (ids.length === 0) throw AppError.badRequest('当前筛选条件下没有题目');
      const added = deps.examService.addQuestions(user, id, ids);
      return { ok: true, added, matched: ids.length, truncated: ids.length >= limit };
    }

    const ids = Array.isArray(body?.questionIds) ? body.questionIds.map((x) => Number(x)).filter((x) => x > 0) : [];
    if (ids.length === 0) throw AppError.badRequest('请选择要加入试卷的题目');
    return { ok: true, added: deps.examService.addQuestions(user, id, ids) };
  });

  /** 随机抽题 / 按题型配额 + 难度配额组卷 */
  app.post('/exams/:id/questions/random', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    const body = req.body as {
      count?: number;
      quota?: Partial<Record<QuestionType, number>>;
      difficultyQuota?: Partial<Record<'easy' | 'medium' | 'hard', number>>;
    };
    const difficultyQuota: Partial<Record<'easy' | 'medium' | 'hard', number>> = {};
    if (body?.difficultyQuota && typeof body.difficultyQuota === 'object') {
      for (const [k, v] of Object.entries(body.difficultyQuota)) {
        if (['easy', 'medium', 'hard'].includes(k)) difficultyQuota[k as 'easy' | 'medium' | 'hard'] = Number(v) || 0;
      }
      if (Object.keys(body.difficultyQuota).length > 0 && Object.keys(difficultyQuota).length === 0) {
        throw AppError.badRequest('难度配额只能是 easy / medium / hard');
      }
    }
    const hasDifficultyQuota = Object.values(difficultyQuota).some((n) => n > 0);
    if (body?.quota && typeof body.quota === 'object') {
      const quota: Partial<Record<QuestionType, number>> = {};
      for (const [k, v] of Object.entries(body.quota)) {
        if (['single', 'multiple', 'judge', 'fill', 'short'].includes(k)) quota[k as QuestionType] = Number(v) || 0;
      }
      if (Object.values(quota).every((n) => !n) && !hasDifficultyQuota) {
        throw AppError.badRequest('请至少为一种题型或难度指定数量');
      }
      return {
        ok: true,
        ...deps.examService.addByQuota(user, id, quota, hasDifficultyQuota ? difficultyQuota : undefined),
      };
    }
    if (hasDifficultyQuota) {
      return { ok: true, ...deps.examService.addByQuota(user, id, {}, difficultyQuota) };
    }
    const count = Number(body?.count ?? 5);
    if (!Number.isFinite(count) || count < 1) throw AppError.badRequest('抽题数量必须大于 0');
    return { ok: true, added: deps.examService.addRandom(user, id, Math.floor(count)) };
  });

  /**
   * 组卷挑题（智学网式工作台左侧）：
   * 课程/课时/题库范围 + 题型 / 难度档 / 难度分区间 / 知识点 / 章节 / 关键字 / 带图，
   * 支持排序与分页，并可选「排除已在卷内的题」。
   */
  app.get('/exams/:id/pool', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    const q = req.query as Record<string, string | undefined>;
    const num = (key: string): number | undefined => {
      if (q[key] === undefined || q[key] === '') return undefined;
      const v = Number.parseInt(q[key] ?? '', 10);
      return Number.isNaN(v) ? undefined : v;
    };
    const excludeInExam = q.excludeInExam === '1';
    const exclude = excludeInExam ? deps.exams.questionIds(id) : [];
    /**
     * 范围默认落到**本考试所属课程**（与 facets/points 一致）：
     * 早先这里只认显式 courseId，不传就等于全库 —— 老师以为在"本课程"里挑题，
     * 实际会把别门课的题混进试卷。要跨课程必须显式 scope=all。
     */
    const exam = deps.examService.findById(id);
    const poolScope = q.scope === 'all' ? 'all' : 'course';
    const baseFilters = poolFiltersFrom(q);
    const poolCourseId = poolScope === 'all' ? undefined : (baseFilters.courseId ?? exam.course_id);
    const picks: Parameters<typeof deps.exams.pick>[0] = {
      ...baseFilters,
      ...(poolCourseId === undefined ? {} : { courseId: poolCourseId }),
      ...(num('lessonId') === undefined ? {} : { lessonId: num('lessonId') }),
      ...(num('bankId') === undefined ? {} : { bankId: num('bankId') }),
      ...(q.difficulty ? { difficulty: q.difficulty } : {}),
      ...(num('levelMin') === undefined ? {} : { levelMin: num('levelMin') }),
      ...(num('levelMax') === undefined ? {} : { levelMax: num('levelMax') }),
      ...(q.point ? { point: q.point } : {}),
      ...(q.chapter ? { chapter: q.chapter } : {}),
      exclude,
    };
    const page = Math.max(1, num('page') ?? 1);
    const pageSize = Math.min(50, Math.max(1, num('pageSize') ?? 20));

    /**
     * 易错题模式（orderBy=error_desc）：
     *   - 取一个更大的候选窗口（最多 200 条）再按"错误率平滑分"排序 —— 错误率不在数据库里，
     *     无法在 SQL 层排序，这个窗口足够覆盖一页挑题；
     *   - 默认只保留**至少作答 2 次**的题（minAttempts 可调）：真机上大量题只有 1 次作答，
     *     否则"答 1 次错 1 次 = 100%"的噪声会霸榜，老师挑到的其实是没数据的题。
     */
    if (q.orderBy === 'error_desc') {
      const minAttempts = Math.max(1, num('minAttempts') ?? 2);
      const stats = deps.questionStats.errorByQuestion();
      const window = deps.exams.pick({ ...picks, limit: 200 });
      const enriched = window
        .map((row) => {
          const stat = stats.get(row.id);
          return {
            id: row.id,
            stem: row.stem,
            type: row.type,
            bank_id: row.bank_id,
            bank_name: row.bank_name,
            point: row.point,
            book: row.book,
            difficulty: row.difficulty,
            difficulty_score: row.difficulty_score,
            attempts: stat?.attempts ?? 0,
            wrong: stat?.wrong ?? 0,
            error_rate: stat ? Math.round(stat.rate * 1000) / 1000 : 0,
            error_score: stat?.score ?? 0,
          };
        })
        .filter((row) => row.attempts >= minAttempts)
        .sort((a, b) => b.error_score - a.error_score || b.attempts - a.attempts);
      const start = (page - 1) * pageSize;
      return {
        total: enriched.length,
        page,
        pageSize,
        orderBy: 'error_desc',
        minAttempts,
        statsCachedAt: deps.questionStats.cachedAt(),
        questions: enriched.slice(start, start + pageSize),
      };
    }

    const items = deps.exams.pick({ ...picks, limit: pageSize, offset: (page - 1) * pageSize });
    const statMap = deps.questionStats.errorByQuestion();
    return {
      total: deps.exams.pickCount(picks),
      page,
      pageSize,
      questions: items.map((row) => {
        const stat = statMap.get(row.id);
        return {
          id: row.id,
          stem: row.stem,
          type: row.type,
          bank_id: row.bank_id,
          bank_name: row.bank_name,
          point: row.point,
          book: row.book,
          difficulty: row.difficulty,
          difficulty_score: row.difficulty_score,
          // 普通模式也带上错率，界面可以直接显示「错率 50%（2 次作答）」
          attempts: stat?.attempts ?? 0,
          wrong: stat?.wrong ?? 0,
          error_rate: stat ? Math.round(stat.rate * 1000) / 1000 : 0,
          error_score: stat?.score ?? 0,
        };
      }),
    };
  });

  /**
   * 选题树（册次 → 章节，带题量）+ 题型/难度/题库计数。
   * 主流组卷系统的左树就是这两层；计数跟随题型/难度/关键词筛选变化。
   */
  app.get('/exams/:id/facets', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    const exam = deps.examService.findById(id);
    const q = req.query as Record<string, unknown>;
    const scope = q['scope'] === 'all' ? 'all' : 'course';
    const courseId = scope === 'all' ? undefined : q['courseId'] ? Number(q['courseId']) : exam.course_id;
    // 树里的计数与题池同口径：排除已在试卷里的题，避免"树说 4 题、表格只列 2 题"
    const excludeInExam = q['excludeInExam'] === '1' ? deps.exams.questionIds(id) : [];
    return deps.exams.facets({
      ...(excludeInExam.length > 0 ? { exclude: excludeInExam } : {}),
      ...(courseId === undefined ? {} : { courseId }),
      ...(listParam(q, 'types').length > 0 ? { types: listParam(q, 'types') } : {}),
      ...(listParam(q, 'levels').length > 0
        ? {
            levels: listParam(q, 'levels').filter((l): l is 'easy' | 'medium' | 'hard' =>
              (LEVELS as readonly string[]).includes(l),
            ),
          }
        : {}),
      ...(typeof q['keyword'] === 'string' && q['keyword'] !== '' ? { keyword: q['keyword'] } : {}),
      ...(listParam(q, 'books').length > 0 ? { books: listParam(q, 'books') } : {}),
      ...(typeof q['bankLimit'] === 'string' ? { bankLimit: Number(q['bankLimit']) } : {}),
    });
  });

  /** 知识点清单（按册次/章节懒加载 + 可搜索）：知识点有 5000+ 个，不整棵返回 */
  app.get('/exams/:id/points', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    const exam = deps.examService.findById(id);
    const q = req.query as Record<string, unknown>;
    const scope = q['scope'] === 'all' ? 'all' : 'course';
    const courseId = scope === 'all' ? undefined : q['courseId'] ? Number(q['courseId']) : exam.course_id;
    return {
      points: deps.exams.pointsOf({
        ...(deps.exams.questionIds(id).length > 0 && q['excludeInExam'] === '1'
          ? { exclude: deps.exams.questionIds(id) }
          : {}),
        ...(courseId === undefined ? {} : { courseId }),
        ...(listParam(q, 'books').length > 0 ? { books: listParam(q, 'books') } : {}),
        ...(listParam(q, 'chapters').length > 0 ? { chapters: listParam(q, 'chapters') } : {}),
        ...(listParam(q, 'types').length > 0 ? { types: listParam(q, 'types') } : {}),
        ...(listParam(q, 'levels').length > 0
          ? {
              levels: listParam(q, 'levels').filter((l): l is 'easy' | 'medium' | 'hard' =>
                (LEVELS as readonly string[]).includes(l),
              ),
            }
          : {}),
        ...(typeof q['keyword'] === 'string' && q['keyword'] !== '' ? { keyword: q['keyword'] } : {}),
        ...(typeof q['pointKeyword'] === 'string' && q['pointKeyword'] !== ''
          ? { pointKeyword: q['pointKeyword'] }
          : {}),
        ...(typeof q['limit'] === 'string' ? { limit: Number(q['limit']) } : {}),
      }),
    };
  });

  /**
   * 平行组卷：按原卷**逐题**配一道"同题型 / 同难度档 / 知识点尽量相同"的**不同**题，
   * 生成一场新考试（沿用原卷的分值、大题、结构与考试设置）。
   * 机构里这就是 A/B 卷，要求两份卷子结构可比，所以不能按题型数量随机抽。
   */
  app.post(
    '/exams/:id/parallel',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            title: { type: 'string', maxLength: 80 },
            scope: { type: 'string', enum: ['course', 'all'] },
            replaceExisting: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const user = requireTeacherOrAdmin(req, reply);
      const id = Number((req.params as { id: string }).id);
      const body = (req.body ?? {}) as { title?: string; scope?: 'course' | 'all'; replaceExisting?: boolean };
      return deps.examService.parallelPaper(user, id, body);
    },
  );

  /**
   * 导出试卷 Word（.docx）：老师要交给教研/印刷二次排版时用。
   * `?answers=0` 导出不含答案解析的学生卷。
   */
  app.get('/exams/:id/paper.docx', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    const q = req.query as { answers?: string };
    const { filename, body } = deps.examService.paperDocx(id, { withAnswers: q.answers !== '0' });
    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .send(body);
  });

  /** 试卷统计 + 双向细目表（知识点 × 题型 × 难度）+ 目标配比达成情况 */
  app.get('/exams/:id/blueprint', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    return deps.examService.blueprint(Number((req.params as { id: string }).id));
  });

  /** 组卷：① 双向细目表（知识点 × 题型 × 难度 逐格数量）或 ② 题型配额 + 难度配比；缺口如实返回 */
  app.post('/exams/:id/compose', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    const body = req.body as {
      quota?: Partial<Record<QuestionType, number>>;
      /** 双向细目表（与 quota 二选一） */
      cells?: unknown;
      ratio?: Partial<Record<'easy' | 'medium' | 'hard', number>>;
      /** 抽题范围：`course`（默认，本课程）/ `all`（明确要求才跨课程） */
      scope?: string;
      courseId?: number;
      point?: string;
      chapter?: string;
      /** 多选范围（可跨章节/跨册）：老师先圈范围，再按题型数量随机抽 */
      books?: string[];
      chapters?: string[];
      points?: string[];
      /** 每个题型的分值（生成后直接落到卷面） */
      scores?: Partial<Record<QuestionType, number>>;
      sectionName?: string;
      scorePerQuestion?: number;
      replaceExisting?: boolean;
    };
    const quota: Partial<Record<QuestionType, number>> = {};
    for (const [k, v] of Object.entries(body?.quota ?? {})) {
      if (['single', 'multiple', 'judge', 'fill', 'short'].includes(k)) quota[k as QuestionType] = Number(v) || 0;
    }
    let cells: BlueprintCell[] | undefined;
    if (body?.cells !== undefined) {
      try {
        cells = normalizeBlueprintCells(body.cells);
      } catch (e) {
        throw AppError.badRequest(e instanceof Error ? e.message : '细目表格式不对');
      }
    }
    if (!cells && Object.values(quota).every((n) => !n)) {
      throw AppError.badRequest('请至少为一种题型指定数量（如 单选 10 道），或填一张双向细目表');
    }
    const ratio: Partial<Record<'easy' | 'medium' | 'hard', number>> = {};
    for (const [k, v] of Object.entries(body?.ratio ?? {})) {
      if (['easy', 'medium', 'hard'].includes(k)) ratio[k as 'easy' | 'medium' | 'hard'] = Number(v) || 0;
    }
    const sum = Object.values(ratio).reduce((s, v) => s + v, 0);
    if (sum > 0 && Math.abs(sum - 1) > 0.01) throw AppError.badRequest('难度配比之和应为 1（如 0.3/0.5/0.2）');
    return deps.examService.autoCompose(user, id, {
      quota,
      ...(cells ? { cells } : {}),
      ...(sum > 0 ? { ratio } : {}),
      scope: body?.scope === 'all' ? 'all' : 'course',
      ...(body?.courseId ? { courseId: Number(body.courseId) } : {}),
      ...(body?.point ? { point: String(body.point) } : {}),
      ...(body?.chapter ? { chapter: String(body.chapter) } : {}),
      ...(Array.isArray(body?.books) && body.books.length > 0 ? { books: body.books.map(String) } : {}),
      ...(Array.isArray(body?.chapters) && body.chapters.length > 0 ? { chapters: body.chapters.map(String) } : {}),
      ...(Array.isArray(body?.points) && body.points.length > 0 ? { points: body.points.map(String) } : {}),
      ...(body?.scores && typeof body.scores === 'object'
        ? {
            scores: Object.fromEntries(
              Object.entries(body.scores)
                .filter(([, v]) => Number.isFinite(Number(v)) && Number(v) >= 0)
                .map(([k, v]) => [k, Number(v)]),
            ),
          }
        : {}),
      ...(body?.sectionName ? { sectionName: String(body.sectionName) } : {}),
      ...(body?.scorePerQuestion ? { scorePerQuestion: Number(body.scorePerQuestion) } : {}),
      replaceExisting: body?.replaceExisting === true,
    });
  });

  /**
   * 换题候选列表（**不随机**）：级联匹配的分组候选，交给老师挑。
   * `GET /exams/:id/questions/:qid/candidates?limit=8`
   */
  app.get('/exams/:id/questions/:qid/candidates', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const p = req.params as { id: string; qid: string };
    const q = req.query as { limit?: string };
    return deps.examService.similarCandidates(Number(p.id), Number(p.qid), {
      limit: q.limit ? Number(q.limit) : undefined,
    });
  });

  /**
   * 换一题：
   *  - 带 `withId` → 用老师从候选里挑中的那道题；
   *  - 不带 → 保持原来的随机替换（兼容旧界面/脚本）。
   */
  app.post('/exams/:id/questions/:qid/replace', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const p = req.params as { id: string; qid: string };
    const body = (req.body ?? {}) as { withId?: number };
    if (body.withId !== undefined) {
      const withId = Number(body.withId);
      if (!Number.isInteger(withId) || withId <= 0) throw AppError.badRequest('withId 参数非法');
      return deps.examService.replaceWith(user, Number(p.id), Number(p.qid), withId);
    }
    return deps.examService.replaceQuestion(user, Number(p.id), Number(p.qid));
  });

  /**
   * 细目表参考数据：当前范围里「知识点 × 题型 × 难度」各有多少可选题，
   * 供组卷工作台的细目表编辑器显示"题池够不够"。
   */
  app.get('/exams/:id/taxonomy', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    const exam = deps.examService.findById(id);
    const q = req.query as { scope?: string; courseId?: string; limit?: string };
    const scope = q.scope === 'all' ? 'all' : 'course';
    const courseId = q.courseId ? Number(q.courseId) : scope === 'all' ? undefined : exam.course_id;
    return deps.examService.taxonomy({
      scope,
      ...(courseId === undefined ? {} : { courseId }),
      ...(q.limit ? { limit: Number(q.limit) } : {}),
    });
  });

  /** 改某题的分值 / 大题分组 */
  app.put('/exams/:id/questions/:qid', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const p = req.params as { id: string; qid: string };
    const body = req.body as { score?: number; section?: string };
    const score = body?.score === undefined ? undefined : Number(body.score);
    if (score !== undefined && (!Number.isFinite(score) || score < 0)) throw AppError.badRequest('分值必须是非负数');
    deps.examService.setQuestionMeta(user, Number(p.id), Number(p.qid), {
      ...(score === undefined ? {} : { score }),
      ...(body?.section === undefined ? {} : { section: String(body.section) }),
    });
    return { ok: true };
  });

  /** 试卷大题结构（名称/每题分值）与目标难度配比、总分 */
  app.put('/exams/:id/structure', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    const body = req.body as {
      structure?: unknown;
      difficultyTarget?: Partial<Record<'easy' | 'medium' | 'hard', number>>;
      totalScore?: number;
      applyScores?: boolean;
    };
    const sections = Array.isArray(body?.structure)
      ? (body.structure as Record<string, unknown>[]).map((s) => ({
          name: typeof s.name === 'string' ? s.name : '',
          type: typeof s.type === 'string' ? s.type : '',
          score: Number(s.score) || 0,
          description: typeof s.description === 'string' ? s.description : '',
        }))
      : [];
    deps.examService.setStructure(
      user,
      id,
      sections,
      body?.difficultyTarget,
      body?.totalScore,
      body?.applyScores !== false,
    );
    return { ok: true };
  });

  /** 重排卷内顺序 */
  app.post('/exams/:id/questions/order', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    const body = req.body as { questionIds?: unknown };
    const ids = Array.isArray(body?.questionIds) ? body.questionIds.map((x) => Number(x)).filter((x) => x > 0) : [];
    if (ids.length === 0) throw AppError.badRequest('请提供题目顺序');
    deps.examService.reorder(user, id, ids);
    return { ok: true };
  });

  app.delete('/exams/:id/questions/:qid', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const p = req.params as { id: string; qid: string };
    deps.examService.removeQuestion(user, Number(p.id), Number(p.qid));
    return { ok: true };
  });

  /** 取卷作答 */
  app.get('/exams/:id/take', async (req, reply) => {
    const user = requireUser(req, reply);
    return deps.examService.take(user, Number((req.params as { id: string }).id));
  });

  /** 交卷 */
  app.post('/exams/:id/submit', { schema: { body: submitSchema } }, async (req, reply) => {
    const user = requireUser(req, reply);
    const id = Number((req.params as { id: string }).id);
    const body = req.body as { answers: { qid: number; answer?: string }[]; startedAt?: number };
    const result = deps.examService.submit(
      user,
      id,
      body.answers.map((a) => ({ qid: Number(a.qid), answer: String(a.answer ?? '') })),
      body.startedAt,
    );
    return { ok: true, ...result };
  });

  /** 我的成绩 */
  app.get('/exams/:id/result', async (req, reply) => {
    const user = requireUser(req, reply);
    return deps.examService.myResult(user, Number((req.params as { id: string }).id));
  });

  /** 成绩单（管理端） */
  app.get('/exams/:id/scores', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    return deps.examService.scoreSheet(Number((req.params as { id: string }).id));
  });

  /** 成绩单 CSV */
  app.get('/exams/:id/scores.csv', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const { filename, rows } = deps.examService.scoreSheetCsv(Number((req.params as { id: string }).id));
    return reply.headers(csvHeaders(filename)).send(toCsv(rows));
  });
}
