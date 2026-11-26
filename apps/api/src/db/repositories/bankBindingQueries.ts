/**
 * 题库「归属课程」的批量操作：课时推导、按册次挂课程、按册次匹配回填。
 *
 * 从 `bankRepository` 抽出（与目录查询同因）：写操作 + 统计各成一模块，
 * 仓储只保留题库本身的增删改查，文件行数也能守住 300 行上限。
 */
import type { AsyncDb } from '../async.js';
import type { BankKind } from './bankRepository.js';
import { bookKeyOfCourseName } from './bankNaming.js';

/** 一键回填归属课程：课时配套题库由课时推导（返回条数） */
export async function bindCourseByLesson(db: AsyncDb): Promise<number> {
  const res = await db.run(
    `UPDATE banks SET course_id = (SELECT l.course_id FROM lessons l WHERE l.id = banks.lesson_id)
     WHERE lesson_id IS NOT NULL
       AND (course_id IS NULL OR course_id <> (SELECT l.course_id FROM lessons l WHERE l.id = banks.lesson_id))`,
  );
  return res.changes;
}

/**
 * 按册次批量挂课程：只影响**未归属**的题库。
 * 匹配口径与 catalogUnboundBooks 的分组完全一致（空册次统一按 "(无册次信息)"），
 * 保证界面上看到 131 个，这里就正好改 131 个。
 */
export async function bindUnboundByBook(db: AsyncDb, book: string, courseId: number | null): Promise<number> {
  const res = await db.run(
    'UPDATE banks SET course_id = ?' +
      ' WHERE course_id IS NULL' +
      " AND COALESCE(NULLIF(book, ''), '(无册次信息)') = ?",
    [courseId, book],
  );
  return res.changes;
}

/**
 * 按册次匹配回填归属课程（返回条数；匹配规则由服务层给出 courseId）。
 *
 * 事务：`AsyncDb.transaction` 保证 sqlite（BEGIN IMMEDIATE）与 PG（单连接 BEGIN）语义一致；
 * 回调抛错时整批回滚 —— 见 `test/bank-write-transaction.test.ts`。
 */
export async function setCourseBindings(
  db: AsyncDb,
  updates: { bankId: number; courseId: number | null }[],
): Promise<number> {
  if (updates.length === 0) return 0;
  let changed = 0;
  await db.transaction(async (tx) => {
    for (const item of updates) {
      const res = await tx.run('UPDATE banks SET course_id = ? WHERE id = ? AND course_id IS NOT ?', [
        item.courseId,
        item.bankId,
        item.courseId,
      ]);
      changed += res.changes;
    }
  });
  return changed;
}

/** 未归属课程但带册次信息的题库（供册次匹配用） */
export async function unboundWithBook(
  db: AsyncDb,
): Promise<{ id: number; book: string; subject: string; kind: string }[]> {
  return db.all<{ id: number; book: string; subject: string; kind: string }>(
    "SELECT id, book, subject, COALESCE(kind, '') AS kind FROM banks WHERE course_id IS NULL AND book <> ''",
  );
}

/** 课程名册次候选（课程名形如「小学数学·二年级上册（新）」→「二年级上册（新）」） */
export async function courseBookKeys(db: AsyncDb): Promise<{ id: number; name: string; key: string }[]> {
  const rows = await db.all<{ id: number; name: string }>('SELECT id, name FROM courses');
  return rows.map((c) => ({ id: c.id, name: c.name, key: bookKeyOfCourseName(c.name) }));
}

/** 题库分布：按课程归属统计（体检/运维用；`kind` 为空表示全部类型） */
export async function courseBindingStats(
  db: AsyncDb,
  kind: BankKind | '' = '',
): Promise<{ bound: number; unbound: number; banks: number }[]> {
  return db.all<{ bound: number; unbound: number; banks: number }>(
    `SELECT COALESCE(SUM(CASE WHEN course_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS bound,
            COALESCE(SUM(CASE WHEN course_id IS NULL THEN 1 ELSE 0 END), 0) AS unbound,
            COUNT(*) AS banks
     FROM banks b WHERE (?1 = '' OR b.kind = ?1)`,
    [kind],
  );
}
