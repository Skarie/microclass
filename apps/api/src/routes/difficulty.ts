/**
 * 难度模型路由：预览 / 应用 / 校准。
 *
 * 口径见 `docs/difficulty.md`：内容特征先验（冷启动）→ 作答数据校准 → 人工标注优先。
 * 预览与校准默认**只算不写**，应用是明确动作；教师/管理员才能改。
 */
import type { FastifyInstance } from 'fastify';
import { requireTeacherOrAdmin, requireUser } from '../http/guards.js';
import type { Deps } from '../app.js';

export async function registerDifficultyRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /** 难度现状：分布（三档/五级/来源）+ 分数直方图 */
  app.get('/questions/difficulty', async (req, reply) => {
    requireUser(req, reply);
    const q = req.query as { bankId?: string };
    const bankId = q.bankId === undefined || q.bankId === '' ? undefined : Number(q.bankId);
    return reply.send({
      cuts: deps.difficultyService.cuts(),
      stats: deps.questions.difficultyStats(bankId, deps.difficultyService.cuts()),
    });
  });

  /** 预览：按当前数据算一遍会变成什么样（不写库），含最难/最容易的样例题 */
  app.get('/questions/difficulty/preview', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const q = req.query as { bankId?: string; keepManual?: string; keepCalibrated?: string };
    const bankId = q.bankId === undefined || q.bankId === '' ? undefined : Number(q.bankId);
    return reply.send(
      deps.difficultyService.preview(bankId, {
        keepManual: q.keepManual !== '0',
        keepCalibrated: q.keepCalibrated !== '0',
      }),
    );
  });

  /**
   * 应用（批量写回难度）。默认保留人工标注与已校准的题；
   * `dryRun=1` 只统计不写库（界面预览按钮走这里）。
   */
  app.post('/questions/difficulty/apply', async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    const q = (req.query ?? {}) as { bankId?: string; dryRun?: string; keepManual?: string; keepCalibrated?: string };
    const bankId = q.bankId === undefined || q.bankId === '' ? undefined : Number(q.bankId);
    return reply.send(
      deps.difficultyService.apply(actor, {
        ...(bankId === undefined ? {} : { bankId }),
        dryRun: q.dryRun === '1' || q.dryRun === 'true',
        keepManual: q.keepManual !== '0',
        keepCalibrated: q.keepCalibrated !== '0',
      }),
    );
  });

  /** 用真实作答数据校准（默认只预演） */
  app.post('/questions/difficulty/calibrate', async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    const q = (req.query ?? {}) as { dryRun?: string; minSamples?: string; k?: string };
    return reply.send(
      deps.difficultyService.calibrate(actor, {
        dryRun: q.dryRun !== '0',
        ...(q.minSamples ? { minSamples: Number(q.minSamples) } : {}),
        ...(q.k ? { k: Number(q.k) } : {}),
      }),
    );
  });
}
