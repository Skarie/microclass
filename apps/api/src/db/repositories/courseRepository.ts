/**
 * 课程与分类仓储。
 */
import type { Category, Course } from '@microclass/shared';
import type { Db } from '../client.js';

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
  constructor(private readonly db: Db) {}

  listAll(): Course[] {
    return this.db.all<Course>('SELECT * FROM courses ORDER BY sort, id');
  }

  listPublished(): Course[] {
    return this.db.all<Course>('SELECT * FROM courses WHERE published = 1 ORDER BY sort, id');
  }

  findById(id: number): Course | undefined {
    return this.db.get<Course>('SELECT * FROM courses WHERE id = ?', [id]);
  }

  create(input: CourseInput): number {
    const info = this.db.run(
      'INSERT INTO courses (name, description, sort, category_id, published) VALUES (?,?,?,?,?)',
      [
        input.name,
        input.description ?? '',
        input.sort ?? 0,
        input.categoryId ?? null,
        input.published === false ? 0 : 1,
      ],
    );
    return info.lastInsertRowid;
  }

  update(id: number, input: CourseInput): void {
    this.db.run('UPDATE courses SET name = ?, description = ?, sort = ?, category_id = ?, published = ? WHERE id = ?', [
      input.name,
      input.description ?? '',
      input.sort ?? 0,
      input.categoryId ?? null,
      input.published === false ? 0 : 1,
      id,
    ]);
  }

  /** 删除课程：课时回到“未归类”，不级联删数据 */
  delete(id: number): void {
    this.db.transaction(() => {
      this.db.run('UPDATE lessons SET course_id = NULL WHERE course_id = ?', [id]);
      this.db.run('DELETE FROM courses WHERE id = ?', [id]);
    });
  }

  setCover(id: number, coverRelPath: string): void {
    this.db.run('UPDATE courses SET cover = ? WHERE id = ?', [coverRelPath, id]);
  }

  /**
   * 绑定 / 解绑课程文件夹（rootId 为 null 即解绑）。
   * 绑定后课程课时管理页的「扫描」就以这个目录为准。
   */
  setFolder(id: number, rootId: string | null, folderPath: string | null): void {
    this.db.run('UPDATE courses SET folder_root_id = ?, folder_path = ?, last_scan_at = NULL WHERE id = ?', [
      rootId,
      folderPath,
      id,
    ]);
  }

  /** 记录扫描时间（Unix 秒） */
  markScanned(id: number): void {
    this.db.run('UPDATE courses SET last_scan_at = ? WHERE id = ?', [Math.floor(Date.now() / 1000), id]);
  }

  /** 找出已经绑定到该文件夹的其他课程（避免同一目录被两门课程抢占） */
  findFolderOwner(rootId: string, folderPath: string, excludeCourseId: number): Course | undefined {
    return this.db.get<Course>(
      'SELECT * FROM courses WHERE folder_root_id = ? AND IFNULL(folder_path, ?) = ? AND id <> ? LIMIT 1',
      [rootId, folderPath, folderPath, excludeCourseId],
    );
  }

  /** 课程 + 分类名 + 课时统计 + 当前用户进度/收藏聚合 */
  aggregate(options: { forUserId: number; includeDrafts: boolean; onlyPublished?: boolean }): CourseAggregate[] {
    const rows = options.includeDrafts ? this.listAll() : this.listPublished();
    const lessons = this.db.all<{ id: number; course_id: number | null }>('SELECT id, course_id FROM lessons');
    const progress = this.db.all<{ lesson_id: number; finished: number; quiz_done: number }>(
      'SELECT lesson_id, finished, quiz_done FROM lesson_progress WHERE user_id = ?',
      [options.forUserId],
    );
    const pmap = new Map(progress.map((p) => [p.lesson_id, p]));
    const favs = new Set(
      this.db
        .all<{ course_id: number }>('SELECT course_id FROM favorites WHERE user_id = ?', [options.forUserId])
        .map((f) => f.course_id),
    );
    const cats = new Map(this.listCategories().map((c) => [c.id, c.name]));

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
  orphanAggregate(forUserId: number): { total: number; finished: number; quiz: number } {
    const rows = this.db.all<{ id: number }>('SELECT id FROM lessons WHERE course_id IS NULL');
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return { total: 0, finished: 0, quiz: 0 };
    const placeholders = ids.map(() => '?').join(',');
    const p = this.db.get<{ finished: number; quiz: number }>(
      `SELECT SUM(CASE WHEN finished = 1 THEN 1 ELSE 0 END) AS finished,
              SUM(CASE WHEN quiz_done = 1 THEN 1 ELSE 0 END) AS quiz
       FROM lesson_progress WHERE user_id = ? AND lesson_id IN (${placeholders})`,
      [forUserId, ...ids],
    );
    return { total: ids.length, finished: p?.finished ?? 0, quiz: p?.quiz ?? 0 };
  }

  toggleFavorite(userId: number, courseId: number): boolean {
    const exists = this.db.get('SELECT 1 AS x FROM favorites WHERE user_id = ? AND course_id = ?', [userId, courseId]);
    if (exists) {
      this.db.run('DELETE FROM favorites WHERE user_id = ? AND course_id = ?', [userId, courseId]);
      return false;
    }
    this.db.run('INSERT INTO favorites (user_id, course_id) VALUES (?,?)', [userId, courseId]);
    return true;
  }

  isFavorite(userId: number, courseId: number): boolean {
    return !!this.db.get('SELECT 1 AS x FROM favorites WHERE user_id = ? AND course_id = ?', [userId, courseId]);
  }

  // ---- 分类 ----
  listCategories(): Category[] {
    return this.db.all<Category>('SELECT * FROM categories ORDER BY sort, id');
  }

  createCategory(name: string): number {
    return this.db.run('INSERT INTO categories (name) VALUES (?)', [name]).lastInsertRowid;
  }

  findCategoryByName(name: string): Category | undefined {
    return this.db.get<Category>('SELECT * FROM categories WHERE name = ?', [name]);
  }

  deleteCategory(id: number): void {
    this.db.transaction(() => {
      this.db.run('UPDATE courses SET category_id = NULL WHERE category_id = ?', [id]);
      this.db.run('DELETE FROM categories WHERE id = ?', [id]);
    });
  }
}
