/**
 * 课时（lessons）与知识点（knowledge）仓储。
 */
import type { Knowledge, Lesson, LessonSource } from '@microclass/shared';
import type { Db } from '../client.js';

/**
 * 课时查询：标题按 SQLite 的自然序排列（`2.` 排在 `10.` 前面），
 * 与轻课堂的 sort_order 思路一致 —— 素材文件名普遍带序号，字典序会明显错乱。
 */
const LESSON_SELECT = `
  SELECT * FROM lessons
`;
const NATURAL_ORDER = 'sort, CAST(title AS INTEGER), title, id';

export interface LessonWithProgress extends Lesson {
  progress: {
    position: number;
    duration: number;
    finished: 0 | 1;
    quiz_done: 0 | 1;
    quiz_best: number;
  } | null;
}

export interface LessonInput {
  title: string;
  description?: string;
  videoKind: Lesson['video_kind'];
  mediaRoot?: string;
  videoPath: string;
  sort?: number;
  groupName?: string;
  courseId?: number | null;
  /** 来源：manual（手工/上传，默认）/ folder（课程文件夹扫描） */
  source?: LessonSource;
}

export class LessonRepository {
  constructor(private readonly db: Db) {}

  listAll(): Lesson[] {
    return this.db.all<Lesson>(`${LESSON_SELECT} ORDER BY ${NATURAL_ORDER}`);
  }

  listByCourse(courseId: number | null): Lesson[] {
    if (courseId === null) {
      return this.db.all<Lesson>(`${LESSON_SELECT} WHERE course_id IS NULL ORDER BY ${NATURAL_ORDER}`);
    }
    return this.db.all<Lesson>(`${LESSON_SELECT} WHERE course_id = ? ORDER BY ${NATURAL_ORDER}`, [courseId]);
  }

  findById(id: number): Lesson | undefined {
    return this.db.get<Lesson>(`${LESSON_SELECT} WHERE id = ?`, [id]);
  }

  /** 需要抽取元数据的本地视频（未抽过或抽取失败） */
  listPendingProbe(limit = 20): Lesson[] {
    return this.db.all<Lesson>(
      `${LESSON_SELECT} WHERE video_kind = 'local' AND probed_at IS NULL ORDER BY id LIMIT ?`,
      [limit],
    );
  }

  /** 还有多少个课时没抽过元数据（给前端/脚本显示真实剩余量） */
  countPendingProbe(): number {
    return (
      this.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM lessons WHERE video_kind = 'local' AND probed_at IS NULL")
        ?.c ?? 0
    );
  }

  setProbeResult(id: number, input: { duration: number | null; mediaType: string; coverPath: string }): void {
    this.db.run(
      "UPDATE lessons SET duration = ?, media_type = ?, cover_path = CASE WHEN ? = '' THEN cover_path ELSE ? END, probed_at = ? WHERE id = ?",
      [input.duration, input.mediaType, input.coverPath, input.coverPath, Date.now(), id],
    );
  }

  findLocalByMediaPath(mediaRoot: string, videoPath: string): Lesson | undefined {
    return this.db.get<Lesson>('SELECT * FROM lessons WHERE media_root = ? AND video_path = ?', [mediaRoot, videoPath]);
  }

  create(input: LessonInput): number {
    return this.db.run(
      'INSERT INTO lessons (title, description, video_kind, media_root, video_path, sort, group_name, course_id, source) VALUES (?,?,?,?,?,?,?,?,?)',
      [
        input.title,
        input.description ?? '',
        input.videoKind,
        input.mediaRoot ?? '',
        input.videoPath,
        input.sort ?? 0,
        input.groupName ?? '',
        input.courseId ?? null,
        input.source ?? 'manual',
      ],
    ).lastInsertRowid;
  }

  update(id: number, input: LessonInput): void {
    this.db.run(
      'UPDATE lessons SET title = ?, description = ?, video_kind = ?, media_root = ?, video_path = ?, sort = ?, group_name = ?, course_id = ? WHERE id = ?',
      [
        input.title,
        input.description ?? '',
        input.videoKind,
        input.mediaRoot ?? '',
        input.videoPath,
        input.sort ?? 0,
        input.groupName ?? '',
        input.courseId ?? null,
        id,
      ],
    );
  }

  delete(id: number): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM lessons WHERE id = ?', [id]);
      this.db.run('DELETE FROM lesson_progress WHERE lesson_id = ?', [id]);
    });
  }

  /**
   * 批量改绑归属：把这些课时一次性挂到目标课程（null = 未归类）下，
   * 可选同时统一章节名（groupName 为 undefined 时保留各自原章节）。
   * 返回实际更新的条数（不存在的 id 会被忽略）。
   */
  batchAssign(ids: number[], courseId: number | null, groupName?: string): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const existing = this.db
      .all<{ id: number }>(`SELECT id FROM lessons WHERE id IN (${placeholders})`, ids)
      .map((r) => r.id);
    if (existing.length === 0) return 0;

    const existingPlaceholders = existing.map(() => '?').join(',');
    let changes = 0;
    this.db.transaction(() => {
      const info =
        groupName === undefined
          ? this.db.run(`UPDATE lessons SET course_id = ? WHERE id IN (${existingPlaceholders})`, [
              courseId,
              ...existing,
            ])
          : this.db.run(`UPDATE lessons SET course_id = ?, group_name = ? WHERE id IN (${existingPlaceholders})`, [
              courseId,
              groupName,
              ...existing,
            ]);
      changes = info.changes;
    });
    return changes;
  }

  /**
   * 课程文件夹下的课时：media_root 相同，且 video_path 落在 folderPath 前缀内。
   * prefix 为空串表示整个媒体根。用 substr 比较而不是 LIKE，
   * 避免文件夹名里的 `%` `_` 被当成通配符。
   */
  listByRootPrefix(rootId: string, prefix: string): Lesson[] {
    if (prefix === '') {
      return this.db.all<Lesson>('SELECT * FROM lessons WHERE media_root = ? ORDER BY id', [rootId]);
    }
    const like = `${prefix}/`;
    return this.db.all<Lesson>(
      'SELECT * FROM lessons WHERE media_root = ? AND substr(video_path, 1, ?) = ? ORDER BY id',
      [rootId, like.length, like],
    );
  }

  /** 按给定顺序重写 sort（0..n-1），用于课程内的拖拽排序 */
  reorder(ids: number[]): number {
    if (ids.length === 0) return 0;
    let changes = 0;
    this.db.transaction(() => {
      ids.forEach((id, index) => {
        changes += this.db.run('UPDATE lessons SET sort = ? WHERE id = ?', [index, id]).changes;
      });
    });
    return changes;
  }

  /** 课程内现有最大 sort（新建课时默认排在最后） */
  maxSort(courseId: number): number {
    const row = this.db.get<{ m: number | null }>('SELECT MAX(sort) AS m FROM lessons WHERE course_id = ?', [courseId]);
    return row?.m ?? 0;
  }

  countByCourse(courseId: number): number {
    return this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM lessons WHERE course_id = ?', [courseId])?.c ?? 0;
  }

  /** 同步文件夹扫描结果：章节名跟随目录，来源标记为 folder */
  markFromFolder(id: number, groupName: string): void {
    this.db.run("UPDATE lessons SET group_name = ?, source = 'folder' WHERE id = ?", [groupName, id]);
  }

  /** 批量删除课时（连带进度），返回实际删除条数 */
  deleteMany(ids: number[]): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    let removed = 0;
    this.db.transaction(() => {
      removed = this.db.run(`DELETE FROM lessons WHERE id IN (${placeholders})`, ids).changes;
      this.db.run(`DELETE FROM lesson_progress WHERE lesson_id IN (${placeholders})`, ids);
    });
    return removed;
  }

  withProgress(lessons: Lesson[], userId: number): LessonWithProgress[] {
    if (lessons.length === 0) return [];
    const placeholders = lessons.map(() => '?').join(',');
    const rows = this.db.all<{
      lesson_id: number;
      position: number;
      duration: number;
      finished: 0 | 1;
      quiz_done: 0 | 1;
      quiz_best: number;
    }>(
      `SELECT lesson_id, position, duration, finished, quiz_done, quiz_best
       FROM lesson_progress WHERE user_id = ? AND lesson_id IN (${placeholders})`,
      [userId, ...lessons.map((l) => l.id)],
    );
    const map = new Map(rows.map((r) => [r.lesson_id, r]));
    return lessons.map((l) => {
      const p = map.get(l.id);
      return {
        ...l,
        progress: p
          ? {
              position: p.position,
              duration: p.duration,
              finished: p.finished,
              quiz_done: p.quiz_done,
              quiz_best: p.quiz_best,
            }
          : null,
      };
    });
  }

  // ---- 知识点 ----
  listKnowledge(lessonId: number): Knowledge[] {
    return this.db.all<Knowledge>('SELECT * FROM knowledge WHERE lesson_id = ? ORDER BY sort, id', [lessonId]);
  }

  findKnowledge(id: number): Knowledge | undefined {
    return this.db.get<Knowledge>('SELECT * FROM knowledge WHERE id = ?', [id]);
  }

  createKnowledge(input: {
    lessonId: number;
    title: string;
    kind: Knowledge['kind'];
    fileName?: string;
    filePath?: string;
    content?: string;
    url?: string;
  }): number {
    return this.db.run(
      'INSERT INTO knowledge (lesson_id, title, kind, file_name, file_path, content, url) VALUES (?,?,?,?,?,?,?)',
      [
        input.lessonId,
        input.title,
        input.kind,
        input.fileName ?? '',
        input.filePath ?? '',
        input.content ?? '',
        input.url ?? '',
      ],
    ).lastInsertRowid;
  }

  deleteKnowledge(id: number): void {
    this.db.run('DELETE FROM knowledge WHERE id = ?', [id]);
  }

  /** 更新知识点标题与正文/链接（只更新传入的字段） */
  updateKnowledge(id: number, patch: { title: string; content?: string; url?: string }): void {
    if (patch.url !== undefined) {
      this.db.run('UPDATE knowledge SET title = ?, url = ? WHERE id = ?', [patch.title, patch.url, id]);
      return;
    }
    this.db.run('UPDATE knowledge SET title = ?, content = ? WHERE id = ?', [patch.title, patch.content ?? '', id]);
  }
}
