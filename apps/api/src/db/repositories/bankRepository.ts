/**
 * 题库（banks）仓储。
 */
import type { Bank } from '@microclass/shared';
import type { Db } from '../client.js';

export interface BankWithStats extends Bank {
  lesson_title: string;
  question_count: number;
}

/** 题库类型：课时配套 / 章节题库（未匹配课时）/ 整卷试卷 */
export type BankKind = 'lesson' | 'chapter' | 'paper';

export interface BankInput {
  name: string;
  lessonId?: number | null;
  /** 默认 lesson（迁移 0008 新增） */
  kind?: BankKind;
  subject?: string;
  book?: string;
  /** 归属课程（迁移 0017；课时配套题库由 lesson 推导，章节/整卷按册次匹配） */
  courseId?: number | null;
}

export interface BankListFilter {
  lessonId?: number | null;
  kind?: BankKind;
  subject?: string;
  book?: string;
  /** 按名字模糊查（管理端搜索大题库用） */
  keyword?: string;
  /** 归属课程（含「未归属」用 `courseId: null`） */
  courseId?: number | null;
  /** 分页：全库有 1.2 万个题库，一次全拉会把页面拖死 */
  limit?: number;
  offset?: number;
}

/** 目录树节点：课程 → 章节 → 小节 → 题库 */
export interface CatalogCourse {
  id: number;
  name: string;
  bankCount: number;
  questionCount: number;
  /** 有题库的章节数（`lessons.group_name` 去重；章节题库的分组在目录接口里算） */
  chapterCount: number;
}

export interface CatalogNode {
  /** 课程下的章节（group_name），空章节归到「未分章」 */
  name: string;
  lessonCount: number;
  bankCount: number;
  questionCount: number;
  lessons: {
    id: number;
    title: string;
    bankCount: number;
    questionCount: number;
    banks: { id: number; name: string; kind: string; questionCount: number }[];
  }[];
  /** 章节下不挂课时的题库（章节题库 / 整卷试卷） */
  banks: { id: number; name: string; kind: string; point: string; questionCount: number }[];
}

export class BankRepository {
  constructor(private readonly db: Db) {}
  /**
   * 题库列表（带题量）。
   *
   * 题量用**一次分组统计**再 JOIN，而不是每个题库一个相关子查询：
   * 全库 1.2 万个题库时，相关子查询会造成 1.2 万次随机索引查找
   * （真机上冷缓存实测把整个请求拖到 **100 秒级**，期间 node:sqlite 同步执行会卡住整个站点）。
   * 另外支持分页：页面一次只取 N 个。
   */
  private bankWhere(options?: BankListFilter): { where: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options?.lessonId === null) clauses.push('b.lesson_id IS NULL');
    else if (typeof options?.lessonId === 'number') {
      clauses.push('b.lesson_id = ?');
      params.push(options.lessonId);
    }
    if (options?.kind) {
      clauses.push('b.kind = ?');
      params.push(options.kind);
    }
    if (options?.subject) {
      clauses.push('b.subject = ?');
      params.push(options.subject);
    }
    if (options?.book) {
      clauses.push('b.book = ?');
      params.push(options.book);
    }
    if (options?.keyword) {
      clauses.push('b.name LIKE ?');
      params.push(`%${options.keyword}%`);
    }
    if (options?.courseId === null) clauses.push('b.course_id IS NULL');
    else if (typeof options?.courseId === 'number') {
      clauses.push('b.course_id = ?');
      params.push(options.courseId);
    }
    return { where: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '', params };
  }

  /**
   * 题库列表。**按 id 倒序（新建的排最前）**：
   * 真机有 1.2 万个题库、接口一次只取前 300 条，若按 id 升序，老师刚建的题库
   * 必然落在 300 条之外 —— 建完就"消失"（已踩过）。倒序后新建的立即可见。
   */
  list(options?: BankListFilter): BankWithStats[] {
    const { where, params } = this.bankWhere(options);
    const limit = Math.min(1000, Math.max(1, options?.limit ?? 1000));
    const offset = Math.max(0, options?.offset ?? 0);
    return this.db.all<BankWithStats>(
      `SELECT b.*, COALESCE(l.title, '') AS lesson_title, b.question_count
       FROM banks b
       LEFT JOIN lessons l ON l.id = b.lesson_id

       ${where}
       ORDER BY b.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
  }

  /** 当前筛选条件下的题库总数（分页用） */
  count(options?: BankListFilter): number {
    const { where, params } = this.bankWhere(options);
    return this.db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM banks b${where}`, params)?.c ?? 0;
  }

  /* ---------------- 课程 → 章节 → 小节 → 题库 目录（筛选与组卷挑题用） ---------------- */

  /** 课程列表 + 每门课的题库数/题量（筛选树第一层） */
  catalogCourses(): CatalogCourse[] {
    return this.db.all<CatalogCourse>(
      `SELECT c.id, c.name,
              COUNT(DISTINCT b.id) AS bankCount,
              COALESCE(SUM(b.question_count), 0) AS questionCount,
              COUNT(DISTINCT CASE WHEN l.group_name <> '' THEN l.group_name END) AS chapterCount
       FROM courses c
       LEFT JOIN banks b ON b.course_id = c.id
       LEFT JOIN lessons l ON l.id = b.lesson_id
       GROUP BY c.id
       HAVING bankCount > 0
       ORDER BY c.name`,
    );
  }

  /** 未归属课程的题库（含「课时库没挂课时」这种历史数据） */
  catalogUnbound(): { bankCount: number; questionCount: number } {
    return (
      this.db.get<{ bankCount: number; questionCount: number }>(
        `SELECT COUNT(*) AS bankCount, COALESCE(SUM(b.question_count), 0) AS questionCount
         FROM banks b WHERE b.course_id IS NULL`,
      ) ?? { bankCount: 0, questionCount: 0 }
    );
  }

  /** 未归属课程按册次分组（目录树里仍能分类导航，而不是一大坨） */
  catalogUnboundBooks(): { book: string; bankCount: number; questionCount: number }[] {
    return this.db.all<{ book: string; bankCount: number; questionCount: number }>(
      `SELECT COALESCE(NULLIF(b.book, ''), '(无册次信息)') AS book,
              COUNT(*) AS bankCount,
              COALESCE(SUM(b.question_count), 0) AS questionCount
       FROM banks b WHERE b.course_id IS NULL
       GROUP BY book ORDER BY bankCount DESC`,
    );
  }

  /**
   * 某门课的目录：章节（group_name）→ 小节（lesson）→ 题库；
   * 不挂课时的章节题库/整卷试卷按「知识点前缀」归到「未分章」分组里。
   */
  catalogCourse(courseId: number): { course: { id: number; name: string } | undefined; chapters: CatalogNode[] } {
    const course = this.db.get<{ id: number; name: string }>('SELECT id, name FROM courses WHERE id = ?', [courseId]);
    const lessons = this.db.all<{ id: number; title: string; group_name: string; sort: number }>(
      'SELECT id, title, group_name, sort FROM lessons WHERE course_id = ? ORDER BY sort, id',
      [courseId],
    );
    const banks = this.db.all<{
      id: number;
      name: string;
      kind: string;
      lesson_id: number | null;
      question_count: number;
    }>(
      `SELECT b.id, b.name, COALESCE(b.kind, '') AS kind, b.lesson_id, b.question_count
       FROM banks b WHERE b.course_id = ? ORDER BY b.id`,
      [courseId],
    );

    const byLesson = new Map<number, typeof banks>();
    const free: typeof banks = [];
    for (const bank of banks) {
      if (bank.lesson_id === null) {
        free.push(bank);
        continue;
      }
      const list = byLesson.get(bank.lesson_id) ?? [];
      list.push(bank);
      byLesson.set(bank.lesson_id, list);
    }

    const chapters = new Map<string, CatalogNode>();
    const chapterOf = (name: string): CatalogNode => {
      const key = name || '未分章';
      let node = chapters.get(key);
      if (!node) {
        node = { name: key, lessonCount: 0, bankCount: 0, questionCount: 0, lessons: [], banks: [] };
        chapters.set(key, node);
      }
      return node;
    };

    for (const lesson of lessons) {
      const owned = byLesson.get(lesson.id) ?? [];
      if (owned.length === 0) continue; // 没有题库的课时不进树，避免几千个空节点
      const node = chapterOf(lesson.group_name);
      node.lessonCount += 1;
      node.bankCount += owned.length;
      node.questionCount += owned.reduce((s, b) => s + b.question_count, 0);
      node.lessons.push({
        id: lesson.id,
        title: lesson.title,
        bankCount: owned.length,
        questionCount: owned.reduce((s, b) => s + b.question_count, 0),
        banks: owned.map((b) => ({ id: b.id, name: b.name, kind: b.kind, questionCount: b.question_count })),
      });
    }

    // 不挂课时的题库：按题库名里的章节段归章（导入命名形如「三年级上册 · 1 时、分、秒 · 时间的推算」）
    for (const bank of free) {
      const key = chapterKeyFromBankName(bank.name);
      const node = chapterOf(key);
      node.bankCount += 1;
      node.questionCount += bank.question_count;
      node.banks.push({
        id: bank.id,
        name: bank.name,
        kind: bank.kind,
        point: bankSectionOfName(bank.name),
        questionCount: bank.question_count,
      });
    }

    return { course, chapters: [...chapters.values()] };
  }

  /** 一键回填归属课程：课时配套题库由课时推导（返回条数） */
  bindCourseByLesson(): number {
    return this.db.run(
      `UPDATE banks SET course_id = (SELECT l.course_id FROM lessons l WHERE l.id = banks.lesson_id)
       WHERE lesson_id IS NOT NULL
         AND (course_id IS NULL OR course_id <> (SELECT l.course_id FROM lessons l WHERE l.id = banks.lesson_id))`,
    ).changes;
  }

  /**
   * 按册次批量挂课程：只影响**未归属**的题库。
   * 匹配口径与 catalogUnboundBooks 的分组完全一致（空册次统一按 "(无册次信息)"），
   * 保证界面上看到 131 个，这里就正好改 131 个。
   */
  bindUnboundByBook(book: string, courseId: number | null): number {
    const res = this.db.run(
      'UPDATE banks SET course_id = ?' +
        ' WHERE course_id IS NULL' +
        " AND COALESCE(NULLIF(book, ''), '(无册次信息)') = ?",
      [courseId, book],
    );
    return res.changes;
  }

  /** 按册次匹配回填归属课程（返回条数；匹配规则由服务层给出 courseId） */
  setCourseBindings(updates: { bankId: number; courseId: number | null }[]): number {
    if (updates.length === 0) return 0;
    let changed = 0;
    this.db.transaction(() => {
      for (const item of updates) {
        changed += this.db.run('UPDATE banks SET course_id = ? WHERE id = ? AND course_id IS NOT ?', [
          item.courseId,
          item.bankId,
          item.courseId,
        ]).changes;
      }
    });
    return changed;
  }

  /** 未归属课程但带册次信息的题库（供册次匹配用） */
  unboundWithBook(): { id: number; book: string; subject: string; kind: string }[] {
    return this.db.all<{ id: number; book: string; subject: string; kind: string }>(
      "SELECT id, book, subject, COALESCE(kind, '') AS kind FROM banks WHERE course_id IS NULL AND book <> ''",
    );
  }

  /** 课程名册次候选（课程名形如「小学数学·二年级上册（新）」→「二年级上册（新）」） */
  courseBookKeys(): { id: number; name: string; key: string }[] {
    return this.db.all<{ id: number; name: string }>('SELECT id, name FROM courses').map((c) => ({
      id: c.id,
      name: c.name,
      key: bookKeyOfCourseName(c.name),
    }));
  }

  /** 题库分布：按课程归属统计（体检/运维用） */
  courseBindingStats(): { bound: number; unbound: number; banks: number }[] {
    return this.db.all<{ bound: number; unbound: number; banks: number }>(
      `SELECT SUM(CASE WHEN course_id IS NOT NULL THEN 1 ELSE 0 END) AS bound,
              SUM(CASE WHEN course_id IS NULL THEN 1 ELSE 0 END) AS unbound,
              COUNT(*) AS banks
       FROM banks`,
    );
  }

  findById(id: number): Bank | undefined {
    return this.db.get<Bank>('SELECT * FROM banks WHERE id = ?', [id]);
  }

  /** 按名字精确查（没有课时归属的题库——章节题库 / 整卷试卷——用它做幂等键） */
  findByName(name: string): Bank | undefined {
    return this.db.get<Bank>('SELECT * FROM banks WHERE name = ? ORDER BY id LIMIT 1', [name]);
  }

  /** 题库类型/归属统计（管理端大题库总览） */
  kindStats(): { kind: BankKind; banks: number; questions: number }[] {
    return this.db.all(
      `SELECT COALESCE(NULLIF(b.kind, ''), 'lesson') AS kind, COUNT(DISTINCT b.id) AS banks, COUNT(q.id) AS questions
       FROM banks b LEFT JOIN questions q ON q.bank_id = b.id
       GROUP BY kind ORDER BY questions DESC`,
    );
  }

  create(input: BankInput): number {
    return this.db.run('INSERT INTO banks (name, lesson_id, kind, subject, book, course_id) VALUES (?,?,?,?,?,?)', [
      input.name,
      input.lessonId ?? null,
      input.kind ?? 'lesson',
      input.subject ?? '',
      input.book ?? '',
      input.courseId ?? null,
    ]).lastInsertRowid;
  }

  update(id: number, input: BankInput): void {
    const existing = this.findById(id);
    // courseId 用 `undefined` 表示「不动」，显式 `null` 表示「移出课程」——
    // 写 COALESCE(?, course_id) 的话永远解绑不了，所以按需拼列。
    const setCourse = input.courseId !== undefined;
    this.db.run(
      `UPDATE banks SET name = ?, lesson_id = ?, kind = ?, subject = ?, book = ?${setCourse ? ', course_id = ?' : ''} WHERE id = ?`,
      [
        input.name,
        input.lessonId ?? null,
        input.kind ?? existing?.kind ?? 'lesson',
        input.subject ?? existing?.subject ?? '',
        input.book ?? existing?.book ?? '',
        ...(setCourse ? [input.courseId ?? null] : []),
        id,
      ],
    );
  }

  /** 只更新标准化元数据（回填用） */
  setMetadata(id: number, meta: { kind?: BankKind; subject?: string; book?: string }): void {
    this.db.run('UPDATE banks SET kind = ?, subject = ?, book = ? WHERE id = ?', [
      meta.kind ?? 'lesson',
      meta.subject ?? '',
      meta.book ?? '',
      id,
    ]);
  }

  delete(id: number): void {
    this.db.run('DELETE FROM banks WHERE id = ?', [id]);
  }

  questionCount(bankId: number): number {
    return this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM questions WHERE bank_id = ?', [bankId])?.c ?? 0;
  }

  /** 题库归属的课时标题（详情用） */
  lessonTitle(lessonId: number | null): string {
    if (lessonId === null) return '';
    return this.db.get<{ title: string }>('SELECT title FROM lessons WHERE id = ?', [lessonId])?.title ?? '';
  }
}

/**
 * 册次写法归一化：把「必修一 / 新必修1 / 必修第二册 / 选修3-1」这类写法收敛成同一种形式，
 * 让题库的 `book` 能和课程名里的册次对上（真机上 1,900+ 个题库因为写法差异匹配不上）。
 */
export function normalizeBookKey(raw: string): string {
  const digits: Record<string, string> = {
    一: '1',
    二: '2',
    三: '3',
    四: '4',
    五: '5',
    六: '6',
    七: '7',
    八: '8',
    九: '9',
    十: '10',
  };
  return String(raw ?? '')
    .trim()
    .replace(/^新/, '')
    .replace(/第/g, '')
    .replace(/册/g, '')
    .replace(/[一二三四五六七八九十]/g, (c) => digits[c] ?? c)
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** 课程名 → 册次关键字。
 * 课程命名形如「小学数学·二年级上册（新）」「高中数学·新必修1」，
 * 取 `·` 之后的部分作为册次；没有 `·` 时退回「X年级YY」或「必修N」片段。
 */
export function bookKeyOfCourseName(name: string): string {
  const text = String(name ?? '').trim();
  const afterDot = text.includes('·') ? text.slice(text.lastIndexOf('·') + 1).trim() : '';
  if (afterDot) return afterDot;
  const grade = /[一二三四五六七八九1-9]年级[上下]?册?（?[新旧]?）?/.exec(text);
  if (grade) return grade[0];
  const required = /(新?必修\s?\d|新?选修\s?\d|选择性必修\s?\d)/.exec(text);
  return required ? required[0].replace(/\s/g, '') : '';
}

/** 题库名的分段：`册次 · 章节 · 知识点` → ['册次','章节','知识点'] */
export function bankNameParts(name: string): string[] {
  return String(name ?? '')
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 章节题库/整卷试卷的归章依据：题库名的第二段（没有第二段就用第一段） */
export function chapterKeyFromBankName(name: string): string {
  const parts = bankNameParts(name);
  return parts[1] ?? parts[0] ?? '';
}

/** 题库名里更细的那一段（知识点），用于界面展示 */
export function bankSectionOfName(name: string): string {
  const parts = bankNameParts(name);
  return parts.length >= 3 ? (parts[parts.length - 1] ?? '') : '';
}
