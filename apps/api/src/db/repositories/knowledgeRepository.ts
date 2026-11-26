/** 知识点仓储：课时级（lesson_id）与课程级（course_id）共用一张表。 */
import type { AsyncDb } from '../async.js';
import type { KnowledgeRow, KnowledgeScope } from '../../domain/knowledgeTypes.js';

export interface KnowledgeCreateInput {
  lessonId?: number;
  courseId?: number;
  title: string;
  kind: KnowledgeRow['kind'];
  fileName?: string;
  filePath?: string;
  content?: string;
  url?: string;
  sort?: number;
}

/** 归属列名只有这两个内部常量，不会被外部输入拼接 */
function scopeColumn(scope: KnowledgeScope): { column: 'lesson_id' | 'course_id'; value: number } {
  if (scope.lessonId !== undefined) return { column: 'lesson_id', value: scope.lessonId };
  if (scope.courseId !== undefined) return { column: 'course_id', value: scope.courseId };
  throw new Error('知识点必须指定 lessonId 或 courseId');
}

/** 行 → 数字化（PG 的 bigint 经 node-postgres 默认是字符串，方言 #17） */
function toRow(row: KnowledgeRow): KnowledgeRow {
  return {
    ...row,
    id: Number(row.id),
    sort: Number(row.sort ?? 0),
    created_at: Number(row.created_at ?? 0),
    lesson_id: row.lesson_id === null || row.lesson_id === undefined ? null : Number(row.lesson_id),
    course_id: row.course_id === null || row.course_id === undefined ? null : Number(row.course_id),
  };
}

export class KnowledgeRepository {
  constructor(private readonly db: AsyncDb) {}

  async listByLesson(lessonId: number): Promise<KnowledgeRow[]> {
    const rows = await this.db.all<KnowledgeRow>('SELECT * FROM knowledge WHERE lesson_id = ? ORDER BY sort, id', [
      lessonId,
    ]);
    return rows.map(toRow);
  }

  async listByCourse(courseId: number): Promise<KnowledgeRow[]> {
    const rows = await this.db.all<KnowledgeRow>('SELECT * FROM knowledge WHERE course_id = ? ORDER BY sort, id', [
      courseId,
    ]);
    return rows.map(toRow);
  }

  async findById(id: number): Promise<KnowledgeRow | undefined> {
    const row = await this.db.get<KnowledgeRow>('SELECT * FROM knowledge WHERE id = ?', [id]);
    return row ? toRow(row) : undefined;
  }

  /** 单条写入；`db` 只在批量事务里传入（保证同一连接） */
  async create(input: KnowledgeCreateInput, db: AsyncDb = this.db): Promise<number> {
    const row = await db.get<{ id: number | string }>(
      `INSERT INTO knowledge (lesson_id, course_id, title, kind, file_name, file_path, content, url, sort)
       VALUES (?,?,?,?,?,?,?,?,?) RETURNING id`,
      [
        input.lessonId ?? null,
        input.courseId ?? null,
        input.title,
        input.kind,
        input.fileName ?? '',
        input.filePath ?? '',
        input.content ?? '',
        input.url ?? '',
        input.sort ?? 0,
      ],
    );
    return Number(row?.id ?? 0);
  }

  /** 批量写入（同一事务）：批量导入知识点时避免半截数据 */
  async createMany(inputs: KnowledgeCreateInput[]): Promise<number[]> {
    const ids: number[] = [];
    await this.db.transaction(async (tx) => {
      for (const input of inputs) ids.push(await this.create(input, tx));
    });
    return ids;
  }

  async delete(id: number): Promise<void> {
    await this.db.run('DELETE FROM knowledge WHERE id = ?', [id]);
  }

  /** 更新标题与正文/链接（只更新传入的字段） */
  async update(id: number, patch: { title: string; content?: string; url?: string }): Promise<void> {
    if (patch.url !== undefined) {
      await this.db.run('UPDATE knowledge SET title = ?, url = ? WHERE id = ?', [patch.title, patch.url, id]);
      return;
    }
    await this.db.run('UPDATE knowledge SET title = ?, content = ? WHERE id = ?', [
      patch.title,
      patch.content ?? '',
      id,
    ]);
  }

  /** 该归属下是否已有同名文本知识点（批量导入的幂等判断） */
  async existsTextTitle(scope: KnowledgeScope, title: string): Promise<boolean> {
    const { column, value } = scopeColumn(scope);
    const row = await this.db.get(
      `SELECT 1 AS x FROM knowledge WHERE ${column} = ? AND kind = 'text' AND title = ? LIMIT 1`,
      [value, title],
    );
    return row !== undefined;
  }

  /** 该归属下现有最大 sort（新建知识点排在最后） */
  async maxSort(scope: KnowledgeScope): Promise<number> {
    const { column, value } = scopeColumn(scope);
    const row = await this.db.get<{ m: number | string | null }>(
      `SELECT MAX(sort) AS m FROM knowledge WHERE ${column} = ?`,
      [value],
    );
    return Number(row?.m ?? 0);
  }
}
