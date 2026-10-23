/**
 * 试卷（组卷后的卷面）路由：卷面视图、加题/改题/删题/排序、试卷结构、Word 导出。
 *
 * 从 `routes/exams.ts` 拆出；路径、方法、参数与返回结构保持不变。
 * 智能组卷（随机/配额/细目表/平行卷）在 `exams-compose`，候选题池在 `exams-pool`。
 */
import type { FastifyInstance } from 'fastify';
import { AppError } from '@microclass/shared';
import { requireTeacherOrAdmin } from '../http/guards.js';
import type { Deps } from '../app.js';
import { poolFiltersFrom } from '../domain/examPoolQuery.js';
import { parseQuestionIds, parseStructureSections } from '../domain/examRequest.js';
import { examIdOf, examQuestionIdsOf } from './exams-shared.js';

export async function registerExamPaperRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /** 组卷视图：已选题目 + 候选题池 */
  app.get('/exams/:id/paper', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    return deps.examService.paper(examIdOf(req));
  });

  /**
   * 手工加题：两种方式
   *   ① `{ questionIds: [...] }` —— 勾选加入（前端已选中的题）；
   *   ② `{ filters: {...}, limit? }` —— **按当前筛选整批加入**（"全选筛选结果 N 题"），
   *      服务端自己取 id，避免把成千上万个 id 传到前端再传回来。
   */
  app.post('/exams/:id/questions', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = examIdOf(req);
    const body = req.body as { questionIds?: unknown; filters?: unknown; limit?: unknown };

    if (body?.filters && typeof body.filters === 'object') {
      const filters = poolFiltersFrom(body.filters as Record<string, unknown>);
      const limit = Math.min(5000, Math.max(1, Number(body.limit ?? 2000) || 2000));
      const ids = deps.exams.pickIds({ ...filters, cap: limit });
      if (ids.length === 0) throw AppError.badRequest('当前筛选条件下没有题目');
      const added = deps.examService.addQuestions(user, id, ids);
      return { ok: true, added, matched: ids.length, truncated: ids.length >= limit };
    }

    const ids = parseQuestionIds(body?.questionIds);
    if (ids.length === 0) throw AppError.badRequest('请选择要加入试卷的题目');
    return { ok: true, added: deps.examService.addQuestions(user, id, ids) };
  });

  /** 导出试卷 Word（.docx）：`?answers=0` 导出不含答案解析的学生卷 */
  app.get('/exams/:id/paper.docx', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const { filename, body } = deps.examService.paperDocx(examIdOf(req), {
      withAnswers: (req.query as { answers?: string }).answers !== '0',
    });
    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .send(body);
  });

  /**
   * 换题候选列表（**不随机**）：级联匹配的分组候选，交给老师挑。
   * `GET /exams/:id/questions/:qid/candidates?limit=8`
   */
  app.get('/exams/:id/questions/:qid/candidates', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const { examId, questionId } = examQuestionIdsOf(req);
    const q = req.query as { limit?: string };
    return deps.examService.similarCandidates(examId, questionId, { limit: q.limit ? Number(q.limit) : undefined });
  });

  /**
   * 换一题：
   *  - 带 `withId` → 用老师从候选里挑中的那道题；
   *  - 不带 → 保持原来的随机替换（兼容旧界面/脚本）。
   */
  app.post('/exams/:id/questions/:qid/replace', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const { examId, questionId } = examQuestionIdsOf(req);
    const body = (req.body ?? {}) as { withId?: number };
    if (body.withId !== undefined) {
      const withId = Number(body.withId);
      if (!Number.isInteger(withId) || withId <= 0) throw AppError.badRequest('withId 参数非法');
      return deps.examService.replaceWith(user, examId, questionId, withId);
    }
    return deps.examService.replaceQuestion(user, examId, questionId);
  });

  /** 改某题的分值 / 大题分组 */
  app.put('/exams/:id/questions/:qid', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const { examId, questionId } = examQuestionIdsOf(req);
    const body = req.body as { score?: number; section?: string };
    const score = body?.score === undefined ? undefined : Number(body.score);
    if (score !== undefined && (!Number.isFinite(score) || score < 0)) throw AppError.badRequest('分值必须是非负数');
    deps.examService.setQuestionMeta(user, examId, questionId, {
      ...(score === undefined ? {} : { score }),
      ...(body?.section === undefined ? {} : { section: String(body.section) }),
    });
    return { ok: true };
  });

  /** 试卷大题结构（名称/每题分值）与目标难度配比、总分 */
  app.put('/exams/:id/structure', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const body = req.body as {
      structure?: unknown;
      difficultyTarget?: Partial<Record<'easy' | 'medium' | 'hard', number>>;
      totalScore?: number;
      applyScores?: boolean;
    };
    deps.examService.setStructure(
      user,
      examIdOf(req),
      parseStructureSections(body?.structure),
      body?.difficultyTarget,
      body?.totalScore,
      body?.applyScores !== false,
    );
    return { ok: true };
  });

  /** 重排卷内顺序 */
  app.post('/exams/:id/questions/order', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const body = req.body as { questionIds?: unknown };
    const ids = parseQuestionIds(body?.questionIds);
    if (ids.length === 0) throw AppError.badRequest('请提供题目顺序');
    deps.examService.reorder(user, examIdOf(req), ids);
    return { ok: true };
  });

  app.delete('/exams/:id/questions/:qid', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const { examId, questionId } = examQuestionIdsOf(req);
    deps.examService.removeQuestion(user, examId, questionId);
    return { ok: true };
  });
}
