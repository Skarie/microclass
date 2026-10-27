/**
 * 题库目录的 SQL 聚合：课程列表、未归属统计、某门课的「章节 → 小节 → 题库」。
 *
 * 从 `bankRepository` 抽出：这些查询只读、无状态，放在独立模块后仓储文件
 * 保持在 300 行以内，目录的统计口径也集中在一处，避免方法一多又长回去。
 */
import type { Db } from '../client.js';
import type { BankKind } from './bankRepository.js';
import { bankSectionOfName, chapterKeyFromBankName } from './bankNaming.js';

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

/** 课程列表 + 每门课的题库数/题量（筛选树第一层；`kind` 为空表示全部类型） */
export function catalogCourses(db: Db, kind: BankKind | '' = ''): CatalogCourse[] {
  return db.all<CatalogCourse>(
    `SELECT c.id, c.name,
            COUNT(DISTINCT b.id) AS bankCount,
            COALESCE(SUM(b.question_count), 0) AS questionCount,
            COUNT(DISTINCT CASE WHEN l.group_name <> '' THEN l.group_name END) AS chapterCount
     FROM courses c
     LEFT JOIN banks b ON b.course_id = c.id AND (?1 = '' OR b.kind = ?1)
     LEFT JOIN lessons l ON l.id = b.lesson_id
     GROUP BY c.id
     HAVING bankCount > 0
     ORDER BY c.name`,
    [kind],
  );
}

/** 未归属课程的题库（含「课时库没挂课时」这种历史数据；`kind` 为空表示全部类型） */
export function catalogUnbound(db: Db, kind: BankKind | '' = ''): { bankCount: number; questionCount: number } {
  return (
    db.get<{ bankCount: number; questionCount: number }>(
      `SELECT COUNT(*) AS bankCount, COALESCE(SUM(b.question_count), 0) AS questionCount
       FROM banks b WHERE b.course_id IS NULL AND (?1 = '' OR b.kind = ?1)`,
      [kind],
    ) ?? { bankCount: 0, questionCount: 0 }
  );
}

/** 未归属课程按册次分组（目录树里仍能分类导航，而不是一大坨；`kind` 为空表示全部类型） */
export function catalogUnboundBooks(
  db: Db,
  kind: BankKind | '' = '',
): { book: string; bankCount: number; questionCount: number }[] {
  return db.all<{ book: string; bankCount: number; questionCount: number }>(
    `SELECT COALESCE(NULLIF(b.book, ''), '(无册次信息)') AS book,
            COUNT(*) AS bankCount,
            COALESCE(SUM(b.question_count), 0) AS questionCount
     FROM banks b WHERE b.course_id IS NULL AND (?1 = '' OR b.kind = ?1)
     GROUP BY book ORDER BY bankCount DESC`,
    [kind],
  );
}

/**
 * 某门课的目录：章节（group_name）→ 小节（lesson）→ 题库；
 * 不挂课时的章节题库/整卷试卷按「知识点前缀」归到「未分章」分组里。
 */
export function catalogCourse(
  db: Db,
  courseId: number,
): { course: { id: number; name: string } | undefined; chapters: CatalogNode[] } {
  const course = db.get<{ id: number; name: string }>('SELECT id, name FROM courses WHERE id = ?', [courseId]);
  const lessons = db.all<{ id: number; title: string; group_name: string; sort: number }>(
    'SELECT id, title, group_name, sort FROM lessons WHERE course_id = ? ORDER BY sort, id',
    [courseId],
  );
  const banks = db.all<{
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
