/**
 * 组卷路由：随机抽题 / 按题型+难度配额抽题 / 智能组卷（配额或双向细目表）/ 平行卷。
 *
 * 从 `routes/exams.ts` 拆出；路径、方法、请求体字段与返回结构保持不变。
 * 参数解析与校验抽到 `domain/examRequest`（纯函数、可单测），这里只做
 * 「校验后调服务、把结果套 `{ ok: true }`」的编排。
 */
import type { FastifyInstance } from 'fastify';
import { AppError, type QuestionType } from '@microclass/shared';
import { normalizeBlueprintCells, type BlueprintCell } from '../domain/blueprint.js';
import {
  isEmptyQuota,
  hasPositiveQuota,
  parseDifficultyQuota,
  parseRatio,
  parseScores,
  parseTypeQuota,
  type ExamLevel,
} from '../domain/examRequest.js';
import { requireTeacherOrAdmin } from '../http/guards.js';
import type { Deps } from '../app.js';
import { examIdOf } from './exams-shared.js';

export async function registerExamComposeRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /** 随机抽题 / 按题型配额 + 难度配额组卷 */
  app.post('/exams/:id/questions/random', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = examIdOf(req);
    const body = req.body as {
      count?: number;
      quota?: Partial<Record<QuestionType, number>>;
      difficultyQuota?: Partial<Record<ExamLevel, number>>;
    };
    const difficulty = parseDifficultyQuota(body?.difficultyQuota);
    if (difficulty.rejected) throw AppError.badRequest('难度配额只能是 easy / medium / hard');
    const hasDifficultyQuota = hasPositiveQuota(difficulty.quota);
    if (body?.quota && typeof body.quota === 'object') {
      const quota = parseTypeQuota(body.quota);
      if (isEmptyQuota(quota) && !hasDifficultyQuota) {
        throw AppError.badRequest('请至少为一种题型或难度指定数量');
      }
      return {
        ok: true,
        ...deps.examService.addByQuota(user, id, quota, hasDifficultyQuota ? difficulty.quota : undefined),
      };
    }
    if (hasDifficultyQuota) {
      return { ok: true, ...deps.examService.addByQuota(user, id, {}, difficulty.quota) };
    }
    const count = Number(body?.count ?? 5);
    if (!Number.isFinite(count) || count < 1) throw AppError.badRequest('抽题数量必须大于 0');
    return { ok: true, added: deps.examService.addRandom(user, id, Math.floor(count)) };
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
      const id = examIdOf(req);
      const body = (req.body ?? {}) as { title?: string; scope?: 'course' | 'all'; replaceExisting?: boolean };
      return deps.examService.parallelPaper(user, id, body);
    },
  );

  /** 试卷统计 + 双向细目表（知识点 × 题型 × 难度）+ 目标配比达成情况 */
  app.get('/exams/:id/blueprint', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    return deps.examService.blueprint(examIdOf(req));
  });

  /** 组卷：① 双向细目表（知识点 × 题型 × 难度 逐格数量）或 ② 题型配额 + 难度配比；缺口如实返回 */
  app.post('/exams/:id/compose', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = examIdOf(req);
    const body = req.body as {
      quota?: Partial<Record<QuestionType, number>>;
      /** 双向细目表（与 quota 二选一） */
      cells?: unknown;
      ratio?: Partial<Record<ExamLevel, number>>;
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
    const quota = parseTypeQuota(body?.quota);
    let cells: BlueprintCell[] | undefined;
    if (body?.cells !== undefined) {
      try {
        cells = normalizeBlueprintCells(body.cells);
      } catch (e) {
        throw AppError.badRequest(e instanceof Error ? e.message : '细目表格式不对');
      }
    }
    if (!cells && isEmptyQuota(quota)) {
      throw AppError.badRequest('请至少为一种题型指定数量（如 单选 10 道），或填一张双向细目表');
    }
    const ratio = parseRatio(body?.ratio);
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
      ...(body?.scores && typeof body.scores === 'object' ? { scores: parseScores(body.scores) } : {}),
      ...(body?.sectionName ? { sectionName: String(body.sectionName) } : {}),
      ...(body?.scorePerQuestion ? { scorePerQuestion: Number(body.scorePerQuestion) } : {}),
      replaceExisting: body?.replaceExisting === true,
    });
  });
}
