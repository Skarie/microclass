/**
 * 实践关联（practice_links / practice_link_lessons）的 SQL。
 *
 * 一张 practice_links 表示「一个练习目标」：整个题库 / 题库内章节 / 小节 / 单题；
 * practice_link_lessons 是目标 ↔ 课时的多对多，因此一个目标可以同时挂多个课时。
 *
 * 全部走 `AsyncDb`（切流后与业务同库）。方言点：
 *   - `question_id IS ?` → `nullSafeEq`（#27，PG 的 `IS` 只接受 NULL 字面量）；
 *   - `INSERT OR IGNORE` → `ON CONFLICT (link_id, lesson_id) DO NOTHING`（#22，两库同一句）；
 *   - `lastInsertRowid` → `RETURNING id`（#14）；
 *   - 主键/外键列是 bigint → 仓储边界 `Number()` 收敛（#17，驱动层还有全局 parser 兜底）。
 */
import type { Db } from '../client.js';
import { createSqliteAsyncDb, type AsyncDb } from '../async.js';
import { nullSafeEq } from '../sql.js';

export interface PracticeLinkRow {
  id: number;
  target_type: string;
  bank_id: number;
  question_id: number | null;
  chapter: string;
  section: string;
  created_at: string;
}

export interface PracticeTarget {
  targetType: string;
  bankId: number;
  questionId: number | null;
  chapter: string;
  section: string;
}

export interface LessonLinkRow {
  link_id: number;
  lesson_id: number;
  title: string;
  course_id: number | null;
  course_name: string;
  group_name: string;
}

export interface QuestionLinkRow {
  link_id: number;
  question_id: number;
  bank_id: number;
  bank_name: string;
  stem: string;
}

/** int8 收敛：PG 的 bigint 即便有全局 parser，边界仍显式 `Number()`（双保险） */
function toInt(value: unknown): number {
  return Number(value);
}

function toIntOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function toLinkRow(row: PracticeLinkRow): PracticeLinkRow {
  return {
    ...row,
    id: toInt(row.id),
    bank_id: toInt(row.bank_id),
    question_id: toIntOrNull(row.question_id),
  };
}

function toLessonRow(row: LessonLinkRow): LessonLinkRow {
  return {
    ...row,
    link_id: toInt(row.link_id),
    lesson_id: toInt(row.lesson_id),
    course_id: toIntOrNull(row.course_id),
  };
}

function toQuestionRow(row: QuestionLinkRow): QuestionLinkRow {
  return { ...row, link_id: toInt(row.link_id), question_id: toInt(row.question_id), bank_id: toInt(row.bank_id) };
}

export class PracticeLinkRepository {
  constructor(
    private readonly db: Db,
    private readonly asyncDb?: AsyncDb,
  ) {}

  private adb(): AsyncDb {
    return this.asyncDb ?? createSqliteAsyncDb(this.db);
  }

  async findById(id: number): Promise<PracticeLinkRow | undefined> {
    const row = await this.adb().get<PracticeLinkRow>('SELECT * FROM practice_links WHERE id = ?', [id]);
    return row ? toLinkRow(row) : undefined;
  }

  async listByBank(bankId: number): Promise<PracticeLinkRow[]> {
    const rows = await this.adb().all<PracticeLinkRow>('SELECT * FROM practice_links WHERE bank_id = ? ORDER BY id', [
      bankId,
    ]);
    return rows.map(toLinkRow);
  }

  async listByLesson(lessonId: number): Promise<PracticeLinkRow[]> {
    const rows = await this.adb().all<PracticeLinkRow>(
      `SELECT pl.* FROM practice_links pl
         JOIN practice_link_lessons pll ON pll.link_id = pl.id
        WHERE pll.lesson_id = ?
        ORDER BY pl.id`,
      [lessonId],
    );
    return rows.map(toLinkRow);
  }

  /** 同一目标（类型 + 题库 + 题目/章节/小节）只保留一条，重复 POST 复用它 */
  async findByTarget(target: PracticeTarget): Promise<PracticeLinkRow | undefined> {
    const db = this.adb();
    const row = await db.get<PracticeLinkRow>(
      `SELECT * FROM practice_links
        WHERE target_type = ? AND bank_id = ? AND ${nullSafeEq('question_id', db.driver)} AND chapter = ? AND section = ?
        ORDER BY id LIMIT 1`,
      [target.targetType, target.bankId, target.questionId, target.chapter, target.section],
    );
    return row ? toLinkRow(row) : undefined;
  }

  async insert(target: PracticeTarget): Promise<PracticeLinkRow> {
    const created = await this.adb().get<{ id: number | string }>(
      `INSERT INTO practice_links (target_type, bank_id, question_id, chapter, section)
       VALUES (?,?,?,?,?) RETURNING id`,
      [target.targetType, target.bankId, target.questionId, target.chapter, target.section],
    );
    if (!created) throw new Error('实践关联创建失败');
    const row = await this.findById(toInt(created.id));
    if (!row) throw new Error('实践关联创建失败');
    return row;
  }

  /** 覆盖式设置课时（先清空再写入，同一事务） */
  async setLessonIds(linkId: number, lessonIds: number[]): Promise<void> {
    const db = this.adb();
    await db.transaction(async (tx) => {
      await tx.run('DELETE FROM practice_link_lessons WHERE link_id = ?', [linkId]);
      await this.addLessonIds(linkId, lessonIds, tx);
    });
  }

  /** 追加课时（重复的走 ON CONFLICT DO NOTHING，不报错）；`runner` 供事务内复用同一连接 */
  async addLessonIds(linkId: number, lessonIds: number[], runner?: AsyncDb): Promise<number> {
    const db = runner ?? this.adb();
    let changes = 0;
    for (const lessonId of lessonIds) {
      const res = await db.run(
        'INSERT INTO practice_link_lessons (link_id, lesson_id) VALUES (?,?) ON CONFLICT (link_id, lesson_id) DO NOTHING',
        [linkId, lessonId],
      );
      changes += res.changes;
    }
    return changes;
  }

  async delete(id: number): Promise<void> {
    const db = this.adb();
    await db.transaction(async (tx) => {
      await tx.run('DELETE FROM practice_link_lessons WHERE link_id = ?', [id]);
      await tx.run('DELETE FROM practice_links WHERE id = ?', [id]);
    });
  }

  /** 关联的课时（含课程名与章节），按课时排序 */
  async lessonsFor(linkIds: number[]): Promise<LessonLinkRow[]> {
    if (linkIds.length === 0) return [];
    const placeholders = linkIds.map(() => '?').join(',');
    const rows = await this.adb().all<LessonLinkRow>(
      `SELECT pll.link_id, l.id AS lesson_id, l.title, l.course_id,
              COALESCE(c.name, '') AS course_name, COALESCE(l.group_name, '') AS group_name
         FROM practice_link_lessons pll
         JOIN lessons l ON l.id = pll.lesson_id
         LEFT JOIN courses c ON c.id = l.course_id
        WHERE pll.link_id IN (${placeholders})
        ORDER BY pll.link_id, l.sort, l.id`,
      linkIds,
    );
    return rows.map(toLessonRow);
  }

  /** 单题目标的题干 + 题库名（练习汇总用） */
  async questionsFor(linkIds: number[]): Promise<QuestionLinkRow[]> {
    if (linkIds.length === 0) return [];
    const placeholders = linkIds.map(() => '?').join(',');
    const rows = await this.adb().all<QuestionLinkRow>(
      `SELECT pl.id AS link_id, q.id AS question_id, q.bank_id,
              COALESCE(b.name, '') AS bank_name, q.stem
         FROM practice_links pl
         JOIN questions q ON q.id = pl.question_id
         LEFT JOIN banks b ON b.id = q.bank_id
        WHERE pl.id IN (${placeholders}) AND pl.target_type = 'question'
        ORDER BY pl.id`,
      linkIds,
    );
    return rows.map(toQuestionRow);
  }
}
