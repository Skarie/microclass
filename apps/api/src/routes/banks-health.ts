/**
 * 题库体检与数据修复路由：体检（元数据覆盖率 / 质量统计 / 重复题）、库内去重、
 * 批量设置难度、兜底重算题库题量。
 *
 * 从 `routes/banks.ts` 拆出；路径、方法、请求体 schema、返回结构全部保持不变。
 * 体检结果缓存 5 分钟（全库体检要扫几十万题），缓存键与新鲜度判定在
 * `services/bankHealthService`（纯函数，见 `test/bank-health.test.ts`）。
 */
import type { FastifyInstance } from 'fastify';
import { requireTeacherOrAdmin } from '../http/guards.js';
import type { Deps } from '../app.js';
import { bankIdOf, bulkDifficultySchema } from './banks-shared.js';
import { parseBankHealthQuery, type BankHealthQuery } from './bankQuery.js';

export async function registerBankHealthRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /**
   * 题库体检（教师/管理员）：标准化元数据覆盖率 + 质量统计 + 重复题明细；
   * 结果缓存 5 分钟，`refresh=1` 强制重算。
   */
  app.get('/banks/health', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const { bankId, limit, refresh } = parseBankHealthQuery(req.query as BankHealthQuery);
    return deps.bankService.health(bankId, limit, { refresh });
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

  /**
   * 批量设置难度（人工标注，重算难度不会覆盖）。
   * 逐题校验 id 是否属于该题库，返回 updated / skipped。
   */
  app.post('/banks/:id/questions/bulk-difficulty', { schema: { body: bulkDifficultySchema } }, async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const bankId = bankIdOf(req);
    const { ids, difficulty } = req.body as { ids: number[]; difficulty: 'easy' | 'medium' | 'hard' };
    return deps.bankService.setQuestionsDifficulty(user, bankId, ids, difficulty);
  });

  /** 题库内去重（「题干 + 选项」指纹相同且答案一致的重复题只保留一条）；默认 dry-run 预览 */
  app.post('/banks/:id/dedupe', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const body = (req.body ?? {}) as { dryRun?: boolean };
    return { ok: true, ...deps.bankService.dedupeBank(user, bankIdOf(req), { dryRun: body.dryRun !== false }) };
  });
}
