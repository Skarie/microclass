/**
 * 学情分析服务：把作答聚合结果加工成机构看得懂的口径。
 *
 * 三条产品原则（都来自真机数据的教训）：
 *   1. **样本不足不下结论**：某知识点只有 1 次作答，正确率 0% 不能叫"未掌握"。
 *      分档前先看 `graded`，不足阈值统一归到 `insufficient`（界面显示"数据不足"）。
 *   2. **排序用威尔逊下界**：错误率排序已在"易错题挑题"里踩过坑（1 次错 1 次 = 100% 会霸榜）。
 *   3. **如实说明数据规模**：总览里返回 `dataNote`，界面直接显示"仅 N 道题有作答数据"，
 *      避免机构拿一份几乎没数据的报表去做教学决策。
 */
import { AppError, type User } from '@microclass/shared';
import type {
  AnalyticsRepository,
  AnalyticsScope,
  PointRow,
  QuestionRow,
  StudentRow,
} from '../db/repositories/analyticsRepository.js';
import { wilsonLowerBound } from '../domain/errorRate.js';

/** 掌握度分档用的阈值（集中在这里，界面文案与后端必须一致） */
export const MASTERY = {
  /** 少于这么多次作答：不下结论 */
  minGraded: 3,
  /** 正确率 ≥ 掌握线 = 掌握 */
  mastered: 0.8,
  /** 正确率 ≥ 薄弱线（但 < 掌握线）= 薄弱；低于薄弱线 = 未掌握 */
  weak: 0.6,
} as const;

export type MasteryLevel = 'mastered' | 'weak' | 'poor' | 'insufficient';

export function masteryOf(graded: number, accuracy: number): MasteryLevel {
  if (graded < MASTERY.minGraded) return 'insufficient';
  if (accuracy >= MASTERY.mastered) return 'mastered';
  if (accuracy >= MASTERY.weak) return 'weak';
  return 'poor';
}

const CACHE_MS = 60 * 1000;

export class AnalyticsService {
  private cache = new Map<string, { at: number; value: unknown }>();

  constructor(private readonly repo: AnalyticsRepository) {}

  private cached<T>(key: string, build: () => T): T {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
    const value = build();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  /** 只有老师/管理员能看学情（学员只能看自己的，走 /stats/me） */
  private requireManager(actor: User): void {
    if (actor.role !== 'admin' && actor.role !== 'teacher')
      throw AppError.forbidden('只有老师或管理员可以查看学情分析');
  }

  /** 学情总览：KPI + 覆盖率 + 按天趋势 + 数据规模说明 */
  overview(
    actor: User,
    options: AnalyticsScope & { trendDays?: number },
  ): {
    scope: { courseId: number | undefined; days: number | undefined };
    kpi: {
      students: number;
      activeStudents: number;
      graded: number;
      wrong: number;
      accuracy: number;
      practiceAttempts: number;
      examAttempts: number;
      questionsWithData: number;
      pointsWithData: number;
      totalQuestions: number;
      totalPoints: number;
      questionCoverage: number;
      pointCoverage: number;
    };
    trend: { day: string; graded: number; wrong: number; students: number; accuracy: number }[];
    mastery: { level: MasteryLevel; points: number }[];
    /** 数据规模说明：样本太小时界面必须显示，避免误读 */
    dataNote: string;
    generatedAt: number;
  } {
    this.requireManager(actor);
    const scope: AnalyticsScope = {
      ...(options.courseId === undefined ? {} : { courseId: options.courseId }),
      ...(options.days === undefined ? {} : { days: options.days }),
    };
    const key = `overview:${scope.courseId ?? 'all'}:${scope.days ?? 'all'}:${options.trendDays ?? 30}`;
    return this.cached(key, () => {
      const totals = this.repo.totals(scope);
      const size = this.repo.scopeSize(scope.courseId === undefined ? {} : { courseId: scope.courseId });
      const trend = this.repo.trend(scope, { limitDays: options.trendDays ?? 30 });
      const points = this.repo.points(scope, { limit: 500 });

      const buckets: Record<MasteryLevel, number> = { mastered: 0, weak: 0, poor: 0, insufficient: 0 };
      for (const p of points) {
        const accuracy = p.graded > 0 ? (p.graded - p.wrong) / p.graded : 0;
        buckets[masteryOf(p.graded, accuracy)] += 1;
      }

      const accuracy = totals.graded > 0 ? (totals.graded - totals.wrong) / totals.graded : 0;
      const dataNote =
        totals.graded === 0
          ? '当前范围内还没有任何客观题作答记录：学员完成课后练习或提交考试后，这里才会有数据。'
          : totals.questions < 10
            ? `当前范围内只有 ${totals.questions} 道题有作答数据（共 ${totals.graded} 条作答）：样本很少，掌握度结论仅供参考。`
            : `覆盖 ${totals.questions} 道题、${totals.graded} 条作答。`;

      return {
        scope: { courseId: scope.courseId, days: scope.days },
        kpi: {
          students: this.repo.studentAccounts(),
          activeStudents: totals.students,
          graded: totals.graded,
          wrong: totals.wrong,
          accuracy: Math.round(accuracy * 1000) / 1000,
          practiceAttempts: totals.practiceAttempts,
          examAttempts: totals.examAttempts,
          questionsWithData: totals.questions,
          pointsWithData: totals.points,
          totalQuestions: size.questions,
          totalPoints: size.points,
          questionCoverage: size.questions > 0 ? Math.round((totals.questions / size.questions) * 1000) / 10 : 0,
          pointCoverage: size.points > 0 ? Math.round((totals.points / size.points) * 1000) / 10 : 0,
        },
        trend: trend.map((t) => ({
          ...t,
          accuracy: t.graded > 0 ? Math.round(((t.graded - t.wrong) / t.graded) * 1000) / 1000 : 0,
        })),
        mastery: (['mastered', 'weak', 'poor', 'insufficient'] as MasteryLevel[]).map((level) => ({
          level,
          points: buckets[level],
        })),
        dataNote,
        generatedAt: Date.now(),
      };
    });
  }

  /** 知识点掌握度排行：薄弱优先（未掌握 → 薄弱 → 数据不足 → 掌握），并带下钻题目 */
  points(
    actor: User,
    options: AnalyticsScope & { limit?: number; questionsPerPoint?: number },
  ): {
    points: {
      point: string;
      graded: number;
      wrong: number;
      accuracy: number;
      students: number;
      questions: number;
      mastery: MasteryLevel;
      /** 该知识点错得最多的几道题，供老师直接下钻讲评 */
      topWrong: { question_id: number; stem: string; graded: number; wrong: number }[];
    }[];
    dataNote: string;
  } {
    this.requireManager(actor);
    const scope: AnalyticsScope = {
      ...(options.courseId === undefined ? {} : { courseId: options.courseId }),
      ...(options.days === undefined ? {} : { days: options.days }),
    };
    const limit = Math.min(200, Math.max(1, options.limit ?? 50));
    const key = `points:${scope.courseId ?? 'all'}:${scope.days ?? 'all'}:${limit}:${options.questionsPerPoint ?? 3}`;
    return this.cached(key, () => {
      const rows: PointRow[] = this.repo.points(scope, { limit: 500 });
      const decorated = rows.map((row) => {
        const accuracy = row.graded > 0 ? (row.graded - row.wrong) / row.graded : 0;
        return { ...row, accuracy, mastery: masteryOf(row.graded, accuracy) };
      });
      const order: Record<MasteryLevel, number> = { poor: 0, weak: 1, insufficient: 2, mastered: 3 };
      decorated.sort((a, b) => order[a.mastery] - order[b.mastery] || b.wrong - a.wrong || b.graded - a.graded);
      const top = decorated.slice(0, limit);

      // 下钻：每个知识点错得最多的几道题（一次查全量再分组，避免 N+1）
      const per = Math.min(5, Math.max(1, options.questionsPerPoint ?? 3));
      const questionRows: QuestionRow[] = this.repo.questions(scope, { limit: 2000 });
      const byPoint = new Map<string, { question_id: number; stem: string; graded: number; wrong: number }[]>();
      for (const q of questionRows.filter((q) => q.wrong > 0)) {
        const list = byPoint.get(q.point) ?? [];
        if (list.length < per) {
          list.push({ question_id: q.question_id, stem: q.stem, graded: q.graded, wrong: q.wrong });
          byPoint.set(q.point, list);
        }
      }

      return {
        points: top.map((row) => ({
          point: row.point,
          graded: row.graded,
          wrong: row.wrong,
          accuracy: Math.round(row.accuracy * 1000) / 1000,
          students: row.students,
          questions: row.questions,
          mastery: row.mastery,
          topWrong: byPoint.get(row.point) ?? [],
        })),
        dataNote:
          decorated.length === 0
            ? '还没有带知识点的作答数据（题目需要先设置知识点）。'
            : `共 ${decorated.length} 个知识点有作答数据；掌握度分档需至少 ${MASTERY.minGraded} 次作答，少于该量的标为"数据不足"。` +
              // 真机实测到的情况：同一份题被复制成多个题库（同一知识点下 20 道题 ×5 份），
              // 知识点统计会按题目记录重复计入 —— 这是数据问题，必须提示而不是悄悄呈现。
              '注意：统计按「题目记录」计数，若题库存在重复题（同题多份），同一知识点的作答量会被重复计入，建议先用题库体检清理重复题。',
      };
    });
  }

  /** 学员学情排行 */
  students(
    actor: User,
    options: AnalyticsScope & { limit?: number },
  ): {
    students: (StudentRow & { accuracy: number; level: MasteryLevel })[];
    dataNote: string;
  } {
    this.requireManager(actor);
    const scope: AnalyticsScope = {
      ...(options.courseId === undefined ? {} : { courseId: options.courseId }),
      ...(options.days === undefined ? {} : { days: options.days }),
    };
    const limit = Math.min(200, Math.max(1, options.limit ?? 50));
    const key = `students:${scope.courseId ?? 'all'}:${scope.days ?? 'all'}:${limit}`;
    return this.cached(key, () => {
      const rows = this.repo.students(scope, { limit });
      return {
        students: rows.map((row) => {
          const accuracy = row.graded > 0 ? (row.graded - row.wrong) / row.graded : 0;
          return { ...row, accuracy: Math.round(accuracy * 1000) / 1000, level: masteryOf(row.graded, accuracy) };
        }),
        dataNote:
          rows.length === 0 ? '当前范围内还没有学员作答记录。' : `按错题数排序，共 ${rows.length} 名学员有作答数据。`,
      };
    });
  }

  /** 高频错题榜（威尔逊下界排序，样本少的自动降权） */
  wrongQuestions(
    actor: User,
    options: AnalyticsScope & { limit?: number; minAttempts?: number },
  ): {
    questions: (QuestionRow & { accuracy: number; score: number })[];
    minAttempts: number;
    dataNote: string;
  } {
    this.requireManager(actor);
    const scope: AnalyticsScope = {
      ...(options.courseId === undefined ? {} : { courseId: options.courseId }),
      ...(options.days === undefined ? {} : { days: options.days }),
    };
    const minAttempts = Math.max(1, options.minAttempts ?? 2);
    const limit = Math.min(200, Math.max(1, options.limit ?? 50));
    const key = `wrong:${scope.courseId ?? 'all'}:${scope.days ?? 'all'}:${limit}:${minAttempts}`;
    return this.cached(key, () => {
      const rows = this.repo.questions(scope, { limit: 2000 });
      const filtered = rows
        .filter((row) => row.graded >= minAttempts)
        .map((row) => ({
          ...row,
          accuracy: Math.round(((row.graded - row.wrong) / row.graded) * 1000) / 1000,
          score: wilsonLowerBound(row.wrong, row.graded),
        }))
        .sort((a, b) => b.score - a.score || b.wrong - a.wrong);
      return {
        questions: filtered.slice(0, limit),
        minAttempts,
        dataNote:
          filtered.length === 0
            ? `当前范围内没有作答次数 ≥ ${minAttempts} 的题目：数据太少，结论不可靠（可把"最少作答"调到 1 查看全部）。`
            : `按威尔逊置信下界排序（样本少的自动降权），共 ${filtered.length} 道题满足最少 ${minAttempts} 次作答。`,
      };
    });
  }

  /** 讲评清单（Markdown）：薄弱知识点 + 典型错题，可直接发给教研或打印 */
  reviewMarkdown(actor: User, options: AnalyticsScope & { limit?: number }): { filename: string; body: string } {
    this.requireManager(actor);
    const limit = Math.min(50, Math.max(1, options.limit ?? 10));
    const points = this.points(actor, { ...options, limit, questionsPerPoint: 2 });
    const wrong = this.wrongQuestions(actor, { ...options, limit, minAttempts: 1 });
    const overview = this.overview(actor, options);
    const levelLabel: Record<MasteryLevel, string> = {
      poor: '未掌握',
      weak: '薄弱',
      insufficient: '数据不足',
      mastered: '掌握',
    };
    const lines: string[] = [];
    lines.push(`# 学情讲评清单`);
    lines.push('');
    lines.push(`- 生成时间：${new Date(overview.generatedAt).toLocaleString('zh-CN')}`);
    lines.push(
      `- 范围：${options.courseId === undefined ? '全部课程' : `课程 #${options.courseId}`}${options.days ? `，最近 ${options.days} 天` : ''}`,
    );
    lines.push(
      `- 数据规模：${overview.kpi.graded} 条作答、${overview.kpi.questionsWithData} 道题、${overview.kpi.activeStudents} 名学员；整体正确率 ${(overview.kpi.accuracy * 100).toFixed(1)}%`,
    );
    lines.push('');
    lines.push(`> ${overview.dataNote}`);
    lines.push('');
    lines.push('## 一、需要重点讲的知识点');
    lines.push('');
    if (points.points.length === 0) lines.push('（暂无数据）');
    for (const [index, p] of points.points.entries()) {
      lines.push(
        `### ${index + 1}. ${p.point}（${levelLabel[p.mastery]}｜正确率 ${(p.accuracy * 100).toFixed(0)}%｜${p.graded} 条作答，${p.wrong} 条错）`,
      );
      for (const q of p.topWrong) {
        const stem = q.stem.replace(/\s+/g, ' ').slice(0, 120);
        lines.push(`- 典型错题（${q.graded} 次作答错 ${q.wrong} 次）：${stem}`);
      }
      lines.push('');
    }
    lines.push('## 二、高频错题（按错误率降序，样本少的自动降权）');
    lines.push('');
    if (wrong.questions.length === 0) lines.push('（暂无数据）');
    for (const [index, q] of wrong.questions.entries()) {
      const stem = q.stem.replace(/\s+/g, ' ').slice(0, 120);
      lines.push(
        `${index + 1}. [${q.point || '未归类'}] ${stem} —— ${q.graded} 次作答错 ${q.wrong} 次（正确率 ${(q.accuracy * 100).toFixed(0)}%）`,
      );
    }
    lines.push('');
    const stamp = new Date().toISOString().slice(0, 10);
    return { filename: `学情讲评清单_${stamp}.md`, body: lines.join('\n') };
  }

  /** 高频错题 CSV（Excel 可直接打开，供教研二次加工） */
  wrongQuestionsCsv(actor: User, options: AnalyticsScope & { limit?: number }): { filename: string; body: string } {
    const { questions } = this.wrongQuestions(actor, { ...options, limit: options.limit ?? 200 });
    const escape = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [
      ['题号', '知识点', '题型', '难度', '作答次数', '错误次数', '正确率', '涉及学员', '题干'].join(','),
      ...questions.map((q) =>
        [
          q.question_id,
          escape(q.point || '未归类'),
          q.type,
          q.difficulty || '',
          q.graded,
          q.wrong,
          `${(q.accuracy * 100).toFixed(0)}%`,
          q.students,
          escape(q.stem.replace(/\s+/g, ' ').slice(0, 200)),
        ].join(','),
      ),
    ];
    return { filename: `高频错题_${new Date().toISOString().slice(0, 10)}.csv`, body: `\uFEFF${lines.join('\n')}` };
  }
}
