/**
 * 学情分析仓储：把真实作答数据（练习 + 考试）汇总成机构关心的口径。
 *
 * 数据来源与口径：
 *   - `attempts.answers`（课后练习）与 `exam_attempts.answers`（考试）都是 `[{qid, answer, correct}]`；
 *     `correct` 为 `true/false/null`，**null 是主观题（待自评），一律不计入正确率** ——
 *     否则填空/简答会被算成"全错"，老师看到的掌握度会整体偏低。
 *   - 练习按 `attempts.lesson_id` 归属课程，考试按 `exam_attempts.exam_id` 归属课程；
 *     不给课程就是全库口径（机构视角）。
 *
 * 性能取舍：这是 JSON 展开聚合（作答条目数 = 作答次数 × 每题）。当前真机量级很小
 * （全库只有几百道题有作答数据），因此直接实时聚合 + 服务层 60 秒缓存。
 * 若将来作答量到百万级，应改为把 `graded` 物化成表（这个 CTE 就是它的定义）。
 */
import type { Db } from '../client.js';

export interface AnalyticsScope {
  /** 限定课程；不给就是全库 */
  courseId?: number;
  /** 只统计最近 N 天；不给就是全部历史 */
  days?: number;
}

export interface GradedTotals {
  /** 参与统计的客观题作答条目数 */
  graded: number;
  wrong: number;
  /** 有作答的学员数 */
  students: number;
  /** 涉及的题目数 */
  questions: number;
  /** 覆盖到的知识点数 */
  points: number;
  /** 练习提交次数（attempts 行数） */
  practiceAttempts: number;
  /** 考试提交次数 */
  examAttempts: number;
}

export interface PointRow {
  point: string;
  graded: number;
  wrong: number;
  students: number;
  questions: number;
}

export interface StudentRow {
  user_id: number;
  username: string;
  display_name: string;
  graded: number;
  wrong: number;
  questions: number;
  points: number;
  /** 该学员错得最多的知识点（按错误条目数） */
  weakest_point: string;
  weakest_wrong: number;
}

export interface QuestionRow {
  question_id: number;
  stem: string;
  type: string;
  point: string;
  difficulty: string;
  graded: number;
  wrong: number;
  students: number;
}

export interface TrendRow {
  day: string;
  graded: number;
  wrong: number;
  students: number;
}

export class AnalyticsRepository {
  constructor(private readonly db: Db) {}

  /**
   * `graded` CTE：把练习与考试的客观题作答统一成
   * `(user_id, qid, correct, created_at)` 四列。所有统计都基于它，保证口径一致。
   */
  private gradedCte(scope: AnalyticsScope, params: unknown[]): string {
    const practice: string[] = [];
    const exam: string[] = [];
    if (scope.courseId !== undefined) {
      practice.push('a.lesson_id IN (SELECT id FROM lessons WHERE course_id = ?)');
      exam.push('ea.exam_id IN (SELECT id FROM exams WHERE course_id = ?)');
      params.push(scope.courseId, scope.courseId);
    }
    if (scope.days !== undefined && scope.days > 0) {
      const since = Math.floor(Date.now() / 1000) - scope.days * 86400;
      practice.push('a.created_at >= ?');
      exam.push('ea.created_at >= ?');
      params.push(since, since);
    }
    const pWhere = practice.length > 0 ? ` AND ${practice.join(' AND ')}` : '';
    const eWhere = exam.length > 0 ? ` AND ${exam.join(' AND ')}` : '';
    return `WITH graded AS (
      SELECT a.user_id AS user_id,
             CAST(json_extract(je.value, '$.qid') AS INTEGER) AS qid,
             json_extract(je.value, '$.correct') AS correct,
             a.created_at AS created_at
      FROM attempts a, json_each(a.answers) je
      WHERE json_extract(je.value, '$.correct') IN (1, 0)${pWhere}
      UNION ALL
      SELECT ea.user_id AS user_id,
             CAST(json_extract(je.value, '$.qid') AS INTEGER) AS qid,
             json_extract(je.value, '$.correct') AS correct,
             ea.created_at AS created_at
      FROM exam_attempts ea, json_each(ea.answers) je
      WHERE json_extract(je.value, '$.correct') IN (1, 0)${eWhere}
    )`;
  }

  /** 总览：作答条目、学员、题目、知识点、练习/考试提交次数 */
  totals(scope: AnalyticsScope): GradedTotals {
    const params: unknown[] = [];
    const cte = this.gradedCte(scope, params);
    const base = this.db.get<{
      graded: number;
      wrong: number;
      students: number;
      questions: number;
    }>(
      `${cte}
       SELECT COUNT(*) AS graded,
              COALESCE(SUM(CASE WHEN g.correct = 0 THEN 1 ELSE 0 END), 0) AS wrong,
              COUNT(DISTINCT g.user_id) AS students,
              COUNT(DISTINCT g.qid) AS questions
       FROM graded g`,
      params,
    );
    const points = this.db.get<{ points: number }>(
      `${cte}
       SELECT COUNT(DISTINCT q.point) AS points
       FROM graded g JOIN questions q ON q.id = g.qid
       WHERE q.point <> ''`,
      params,
    );
    const practiceScope: string[] = [];
    const practiceParams: unknown[] = [];
    if (scope.courseId !== undefined) {
      practiceScope.push('lesson_id IN (SELECT id FROM lessons WHERE course_id = ?)');
      practiceParams.push(scope.courseId);
    }
    if (scope.days !== undefined && scope.days > 0) {
      practiceScope.push('created_at >= ?');
      practiceParams.push(Math.floor(Date.now() / 1000) - scope.days * 86400);
    }
    const pWhere = practiceScope.length > 0 ? ` WHERE ${practiceScope.join(' AND ')}` : '';
    const practiceAttempts =
      this.db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM attempts${pWhere}`, practiceParams)?.c ?? 0;

    const examScope: string[] = [];
    const examParams: unknown[] = [];
    if (scope.courseId !== undefined) {
      examScope.push('exam_id IN (SELECT id FROM exams WHERE course_id = ?)');
      examParams.push(scope.courseId);
    }
    if (scope.days !== undefined && scope.days > 0) {
      examScope.push('created_at >= ?');
      examParams.push(Math.floor(Date.now() / 1000) - scope.days * 86400);
    }
    const eWhere = examScope.length > 0 ? ` WHERE ${examScope.join(' AND ')}` : '';
    const examAttempts =
      this.db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM exam_attempts${eWhere}`, examParams)?.c ?? 0;

    return {
      graded: Number(base?.graded ?? 0),
      wrong: Number(base?.wrong ?? 0),
      students: Number(base?.students ?? 0),
      questions: Number(base?.questions ?? 0),
      points: Number(points?.points ?? 0),
      practiceAttempts: Number(practiceAttempts),
      examAttempts: Number(examAttempts),
    };
  }

  /** 知识点掌握度：每个知识点的作答条目、错次、涉及学员与题目数 */
  points(scope: AnalyticsScope, options?: { limit?: number }): PointRow[] {
    const params: unknown[] = [];
    const cte = this.gradedCte(scope, params);
    const limit = Math.min(500, Math.max(1, options?.limit ?? 200));
    return this.db.all<PointRow>(
      `${cte}
       SELECT q.point AS point,
              COUNT(*) AS graded,
              COALESCE(SUM(CASE WHEN g.correct = 0 THEN 1 ELSE 0 END), 0) AS wrong,
              COUNT(DISTINCT g.user_id) AS students,
              COUNT(DISTINCT g.qid) AS questions
       FROM graded g JOIN questions q ON q.id = g.qid
       WHERE q.point <> ''
       GROUP BY q.point
       ORDER BY wrong DESC, graded DESC
       LIMIT ?`,
      [...params, limit],
    );
  }

  /** 学员学情：每个学员的作答量、错次、涉及知识点与最弱知识点 */
  students(scope: AnalyticsScope, options?: { limit?: number }): StudentRow[] {
    const params: unknown[] = [];
    const cte = this.gradedCte(scope, params);
    const limit = Math.min(500, Math.max(1, options?.limit ?? 200));
    const rows = this.db.all<{
      user_id: number;
      username: string;
      display_name: string;
      graded: number;
      wrong: number;
      questions: number;
      points: number;
    }>(
      `${cte}
       SELECT g.user_id AS user_id,
              COALESCE(u.username, '') AS username,
              COALESCE(u.display_name, '') AS display_name,
              COUNT(*) AS graded,
              COALESCE(SUM(CASE WHEN g.correct = 0 THEN 1 ELSE 0 END), 0) AS wrong,
              COUNT(DISTINCT g.qid) AS questions,
              COUNT(DISTINCT q.point) AS points
       FROM graded g
       LEFT JOIN questions q ON q.id = g.qid
       LEFT JOIN users u ON u.id = g.user_id
       GROUP BY g.user_id
       ORDER BY wrong DESC, graded DESC
       LIMIT ?`,
      [...params, limit],
    );

    // 最弱知识点：每个学员错得最多的那个知识点（单独聚合，避免主查询里再套一层）
    const weakParams: unknown[] = [];
    const weakCte = this.gradedCte(scope, weakParams);
    const weakRows = this.db.all<{ user_id: number; point: string; wrong: number }>(
      `${weakCte}
       SELECT g.user_id AS user_id, q.point AS point,
              SUM(CASE WHEN g.correct = 0 THEN 1 ELSE 0 END) AS wrong
       FROM graded g JOIN questions q ON q.id = g.qid
       WHERE q.point <> ''
       GROUP BY g.user_id, q.point
       HAVING wrong > 0
       ORDER BY wrong DESC`,
      weakParams,
    );
    const weakest = new Map<number, { point: string; wrong: number }>();
    for (const row of weakRows) {
      if (!weakest.has(row.user_id)) weakest.set(row.user_id, { point: row.point, wrong: Number(row.wrong) });
    }

    return rows.map((row) => ({
      ...row,
      graded: Number(row.graded),
      wrong: Number(row.wrong),
      questions: Number(row.questions),
      points: Number(row.points),
      weakest_point: weakest.get(row.user_id)?.point ?? '',
      weakest_wrong: weakest.get(row.user_id)?.wrong ?? 0,
    }));
  }

  /** 高频错题：按题聚合（排序由服务层用威尔逊下界做） */
  questions(scope: AnalyticsScope, options?: { limit?: number }): QuestionRow[] {
    const params: unknown[] = [];
    const cte = this.gradedCte(scope, params);
    const limit = Math.min(2000, Math.max(1, options?.limit ?? 300));
    return this.db
      .all<QuestionRow>(
        `${cte}
       SELECT g.qid AS question_id,
              q.stem AS stem,
              q.type AS type,
              q.point AS point,
              q.difficulty AS difficulty,
              COUNT(*) AS graded,
              COALESCE(SUM(CASE WHEN g.correct = 0 THEN 1 ELSE 0 END), 0) AS wrong,
              COUNT(DISTINCT g.user_id) AS students
       FROM graded g JOIN questions q ON q.id = g.qid
       GROUP BY g.qid
       ORDER BY wrong DESC, graded DESC
       LIMIT ?`,
        [...params, limit],
      )
      .map((row) => ({
        ...row,
        graded: Number(row.graded),
        wrong: Number(row.wrong),
        students: Number(row.students),
      }));
  }

  /** 按天趋势（作答条目 / 错次 / 学员数） */
  trend(scope: AnalyticsScope, options?: { limitDays?: number }): TrendRow[] {
    const params: unknown[] = [];
    const cte = this.gradedCte(scope, params);
    const days = Math.min(365, Math.max(1, options?.limitDays ?? 30));
    return this.db
      .all<TrendRow>(
        `${cte}
         SELECT date(g.created_at, 'unixepoch') AS day,
                COUNT(*) AS graded,
                COALESCE(SUM(CASE WHEN g.correct = 0 THEN 1 ELSE 0 END), 0) AS wrong,
                COUNT(DISTINCT g.user_id) AS students
         FROM graded g
         GROUP BY day
         ORDER BY day DESC
         LIMIT ?`,
        [...params, days],
      )
      .map((row) => ({ ...row, graded: Number(row.graded), wrong: Number(row.wrong), students: Number(row.students) }))
      .reverse();
  }

  /** 学员账号总数（分母：算"活跃率"用） */
  studentAccounts(): number {
    const row = this.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE role = 'student'");
    return Number(row?.c ?? 0);
  }

  /**
   * 范围里的题目总数与知识点总数（用来算"覆盖率"）。
   * 口径与组卷题池一致：题库归属课程，或题库/题目挂在课程课时下。
   */
  scopeSize(options: { courseId?: number }): { questions: number; points: number } {
    const where: string[] = [];
    const params: unknown[] = [];
    if (options.courseId !== undefined) {
      where.push(
        `(b.course_id = ? OR b.lesson_id IN (SELECT id FROM lessons WHERE course_id = ?)
          OR q.lesson_id IN (SELECT id FROM lessons WHERE course_id = ?))`,
      );
      params.push(options.courseId, options.courseId, options.courseId);
    }
    const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    const row = this.db.get<{ questions: number; points: number }>(
      `SELECT COUNT(*) AS questions, COUNT(DISTINCT CASE WHEN q.point <> '' THEN q.point END) AS points
       FROM questions q LEFT JOIN banks b ON b.id = q.bank_id${clause}`,
      params,
    );
    return { questions: Number(row?.questions ?? 0), points: Number(row?.points ?? 0) };
  }
}
