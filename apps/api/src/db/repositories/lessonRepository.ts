/**
 * 课时（lessons）与知识点（knowledge）仓储。
 *
 * P0 阶段 2（lessons/courses 域）：读写统一走 `AsyncDb`（sqlite / PG 双栈），
 * 自增改 `INSERT … RETURNING id`，多语句改 `AsyncDb.transaction(async tx)`。
 */
import type { Lesson, LessonSource } from '@microclass/shared';
import type { Db } from '../client.js';
import { createSqliteAsyncDb, type AsyncDb } from '../async.js';
import { naturalNumberPrefix } from '../sql.js';

/**
 * 课时查询：标题按 SQLite 的自然序排列（`2.` 排在 `10.` 前面），
 * 与轻课堂的 sort_order 思路一致 —— 素材文件名普遍带序号，字典序会明显错乱。
 *
 * P0 阶段 2（方言 #16）：`CAST(title AS INTEGER)` 在 SQLite 里「非数字前缀 → 0」，
 * 但 PostgreSQL 遇到「第X课」会直接报错，所以排序表达式必须按驱动生成
 * （`db/sql.ts` 的 `naturalNumberPrefix`：sqlite 原样 CAST / pg 取前导数字再 COALESCE 0）。
 */
const LESSON_SELECT = `
  SELECT * FROM lessons
`;

function naturalOrder(driver: AsyncDb['driver']): string {
  return `sort, ${naturalNumberPrefix('title', driver)}, title, id`;
}

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
  /** 已迁移域：读写都走 asyncDb；测试没注入时退回 sqlite 包装（与 BankRepository 一致） */
  constructor(
    private readonly db: Db,
    private readonly asyncDb?: AsyncDb,
  ) {}

  private adb(): AsyncDb {
    return this.asyncDb ?? createSqliteAsyncDb(this.db);
  }

  async listAll(): Promise<Lesson[]> {
    return this.adb().all<Lesson>(`${LESSON_SELECT} ORDER BY ${naturalOrder(this.adb().driver)}`);
  }

  async listByCourse(courseId: number | null): Promise<Lesson[]> {
    if (courseId === null) {
      return this.adb().all<Lesson>(
        `${LESSON_SELECT} WHERE course_id IS NULL ORDER BY ${naturalOrder(this.adb().driver)}`,
      );
    }
    return this.adb().all<Lesson>(`${LESSON_SELECT} WHERE course_id = ? ORDER BY ${naturalOrder(this.adb().driver)}`, [
      courseId,
    ]);
  }

  async findById(id: number): Promise<Lesson | undefined> {
    return this.adb().get<Lesson>(`${LESSON_SELECT} WHERE id = ?`, [id]);
  }

  /** 需要抽取元数据的本地视频（未抽过或抽取失败） */
  async listPendingProbe(limit = 20): Promise<Lesson[]> {
    return this.adb().all<Lesson>(
      `${LESSON_SELECT} WHERE video_kind = 'local' AND probed_at IS NULL ORDER BY id LIMIT ?`,
      [limit],
    );
  }

  /** 还有多少个课时没抽过元数据（给前端/脚本显示真实剩余量） */
  async countPendingProbe(): Promise<number> {
    const row = await this.adb().get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM lessons WHERE video_kind = 'local' AND probed_at IS NULL",
    );
    return row?.c ?? 0;
  }

  async setProbeResult(
    id: number,
    input: { duration: number | null; mediaType: string; coverPath: string },
  ): Promise<void> {
    await this.adb().run(
      "UPDATE lessons SET duration = ?, media_type = ?, cover_path = CASE WHEN ? = '' THEN cover_path ELSE ? END, probed_at = ? WHERE id = ?",
      [input.duration, input.mediaType, input.coverPath, input.coverPath, Date.now(), id],
    );
  }

  async findLocalByMediaPath(mediaRoot: string, videoPath: string): Promise<Lesson | undefined> {
    return this.adb().get<Lesson>('SELECT * FROM lessons WHERE media_root = ? AND video_path = ?', [
      mediaRoot,
      videoPath,
    ]);
  }

  /** 新建课时：`RETURNING id`（不依赖 lastInsertRowid，sqlite / PG 同一句 SQL） */
  async create(input: LessonInput): Promise<number> {
    const row = await this.adb().get<{ id: number }>(
      `INSERT INTO lessons (title, description, video_kind, media_root, video_path, sort, group_name, course_id, source)
       VALUES (?,?,?,?,?,?,?,?,?) RETURNING id`,
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
    );
    if (!row) throw new Error('创建课时后未返回 id');
    return row.id;
  }

  async update(id: number, input: LessonInput): Promise<void> {
    await this.adb().run(
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

  /** 删除课时（连带进度）：同事务，任一失败整批回滚 */
  async delete(id: number): Promise<void> {
    await this.adb().transaction(async (tx) => {
      await tx.run('DELETE FROM lessons WHERE id = ?', [id]);
      await tx.run('DELETE FROM lesson_progress WHERE lesson_id = ?', [id]);
    });
  }

  /**
   * 批量改绑归属：把这些课时一次性挂到目标课程（null = 未归类）下，
   * 可选同时统一章节名（groupName 为 undefined 时保留各自原章节）。
   * 返回实际更新的条数（不存在的 id 会被忽略）。
   */
  async batchAssign(ids: number[], courseId: number | null, groupName?: string): Promise<number> {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const existing = (
      await this.adb().all<{ id: number }>(`SELECT id FROM lessons WHERE id IN (${placeholders})`, ids)
    ).map((r) => r.id);
    if (existing.length === 0) return 0;

    const existingPlaceholders = existing.map(() => '?').join(',');
    return this.adb().transaction(async (tx) => {
      const info =
        groupName === undefined
          ? await tx.run(`UPDATE lessons SET course_id = ? WHERE id IN (${existingPlaceholders})`, [
              courseId,
              ...existing,
            ])
          : await tx.run(`UPDATE lessons SET course_id = ?, group_name = ? WHERE id IN (${existingPlaceholders})`, [
              courseId,
              groupName,
              ...existing,
            ]);
      return info.changes;
    });
  }

  /**
   * 课程文件夹下的课时：media_root 相同，且 video_path 落在 folderPath 前缀内。
   * prefix 为空串表示整个媒体根。用 substr 比较而不是 LIKE，
   * 避免文件夹名里的 `%` `_` 被当成通配符。
   */
  async listByRootPrefix(rootId: string, prefix: string): Promise<Lesson[]> {
    if (prefix === '') {
      return this.adb().all<Lesson>('SELECT * FROM lessons WHERE media_root = ? ORDER BY id', [rootId]);
    }
    const like = `${prefix}/`;
    return this.adb().all<Lesson>(
      'SELECT * FROM lessons WHERE media_root = ? AND substr(video_path, 1, ?) = ? ORDER BY id',
      [rootId, like.length, like],
    );
  }

  /** 按给定顺序重写 sort（0..n-1），用于课程内的拖拽排序 */
  async reorder(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.adb().transaction(async (tx) => {
      let changes = 0;
      for (const [index, id] of ids.entries()) {
        changes += (await tx.run('UPDATE lessons SET sort = ? WHERE id = ?', [index, id])).changes;
      }
      return changes;
    });
  }

  /** 课程内现有最大 sort（新建课时默认排在最后） */
  async maxSort(courseId: number): Promise<number> {
    const row = await this.adb().get<{ m: number | null }>('SELECT MAX(sort) AS m FROM lessons WHERE course_id = ?', [
      courseId,
    ]);
    return row?.m ?? 0;
  }

  async countByCourse(courseId: number): Promise<number> {
    const row = await this.adb().get<{ c: number }>('SELECT COUNT(*) AS c FROM lessons WHERE course_id = ?', [
      courseId,
    ]);
    return row?.c ?? 0;
  }

  /** 同步文件夹扫描结果：章节名跟随目录，来源标记为 folder */
  async markFromFolder(id: number, groupName: string): Promise<void> {
    await this.adb().run("UPDATE lessons SET group_name = ?, source = 'folder' WHERE id = ?", [groupName, id]);
  }

  /** 批量删除课时（连带进度），返回实际删除条数；同事务 */
  async deleteMany(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    return this.adb().transaction(async (tx) => {
      const removed = (await tx.run(`DELETE FROM lessons WHERE id IN (${placeholders})`, ids)).changes;
      await tx.run(`DELETE FROM lesson_progress WHERE lesson_id IN (${placeholders})`, ids);
      return removed;
    });
  }

  async withProgress(lessons: Lesson[], userId: number): Promise<LessonWithProgress[]> {
    if (lessons.length === 0) return [];
    const placeholders = lessons.map(() => '?').join(',');
    const rows = await this.adb().all<{
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
}
