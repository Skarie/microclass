/**
 * 标签（迁移 0030）的 SQL：标签本身与题目标签关联。
 *
 * 业务校验（名称归一 / 重名 409 / 批量模式）在 `services/tagService`；
 * 这里只做无状态取数与写入，并把「多对多」的三种批量语义（add / remove / replace）落成 SQL。
 *
 * 筛选语义（any / all）与组卷题池共用同一套写法：
 *   any → `question_id IN (SELECT … WHERE tag_id IN (…))`；
 *   all → 子查询 `GROUP BY question_id HAVING COUNT(DISTINCT tag_id) = N`。
 *
 * P0 阶段 2（收尾批次）：改走 `AsyncDb`（PG 模式下不再落回 SQLite）。方言处理：
 *   - `COLLATE NOCASE` → `nocase(col, driver)`（#6 的运行时一半：PG 的 tags.name 已是 citext）；
 *   - `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`（#22，两库同一句）；
 *   - `INSERT` 取 id → `RETURNING id`（#14）；int8 统一 `Number()`（#17）。
 */
import type { AsyncDb } from '../async.js';
import { likeCI, nocase } from '../sql.js';

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

/** 行 → 数字化（PG 的 bigint 默认返回字符串，方言 #17） */
function toRow(row: TagRow): TagRow {
  return {
    ...row,
    id: Number(row.id),
    created_by: row.created_by === null || row.created_by === undefined ? null : Number(row.created_by),
  };
}

const COLUMNS = 'id, name, note, created_at, created_by';

export class TagRepository {
  constructor(private readonly db: AsyncDb) {}

  /** 列表：标签名/备注模糊搜，按名字排序；题目数一次聚合 */
  async list(search: string): Promise<TagListRow[]> {
    const like = `%${search}%`;
    // 关键词匹配与排序都走方言包装（#8/#23 + #6）：SQLite 的 LIKE/COLLATE NOCASE 大小写不敏感，
    // PG 侧由 `LOWER() … LIKE LOWER()` 与 citext 列承担，两边结果一致。
    const where = search === '' ? '' : ` WHERE ${likeCI('t.name')} OR ${likeCI('t.note')}`;
    const params = search === '' ? [] : [like, like];
    const rows = await this.db.all<TagRow & { questionCount: number | string }>(
      `SELECT t.id, t.name, t.note, t.created_at, t.created_by, COUNT(qt.question_id) AS "questionCount"
         FROM tags t
         LEFT JOIN question_tags qt ON qt.tag_id = t.id${where}
        GROUP BY t.id
        ORDER BY ${nocase('t.name', this.db.driver)}, t.id`,
      params,
    );
    return rows.map((row) => ({ ...toRow(row), questionCount: Number(row.questionCount ?? 0) }));
  }

  async findById(id: number): Promise<TagRow | undefined> {
    const row = await this.db.get<TagRow>(`SELECT ${COLUMNS} FROM tags WHERE id = ?`, [id]);
    return row ? toRow(row) : undefined;
  }

  /** 重名检查（大小写不敏感，首尾空格由服务层 trim） */
  async findByName(name: string): Promise<TagRow | undefined> {
    const row = await this.db.get<TagRow>(`SELECT ${COLUMNS} FROM tags WHERE ${nocase('name', this.db.driver)} = ?`, [
      name,
    ]);
    return row ? toRow(row) : undefined;
  }

  async create(input: TagWrite): Promise<number> {
    const row = await this.db.get<{ id: number | string }>(
      'INSERT INTO tags (name, note, created_by) VALUES (?,?,?) RETURNING id',
      [input.name, input.note, input.createdBy],
    );
    return Number(row?.id ?? 0);
  }

  async update(id: number, input: TagWrite): Promise<void> {
    await this.db.run('UPDATE tags SET name = ?, note = ? WHERE id = ?', [input.name, input.note, id]);
  }

  /** 删标签：question_tags 由外键 ON DELETE CASCADE 清掉 */
  async remove(id: number): Promise<void> {
    await this.db.run('DELETE FROM tags WHERE id = ?', [id]);
  }

  async countQuestions(tagId: number): Promise<number> {
    const row = await this.db.get<{ c: number | string }>('SELECT COUNT(*) AS c FROM question_tags WHERE tag_id = ?', [
      tagId,
    ]);
    return Number(row?.c ?? 0);
  }

  /** 存在的标签 id（批量打标前统一校验，避免一半成功） */
  async existingTagIds(ids: number[]): Promise<number[]> {
    if (ids.length === 0) return [];
    const marks = ids.map(() => '?').join(',');
    const rows = await this.db.all<{ id: number | string }>(`SELECT id FROM tags WHERE id IN (${marks})`, ids);
    return rows.map((row) => Number(row.id));
  }

  /** 存在的题目 id（批量打标前统一校验） */
  async existingQuestionIds(ids: number[]): Promise<number[]> {
    if (ids.length === 0) return [];
    const marks = ids.map(() => '?').join(',');
    const rows = await this.db.all<{ id: number | string }>(`SELECT id FROM questions WHERE id IN (${marks})`, ids);
    return rows.map((row) => Number(row.id));
  }

  /** 某道题的标签（按名字排序，题目编辑弹窗用） */
  async tagsOfQuestion(questionId: number): Promise<TagRow[]> {
    const rows = await this.db.all<TagRow>(
      `SELECT t.id, t.name, t.note, t.created_at, t.created_by
         FROM question_tags qt JOIN tags t ON t.id = qt.tag_id
        WHERE qt.question_id = ?
        ORDER BY ${nocase('t.name', this.db.driver)}, t.id`,
      [questionId],
    );
    return rows.map(toRow);
  }

  /** 批量里某几个题目的现有标签（用于计算 affected 与前端回显） */
  async tagIdsOfQuestions(questionIds: number[]): Promise<Map<number, number[]>> {
    const map = new Map<number, number[]>();
    if (questionIds.length === 0) return map;
    const marks = questionIds.map(() => '?').join(',');
    const rows = await this.db.all<{ question_id: number | string; tag_id: number | string }>(
      `SELECT question_id, tag_id FROM question_tags WHERE question_id IN (${marks})`,
      questionIds,
    );
    for (const row of rows) {
      const questionId = Number(row.question_id);
      map.set(questionId, [...(map.get(questionId) ?? []), Number(row.tag_id)]);
    }
    return map;
  }

  /** 覆盖式设置：先清空这题的标签，再写新的（单事务，避免中间态被看到） */
  async setQuestionTags(questionId: number, tagIds: number[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM question_tags WHERE question_id = ?', [questionId]);
      for (const tagId of tagIds) {
        await tx.run('INSERT INTO question_tags (question_id, tag_id) VALUES (?,?) ON CONFLICT DO NOTHING', [
          questionId,
          tagId,
        ]);
      }
    });
  }

  /**
   * 批量打标：add / remove / replace 三种语义。
   * 返回**受影响的题目数**（有实际变更的题），没有变更的题不计入。
   */
  async batch(questionIds: number[], tagIds: number[], mode: TagBatchMode): Promise<number> {
    let affected = 0;
    const before = await this.tagIdsOfQuestions(questionIds);
    await this.db.transaction(async (tx) => {
      for (const questionId of questionIds) {
        const current = before.get(questionId) ?? [];
        if (mode === 'replace') {
          await tx.run('DELETE FROM question_tags WHERE question_id = ?', [questionId]);
          for (const tagId of tagIds) {
            await tx.run('INSERT INTO question_tags (question_id, tag_id) VALUES (?,?) ON CONFLICT DO NOTHING', [
              questionId,
              tagId,
            ]);
          }
          if (current.slice().sort().join(',') !== tagIds.slice().sort().join(',')) affected += 1;
          continue;
        }
        if (mode === 'add') {
          let changed = 0;
          for (const tagId of tagIds) {
            const result = await tx.run(
              'INSERT INTO question_tags (question_id, tag_id) VALUES (?,?) ON CONFLICT DO NOTHING',
              [questionId, tagId],
            );
            changed += result.changes;
          }
          if (changed > 0) affected += 1;
          continue;
        }
        // remove：只删请求里给的标签，题目其他标签不动
        let removed = 0;
        for (const tagId of tagIds) {
          const result = await tx.run('DELETE FROM question_tags WHERE question_id = ? AND tag_id = ?', [
            questionId,
            tagId,
          ]);
          removed += result.changes;
        }
        if (removed > 0) affected += 1;
      }
    });
    return affected;
  }
}
