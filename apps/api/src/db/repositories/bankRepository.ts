/**
 * 题库（banks）仓储：题库自身的增删改查、列表筛选与详情取数。
 *
 * 目录聚合（课程 → 章节 → 小节 → 题库）在 `bankCatalogQueries`，
 * 归属课程的批量操作在 `bankBindingQueries`，章节目录与回填在 `bankSectionQueries`；
 * 这里保留同名方法转发，调用方（服务层）无需感知拆分。
 */
import type { Bank } from '@microclass/shared';
import type { Db } from '../client.js';
import {
  catalogCourse,
  catalogCourses,
  catalogUnbound,
  catalogUnboundBooks,
  type CatalogCourse,
  type CatalogNode,
} from './bankCatalogQueries.js';
import {
  bindCourseByLesson,
  bindUnboundByBook,
  courseBindingStats,
  courseBookKeys,
  setCourseBindings,
  unboundWithBook,
} from './bankBindingQueries.js';
import {
  banksMissingSection,
  catalogSectionsByBook,
  catalogSectionsByCourse,
  setBankSections,
  type BankBookCatalog,
  type BankCourseCatalog,
  type BankMissingSectionRow,
} from './bankSectionQueries.js';

export * from './bankNaming.js';
export type { CatalogCourse, CatalogNode } from './bankCatalogQueries.js';

/** 题库行：`banks` 表全量字段（迁移 0023 新增 section） */
export interface BankRow extends Bank {
  /** 章节；空串 = 未分章（前端归到「未分章」） */
  section: string;
}

export interface BankWithStats extends BankRow {
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
  /** 章节（迁移 0023）：手填或从课时 group_name 继承 */
  section?: string;
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
  /** 章节精确筛选；传空串 = 只看未分章（与「不传」区分） */
  section?: string;
  /** 分页：全库有 1.2 万个题库，一次全拉会把页面拖死 */
  limit?: number;
  offset?: number;
}

export class BankRepository {
  constructor(private readonly db: Db) {}

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
    // 注意：空串是有意义的筛选值（未分章），不能用 if (value) 判断
    if (options?.section !== undefined) {
      clauses.push('b.section = ?');
      params.push(options.section);
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

  catalogCourses(kind: BankKind | '' = ''): CatalogCourse[] {
    return catalogCourses(this.db, kind);
  }

  catalogUnbound(kind: BankKind | '' = ''): { bankCount: number; questionCount: number } {
    return catalogUnbound(this.db, kind);
  }

  catalogUnboundBooks(kind: BankKind | '' = ''): { book: string; bankCount: number; questionCount: number }[] {
    return catalogUnboundBooks(this.db, kind);
  }

  catalogCourse(courseId: number): { course: { id: number; name: string } | undefined; chapters: CatalogNode[] } {
    return catalogCourse(this.db, courseId);
  }

  /* ---------------- 章节目录（册次 → 章节）与批量回填 ---------------- */

  sectionCatalogByBook(kind: BankKind | '' = ''): BankBookCatalog {
    return catalogSectionsByBook(this.db, kind);
  }

  sectionCatalogByCourse(kind: BankKind | '' = ''): BankCourseCatalog {
    return catalogSectionsByCourse(this.db, kind);
  }

  banksWithoutSection(kind: BankKind | '' = ''): BankMissingSectionRow[] {
    return banksMissingSection(this.db, kind);
  }

  applyBankSections(updates: { id: number; section: string }[]): number {
    return setBankSections(this.db, updates);
  }

  /* ---------------- 归属课程（转发 bankBindingQueries） ---------------- */

  /** 一键回填归属课程：课时配套题库由课时推导（返回条数） */
  bindCourseByLesson(): number {
    return bindCourseByLesson(this.db);
  }

  /** 按册次批量挂课程（只影响未归属题库） */
  bindUnboundByBook(book: string, courseId: number | null): number {
    return bindUnboundByBook(this.db, book, courseId);
  }

  setCourseBindings(updates: { bankId: number; courseId: number | null }[]): number {
    return setCourseBindings(this.db, updates);
  }

  unboundWithBook(): { id: number; book: string; subject: string; kind: string }[] {
    return unboundWithBook(this.db);
  }

  courseBookKeys(): { id: number; name: string; key: string }[] {
    return courseBookKeys(this.db);
  }

  courseBindingStats(kind: BankKind | '' = ''): { bound: number; unbound: number; banks: number }[] {
    return courseBindingStats(this.db, kind);
  }

  findById(id: number): BankRow | undefined {
    return this.db.get<BankRow>('SELECT * FROM banks WHERE id = ?', [id]);
  }

  /** 按名字精确查（没有课时归属的题库——章节题库 / 整卷试卷——用它做幂等键） */
  findByName(name: string): BankRow | undefined {
    return this.db.get<BankRow>('SELECT * FROM banks WHERE name = ? ORDER BY id LIMIT 1', [name]);
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
    return this.db.run(
      'INSERT INTO banks (name, lesson_id, kind, subject, book, section, course_id) VALUES (?,?,?,?,?,?,?)',
      [
        input.name,
        input.lessonId ?? null,
        input.kind ?? 'lesson',
        input.subject ?? '',
        input.book ?? '',
        input.section ?? '',
        input.courseId ?? null,
      ],
    ).lastInsertRowid;
  }

  update(id: number, input: BankInput): void {
    const existing = this.findById(id);
    // courseId 用 `undefined` 表示「不动」，显式 `null` 表示「移出课程」——
    // 写 COALESCE(?, course_id) 的话永远解绑不了，所以按需拼列。
    const setCourse = input.courseId !== undefined;
    this.db.run(
      `UPDATE banks SET name = ?, lesson_id = ?, kind = ?, subject = ?, book = ?, section = ?${
        setCourse ? ', course_id = ?' : ''
      } WHERE id = ?`,
      [
        input.name,
        input.lessonId ?? null,
        input.kind ?? existing?.kind ?? 'lesson',
        input.subject ?? existing?.subject ?? '',
        input.book ?? existing?.book ?? '',
        input.section ?? existing?.section ?? '',
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
