/**
 * 题池路由：组卷工作台左侧的挑题池、选题树（册次 → 章节）、知识点懒加载、细目表参考数据。
 *
 * 从 `routes/exams.ts` 拆出；路径、方法、查询参数（含多选与 `scope=all` 语义）与
 * 返回结构保持不变。参数解析在 `domain/examPoolQuery` 与 `domain/examTaxonomyQuery`，
 * 响应拼装在 `domain/examPoolView`，这里只负责取考试、排除已在卷内的题、调用仓储。
 */
import type { FastifyInstance } from 'fastify';
import { requireTeacherOrAdmin } from '../http/guards.js';
import type { Deps } from '../app.js';
import { parsePoolQuery } from '../domain/examPoolQuery.js';
import { parseFacetsQuery, parsePointsQuery, parseTaxonomyQuery } from '../domain/examTaxonomyQuery.js';
import { buildErrorPoolPage, buildPoolQuestions } from '../domain/examPoolView.js';
import { examIdOf } from './exams-shared.js';

export async function registerExamPoolRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /**
   * 组卷挑题（智学网式工作台左侧）：
   * 课程/课时/题库范围 + 题型 / 难度档 / 难度分区间 / 知识点 / 章节 / 关键字 / 带图，
   * 支持排序与分页，并可选「排除已在卷内的题」。
   */
  app.get('/exams/:id/pool', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const id = examIdOf(req);
    const q = req.query as Record<string, string | undefined>;
    // 范围默认落到**本考试所属课程**（与 facets/points 一致）：要跨课程必须显式 scope=all
    const exam = deps.examService.findById(id);
    const exclude = q.excludeInExam === '1' ? deps.exams.questionIds(id) : [];
    const parsed = parsePoolQuery(q, exam.course_id, exclude);

    /**
     * 易错题模式（orderBy=error_desc）：
     *   - 取一个更大的候选窗口（最多 200 条）再按"错误率平滑分"排序 —— 错误率不在数据库里，
     *     无法在 SQL 层排序，这个窗口足够覆盖一页挑题；
     *   - 默认只保留**至少作答 2 次**的题（minAttempts 可调）。
     */
    if (parsed.orderBy === 'error_desc') {
      const stats = deps.questionStats.errorByQuestion();
      const window = deps.exams.pick({ ...parsed.picks, limit: 200 });
      const page = buildErrorPoolPage(window, stats, {
        minAttempts: parsed.minAttempts,
        page: parsed.page,
        pageSize: parsed.pageSize,
      });
      return {
        total: page.total,
        page: parsed.page,
        pageSize: parsed.pageSize,
        orderBy: 'error_desc',
        minAttempts: parsed.minAttempts,
        statsCachedAt: deps.questionStats.cachedAt(),
        questions: page.questions,
      };
    }

    const items = deps.exams.pick({
      ...parsed.picks,
      limit: parsed.pageSize,
      offset: (parsed.page - 1) * parsed.pageSize,
    });
    return {
      total: deps.exams.pickCount(parsed.picks),
      page: parsed.page,
      pageSize: parsed.pageSize,
      // 普通模式也带上错率，界面可以直接显示「错率 50%（2 次作答）」
      questions: buildPoolQuestions(items, deps.questionStats.errorByQuestion()),
    };
  });

  /**
   * 选题树（册次 → 章节，带题量）+ 题型/难度/题库计数。
   * 主流组卷系统的左树就是这两层；计数跟随题型/难度/关键词筛选变化。
   */
  app.get('/exams/:id/facets', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const id = examIdOf(req);
    const exam = deps.examService.findById(id);
    const q = req.query as Record<string, unknown>;
    // 树里的计数与题池同口径：排除已在试卷里的题，避免"树说 4 题、表格只列 2 题"
    const exclude = q['excludeInExam'] === '1' ? deps.exams.questionIds(id) : [];
    return deps.exams.facets(parseFacetsQuery(q, exam.course_id, exclude));
  });

  /** 知识点清单（按册次/章节懒加载 + 可搜索）：知识点有 5000+ 个，不整棵返回 */
  app.get('/exams/:id/points', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const id = examIdOf(req);
    const exam = deps.examService.findById(id);
    const q = req.query as Record<string, unknown>;
    const exclude = q['excludeInExam'] === '1' ? deps.exams.questionIds(id) : [];
    return { points: deps.exams.pointsOf(parsePointsQuery(q, exam.course_id, exclude)) };
  });

  /**
   * 细目表参考数据：当前范围里「知识点 × 题型 × 难度」各有多少可选题，
   * 供组卷工作台的细目表编辑器显示"题池够不够"。
   */
  app.get('/exams/:id/taxonomy', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const exam = deps.examService.findById(examIdOf(req));
    return deps.examService.taxonomy(parseTaxonomyQuery(req.query as Record<string, unknown>, exam.course_id));
  });
}
