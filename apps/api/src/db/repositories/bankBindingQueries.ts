/**
 * 题库「归属课程」的批量操作：课时推导、按册次挂课程、按册次匹配回填。
 *
 * 从 `bankRepository` 抽出（与目录查询同因）：写操作 + 统计各成一模块，
 * 仓储只保留题库本身的增删改查，文件行数也能守住 300 行上限。
 */
import type { Db } from '../client.js';
import type { BankKind } from './bankRepository.js';
import { bookKeyOfCourseName } from './bankNaming.js';

/** 一键回填归属课程：课时配套题库由课时推导（返回条数） */
export function bindCourseByLesson(db: Db): number {
  return db.run(
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
export function bindUnboundByBook(db: Db, book: string, courseId: number | null): number {
  const res = db.run(
    'UPDATE banks SET course_id = ?' +
      ' WHERE course_id IS NULL' +
      " AND COALESCE(NULLIF(book, ''), '(无册次信息)') = ?",
    [courseId, book],
  );
  return res.changes;
}

/** 按册次匹配回填归属课程（返回条数；匹配规则由服务层给出 courseId） */
export function setCourseBindings(db: Db, updates: { bankId: number; courseId: number | null }[]): number {
  if (updates.length === 0) return 0;
  let changed = 0;
  db.transaction(() => {
    for (const item of updates) {
      changed += db.run('UPDATE banks SET course_id = ? WHERE id = ? AND course_id IS NOT ?', [
        item.courseId,
        item.bankId,
        item.courseId,
      ]).changes;
    }
  });
  return changed;
}

/** 未归属课程但带册次信息的题库（供册次匹配用） */
export function unboundWithBook(db: Db): { id: number; book: string; subject: string; kind: string }[] {
  return db.all<{ id: number; book: string; subject: string; kind: string }>(
    "SELECT id, book, subject, COALESCE(kind, '') AS kind FROM banks WHERE course_id IS NULL AND book <> ''",
  );
}

/** 课程名册次候选（课程名形如「小学数学·二年级上册（新）」→「二年级上册（新）」） */
export function courseBookKeys(db: Db): { id: number; name: string; key: string }[] {
  return db.all<{ id: number; name: string }>('SELECT id, name FROM courses').map((c) => ({
    id: c.id,
    name: c.name,
    key: bookKeyOfCourseName(c.name),
  }));
}

/** 题库分布：按课程归属统计（体检/运维用；`kind` 为空表示全部类型） */
export function courseBindingStats(
  db: Db,
  kind: BankKind | '' = '',
): { bound: number; unbound: number; banks: number }[] {
  return db.all<{ bound: number; unbound: number; banks: number }>(
    `SELECT COALESCE(SUM(CASE WHEN course_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS bound,
            COALESCE(SUM(CASE WHEN course_id IS NULL THEN 1 ELSE 0 END), 0) AS unbound,
            COUNT(*) AS banks
     FROM banks b WHERE (?1 = '' OR b.kind = ?1)`,
    [kind],
  );
}
