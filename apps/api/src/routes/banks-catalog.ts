/**
 * 题库目录与课程绑定路由：目录树（筛选用）、按册次批量挂课程、一键回填课程归属。
 *
 * 从 `routes/banks.ts` 拆出；路径、方法、请求体 schema、返回结构全部保持不变。
 * 目录数据量大（课程 → 章节 → 小节 → 题库），只在这里做参数解析与服务转发，
 * 统计口径在 `services/bankCatalogService`。
 */
import type { FastifyInstance } from 'fastify';
import { requireTeacherOrAdmin, requireUser } from '../http/guards.js';
import type { Deps } from '../app.js';
import { bindByBookBodySchema } from './banks-shared.js';
import { parseBankCatalogQuery, type BankCatalogQuery } from './bankQuery.js';

export async function registerBankCatalogRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /**
   * 题库目录树（筛选用）：
   *   - 不带 `courseId`：返回课程列表（含题库数/题量）+ 未归属课程统计；
   *   - 带 `courseId`：返回该课程的「章节（课时分组）→ 小节 → 题库」以及不挂课时的章节题库/整卷试卷。
   */
  app.get('/banks/catalog', async (req, reply) => {
    requireUser(req, reply);
    const { courseId, kind } = parseBankCatalogQuery(req.query as BankCatalogQuery);
    if (courseId !== undefined) return deps.bankService.catalogCourse(courseId);
    return deps.bankService.catalog(kind);
  });

  /** 按册次批量挂课程（未归属题库的批量归类）；`courseId: null` = 移出课程 */
  app.post('/banks/bind-by-book', { schema: { body: bindByBookBodySchema } }, async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    const { book, courseId } = req.body as { book: string; courseId?: number | null };
    return deps.bankService.bindUnboundByBook(actor, book, courseId ?? null);
  });

  /**
   * 一键回填题库归属课程（课时推导 + 册次匹配），匹配不上的留在「未归属」。
   * 导入题库后跑一次，管理端就不用手工一个个挂课程。
   */
  app.post('/banks/rebind-courses', async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    return deps.bankService.rebindCourses(actor);
  });
}
