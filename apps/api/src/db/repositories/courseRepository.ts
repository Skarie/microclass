/**
 * 课程与分类仓储。
 *
 * P0 阶段 2（lessons/courses 域）：读写统一走 `AsyncDb`（sqlite / PG 双栈），
 * 自增改 `INSERT … RETURNING id`，多语句改 `AsyncDb.transaction(async tx)`。
 */
import type { Category, Course } from '@microclass/shared';
import type { Db } from '../client.js';
import { createSqliteAsyncDb, type AsyncDb } from '../async.js';

export interface CourseAggregate extends Course {
  category_name: string;
  total: number;
  finished: number;
  quiz: number;
  fav: boolean;
}

export interface CourseInput {
  name: string;
  description?: string;
  sort?: number;
  categoryId?: number | null;
  published?: boolean;
}

export class CourseRepository {
  /** 已迁移域：读写都走 asyncDb；测试没注入时退回 sqlite 包装（与 BankRepository 一致） */
  constructor(
    private readonly db: Db,
    private readonly asyncDb?: AsyncDb,
  ) {}

  private adb(): AsyncDb {
    return this.asyncDb ?? createSqliteAsyncDb(this.db);
  }

  async listAll(): Promise<Course[]> {
    return this.adb().all<Course>('SELECT * FROM courses ORDER BY sort, id');
  }

  async listPublished(): Promise<Course[]> {
    return this.adb().all<Course>('SELECT * FROM courses WHERE published = 1 ORDER BY sort, id');
  }

  async findById(id: number): Promise<Course | undefined> {
    return this.adb().get<Course>('SELECT * FROM courses WHERE id = ?', [id]);
  }

  /** 新建课程：`RETURNING id`（不依赖 lastInsertRowid，sqlite / PG 同一句 SQL） */
  async create(input: CourseInput): Promise<number> {
    const row = await this.adb().get<{ id: number }>(
      'INSERT INTO courses (name, description, sort, category_id, published) VALUES (?,?,?,?,?) RETURNING id',
      [
        input.name,
        input.description ?? '',
        input.sort ?? 0,
        input.categoryId ?? null,
        input.published === false ? 0 : 1,
      ],
    );
    if (!row) throw new Error('创建课程后未返回 id');
    return row.id;
  }

  async update(id: number, input: CourseInput): Promise<void> {
    await this.adb().run(
      'UPDATE courses SET name = ?, description = ?, sort = ?, category_id = ?, published = ? WHERE id = ?',
      [
        input.name,
        input.description ?? '',
        input.sort ?? 0,
        input.categoryId ?? null,
        input.published === false ? 0 : 1,
        id,
      ],
    );
  }

  /** 删除课程：课时回到“未归类”，不级联删数据；同事务 */
  async delete(id: number): Promise<void> {
    await this.adb().transaction(async (tx) => {
      await tx.run('UPDATE lessons SET course_id = NULL WHERE course_id = ?', [id]);
      await tx.run('DELETE FROM courses WHERE id = ?', [id]);
    });
  }

  async setCover(id: number, coverRelPath: string): Promise<void> {
    await this.adb().run('UPDATE courses SET cover = ? WHERE id = ?', [coverRelPath, id]);
  }

  /**
   * 绑定 / 解绑课程文件夹（rootId 为 null 即解绑）。
   * 绑定后课程课时管理页的「扫描」就以这个目录为准。
   */
  async setFolder(id: number, rootId: string | null, folderPath: string | null): Promise<void> {
    await this.adb().run('UPDATE courses SET folder_root_id = ?, folder_path = ?, last_scan_at = NULL WHERE id = ?', [
      rootId,
      folderPath,
      id,
    ]);
  }

  /** 记录扫描时间（Unix 秒） */
  async markScanned(id: number): Promise<void> {
    await this.adb().run('UPDATE courses SET last_scan_at = ? WHERE id = ?', [Math.floor(Date.now() / 1000), id]);
  }

  /** 找出已经绑定到该文件夹的其他课程（避免同一目录被两门课程抢占） */
  async findFolderOwner(rootId: string, folderPath: string, excludeCourseId: number): Promise<Course | undefined> {
    // COALESCE 而不是 IFNULL：PostgreSQL 没有 IFNULL，两库都认 COALESCE
    return this.adb().get<Course>(
      'SELECT * FROM courses WHERE folder_root_id = ? AND COALESCE(folder_path, ?) = ? AND id <> ? LIMIT 1',
      [rootId, folderPath, folderPath, excludeCourseId],
    );
  }

  /** 课程 + 分类名 + 课时统计 + 当前用户进度/收藏聚合 */
  async aggregate(options: {
    forUserId: number;
    includeDrafts: boolean;
    onlyPublished?: boolean;
  }): Promise<CourseAggregate[]> {
    const rows = options.includeDrafts ? await this.listAll() : await this.listPublished();
    const lessons = await this.adb().all<{ id: number; course_id: number | null }>('SELECT id, course_id FROM lessons');
    const progress = await this.adb().all<{ lesson_id: number; finished: number; quiz_done: number }>(
      'SELECT lesson_id, finished, quiz_done FROM lesson_progress WHERE user_id = ?',
      [options.forUserId],
    );
    const pmap = new Map(progress.map((p) => [p.lesson_id, p]));
    const favs = new Set(
      (
        await this.adb().all<{ course_id: number }>('SELECT course_id FROM favorites WHERE user_id = ?', [
          options.forUserId,
        ])
      ).map((f) => f.course_id),
    );
    const cats = new Map((await this.listCategories()).map((c) => [c.id, c.name]));

    const byCourse = new Map<number, number[]>();
    for (const l of lessons) {
      if (l.course_id === null) continue;
      const arr = byCourse.get(l.course_id) ?? [];
      arr.push(l.id);
      byCourse.set(l.course_id, arr);
    }

    return rows.map((c) => {
      const ids = byCourse.get(c.id) ?? [];
      let finished = 0;
      let quiz = 0;
      for (const id of ids) {
        const p = pmap.get(id);
        if (!p) continue;
        if (p.finished === 1) finished++;
        if (p.quiz_done === 1) quiz++;
      }
      return {
        ...c,
        category_name: c.category_id === null ? '' : (cats.get(c.category_id) ?? ''),
        total: ids.length,
        finished,
        quiz,
        fav: favs.has(c.id),
      };
    });
  }

  /** 未归类课时聚合（course_id IS NULL） */
  async orphanAggregate(forUserId: number): Promise<{ total: number; finished: number; quiz: number }> {
    const rows = await this.adb().all<{ id: number }>('SELECT id FROM lessons WHERE course_id IS NULL');
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return { total: 0, finished: 0, quiz: 0 };
    const placeholders = ids.map(() => '?').join(',');
    const p = await this.adb().get<{ finished: number; quiz: number }>(
      `SELECT SUM(CASE WHEN finished = 1 THEN 1 ELSE 0 END) AS finished,
              SUM(CASE WHEN quiz_done = 1 THEN 1 ELSE 0 END) AS quiz
       FROM lesson_progress WHERE user_id = ? AND lesson_id IN (${placeholders})`,
      [forUserId, ...ids],
    );
    return { total: ids.length, finished: p?.finished ?? 0, quiz: p?.quiz ?? 0 };
  }

  /** 收藏开关：先查再写放在同一事务里，避免并发下重复插入/删空 */
  async toggleFavorite(userId: number, courseId: number): Promise<boolean> {
    return this.adb().transaction(async (tx) => {
      const exists = await tx.get('SELECT 1 AS x FROM favorites WHERE user_id = ? AND course_id = ?', [
        userId,
        courseId,
      ]);
      if (exists) {
        await tx.run('DELETE FROM favorites WHERE user_id = ? AND course_id = ?', [userId, courseId]);
        return false;
      }
      await tx.run('INSERT INTO favorites (user_id, course_id) VALUES (?,?)', [userId, courseId]);
      return true;
    });
  }

  async isFavorite(userId: number, courseId: number): Promise<boolean> {
    return !!(await this.adb().get('SELECT 1 AS x FROM favorites WHERE user_id = ? AND course_id = ?', [
      userId,
      courseId,
    ]));
  }

  // ---- 分类 ----
  async listCategories(): Promise<Category[]> {
    return this.adb().all<Category>('SELECT * FROM categories ORDER BY sort, id');
  }

  async createCategory(name: string): Promise<number> {
    const row = await this.adb().get<{ id: number }>('INSERT INTO categories (name) VALUES (?) RETURNING id', [name]);
    if (!row) throw new Error('创建分类后未返回 id');
    return row.id;
  }

  async findCategoryByName(name: string): Promise<Category | undefined> {
    return this.adb().get<Category>('SELECT * FROM categories WHERE name = ?', [name]);
  }

  async deleteCategory(id: number): Promise<void> {
    await this.adb().transaction(async (tx) => {
      await tx.run('UPDATE courses SET category_id = NULL WHERE category_id = ?', [id]);
      await tx.run('DELETE FROM categories WHERE id = ?', [id]);
    });
  }
}
