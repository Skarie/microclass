/**
 * 标签（迁移 0030）的 SQL：标签本身与题目标签关联。
 *
 * 业务校验（名称归一 / 重名 409 / 批量模式）在 `services/tagService`；
 * 这里只做无状态取数与写入，并把「多对多」的三种批量语义（add / remove / replace）落成 SQL。
 *
 * 筛选语义（any / all）与组卷题池共用同一套写法：
 *   any → `question_id IN (SELECT … WHERE tag_id IN (…))`；
 *   all → 子查询 `GROUP BY question_id HAVING COUNT(DISTINCT tag_id) = N`。
 */
import type { Db } from '../client.js';

export interface TagRow {
  id: number;
  name: string;
  note: string;
  created_at: string;
  created_by: number | null;
}

/** 列表行：标签 + 题目数（一次 LEFT JOIN 聚合，不做 N+1） */
export interface TagListRow extends TagRow {
  questionCount: number;
}

export interface TagWrite {
  name: string;
  note: string;
  createdBy: number | null;
}

export type TagBatchMode = 'add' | 'remove' | 'replace';

export class TagRepository {
  constructor(private readonly db: Db) {}

  /** 列表：标签名/备注模糊搜，按名字排序；题目数一次聚合 */
  list(search: string): TagListRow[] {
    const like = `%${search}%`;
    const where = search === '' ? '' : ' WHERE t.name LIKE ? OR t.note LIKE ?';
    const params = search === '' ? [] : [like, like];
    const rows = this.db.all<TagRow & { questionCount: number }>(
      `SELECT t.id, t.name, t.note, t.created_at, t.created_by, COUNT(qt.question_id) AS questionCount
         FROM tags t
         LEFT JOIN question_tags qt ON qt.tag_id = t.id${where}
        GROUP BY t.id
        ORDER BY t.name COLLATE NOCASE, t.id`,
      params,
    );
    return rows.map((row) => ({ ...row, questionCount: Number(row.questionCount ?? 0) }));
  }

  findById(id: number): TagRow | undefined {
    return this.db.get<TagRow>('SELECT id, name, note, created_at, created_by FROM tags WHERE id = ?', [id]);
  }

  /** 重名检查（大小写不敏感，首尾空格由服务层 trim） */
  findByName(name: string): TagRow | undefined {
    return this.db.get<TagRow>(
      'SELECT id, name, note, created_at, created_by FROM tags WHERE name COLLATE NOCASE = ?',
      [name],
    );
  }

  create(input: TagWrite): number {
    return this.db.run('INSERT INTO tags (name, note, created_by) VALUES (?,?,?)', [
      input.name,
      input.note,
      input.createdBy,
    ]).lastInsertRowid;
  }

  update(id: number, input: TagWrite): void {
    this.db.run('UPDATE tags SET name = ?, note = ? WHERE id = ?', [input.name, input.note, id]);
  }

  /** 删标签：question_tags 由外键 ON DELETE CASCADE 清掉 */
  remove(id: number): void {
    this.db.run('DELETE FROM tags WHERE id = ?', [id]);
  }

  countQuestions(tagId: number): number {
    return this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM question_tags WHERE tag_id = ?', [tagId])?.c ?? 0;
  }

  /** 存在的标签 id（批量打标前统一校验，避免一半成功） */
  existingTagIds(ids: number[]): number[] {
    if (ids.length === 0) return [];
    const marks = ids.map(() => '?').join(',');
    return this.db.all<{ id: number }>(`SELECT id FROM tags WHERE id IN (${marks})`, ids).map((row) => row.id);
  }

  /** 存在的题目 id（批量打标前统一校验） */
  existingQuestionIds(ids: number[]): number[] {
    if (ids.length === 0) return [];
    const marks = ids.map(() => '?').join(',');
    return this.db.all<{ id: number }>(`SELECT id FROM questions WHERE id IN (${marks})`, ids).map((row) => row.id);
  }

  /** 某道题的标签（按名字排序，题目编辑弹窗用） */
  tagsOfQuestion(questionId: number): TagRow[] {
    return this.db.all<TagRow>(
      `SELECT t.id, t.name, t.note, t.created_at, t.created_by
         FROM question_tags qt JOIN tags t ON t.id = qt.tag_id
        WHERE qt.question_id = ?
        ORDER BY t.name COLLATE NOCASE, t.id`,
      [questionId],
    );
  }

  /** 批量里某几个题目的现有标签（用于计算 affected 与前端回显） */
  tagIdsOfQuestions(questionIds: number[]): Map<number, number[]> {
    const map = new Map<number, number[]>();
    if (questionIds.length === 0) return map;
    const marks = questionIds.map(() => '?').join(',');
    const rows = this.db.all<{ question_id: number; tag_id: number }>(
      `SELECT question_id, tag_id FROM question_tags WHERE question_id IN (${marks})`,
      questionIds,
    );
    for (const row of rows) {
      map.set(row.question_id, [...(map.get(row.question_id) ?? []), row.tag_id]);
    }
    return map;
  }

  /** 覆盖式设置：先清空这题的标签，再写新的（单事务，避免中间态被看到） */
  setQuestionTags(questionId: number, tagIds: number[]): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM question_tags WHERE question_id = ?', [questionId]);
      for (const tagId of tagIds) {
        this.db.run('INSERT OR IGNORE INTO question_tags (question_id, tag_id) VALUES (?,?)', [questionId, tagId]);
      }
    });
  }

  /**
   * 批量打标：add / remove / replace 三种语义。
   * 返回**受影响的题目数**（有实际变更的题），没有变更的题不计入。
   */
  batch(questionIds: number[], tagIds: number[], mode: TagBatchMode): number {
    let affected = 0;
    const before = this.tagIdsOfQuestions(questionIds);
    this.db.transaction(() => {
      for (const questionId of questionIds) {
        const current = before.get(questionId) ?? [];
        if (mode === 'replace') {
          this.db.run('DELETE FROM question_tags WHERE question_id = ?', [questionId]);
          for (const tagId of tagIds) {
            this.db.run('INSERT OR IGNORE INTO question_tags (question_id, tag_id) VALUES (?,?)', [questionId, tagId]);
          }
          if (current.slice().sort().join(',') !== tagIds.slice().sort().join(',')) affected += 1;
          continue;
        }
        if (mode === 'add') {
          let changed = 0;
          for (const tagId of tagIds) {
            changed += this.db.run('INSERT OR IGNORE INTO question_tags (question_id, tag_id) VALUES (?,?)', [
              questionId,
              tagId,
            ]).changes;
          }
          if (changed > 0) affected += 1;
          continue;
        }
        // remove：只删请求里给的标签，题目其他标签不动
        let removed = 0;
        for (const tagId of tagIds) {
          removed += this.db.run('DELETE FROM question_tags WHERE question_id = ? AND tag_id = ?', [
            questionId,
            tagId,
          ]).changes;
        }
        if (removed > 0) affected += 1;
      }
    });
    return affected;
  }
}
