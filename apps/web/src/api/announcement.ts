/**
 * 公告接口的视图模型。
 *
 * - 学员端：`GET /announcements?limit=5`（登录可读，只返回已发布公告）
 * - 管理端：`/admin/announcements` 的增删改查
 *
 * `createdAt` 是创建时间：后端返回库里 TEXT 列的 **UTC 字符串**（`YYYY-MM-DD HH:mm:ss`）；
 * 也兼容毫秒/秒时间戳（早期接口写法）。解析统一走 utils/announcement 的 toDate()。
 * `level` 决定首页条目的图标与软色底，`pinned` 决定是否显示「置顶」小标签。
 */
export type AnnouncementLevel = 'info' | 'warning' | 'danger';

/** 级别枚举的运行时来源：下拉框与校验都以它为准，避免各处手写字符串 */
export const ANNOUNCEMENT_LEVELS: readonly AnnouncementLevel[] = ['info', 'warning', 'danger'];

export interface Announcement {
  id: number;
  title: string;
  body: string;
  level: AnnouncementLevel;
  pinned: boolean;
  /** UTC 时间字符串（或时间戳，见上） */
  createdAt: string | number;
  /** 仅管理端返回：false 表示草稿（学员端看不到） */
  published?: boolean;
  /** 仅管理端返回：创建人 id */
  createdBy?: number | null;
}

export interface AnnouncementListResponse {
  announcements: Announcement[];
  /** 管理端分页总数 */
  total?: number;
}

/** 新建 / 编辑提交的字段 */
export interface AnnouncementPayload {
  title: string;
  body: string;
  level: AnnouncementLevel;
  pinned: boolean;
  published: boolean;
}
