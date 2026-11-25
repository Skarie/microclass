/**
 * 站内公告仓储（迁移 0028）：公开列表、管理端分页、增删改。
 *
 * 时间字段沿用 TEXT（datetime('now')，UTC），与 practice_links 等既有表一致；
 * `pinned` / `published` 在库里是 0/1 整数，服务层再转 boolean。
 *
 * P0 阶段 2：改为走 `AsyncDb`（sqlite / pg 双栈），方法全部异步。
 * `create` 用 `INSERT ... RETURNING id`（SQLite 3.35+ 与 PG 都支持），
 * 这样不必依赖各驱动不同的 lastInsertRowid。
 */
import type { AsyncDb } from '../async.js';

export type AnnouncementLevel = 'info' | 'warning' | 'danger';

export interface AnnouncementRow {
  id: number;
  title: string;
  body: string;
  level: AnnouncementLevel;
  pinned: number;
  published: number;
  created_at: string;
  created_by: number | null;
}

export interface AnnouncementWrite {
  title: string;
  body: string;
  level: AnnouncementLevel;
  pinned: boolean;
  published: boolean;
  createdBy: number | null;
}

const COLUMNS = 'id, title, body, level, pinned, published, created_at, created_by';

export class AnnouncementRepository {
  constructor(private readonly db: AsyncDb) {}

  /** 公开列表：只出已发布；置顶优先，同状态按时间倒序（id 兜底同一秒） */
  async listPublished(limit: number): Promise<AnnouncementRow[]> {
    return this.db.all<AnnouncementRow>(
      `SELECT ${COLUMNS} FROM announcements
       WHERE published = 1
       ORDER BY pinned DESC, created_at DESC, id DESC
       LIMIT ?`,
      [limit],
    );
  }

  /** 管理端列表：草稿与已发布都返回，最新在前；limit=null 表示不分页（全部） */
  async listAll(limit: number | null, offset: number): Promise<AnnouncementRow[]> {
    const paging = limit === null ? '' : ' LIMIT ? OFFSET ?';
    return this.db.all<AnnouncementRow>(
      `SELECT ${COLUMNS} FROM announcements
       ORDER BY pinned DESC, created_at DESC, id DESC${paging}`,
      limit === null ? [] : [limit, offset],
    );
  }

  async countAll(): Promise<number> {
    const row = await this.db.get<{ c: number | string }>('SELECT COUNT(*) AS c FROM announcements');
    return Number(row?.c ?? 0);
  }

  async findById(id: number): Promise<AnnouncementRow | undefined> {
    return this.db.get<AnnouncementRow>(`SELECT ${COLUMNS} FROM announcements WHERE id = ?`, [id]);
  }

  async create(input: AnnouncementWrite): Promise<number> {
    const row = await this.db.get<{ id: number | string }>(
      `INSERT INTO announcements (title, body, level, pinned, published, created_by)
       VALUES (?,?,?,?,?,?)
       RETURNING id`,
      [input.title, input.body, input.level, input.pinned ? 1 : 0, input.published ? 1 : 0, input.createdBy],
    );
    return Number(row?.id ?? 0);
  }

  async update(id: number, input: AnnouncementWrite): Promise<number> {
    const result = await this.db.run(
      'UPDATE announcements SET title = ?, body = ?, level = ?, pinned = ?, published = ? WHERE id = ?',
      [input.title, input.body, input.level, input.pinned ? 1 : 0, input.published ? 1 : 0, id],
    );
    return result.changes;
  }

  async remove(id: number): Promise<number> {
    const result = await this.db.run('DELETE FROM announcements WHERE id = ?', [id]);
    return result.changes;
  }
}
