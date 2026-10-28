/**
 * 题目路由：跨题库检索、题库内题目列表 / 新建、单题读写、批量删除。
 *
 * 从 `routes/banks.ts` 拆出；路径、方法、请求体 schema、返回结构全部保持不变。
 * 题目配图（上传 / 访问）在 `banks-question-media`，批量导入与导出在
 * `banks-import-export`，难度批量标注在 `banks-health`。
 */
import type { FastifyInstance } from 'fastify';
import { AppError } from '@microclass/shared';
import { requireTeacherOrAdmin, requireUser } from '../http/guards.js';
import type { Deps } from '../app.js';
import type { QuestionDto } from '../services/bankService.js';
import { bankIdOf, bulkIdsSchema, questionBodySchema, questionIdOf, questionSectionsSchema } from './banks-shared.js';
import {
  parseBankQuestionListQuery,
  parseQuestionSearchQuery,
  type BankQuestionListQuery,
  type QuestionSearchQuery,
} from './bankQuery.js';

export async function registerBankQuestionRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /** 跨题库按知识点/书册/难度找题（聚合浏览、组卷选题用） */
  app.get('/questions/search', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    return deps.bankService.searchQuestions(parseQuestionSearchQuery(req.query as QuestionSearchQuery));
  });

  /** 题库内题目列表（支持题型/难度筛选、关键词搜索、分页） */
  app.get('/banks/:id/questions', async (req, reply) => {
    requireUser(req, reply);
    return deps.bankService.listQuestions(
      bankIdOf(req),
      parseBankQuestionListQuery(req.query as BankQuestionListQuery),
    );
  });

  /** 新建题目：路径上的 `:id` 是题库 id（body 里的 bankId 以路径为准） */
  app.post('/banks/:id/questions', { schema: { body: questionBodySchema } }, async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const bankId = bankIdOf(req);
    const body = req.body as QuestionDto;
    return { ok: true, id: deps.bankService.createQuestion(user, { ...body, bankId }) };
  });

  app.get('/questions/:id', async (req, reply) => {
    requireUser(req, reply);
    const question = deps.bankService.findQuestion(questionIdOf(req));
    if (!question) throw AppError.notFound('题目不存在');
    return { question };
  });

  app.put('/questions/:id', { schema: { body: questionBodySchema } }, async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    deps.bankService.updateQuestion(user, questionIdOf(req), req.body as QuestionDto);
    return { ok: true };
  });

  app.delete('/questions/:id', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    deps.bankService.removeQuestion(user, questionIdOf(req));
    return { ok: true };
  });

  /** 批量改章节 / 小节（只改本库题目；空串表示清空），返回 updated */
  app.patch('/banks/:id/questions/sections', { schema: { body: questionSectionsSchema } }, async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const bankId = bankIdOf(req);
    const body = req.body as { ids: number[]; chapter?: string; section?: string };
    return deps.bankService.setQuestionsSections(user, bankId, body.ids, {
      ...(body.chapter === undefined ? {} : { chapter: body.chapter }),
      ...(body.section === undefined ? {} : { section: body.section }),
    });
  });

  /** 批量删除所选题目（只删属于该题库的题，返回 deleted / skipped） */
  app.post('/banks/:id/questions/bulk-delete', { schema: { body: bulkIdsSchema } }, async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const bankId = bankIdOf(req);
    const { ids } = req.body as { ids: number[] };
    return deps.bankService.removeQuestions(user, bankId, ids);
  });
}
