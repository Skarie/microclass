/**
 * 题库主体路由：题库列表（筛选 / 分页）、题库 CRUD、整卷题库一键建考试。
 *
 * 从 `routes/banks.ts` 拆出；路径、方法、请求体 schema、返回结构全部保持不变。
 * 目录与绑定在 `banks-catalog`，体检 / 去重 / 批量难度在 `banks-health`，
 * 题目在 `banks-questions`，导出导入在 `banks-import-export`。
 */
import type { FastifyInstance } from 'fastify';
import { requireTeacherOrAdmin, requireUser } from '../http/guards.js';
import type { Deps } from '../app.js';
import type { BankDto } from '../services/bankService.js';
import { bankBodySchema, bankIdOf } from './banks-shared.js';
import { parseBankListQuery, type BankListQuery } from './bankQuery.js';

export async function registerBankCrudRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /** 题库列表：名称 / 类型 / 学科 / 册次 / 关键字 / 归属课程筛选 + 分页 */
  app.get('/banks', async (req, reply) => {
    requireUser(req, reply);
    const filter = parseBankListQuery(req.query as BankListQuery);
    return { banks: deps.bankService.list(filter), total: deps.bankService.countBanks(filter) };
  });

  app.post('/banks', { schema: { body: bankBodySchema } }, async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    return { ok: true, id: deps.bankService.create(user, req.body as BankDto) };
  });

  /** 题库详情：题库本身 + 题目列表（学员只看得到不挂答案的视图） */
  app.get('/banks/:id', async (req, reply) => {
    requireUser(req, reply);
    return deps.bankService.detail(bankIdOf(req));
  });

  app.put('/banks/:id', { schema: { body: bankBodySchema } }, async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    deps.bankService.update(user, bankIdOf(req), req.body as BankDto);
    return { ok: true };
  });

  app.delete('/banks/:id', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    deps.bankService.remove(user, bankIdOf(req));
    return { ok: true };
  });

  /** 整卷试卷题库 → 一键建考试（多样化：期中/期末/单元测试卷直接变成考试） */
  app.post('/banks/:id/exam', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = bankIdOf(req);
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
}
