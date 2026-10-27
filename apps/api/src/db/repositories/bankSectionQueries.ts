/**
 * 题库「章节」的目录聚合与批量回填数据源。
 *
 * 与按课程的目录（bankCatalogQueries）并列：这里只看 `banks.book / section`，
 * 不关心课时树，所以没有课程也能把题库分到「册次 → 章节」下。
 */
import type { Db } from '../client.js';
import type { BankKind } from './bankRepository.js';
import { compareNaturalName } from '../../domain/nameOrder.js';

/** 册次 / 章节下的计数（题量取 banks.question_count 预计算列） */
export interface SectionCount {
  section: string;
  bankCount: number;
  questionCount: number;
}

export interface SectionBook {
  /** 空串 = 「未归类册次」 */
  book: string;
  /** 该册次下是否有未归属课程的题库（前端据此提示「未归类」） */
  isUnbound: boolean;
  bankCount: number;
  questionCount: number;
  sections: SectionCount[];
}

export interface CourseBook {
  book: string;
  bankCount: number;
  questionCount: number;
  sections: SectionCount[];
}

export interface SectionCourse {
  id: number;
  name: string;
  bankCount: number;
  questionCount: number;
  books: CourseBook[];
}

export interface BankBookCatalog {
  view: 'book';
  books: SectionBook[];
}

export interface BankCourseCatalog {
  view: 'course';
  courses: SectionCourse[];
}

export type BankSectionCatalog = BankBookCatalog | BankCourseCatalog;
export type BankSectionView = 'book' | 'course';

/** 回填候选：section 为空、可能带课时 group_name 的题库 */
export interface BankMissingSectionRow {
  id: number;
  name: string;
  book: string;
  lessonId: number | null;
  groupName: string;
}

interface SectionRow {
  book: string;
  section: string;
  bankCount: number;
  questionCount: number;
  unbound: number;
}

/**
 * view=book：全部题库按 `book → section` 分组。
 * 册次与章节都用自然序，空串（未归类册次 / 未分章）排在最后。
 */
export function catalogSectionsByBook(db: Db, kind: BankKind | '' = ''): BankBookCatalog {
  const rows = db.all<SectionRow>(
    `SELECT COALESCE(b.book, '') AS book, COALESCE(b.section, '') AS section,
            COUNT(*) AS bankCount,
            COALESCE(SUM(b.question_count), 0) AS questionCount,
            MAX(CASE WHEN b.course_id IS NULL THEN 1 ELSE 0 END) AS unbound
     FROM banks b WHERE (?1 = '' OR b.kind = ?1)
     GROUP BY book, section`,
    [kind],
  );
  const books = new Map<string, SectionBook>();
  for (const row of rows) {
    let node = books.get(row.book);
    if (!node) {
      node = { book: row.book, isUnbound: false, bankCount: 0, questionCount: 0, sections: [] };
      books.set(row.book, node);
    }
    if (row.unbound === 1) node.isUnbound = true;
    node.bankCount += row.bankCount;
    node.questionCount += row.questionCount;
    node.sections.push({
      section: row.section,
      bankCount: row.bankCount,
      questionCount: row.questionCount,
    });
  }
  const list = [...books.values()];
  for (const book of list) book.sections.sort((a, b) => compareNaturalName(a.section, b.section));
  list.sort((a, b) => compareNaturalName(a.book, b.book));
  return { view: 'book', books: list };
}

/**
 * view=course：只统计挂了课程的题库，按 `course → book → section` 分组。
 */
export function catalogSectionsByCourse(db: Db, kind: BankKind | '' = ''): BankCourseCatalog {
  const rows = db.all<SectionRow & { courseId: number; name: string }>(
    `SELECT c.id AS courseId, c.name,
            COALESCE(b.book, '') AS book, COALESCE(b.section, '') AS section,
            COUNT(*) AS bankCount,
            COALESCE(SUM(b.question_count), 0) AS questionCount,
            0 AS unbound
     FROM banks b JOIN courses c ON c.id = b.course_id
     WHERE (?1 = '' OR b.kind = ?1)
     GROUP BY c.id, book, section
     ORDER BY c.name, c.id`,
    [kind],
  );
  const courses = new Map<number, SectionCourse>();
  for (const row of rows) {
    let course = courses.get(row.courseId);
    if (!course) {
      course = { id: row.courseId, name: row.name, bankCount: 0, questionCount: 0, books: [] };
      courses.set(row.courseId, course);
    }
    course.bankCount += row.bankCount;
    course.questionCount += row.questionCount;
    let book = course.books.find((b) => b.book === row.book);
    if (!book) {
      book = { book: row.book, bankCount: 0, questionCount: 0, sections: [] };
      course.books.push(book);
    }
    book.bankCount += row.bankCount;
    book.questionCount += row.questionCount;
    book.sections.push({
      section: row.section,
      bankCount: row.bankCount,
      questionCount: row.questionCount,
    });
  }
  for (const course of courses.values()) {
    for (const book of course.books) book.sections.sort((a, b) => compareNaturalName(a.section, b.section));
    course.books.sort((a, b) => compareNaturalName(a.book, b.book));
  }
  return { view: 'course', courses: [...courses.values()] };
}

/** 回填候选：section 为空（可按 kind 过滤），带课时 group_name 供优先继承 */
export function banksMissingSection(db: Db, kind: BankKind | '' = ''): BankMissingSectionRow[] {
  return db.all<BankMissingSectionRow>(
    `SELECT b.id, b.name, COALESCE(b.book, '') AS book, b.lesson_id AS lessonId, COALESCE(l.group_name, '') AS groupName
       FROM banks b LEFT JOIN lessons l ON l.id = b.lesson_id
       WHERE b.section = '' AND (?1 = '' OR b.kind = ?1)
       ORDER BY b.id`,
    [kind],
  );
}

/** 批量写入回填结果；只改仍然为空的题库（避免覆盖老师刚手工填的章节），返回改动条数 */
export function setBankSections(db: Db, updates: { id: number; section: string }[]): number {
  if (updates.length === 0) return 0;
  let changed = 0;
  db.transaction(() => {
    for (const item of updates) {
      changed += db.run("UPDATE banks SET section = ? WHERE id = ? AND section = ''", [item.section, item.id]).changes;
    }
  });
  return changed;
}
