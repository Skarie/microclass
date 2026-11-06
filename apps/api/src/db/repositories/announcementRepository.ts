/**
 * 站内公告仓储（迁移 0028）：公开列表、管理端分页、增删改。
 *
 * 时间字段沿用 TEXT（datetime('now')，UTC），与 practice_links 等既有表一致；
 * `pinned` / `published` 在库里是 0/1 整数，服务层再转 boolean。
 */
import type { Db } from '../client.js';

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
  constructor(private readonly db: Db) {}

  /** 公开列表：只出已发布；置顶优先，同状态按时间倒序（id 兜底同一秒） */
  listPublished(limit: number): AnnouncementRow[] {
    return this.db.all<AnnouncementRow>(
      `SELECT ${COLUMNS} FROM announcements
       WHERE published = 1
       ORDER BY pinned DESC, created_at DESC, id DESC
       LIMIT ?`,
      [limit],
    );
  }

  /** 管理端列表：草稿与已发布都返回，最新在前；limit=null 表示不分页（全部） */
  listAll(limit: number | null, offset: number): AnnouncementRow[] {
    const paging = limit === null ? '' : ' LIMIT ? OFFSET ?';
    return this.db.all<AnnouncementRow>(
      `SELECT ${COLUMNS} FROM announcements
       ORDER BY pinned DESC, created_at DESC, id DESC${paging}`,
      limit === null ? [] : [limit, offset],
    );
  }

  countAll(): number {
    const row = this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM announcements');
    return Number(row?.c ?? 0);
  }

  findById(id: number): AnnouncementRow | undefined {
    return this.db.get<AnnouncementRow>(`SELECT ${COLUMNS} FROM announcements WHERE id = ?`, [id]);
  }

  create(input: AnnouncementWrite): number {
    return this.db.run(
      `INSERT INTO announcements (title, body, level, pinned, published, created_by)
       VALUES (?,?,?,?,?,?)`,
      [input.title, input.body, input.level, input.pinned ? 1 : 0, input.published ? 1 : 0, input.createdBy],
    ).lastInsertRowid;
  }

  update(id: number, input: AnnouncementWrite): number {
    return this.db.run(
      'UPDATE announcements SET title = ?, body = ?, level = ?, pinned = ?, published = ? WHERE id = ?',
      [input.title, input.body, input.level, input.pinned ? 1 : 0, input.published ? 1 : 0, id],
    ).changes;
  }

  remove(id: number): number {
    return this.db.run('DELETE FROM announcements WHERE id = ?', [id]).changes;
  }
}
