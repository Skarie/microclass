/**
 * 站内公告服务：入参校验、DTO 组装、写审计。
 *
 * 读接口登录即可（公开列表只出 published=1）；写接口仅管理员（路由层守卫 + 这里兜底）。
 * 时间字段沿用库里 TEXT（UTC），与实践关联等既有接口保持一致，不额外做时区转换。
 */
import { AppError, type User } from '@microclass/shared';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type {
  AnnouncementLevel,
  AnnouncementRepository,
  AnnouncementRow,
  AnnouncementWrite,
} from '../db/repositories/announcementRepository.js';

const LEVELS: readonly AnnouncementLevel[] = ['info', 'warning', 'danger'];
const TITLE_MAX = 200;
const BODY_MAX = 5000;
const PUBLIC_LIMIT_MAX = 50;
const ADMIN_LIMIT_MAX = 200;
const OFFSET_MAX = 1_000_000;

/** 管理端请求体：PUT 为部分更新，POST 只要求 title */
export interface AnnouncementInput {
  title?: unknown;
  body?: unknown;
  level?: unknown;
  pinned?: unknown;
  published?: unknown;
}

export interface PublicAnnouncement {
  id: number;
  title: string;
  body: string;
  level: AnnouncementLevel;
  pinned: boolean;
  createdAt: string;
}

export type AdminAnnouncement = PublicAnnouncement & { published: boolean; createdBy: number | null };

export interface AdminAnnouncementPage {
  announcements: AdminAnnouncement[];
  total: number;
  /** null = 未分页（管理端不带 limit 时返回全部） */
  limit: number | null;
  offset: number;
}

function parseTitle(raw: unknown): string {
  if (typeof raw !== 'string') throw AppError.badRequest('title 必须是字符串');
  const title = raw.trim();
  if (title.length === 0 || title.length > TITLE_MAX) {
    throw AppError.badRequest(`title 长度必须在 1~${TITLE_MAX} 之间`);
  }
  return title;
}

function parseBody(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw AppError.badRequest('body 必须是字符串');
  if (raw.length > BODY_MAX) throw AppError.badRequest(`body 不能超过 ${BODY_MAX} 字符`);
  return raw;
}

function parseLevel(raw: unknown): AnnouncementLevel {
  if (raw === undefined || raw === null) return 'info';
  if (typeof raw !== 'string') throw AppError.badRequest('level 必须是字符串');
  const level = LEVELS.find((item) => item === raw);
  if (!level) throw AppError.badRequest('level 只能是 info / warning / danger');
  return level;
}

function parseFlag(raw: unknown, label: string, fallback: boolean): boolean {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== 'boolean') throw AppError.badRequest(`${label} 必须是布尔值`);
  return raw;
}

/** 查询串参数：严格非负整数，越界直接 400（不做静默截断，避免前端以为生效了） */
function intParam(raw: unknown, label: string, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw === '') return fallback;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw AppError.badRequest(`${label} 必须是非负整数`);
  const value = Number(raw);
  if (value < min || value > max) throw AppError.badRequest(`${label} 必须在 ${min}~${max} 之间`);
  return value;
}

function toPublic(row: AnnouncementRow): PublicAnnouncement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    level: row.level,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
  };
}

function toAdmin(row: AnnouncementRow): AdminAnnouncement {
  return { ...toPublic(row), published: row.published === 1, createdBy: row.created_by };
}

function baseOf(row: AnnouncementRow): AnnouncementWrite {
  return {
    title: row.title,
    body: row.body,
    level: row.level,
    pinned: row.pinned === 1,
    published: row.published === 1,
    createdBy: row.created_by,
  };
}

export class AnnouncementService {
  constructor(
    private readonly repo: AnnouncementRepository,
    private readonly audit: AuditRepository,
  ) {}

  listPublic(rawLimit: unknown): PublicAnnouncement[] {
    const limit = intParam(rawLimit, 'limit', 5, 1, PUBLIC_LIMIT_MAX);
    return this.repo.listPublished(limit).map(toPublic);
  }

  listAdmin(rawLimit: unknown, rawOffset: unknown): AdminAnnouncementPage {
    const paginated = rawLimit !== undefined && rawLimit !== '';
    const limit = paginated ? intParam(rawLimit, 'limit', ADMIN_LIMIT_MAX, 1, ADMIN_LIMIT_MAX) : null;
    const offset = limit === null ? 0 : intParam(rawOffset, 'offset', 0, 0, OFFSET_MAX);
    return {
      announcements: this.repo.listAll(limit, offset).map(toAdmin),
      total: this.repo.countAll(),
      limit,
      offset,
    };
  }

  create(actor: User, input: AnnouncementInput): number {
    const write = this.merge(
      input,
      { title: '', body: '', level: 'info', pinned: false, published: true, createdBy: actor.id },
      true,
    );
    const id = this.repo.create(write);
    this.writeAudit(actor, 'announcement.create', id, write);
    return id;
  }

  update(actor: User, id: number, input: AnnouncementInput): void {
    const existing = this.requireRow(id);
    const write = this.merge(input, baseOf(existing));
    this.repo.update(id, write);
    this.writeAudit(actor, 'announcement.update', id, write);
  }

  remove(actor: User, id: number): void {
    const existing = this.requireRow(id);
    this.repo.remove(id);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'announcement.delete',
      targetType: 'announcement',
      targetId: id,
      detail: { title: existing.title },
    });
  }

  private requireRow(id: number): AnnouncementRow {
    const row = this.repo.findById(id);
    if (!row) throw AppError.notFound('公告不存在');
    return row;
  }

  /** 部分更新：未传的字段沿用 base（新建时是默认值，但 title 必填） */
  private merge(input: AnnouncementInput, base: AnnouncementWrite, requireTitle = false): AnnouncementWrite {
    return {
      title: input.title === undefined && !requireTitle ? base.title : parseTitle(input.title),
      body: input.body === undefined ? base.body : parseBody(input.body),
      level: input.level === undefined ? base.level : parseLevel(input.level),
      pinned: parseFlag(input.pinned, 'pinned', base.pinned),
      published: parseFlag(input.published, 'published', base.published),
      createdBy: base.createdBy,
    };
  }

  private writeAudit(actor: User, action: string, id: number, write: AnnouncementWrite): void {
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action,
      targetType: 'announcement',
      targetId: id,
      detail: { title: write.title, level: write.level, pinned: write.pinned, published: write.published },
    });
  }
}
