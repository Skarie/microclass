/**
 * 「同题不同答案」核对路由。
 *
 * 全库扫描（36.6 万题的指纹分组）比较慢，因此扫描结果物化在 `question_conflicts` 台账里；
 * 列表/详情只读台账，`POST /question-conflicts/sync` 才重新扫描。
 */
import type { FastifyInstance } from 'fastify';
import { requireTeacherOrAdmin, requireUser } from '../http/guards.js';
import type { Deps } from '../app.js';
import type { ConflictStatus } from '../db/repositories/questionConflictRepository.js';

const statusValues = ['pending', 'resolved', 'ignored', 'all'] as const;

function parseStatus(raw: unknown): ConflictStatus | 'all' {
  const s = typeof raw === 'string' ? raw : 'pending';
  return (statusValues as readonly string[]).includes(s) ? (s as ConflictStatus | 'all') : 'pending';
}

export async function registerQuestionConflictRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /** 冲突组列表（默认只看待核对，按组内题量倒序） */
  app.get('/question-conflicts', async (req, reply) => {
    requireUser(req, reply);
    const q = req.query as { status?: string; page?: string; pageSize?: string };
    return reply.send(
      deps.conflictService.list({
        status: parseStatus(q.status),
        page: Number(q.page ?? 1) || 1,
        pageSize: Number(q.pageSize ?? 20) || 20,
      }),
    );
  });

  /**
   * 重新扫描全库、刷新台账。
   *
   * 注意：这是一次全库分组（36.6 万题），**冷缓存时在 NAS 上可能要几分钟**，
   * 期间 node:sqlite 会占住事件循环（整站短暂无响应），所以只允许显式调用，
   * 列表接口不会隐式触发。已 resolved / ignored 的组保留人工判断，不会被打回 pending。
   */
  app.post('/question-conflicts/sync', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    return reply.send(deps.conflictService.rescan());
  });

  /** 批量按「多数答案」处理（默认只预演，`dryRun=0` 才落库；票数并列的跳过） */
  app.post('/question-conflicts/resolve-majority', async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    const q = req.query as { dryRun?: string; limit?: string };
    const dryRun = q.dryRun === '0' || q.dryRun === 'false' ? false : true;
    const limit = Number(q.limit ?? 1000) || 1000;
    return reply.send(deps.conflictService.resolveMajority(actor, { dryRun, limit }));
  });

  /**
   * 批量合并「同一个答案的不同写法」（默认只预演，`dryRun=0` 才落库）。
   *
   * 与「按多数答案」的区别：多数票是**二选一**，会把另一种正确写法判错；
   * 合并是把两种写法都变成可接受答案（`A|B`）。只有两两等价的组才会被处理。
   */
  app.post('/question-conflicts/resolve-equivalent', async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    const q = req.query as { dryRun?: string; limit?: string };
    const dryRun = q.dryRun === '0' || q.dryRun === 'false' ? false : true;
    const limit = Number(q.limit ?? 1000) || 1000;
    return reply.send(deps.conflictService.resolveEquivalent(actor, { dryRun, limit }));
  });

  /** 某一组的全部题目（含题库名、难度、来源），用于判断该信哪个答案 */
  app.get('/question-conflicts/:hash', async (req, reply) => {
    requireUser(req, reply);
    const { hash } = req.params as { hash: string };
    return reply.send(deps.conflictService.detail(hash));
  });

  /** 选定答案：整组统一（题干+选项相同的题，答案本应一致） */
  app.post('/question-conflicts/:hash/resolve', async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    const { hash } = req.params as { hash: string };
    const body = (req.body ?? {}) as { answer?: string };
    return reply.send(deps.conflictService.resolve(actor, hash, String(body.answer ?? '')));
  });

  /** 忽略：确认这一组答案不同是合理的，不再出现在待核对列表 */
  app.post('/question-conflicts/:hash/ignore', async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    const { hash } = req.params as { hash: string };
    return reply.send(deps.conflictService.ignore(actor, hash));
  });

  /** 恢复为待核对 */
  app.post('/question-conflicts/:hash/reopen', async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    const { hash } = req.params as { hash: string };
    return reply.send(deps.conflictService.reopen(actor, hash));
  });
}
