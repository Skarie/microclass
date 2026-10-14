/**
 * 学习进度路由：上报、观看区间、查询、学习概览（时长/等级）。
 *
 * 与轻课堂一致的做法：除了单一播放位置，还按「观看区间」记录已看片段，
 * 用于真实判断「是否看完」（拖到结尾不算看完），进而控制刷题解锁。
 */
import type { FastifyInstance } from 'fastify';
import { AppError } from '@microclass/shared';
import { requireUser } from '../http/guards.js';
import type { Deps } from '../app.js';
import { mergeIntervals } from '../db/repositories/watchIntervalRepository.js';

export async function registerProgressRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get('/progress', async (req, reply) => {
    const user = requireUser(req, reply);
    return { progress: deps.progress.listByUser(user.id) };
  });

  app.post(
    '/progress',
    {
      schema: {
        body: {
          type: 'object',
          required: ['lessonId', 'position', 'duration'],
          properties: {
            lessonId: { type: 'integer', minimum: 1 },
            position: { type: 'number', minimum: 0 },
            duration: { type: 'number', minimum: 0 },
            finished: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const user = requireUser(req, reply);
      const body = req.body as { lessonId: number; position: number; duration: number; finished?: boolean };
      if (!deps.lessons.findById(body.lessonId)) throw AppError.notFound('视频单元不存在');
      deps.progress.upsert({
        userId: user.id,
        lessonId: body.lessonId,
        position: body.position,
        duration: body.duration,
        finished: body.finished === true,
      });
      return { ok: true };
    },
  );

  /**
   * 上报观看区间（播放器每隔十几秒把「刚看过的这段」发上来）。
   * 同时更新播放位置/时长，保证断点续播与旧的进度展示不受影响。
   */
  app.post(
    '/progress/intervals',
    {
      schema: {
        body: {
          type: 'object',
          required: ['lessonId', 'intervals'],
          properties: {
            lessonId: { type: 'integer', minimum: 1 },
            position: { type: 'number', minimum: 0 },
            duration: { type: 'number', minimum: 0 },
            finished: { type: 'boolean' },
            intervals: {
              type: 'array',
              maxItems: 50,
              items: {
                type: 'object',
                required: ['start', 'end'],
                properties: {
                  start: { type: 'number', minimum: 0 },
                  end: { type: 'number', minimum: 0 },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const user = requireUser(req, reply);
      const body = req.body as {
        lessonId: number;
        position?: number;
        duration?: number;
        finished?: boolean;
        intervals: { start: number; end: number }[];
      };
      const lesson = deps.lessons.findById(body.lessonId);
      if (!lesson) throw AppError.notFound('视频单元不存在');

      const segments = mergeIntervals(
        body.intervals.map((i) => ({ start_sec: Math.floor(i.start), end_sec: Math.floor(i.end) })),
      );
      if (segments.length > 0) {
        deps.watchIntervals.record(user.id, body.lessonId, segments);
      }

      // 总时长优先用 ffprobe 抽到的真实时长
      const duration = body.duration ?? lesson.duration ?? 0;
      const covered = deps.watchIntervals.covered(user.id, body.lessonId);
      // 区间覆盖达到总时长 95% 时自动标记完成（与「看完」语义一致）
      const autoFinished = duration > 0 && covered / duration >= 0.95;

      deps.progress.upsert({
        userId: user.id,
        lessonId: body.lessonId,
        position: body.position ?? 0,
        duration,
        finished: body.finished === true || autoFinished,
      });

      return {
        ok: true,
        coveredSeconds: covered,
        duration,
        percent: duration > 0 ? Math.min(100, Math.round((covered / duration) * 100)) : 0,
        finished: body.finished === true || autoFinished,
      };
    },
  );

  /** 读取某课时的观看区间与已看时长（复盘/调试用） */
  app.get('/progress/intervals', async (req, reply) => {
    const user = requireUser(req, reply);
    const lessonId = Number.parseInt(String((req.query as { lesson?: string }).lesson ?? ''), 10);
    if (Number.isNaN(lessonId)) throw AppError.badRequest('lesson 参数非法');
    const intervals = deps.watchIntervals.list(user.id, lessonId);
    const covered = deps.watchIntervals.covered(user.id, lessonId);
    const lesson = deps.lessons.findById(lessonId);
    const duration = lesson?.duration ?? deps.progress.get(user.id, lessonId)?.duration ?? 0;
    return {
      intervals: intervals.map((i) => ({ start: i.start_sec, end: i.end_sec })),
      coveredSeconds: covered,
      duration,
      percent: duration > 0 ? Math.min(100, Math.round((covered / duration) * 100)) : 0,
      quizUnlocked: deps.lessonService.isQuizUnlocked(user, lessonId),
    };
  });

  app.get('/me/summary', async (req, reply) => {
    const user = requireUser(req, reply);
    return deps.progress.summary(user.id);
  });
}
