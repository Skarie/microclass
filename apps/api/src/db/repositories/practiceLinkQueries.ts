/**
 * 实践关联（practice_links / practice_link_lessons）的 SQL。
 *
 * 一张 practice_links 表示「一个练习目标」：整个题库 / 题库内章节 / 小节 / 单题；
 * practice_link_lessons 是目标 ↔ 课时的多对多，因此一个目标可以同时挂多个课时。
 */
import type { Db } from '../client.js';

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

export class PracticeLinkRepository {
  constructor(private readonly db: Db) {}

  findById(id: number): PracticeLinkRow | undefined {
    return this.db.get<PracticeLinkRow>('SELECT * FROM practice_links WHERE id = ?', [id]);
  }

  listByBank(bankId: number): PracticeLinkRow[] {
    return this.db.all<PracticeLinkRow>('SELECT * FROM practice_links WHERE bank_id = ? ORDER BY id', [bankId]);
  }

  listByLesson(lessonId: number): PracticeLinkRow[] {
    return this.db.all<PracticeLinkRow>(
      `SELECT pl.* FROM practice_links pl
         JOIN practice_link_lessons pll ON pll.link_id = pl.id
        WHERE pll.lesson_id = ?
        ORDER BY pl.id`,
      [lessonId],
    );
  }

  /** 同一目标（类型 + 题库 + 题目/章节/小节）只保留一条，重复 POST 复用它 */
  findByTarget(target: PracticeTarget): PracticeLinkRow | undefined {
    return this.db.get<PracticeLinkRow>(
      `SELECT * FROM practice_links
        WHERE target_type = ? AND bank_id = ? AND question_id IS ? AND chapter = ? AND section = ?
        ORDER BY id LIMIT 1`,
      [target.targetType, target.bankId, target.questionId, target.chapter, target.section],
    );
  }

  insert(target: PracticeTarget): PracticeLinkRow {
    const id = this.db.run(
      `INSERT INTO practice_links (target_type, bank_id, question_id, chapter, section)
       VALUES (?,?,?,?,?)`,
      [target.targetType, target.bankId, target.questionId, target.chapter, target.section],
    ).lastInsertRowid;
    const row = this.findById(id);
    if (!row) throw new Error('实践关联创建失败');
    return row;
  }

  /** 覆盖式设置课时（先清空再写入） */
  setLessonIds(linkId: number, lessonIds: number[]): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM practice_link_lessons WHERE link_id = ?', [linkId]);
      this.addLessonIds(linkId, lessonIds);
    });
  }

  /** 追加课时（重复的 INSERT OR IGNORE，不报错） */
  addLessonIds(linkId: number, lessonIds: number[]): number {
    let changes = 0;
    for (const lessonId of lessonIds) {
      changes += this.db.run('INSERT OR IGNORE INTO practice_link_lessons (link_id, lesson_id) VALUES (?,?)', [
        linkId,
        lessonId,
      ]).changes;
    }
    return changes;
  }

  delete(id: number): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM practice_link_lessons WHERE link_id = ?', [id]);
      this.db.run('DELETE FROM practice_links WHERE id = ?', [id]);
    });
  }

  /** 关联的课时（含课程名与章节），按课时排序 */
  lessonsFor(linkIds: number[]): LessonLinkRow[] {
    if (linkIds.length === 0) return [];
    const placeholders = linkIds.map(() => '?').join(',');
    return this.db.all<LessonLinkRow>(
      `SELECT pll.link_id, l.id AS lesson_id, l.title, l.course_id,
              COALESCE(c.name, '') AS course_name, COALESCE(l.group_name, '') AS group_name
         FROM practice_link_lessons pll
         JOIN lessons l ON l.id = pll.lesson_id
         LEFT JOIN courses c ON c.id = l.course_id
        WHERE pll.link_id IN (${placeholders})
        ORDER BY pll.link_id, l.sort, l.id`,
      linkIds,
    );
  }

  /** 单题目标的题干 + 题库名（练习汇总用） */
  questionsFor(linkIds: number[]): QuestionLinkRow[] {
    if (linkIds.length === 0) return [];
    const placeholders = linkIds.map(() => '?').join(',');
    return this.db.all<QuestionLinkRow>(
      `SELECT pl.id AS link_id, q.id AS question_id, q.bank_id,
              COALESCE(b.name, '') AS bank_name, q.stem
         FROM practice_links pl
         JOIN questions q ON q.id = pl.question_id
         LEFT JOIN banks b ON b.id = q.bank_id
        WHERE pl.id IN (${placeholders}) AND pl.target_type = 'question'
        ORDER BY pl.id`,
      linkIds,
    );
  }
}
