/** 学情分析路由（老师/管理员） */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.js';
import { requireTeacherOrAdmin } from '../http/guards.js';

export async function registerAnalyticsRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /** 解析公共筛选：课程 + 最近天数 */
  const scopeOf = (q: Record<string, string | undefined>): { courseId?: number; days?: number } => {
    const courseId = q.courseId ? Number.parseInt(q.courseId, 10) : undefined;
    const days = q.days ? Number.parseInt(q.days, 10) : undefined;
    return {
      ...(courseId === undefined || Number.isNaN(courseId) ? {} : { courseId }),
      ...(days === undefined || Number.isNaN(days) || days <= 0 ? {} : { days }),
    };
  };

  /** 学情总览：KPI + 覆盖率 + 趋势 + 掌握度分布 + 数据规模说明 */
  app.get('/analytics/overview', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const q = req.query as Record<string, string | undefined>;
    const trendDays = q.trendDays ? Number.parseInt(q.trendDays, 10) : 30;
    return deps.analyticsService.overview(user, {
      ...scopeOf(q),
      ...(Number.isNaN(trendDays) ? {} : { trendDays }),
    });
  });

  /** 知识点掌握度（薄弱优先，含下钻错题） */
  app.get('/analytics/points', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const q = req.query as Record<string, string | undefined>;
    return deps.analyticsService.points(user, {
      ...scopeOf(q),
      ...(q.limit ? { limit: Number.parseInt(q.limit, 10) } : {}),
      ...(q.questionsPerPoint ? { questionsPerPoint: Number.parseInt(q.questionsPerPoint, 10) } : {}),
    });
  });

  /** 学员学情排行 */
  app.get('/analytics/students', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const q = req.query as Record<string, string | undefined>;
    return deps.analyticsService.students(user, {
      ...scopeOf(q),
      ...(q.limit ? { limit: Number.parseInt(q.limit, 10) } : {}),
    });
  });

  /** 高频错题榜（威尔逊下界排序） */
  app.get('/analytics/wrong-questions', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const q = req.query as Record<string, string | undefined>;
    return deps.analyticsService.wrongQuestions(user, {
      ...scopeOf(q),
      ...(q.limit ? { limit: Number.parseInt(q.limit, 10) } : {}),
      ...(q.minAttempts ? { minAttempts: Number.parseInt(q.minAttempts, 10) } : {}),
    });
  });

  /** 高频错题 CSV（Excel 直接打开） */
  app.get('/analytics/wrong-questions.csv', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const q = req.query as Record<string, string | undefined>;
    const { filename, body } = deps.analyticsService.wrongQuestionsCsv(user, {
      ...scopeOf(q),
      ...(q.limit ? { limit: Number.parseInt(q.limit, 10) } : {}),
    });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .send(body);
  });

  /** 讲评清单（Markdown）：薄弱知识点 + 典型错题，可直接发给教研 */
  app.get('/analytics/review.md', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const q = req.query as Record<string, string | undefined>;
    const { filename, body } = deps.analyticsService.reviewMarkdown(user, {
      ...scopeOf(q),
      ...(q.limit ? { limit: Number.parseInt(q.limit, 10) } : {}),
    });
    return reply
      .header('content-type', 'text/markdown; charset=utf-8')
      .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .send(body);
  });
}
