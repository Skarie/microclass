/**
 * 公告的展示派生值：级别 → 文案/语气/图标、时间解析、相对时间、正文摘要。
 *
 * 纯函数，首页公告条与后台公告管理共用，避免两处各写一套级别映射。
 */
import type { AnnouncementLevel } from '@/api/announcement';
import { ANNOUNCEMENT_LEVELS } from '@/api/announcement';
import type { IconName } from '@/components/icons';

/** Tag 组件支持的语义语气（与公告级别一一对应，不再新增颜色） */
export type LevelTone = 'info' | 'warning' | 'danger';

export interface LevelMeta {
  label: string;
  tone: LevelTone;
  icon: IconName;
}

const LEVEL_META: Record<AnnouncementLevel, LevelMeta> = {
  info: { label: '通知', tone: 'info', icon: 'info' },
  warning: { label: '提醒', tone: 'warning', icon: 'alert' },
  danger: { label: '重要', tone: 'danger', icon: 'shield' },
};

export function levelMeta(level: AnnouncementLevel): LevelMeta {
  return LEVEL_META[level] ?? LEVEL_META.info;
}

/** 后端契约可能给未知级别（未来扩枚举），此时按 info 处理 */
export function isAnnouncementLevel(value: string): value is AnnouncementLevel {
  return (ANNOUNCEMENT_LEVELS as readonly string[]).includes(value);
}

/**
 * 创建时间归一成 Date。
 *
 * 后端 `createdAt` 是库里 TEXT 的 **UTC** 字符串（`2026-11-06 13:00:00`），
 * 直接 `new Date(str)` 会被浏览器按本地时区解释，东亚时区会差 8 小时；
 * 所以正则识别「无时区的日期时间」并补 `Z`。数字按秒/毫秒判断（兼容旧接口）。
 */
export function toDate(at: string | number, now = Date.now()): Date {
  if (typeof at === 'number') return new Date(at < 1e12 ? at * 1000 : at);
  const text = at.trim();
  const naive = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(text);
  if (naive) return new Date(`${naive[1]}T${naive[2]}Z`);
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? new Date(now) : date;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** 相对时间：今天 / 昨天 / N 天前（首页条目与详情弹窗都用这个） */
export function relativeDay(at: string | number, now = Date.now()): string {
  const then = startOfDay(toDate(at, now));
  const today = startOfDay(new Date(now));
  const diff = Math.round((today.getTime() - then.getTime()) / 86_400_000);
  if (diff <= 0) return '今天';
  if (diff === 1) return '昨天';
  return `${diff} 天前`;
}

/** 管理端列表用的绝对时间：YYYY-MM-DD HH:mm（转成浏览器本地时区） */
export function formatStamp(at: string | number): string {
  const date = toDate(at);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 正文摘要：压成一行，超过 max 个字符补省略号 */
export function summaryOf(body: string, max = 60): string {
  const text = (body ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
