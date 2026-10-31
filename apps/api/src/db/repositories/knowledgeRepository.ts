/** 知识点仓储：课时级（lesson_id）与课程级（course_id）共用一张表。 */
import type { Db } from '../client.js';
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

export class KnowledgeRepository {
  constructor(private readonly db: Db) {}

  listByLesson(lessonId: number): KnowledgeRow[] {
    return this.db.all<KnowledgeRow>('SELECT * FROM knowledge WHERE lesson_id = ? ORDER BY sort, id', [lessonId]);
  }

  listByCourse(courseId: number): KnowledgeRow[] {
    return this.db.all<KnowledgeRow>('SELECT * FROM knowledge WHERE course_id = ? ORDER BY sort, id', [courseId]);
  }

  findById(id: number): KnowledgeRow | undefined {
    return this.db.get<KnowledgeRow>('SELECT * FROM knowledge WHERE id = ?', [id]);
  }

  create(input: KnowledgeCreateInput): number {
    return this.db.run(
      `INSERT INTO knowledge (lesson_id, course_id, title, kind, file_name, file_path, content, url, sort)
       VALUES (?,?,?,?,?,?,?,?,?)`,
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
    ).lastInsertRowid;
  }

  /** 批量写入（同一事务）：批量导入知识点时避免半截数据 */
  createMany(inputs: KnowledgeCreateInput[]): number[] {
    const ids: number[] = [];
    this.db.transaction(() => {
      for (const input of inputs) ids.push(this.create(input));
    });
    return ids;
  }

  delete(id: number): void {
    this.db.run('DELETE FROM knowledge WHERE id = ?', [id]);
  }

  /** 更新标题与正文/链接（只更新传入的字段） */
  update(id: number, patch: { title: string; content?: string; url?: string }): void {
    if (patch.url !== undefined) {
      this.db.run('UPDATE knowledge SET title = ?, url = ? WHERE id = ?', [patch.title, patch.url, id]);
      return;
    }
    this.db.run('UPDATE knowledge SET title = ?, content = ? WHERE id = ?', [patch.title, patch.content ?? '', id]);
  }

  /** 该归属下是否已有同名文本知识点（批量导入的幂等判断） */
  existsTextTitle(scope: KnowledgeScope, title: string): boolean {
    const { column, value } = scopeColumn(scope);
    const row = this.db.get(
      `SELECT 1 AS x FROM knowledge WHERE ${column} = ? AND kind = 'text' AND title = ? LIMIT 1`,
      [value, title],
    );
    return row !== undefined;
  }

  /** 该归属下现有最大 sort（新建知识点排在最后） */
  maxSort(scope: KnowledgeScope): number {
    const { column, value } = scopeColumn(scope);
    const row = this.db.get<{ m: number | null }>(`SELECT MAX(sort) AS m FROM knowledge WHERE ${column} = ?`, [value]);
    return row?.m ?? 0;
  }
}
