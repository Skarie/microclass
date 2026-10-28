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
  countBanks,
  findBankWithStats,
  listBanks,
  type BankListFilter,
  type BankWithStats,
} from './bankListQueries.js';
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
export type { BankListFilter, BankWithStats } from './bankListQueries.js';

/** 题库行：`banks` 表全量字段（迁移 0023 新增 section、0024 新增 folder_id） */
export interface BankRow extends Bank {
  /** 章节；空串 = 未分章（前端归到「未分章」） */
  section: string;
  /** 归属文件夹（迁移 0024）；NULL = 未分类 */
  folder_id: number | null;
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
  /** 归属文件夹（迁移 0024）；`null` = 未分类，`undefined` = 不改 */
  folderId?: number | null;
}

export class BankRepository {
  /** 文件夹仓储等需要直接读库时复用同一个连接（app.ts 不再额外注入依赖） */
  constructor(readonly db: Db) {}

  /** 题库列表（SQL 与派生字段见 `bankListQueries`） */
  list(options?: BankListFilter): BankWithStats[] {
    return listBanks(this.db, options);
  }

  /** 当前筛选条件下的题库总数（分页用） */
  count(options?: BankListFilter): number {
    return countBanks(this.db, options);
  }

  /** 单条题库（详情用，含文件夹路径 / 课程名 / 课时名） */
  findWithStats(id: number): BankWithStats | undefined {
    return findBankWithStats(this.db, id);
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
      'INSERT INTO banks (name, lesson_id, kind, subject, book, section, course_id, folder_id) VALUES (?,?,?,?,?,?,?,?)',
      [
        input.name,
        input.lessonId ?? null,
        input.kind ?? 'lesson',
        input.subject ?? '',
        input.book ?? '',
        input.section ?? '',
        input.courseId ?? null,
        input.folderId ?? null,
      ],
    ).lastInsertRowid;
  }

  update(id: number, input: BankInput): void {
    const existing = this.findById(id);
    // courseId / folderId 用 `undefined` 表示「不动」，显式 `null` 表示「移出」——
    // 写 COALESCE(?, col) 的话永远解绑不了，所以按需拼列。
    const setCourse = input.courseId !== undefined;
    const setFolder = input.folderId !== undefined;
    this.db.run(
      `UPDATE banks SET name = ?, lesson_id = ?, kind = ?, subject = ?, book = ?, section = ?${
        setCourse ? ', course_id = ?' : ''
      }${setFolder ? ', folder_id = ?' : ''} WHERE id = ?`,
      [
        input.name,
        input.lessonId ?? null,
        input.kind ?? existing?.kind ?? 'lesson',
        input.subject ?? existing?.subject ?? '',
        input.book ?? existing?.book ?? '',
        input.section ?? existing?.section ?? '',
        ...(setCourse ? [input.courseId ?? null] : []),
        ...(setFolder ? [input.folderId ?? null] : []),
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
}
