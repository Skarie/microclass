/**
 * 考试（exams / exam_questions / exam_attempts）仓储。
 */
import type { Exam } from '@microclass/shared';
import type { Db } from '../client.js';

/**
 * 难度档位的统一 SQL 口径（组卷挑题、细目表统计、筛选题树三处必须一致，
 * 否则「筛出来的题量」和「实际配到的题量」会对不上）：
 * 优先三档字段，旧数据用 difficulty_score 按 42/71 分档，没有分的算中档。
 */
const DIFFICULTY_BUCKET_SQL = `CASE
  WHEN q.difficulty IN ('easy','medium','hard') THEN q.difficulty
  WHEN COALESCE(q.difficulty_score, -1) < 0 THEN 'medium'
  WHEN q.difficulty_score < 42 THEN 'easy'
  WHEN q.difficulty_score < 71 THEN 'medium'
  ELSE 'hard'
END`;

export interface ExamWithStats extends Exam {
  question_count: number;
  attempt_count: number;
}

export interface PoolQuestion {
  id: number;
  stem: string;
  type: string;
  bank_id: number;
  lesson_id: number | null;
  /** 难度：easy / medium / hard（空串 = 未标注）——按难度配额组卷用 */
  difficulty?: string;
}

export interface ExamInput {
  courseId: number;
  title: string;
  description?: string;
  durationMinutes?: number;
  passScore?: number;
  status?: Exam['status'];
  /** 试卷结构（大题分组 JSON 字符串，迁移 0018） */
  structure?: string;
  /** 目标难度配比 JSON，如 {"easy":0.3,"medium":0.5,"hard":0.2} */
  difficultyTarget?: string;
  /** 试卷总分（默认 100） */
  totalScore?: number;
  /** 考试设置（对标学习通）：时间窗口 / 作答次数 / 乱序 / 公布答案 */
  startAt?: number;
  endAt?: number;
  attemptLimit?: number;
  shuffleQuestions?: boolean;
  showAnswers?: boolean;
}

export interface ExamAttempt {
  id: number;
  exam_id: number;
  user_id: number;
  answers: string;
  score: number;
  total: number;
  passed: 0 | 1;
  used_seconds: number;
  created_at: number;
}

export class ExamRepository {
  constructor(private readonly db: Db) {}

  listByCourse(courseId: number): Exam[] {
    return this.db.all<Exam>('SELECT * FROM exams WHERE course_id = ? ORDER BY id DESC', [courseId]);
  }

  /** 考试列表（含题量、参与人数与我的最近成绩） */
  listByCourseWithStats(courseId: number, viewerId: number | null): (ExamWithStats & { my: ExamAttempt | null })[] {
    return this.listByCourse(courseId).map((e) => {
      const questionCount =
        this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM exam_questions WHERE exam_id = ?', [e.id])?.c ?? 0;
      const attemptCount =
        this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM exam_attempts WHERE exam_id = ?', [e.id])?.c ?? 0;
      const my =
        viewerId === null
          ? null
          : (this.db.get<ExamAttempt>(
              'SELECT * FROM exam_attempts WHERE exam_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1',
              [e.id, viewerId],
            ) ?? null);
      return { ...e, question_count: questionCount, attempt_count: attemptCount, my };
    });
  }

  findById(id: number): Exam | undefined {
    return this.db.get<Exam>('SELECT * FROM exams WHERE id = ?', [id]);
  }

  create(input: ExamInput): number {
    return this.db.run(
      `INSERT INTO exams (course_id, title, description, duration_minutes, pass_score, status, structure, difficulty_target, total_score,
                           start_at, end_at, attempt_limit, shuffle_questions, show_answers)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.courseId,
        input.title,
        input.description ?? '',
        input.durationMinutes ?? 60,
        input.passScore ?? 60,
        input.status ?? 'draft',
        input.structure ?? '[]',
        input.difficultyTarget ?? '',
        input.totalScore ?? 100,
        input.startAt ?? 0,
        input.endAt ?? 0,
        input.attemptLimit ?? 0,
        input.shuffleQuestions ? 1 : 0,
        input.showAnswers === false ? 0 : 1,
      ],
    ).lastInsertRowid;
  }

  update(id: number, input: ExamInput): void {
    const existing = this.findById(id);
    this.db.run(
      `UPDATE exams SET course_id = ?, title = ?, description = ?, duration_minutes = ?, pass_score = ?, status = ?,
         structure = ?, difficulty_target = ?, total_score = ?,
         start_at = ?, end_at = ?, attempt_limit = ?, shuffle_questions = ?, show_answers = ?
       WHERE id = ?`,
      [
        input.courseId,
        input.title,
        input.description ?? '',
        input.durationMinutes ?? 60,
        input.passScore ?? 60,
        input.status ?? 'draft',
        input.structure ?? existing?.structure ?? '[]',
        input.difficultyTarget ?? existing?.difficulty_target ?? '',
        input.totalScore ?? existing?.total_score ?? 100,
        // 考试设置：不传即保持原值（表单里没动的项不能被重置）
        input.startAt ?? existing?.start_at ?? 0,
        input.endAt ?? existing?.end_at ?? 0,
        input.attemptLimit ?? existing?.attempt_limit ?? 0,
        (input.shuffleQuestions ?? Boolean(existing?.shuffle_questions)) ? 1 : 0,
        (input.showAnswers ?? (existing?.show_answers === undefined ? true : Boolean(existing.show_answers))) ? 1 : 0,
        id,
      ],
    );
  }

  /** 只更新试卷结构/目标配比（组卷工作台里改大题、分值） */
  setStructure(id: number, structure: string, difficultyTarget?: string, totalScore?: number): void {
    const existing = this.findById(id);
    this.db.run('UPDATE exams SET structure = ?, difficulty_target = ?, total_score = ? WHERE id = ?', [
      structure,
      difficultyTarget ?? existing?.difficulty_target ?? '',
      totalScore ?? existing?.total_score ?? 100,
      id,
    ]);
  }

  delete(id: number): void {
    this.db.run('DELETE FROM exams WHERE id = ?', [id]);
  }

  // ---- 组卷 ----

  /** 已选入试卷的题目（按卷内顺序，含大题与分值） */
  listQuestions(examId: number): {
    id: number;
    bank_id: number;
    lesson_id: number | null;
    type: string;
    stem: string;
    image_path: string;
    options: string;
    answer: string;
    analysis: string;
    sort: number;
    difficulty: string;
    difficulty_score: number;
    point: string;
    book: string;
    score: number;
    section: string;
  }[] {
    return this.db.all(
      `SELECT q.id, q.bank_id, q.lesson_id, q.type, q.stem, q.image_path, q.options, q.answer, q.analysis,
              q.difficulty, q.difficulty_score, q.point, q.book,
              eq.sort, eq.score, COALESCE(eq.section, '') AS section
       FROM exam_questions eq
       JOIN questions q ON q.id = eq.question_id
       WHERE eq.exam_id = ?
       ORDER BY eq.sort, q.id`,
      [examId],
    );
  }

  /** 单个题目的卷内配置（换题/改分值用） */
  questionInExam(examId: number, questionId: number): { sort: number; score: number; section: string } | undefined {
    return this.db.get<{ sort: number; score: number; section: string }>(
      "SELECT sort, score, COALESCE(section, '') AS section FROM exam_questions WHERE exam_id = ? AND question_id = ?",
      [examId, questionId],
    );
  }

  /** 改某题的分值 / 大题分组 */
  setQuestionMeta(examId: number, questionId: number, meta: { score?: number; section?: string }): void {
    if (meta.score !== undefined) {
      this.db.run('UPDATE exam_questions SET score = ? WHERE exam_id = ? AND question_id = ?', [
        meta.score,
        examId,
        questionId,
      ]);
    }
    if (meta.section !== undefined) {
      this.db.run('UPDATE exam_questions SET section = ? WHERE exam_id = ? AND question_id = ?', [
        meta.section,
        examId,
        questionId,
      ]);
    }
  }

  /** 重排卷内顺序（传完整 id 顺序） */
  reorder(examId: number, questionIds: number[]): void {
    this.db.transaction(() => {
      questionIds.forEach((qid, index) => {
        this.db.run('UPDATE exam_questions SET sort = ? WHERE exam_id = ? AND question_id = ?', [index, examId, qid]);
      });
    });
  }

  /** 用另一道题替换卷内某题（保持位置/分值/大题） */
  replaceQuestion(examId: number, oldQuestionId: number, newQuestionId: number): void {
    const current = this.questionInExam(examId, oldQuestionId);
    this.db.transaction(() => {
      this.db.run('DELETE FROM exam_questions WHERE exam_id = ? AND question_id = ?', [examId, oldQuestionId]);
      this.db.run(
        `INSERT OR REPLACE INTO exam_questions (exam_id, question_id, sort, score, section) VALUES (?,?,?,?,?)`,
        [examId, newQuestionId, current?.sort ?? 0, current?.score ?? 0, current?.section ?? ''],
      );
    });
  }

  /** 组卷挑题的条件（pick 与 pickCount 共用，避免两处条件写歪） */
  private pickWhere(options: {
    courseId?: number;
    lessonId?: number;
    bankId?: number;
    type?: string;
    difficulty?: string;
    levelMin?: number;
    levelMax?: number;
    point?: string;
    chapter?: string;
    /** 多选：册次（教材版本册次） */
    books?: string[];
    /** 多选：教材章节（「按教材章节命题」用） */
    chapters?: string[];
    /** 多选：知识点（「按知识点命题」用） */
    points?: string[];
    /** 多选：题型 */
    types?: string[];
    /** 多选：难度档位（与 taxonomy 的口径一致：优先三档字段，旧数据按 difficulty_score 分档） */
    levels?: ('easy' | 'medium' | 'hard')[];
    keyword?: string;
    hasImage?: boolean;
    exclude?: number[];
  }): { where: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    /**
     * 精确多选（树的勾选是"这个章节/知识点"，不能用 LIKE 子串匹配）。
     * 哨兵值 `__none__` = 老师勾的是树里的「未标注」节点 → 匹配空值/ NULL。
     */
    const inClause = (column: string, values: string[] | undefined): void => {
      const list = (values ?? []).filter((v) => v !== '');
      if (list.length === 0) return;
      const real = list.filter((v) => v !== '__none__');
      const wantEmpty = list.includes('__none__');
      const parts: string[] = [];
      if (real.length > 0) {
        parts.push(`${column} IN (${real.map(() => '?').join(',')})`);
        params.push(...real);
      }
      if (wantEmpty) parts.push(`(${column} IS NULL OR ${column} = '')`);
      clauses.push(parts.length > 1 ? `(${parts.join(' OR ')})` : (parts[0] ?? '1 = 1'));
    };
    if (options.courseId !== undefined) {
      // 课程范围 = 题目所属题库的课程（q.course_id，迁移 0022 起冗余在题目行上，走索引）
      //           + 题目本身挂在课程课时下（q.lesson_id，走 idx_questions_lesson）
      //
      // 为什么不再关联 banks：原条件以 questions（37 万行）为驱动表逐行回查 banks 求值 OR，
      // 实测「本课程池」205ms；冗余列 + 两个可用索引后不再需要全表扫描。
      // banks.course_id 已由迁移与触发器保持与课时一致，语义不变。
      clauses.push(
        '(q.course_id = ? OR q.bank_lesson_course_id = ? OR q.lesson_id IN (SELECT id FROM lessons WHERE course_id = ?))',
      );
      params.push(options.courseId, options.courseId, options.courseId);
    }
    if (options.lessonId !== undefined) {
      clauses.push('(q.lesson_id = ? OR b.lesson_id = ?)');
      params.push(options.lessonId, options.lessonId);
    }
    if (options.bankId !== undefined) {
      clauses.push('q.bank_id = ?');
      params.push(options.bankId);
    }
    inClause('q.book', options.books);
    inClause('q.chapter', options.chapters);
    inClause('q.point', options.points);
    inClause('q.type', options.types);
    if (options.levels && options.levels.length > 0) {
      // 与 taxonomy()/掌握度完全同口径：优先三档字段，旧数据用 difficulty_score 按 42/71 分档
      clauses.push(`${DIFFICULTY_BUCKET_SQL} IN (${options.levels.map(() => '?').join(',')})`);
      params.push(...options.levels);
    }
    if (options.type) {
      clauses.push('q.type = ?');
      params.push(options.type);
    }
    if (options.difficulty) {
      clauses.push('q.difficulty = ?');
      params.push(options.difficulty);
    }
    if (options.levelMin !== undefined) {
      clauses.push('q.difficulty_score >= ?');
      params.push(options.levelMin);
    }
    if (options.levelMax !== undefined) {
      clauses.push('q.difficulty_score <= ?');
      params.push(options.levelMax);
    }
    if (options.point) {
      clauses.push('q.point LIKE ?');
      params.push(`%${options.point}%`);
    }
    if (options.chapter) {
      clauses.push('q.chapter LIKE ?');
      params.push(`%${options.chapter}%`);
    }
    if (options.keyword) {
      clauses.push('q.stem LIKE ?');
      params.push(`%${options.keyword}%`);
    }
    if (options.hasImage === true) clauses.push('q.has_image = 1');
    if (options.hasImage === false) clauses.push('q.has_image = 0');
    const exclude = options.exclude ?? [];
    if (exclude.length > 0) {
      clauses.push(`q.id NOT IN (${exclude.map(() => '?').join(',')})`);
      params.push(...exclude);
    }
    return { where: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '', params };
  }

  /**
   * 挑题（组卷/选题的核心查询）。
   *
   * 注意：这里**不要加 DISTINCT**。`q.id` 是主键、`banks.id` 也是主键，
   * JOIN 不会产生重复行；而 DISTINCT 会强制 SQLite 先物化去重**整个**过滤结果集再 LIMIT，
   * 在 38 万题的库上代价很高（实测平行组卷因此到 5.2s）。
   */
  pick(options: {
    courseId?: number;
    lessonId?: number;
    bankId?: number;
    type?: string;
    difficulty?: string;
    levelMin?: number;
    levelMax?: number;
    point?: string;
    chapter?: string;
    /**
     * 多选范围（可跨章节/跨册）。**必须在这里显式声明**：
     * `pick()` 把 options 整体转给 `pickWhere()`，而调用方用 `...(cond ? { chapters } : {})`
     * 这种方式传参时 TS 的"多余属性检查"不生效 —— 漏声明不会报错，只会**静默丢掉范围**，
     * 结果就是"按章节随机组卷"变成全库乱抽（已踩过）。
     */
    books?: string[];
    chapters?: string[];
    points?: string[];
    types?: string[];
    levels?: ('easy' | 'medium' | 'hard')[];
    keyword?: string;
    hasImage?: boolean;
    exclude?: number[];
    /**
     * `error_desc`（易错题优先）不在 SQL 里排序 —— 错误率来自作答聚合、不在 questions 表里，
     * 由路由层取一个候选窗口后在内存里按威尔逊下界排。这里收下它只是为了类型统一。
     */
    orderBy?: 'default' | 'difficulty_asc' | 'difficulty_desc' | 'error_desc';
    limit?: number;
    offset?: number;
  }): (PoolQuestion & { point: string; book: string; bank_name: string; difficulty_score: number })[] {
    const { where, params } = this.pickWhere(options);
    const order =
      options.orderBy === 'difficulty_asc'
        ? 'q.difficulty_score ASC, q.id'
        : options.orderBy === 'difficulty_desc'
          ? 'q.difficulty_score DESC, q.id'
          : 'q.id';
    const limit = Math.min(200, Math.max(1, options.limit ?? 20));
    const offset = Math.max(0, options.offset ?? 0);
    return this.db.all(
      `SELECT q.id, q.stem, q.type, q.bank_id, q.lesson_id, q.difficulty, q.subject, q.book, q.point,
              q.difficulty_score, COALESCE(b.name, '') AS bank_name
       FROM questions q LEFT JOIN banks b ON b.id = q.bank_id${where}
       ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
  }

  /**
   * 细目表参考数据：「知识点 × 题型 × 难度」各有多少题。
   *
   * 难度档位与 `ExamService.blueprint` 口径一致：优先用三档字段，
   * 旧数据没有就用 `difficulty_score` 按 42/71 分档。
   */
  taxonomy(options: {
    courseId?: number;
    limit?: number;
  }): { point: string; total: number; cells: { type: string; easy: number; medium: number; hard: number }[] }[] {
    const where: string[] = ["q.point <> ''"];
    const params: unknown[] = [];
    if (options.courseId !== undefined) {
      where.push(
        `(b.course_id = ? OR q.lesson_id IN (SELECT id FROM lessons WHERE course_id = ?)
          OR q.bank_id IN (SELECT id FROM banks WHERE course_id = ?))`,
      );
      params.push(options.courseId, options.courseId, options.courseId);
    }
    const rows = this.db.all<{ point: string; type: string; bucket: string; n: number }>(
      `SELECT q.point AS point,
              q.type AS type,
              CASE
                WHEN q.difficulty IN ('easy','medium','hard') THEN q.difficulty
                WHEN COALESCE(q.difficulty_score, -1) < 0 THEN 'medium'
                WHEN q.difficulty_score < 42 THEN 'easy'
                WHEN q.difficulty_score < 71 THEN 'medium'
                ELSE 'hard'
              END AS bucket,
              COUNT(*) AS n
       FROM questions q
       LEFT JOIN banks b ON b.id = q.bank_id
       WHERE ${where.join(' AND ')}
       GROUP BY q.point, q.type, bucket
       ORDER BY n DESC`,
      params,
    );
    const byPoint = new Map<
      string,
      { point: string; total: number; cells: Map<string, { easy: number; medium: number; hard: number }> }
    >();
    for (const row of rows) {
      const entry =
        byPoint.get(row.point) ??
        ({
          point: row.point,
          total: 0,
          cells: new Map<string, { easy: number; medium: number; hard: number }>(),
        } satisfies {
          point: string;
          total: number;
          cells: Map<string, { easy: number; medium: number; hard: number }>;
        });
      const cell = entry.cells.get(row.type) ?? { easy: 0, medium: 0, hard: 0 };
      const bucket = row.bucket === 'easy' || row.bucket === 'hard' ? row.bucket : 'medium';
      cell[bucket] += row.n;
      entry.cells.set(row.type, cell);
      entry.total += row.n;
      byPoint.set(row.point, entry);
    }
    const limit = Math.min(500, Math.max(1, options.limit ?? 200));
    return [...byPoint.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, limit)
      .map((entry) => ({
        point: entry.point,
        total: entry.total,
        cells: [...entry.cells.entries()].map(([type, counts]) => ({ type, ...counts })),
      }));
  }

  /**
   * 选题树数据（册次 → 章节，带题量）：主流组卷系统左树就是这两层，
   * 「按教材章节命题」靠它。知识点太多（真机 5380 个）不整棵返回，
   * 由 `pointsOf()` 按册次/章节懒加载 + 搜索。
   *
   * 计数跟随题型/难度/关键词筛选变化：老师拖完筛选就能看到每章还剩多少题。
   */
  facets(options: {
    courseId?: number;
    types?: string[];
    levels?: ('easy' | 'medium' | 'hard')[];
    keyword?: string;
    books?: string[];
    bankLimit?: number;
    /** 排除已在试卷里的题（让树里的计数与题池一致） */
    exclude?: number[];
  }): {
    total: number;
    books: {
      book: string;
      label: string;
      count: number;
      chapters: { chapter: string; label: string; count: number }[];
    }[];
    types: { type: string; count: number }[];
    levels: { level: 'easy' | 'medium' | 'hard'; count: number }[];
    banks: { id: number; name: string; count: number }[];
  } {
    const scope = {
      ...(options.courseId === undefined ? {} : { courseId: options.courseId }),
      ...(options.types ? { types: options.types } : {}),
      ...(options.levels ? { levels: options.levels } : {}),
      ...(options.keyword ? { keyword: options.keyword } : {}),
      ...(options.books ? { books: options.books } : {}),
      ...(options.exclude && options.exclude.length > 0 ? { exclude: options.exclude } : {}),
    };
    const { where, params } = this.pickWhere(scope);
    const total = this.pickCount(scope);

    const rows = this.db.all<{ book: string; chapter: string; n: number }>(
      `SELECT COALESCE(q.book, '') AS book, COALESCE(q.chapter, '') AS chapter, COUNT(*) AS n
       FROM questions q LEFT JOIN banks b ON b.id = q.bank_id${where}
       GROUP BY q.book, q.chapter
       ORDER BY book, n DESC`,
      params,
    );
    /** 空值统一映射成哨兵值 __none__（树里显示成"未标注"），保证勾选后真的能筛出题 */
    const byBook = new Map<
      string,
      { book: string; label: string; count: number; chapters: { chapter: string; label: string; count: number }[] }
    >();
    for (const row of rows) {
      const bookKey = row.book || '__none__';
      const entry = byBook.get(bookKey) ?? {
        book: bookKey,
        label: row.book || '（未标注册次）',
        count: 0,
        chapters: [],
      };
      entry.chapters.push({
        chapter: row.chapter || '__none__',
        label: row.chapter || '（未标注章节）',
        count: Number(row.n),
      });
      entry.count += Number(row.n);
      byBook.set(bookKey, entry);
    }

    const typeRows = this.db.all<{ type: string; n: number }>(
      `SELECT q.type AS type, COUNT(*) AS n FROM questions q LEFT JOIN banks b ON b.id = q.bank_id${where}
       GROUP BY q.type ORDER BY n DESC`,
      params,
    );
    const levelRows = this.db.all<{ level: string; n: number }>(
      `SELECT ${DIFFICULTY_BUCKET_SQL} AS level, COUNT(*) AS n
       FROM questions q LEFT JOIN banks b ON b.id = q.bank_id${where}
       GROUP BY level`,
      params,
    );
    const bankRows = this.db.all<{ id: number; name: string; n: number }>(
      `SELECT q.bank_id AS id, COALESCE(b.name, '') AS name, COUNT(*) AS n
       FROM questions q LEFT JOIN banks b ON b.id = q.bank_id${where}
       GROUP BY q.bank_id ORDER BY n DESC LIMIT ?`,
      [...params, Math.min(200, Math.max(1, options.bankLimit ?? 50))],
    );

    const levels: ('easy' | 'medium' | 'hard')[] = ['easy', 'medium', 'hard'];
    return {
      total,
      books: [...byBook.values()].sort((a, b) => b.count - a.count),
      types: typeRows.map((r) => ({ type: r.type, count: Number(r.n) })),
      levels: levels.map((level) => ({ level, count: Number(levelRows.find((r) => r.level === level)?.n ?? 0) })),
      banks: bankRows.map((r) => ({ id: r.id, name: r.name, count: Number(r.n) })),
    };
  }

  /** 知识点清单 + 题量（知识点树懒加载 / 搜索用） */
  pointsOf(options: {
    courseId?: number;
    books?: string[];
    chapters?: string[];
    types?: string[];
    levels?: ('easy' | 'medium' | 'hard')[];
    keyword?: string;
    pointKeyword?: string;
    limit?: number;
    /** 排除已在试卷里的题 */
    exclude?: number[];
  }): { point: string; label: string; chapter: string; count: number }[] {
    const { where, params } = this.pickWhere({
      ...(options.courseId === undefined ? {} : { courseId: options.courseId }),
      ...(options.books ? { books: options.books } : {}),
      ...(options.chapters ? { chapters: options.chapters } : {}),
      ...(options.types ? { types: options.types } : {}),
      ...(options.levels ? { levels: options.levels } : {}),
      ...(options.keyword ? { keyword: options.keyword } : {}),
      ...(options.pointKeyword ? { point: options.pointKeyword } : {}),
      ...(options.exclude && options.exclude.length > 0 ? { exclude: options.exclude } : {}),
    });
    const limit = Math.min(500, Math.max(1, options.limit ?? 200));
    return this.db
      .all<{ point: string; chapter: string; n: number }>(
        `SELECT COALESCE(q.point, '') AS point, COALESCE(q.chapter, '') AS chapter, COUNT(*) AS n
         FROM questions q LEFT JOIN banks b ON b.id = q.bank_id${where}
         GROUP BY q.point, q.chapter ORDER BY n DESC LIMIT ?`,
        [...params, limit],
      )
      .map((r) => ({
        point: r.point || '__none__',
        label: r.point || '（未标注知识点）',
        chapter: r.chapter || '__none__',
        count: Number(r.n),
      }));
  }

  /** 符合筛选条件的全部题目 id（「全选筛选结果」用）；有上限保护，避免把几十万 id 传给前端 */
  pickIds(options: Parameters<ExamRepository['pick']>[0] & { cap?: number }): number[] {
    const { where, params } = this.pickWhere(options);
    const cap = Math.min(5000, Math.max(1, options.cap ?? 2000));
    return this.db
      .all<{ id: number }>(
        `SELECT q.id FROM questions q LEFT JOIN banks b ON b.id = q.bank_id${where} ORDER BY q.id LIMIT ?`,
        [...params, cap],
      )
      .map((r) => r.id);
  }

  /** 挑题总数（分页用；条件与 `pick` 完全一致） */
  pickCount(options: Parameters<ExamRepository['pick']>[0]): number {
    const { where, params } = this.pickWhere(options);
    return (
      this.db.get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM questions q LEFT JOIN banks b ON b.id = q.bank_id${where}`,
        params,
      )?.c ?? 0
    );
  }

  /** 课程范围内的候选题目（课时直属题目或课时所属题库的题目） */
  pool(courseId: number): PoolQuestion[] {
    return this.db.all<PoolQuestion>(
      `SELECT q.id, q.stem, q.type, q.bank_id, q.lesson_id, q.difficulty
       FROM questions q
       LEFT JOIN banks b ON b.id = q.bank_id
       WHERE q.lesson_id IN (SELECT id FROM lessons WHERE course_id = ?)
          OR b.lesson_id IN (SELECT id FROM lessons WHERE course_id = ?)
       ORDER BY q.id`,
      [courseId, courseId],
    );
  }

  /**
   * 全库候选题（跨题库）——按知识点 / 书册 / 难度筛题用。
   * 不传任何条件时会扫全表，因此调用方必须带分页上限。
   */
  search(options: {
    subject?: string;
    book?: string;
    chapter?: string;
    point?: string;
    difficulty?: string;
    type?: string;
    limit?: number;
    offset?: number;
  }): PoolQuestion[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.subject) {
      clauses.push('q.subject = ?');
      params.push(options.subject);
    }
    if (options.book) {
      clauses.push('q.book = ?');
      params.push(options.book);
    }
    if (options.chapter) {
      clauses.push('q.chapter = ?');
      params.push(options.chapter);
    }
    if (options.point) {
      clauses.push('q.point = ?');
      params.push(options.point);
    }
    if (options.difficulty) {
      clauses.push('q.difficulty = ?');
      params.push(options.difficulty);
    }
    if (options.type) {
      clauses.push('q.type = ?');
      params.push(options.type);
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.min(500, Math.max(1, options.limit ?? 50));
    const offset = Math.max(0, options.offset ?? 0);
    return this.db.all<PoolQuestion>(
      `SELECT q.id, q.stem, q.type, q.bank_id, q.lesson_id, q.difficulty, q.subject, q.book, q.point, b.name AS bank_name
       FROM questions q LEFT JOIN banks b ON b.id = q.bank_id${where}
       ORDER BY q.id LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
  }

  /** 按知识点聚合的题目统计（一个知识点有多少题、难度分布、来自几个题库） */
  pointStats(options: { subject?: string; book?: string; point?: string; limit?: number }): {
    subject: string;
    book: string;
    point: string;
    questions: number;
    easy: number;
    medium: number;
    hard: number;
    banks: number;
  }[] {
    const clauses: string[] = ["q.point <> ''"];
    const params: unknown[] = [];
    if (options.subject) {
      clauses.push('q.subject = ?');
      params.push(options.subject);
    }
    if (options.book) {
      clauses.push('q.book = ?');
      params.push(options.book);
    }
    if (options.point) {
      clauses.push('q.point LIKE ?');
      params.push(`%${options.point}%`);
    }
    const limit = Math.min(500, Math.max(1, options.limit ?? 50));
    return this.db.all(
      `SELECT q.subject, q.book, q.point, COUNT(*) AS questions,
              SUM(CASE WHEN q.difficulty = 'easy' THEN 1 ELSE 0 END) AS easy,
              SUM(CASE WHEN q.difficulty = 'medium' THEN 1 ELSE 0 END) AS medium,
              SUM(CASE WHEN q.difficulty = 'hard' THEN 1 ELSE 0 END) AS hard,
              COUNT(DISTINCT q.bank_id) AS banks
       FROM questions q WHERE ${clauses.join(' AND ')}
       GROUP BY q.subject, q.book, q.point
       ORDER BY questions DESC LIMIT ?`,
      [...params, limit],
    );
  }

  /** 批量加题；已在卷内的自动跳过，返回实际新增数 */
  addQuestions(examId: number, questionIds: number[]): number {
    let added = 0;
    const maxSort = this.db.get<{ m: number | null }>('SELECT MAX(sort) AS m FROM exam_questions WHERE exam_id = ?', [
      examId,
    ])?.m;
    let next = maxSort === null || maxSort === undefined ? 0 : maxSort + 1;
    this.db.transaction(() => {
      for (const qid of questionIds) {
        if (!this.db.get<{ id: number }>('SELECT id FROM questions WHERE id = ?', [qid])) continue;
        const info = this.db.run('INSERT OR IGNORE INTO exam_questions (exam_id, question_id, sort) VALUES (?,?,?)', [
          examId,
          qid,
          next,
        ]);
        if (info.changes > 0) {
          added += 1;
          next += 1;
        }
      }
    });
    return added;
  }

  removeQuestion(examId: number, questionId: number): void {
    this.db.run('DELETE FROM exam_questions WHERE exam_id = ? AND question_id = ?', [examId, questionId]);
  }

  /** 把某题型的所有题统一刷成「大题名 + 每题分值」（组卷按题型生成大题用） */
  applySection(examId: number, type: string, sectionName: string, score: number): number {
    return this.db.run(
      `UPDATE exam_questions SET section = ?, score = ?
       WHERE exam_id = ?
         AND question_id IN (SELECT id FROM questions WHERE type = ?)`,
      [sectionName, score, examId, type],
    ).changes;
  }

  /** 清空卷内题目（智能组卷「重新生成」用） */
  clearQuestions(examId: number): number {
    return this.db.run('DELETE FROM exam_questions WHERE exam_id = ?', [examId]).changes;
  }

  questionIds(examId: number): number[] {
    return this.db
      .all<{ question_id: number }>('SELECT question_id FROM exam_questions WHERE exam_id = ?', [examId])
      .map((r) => r.question_id);
  }

  // ---- 作答与成绩 ----

  /** 该学员在这场考试上的作答次数（学习通式"允许作答次数"要用） */
  attemptCount(examId: number, userId: number): number {
    return (
      this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM exam_attempts WHERE exam_id = ? AND user_id = ?', [
        examId,
        userId,
      ])?.c ?? 0
    );
  }

  findAttempt(examId: number, userId: number): ExamAttempt | undefined {
    return this.db.get<ExamAttempt>(
      'SELECT * FROM exam_attempts WHERE exam_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1',
      [examId, userId],
    );
  }

  createAttempt(input: {
    examId: number;
    userId: number;
    answers: unknown;
    score: number;
    total: number;
    passed: boolean;
    usedSeconds: number;
  }): number {
    return this.db.run(
      'INSERT INTO exam_attempts (exam_id, user_id, answers, score, total, passed, used_seconds) VALUES (?,?,?,?,?,?,?)',
      [
        input.examId,
        input.userId,
        JSON.stringify(input.answers),
        input.score,
        input.total,
        input.passed ? 1 : 0,
        input.usedSeconds,
      ],
    ).lastInsertRowid;
  }

  /** 成绩单：某场考试的全部作答（含学生信息与统计） */
  attemptsOf(examId: number): (ExamAttempt & { username: string; display_name: string })[] {
    return this.db.all<ExamAttempt & { username: string; display_name: string }>(
      `SELECT a.*, u.username, u.display_name
       FROM exam_attempts a
       JOIN users u ON u.id = a.user_id
       WHERE a.exam_id = ?
       ORDER BY a.score DESC, a.used_seconds ASC, a.id`,
      [examId],
    );
  }

  /** 我的所有考试成绩（个人中心用） */
  attemptsByUser(userId: number): (ExamAttempt & { exam_title: string; course_id: number; course_name: string })[] {
    return this.db.all<ExamAttempt & { exam_title: string; course_id: number; course_name: string }>(
      `SELECT a.*, e.title AS exam_title, e.course_id, COALESCE(c.name, '') AS course_name
       FROM exam_attempts a
       JOIN exams e ON e.id = a.exam_id
       LEFT JOIN courses c ON c.id = e.course_id
       WHERE a.user_id = ?
       ORDER BY a.created_at DESC, a.id DESC`,
      [userId],
    );
  }
}
