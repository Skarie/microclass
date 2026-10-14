/**
 * 共享常量与枚举：前后端共用，禁止在应用层硬编码。
 */

/** 用户角色 */
export const ROLES = ['admin', 'teacher', 'student'] as const;
export type Role = (typeof ROLES)[number];

/** 课时视频来源 */
export const VIDEO_KINDS = ['local', 'embed', 'url'] as const;
export type VideoKind = (typeof VIDEO_KINDS)[number];

/** 题型 */
export const QUESTION_TYPES = ['single', 'multiple', 'judge', 'fill', 'short'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** 可自动判分的题型（简答需人工/自检） */
export const AUTO_GRADED_TYPES: readonly QuestionType[] = ['single', 'multiple', 'judge', 'fill'];

/** 知识点类型 */
export const KNOWLEDGE_KINDS = ['text', 'file', 'link'] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

/** 课程/考试发布状态 */
export const PUBLISH_STATUS = ['draft', 'published'] as const;
export type PublishStatus = (typeof PUBLISH_STATUS)[number];

/** 视频扩展名（媒体根目录扫描用） */
export const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.flv', '.ts', '.m4v'] as const;

/** 本地视频解锁刷题的观看比例门槛 */
export const QUIZ_UNLOCK_RATIO = 0.8;

/** 学习等级阈值（累计学习分钟） */
export const LEVELS = [
  { name: '🌱 一级学员', minMinutes: 0 },
  { name: '📖 二级学员', minMinutes: 10 },
  { name: '🚀 三级学员', minMinutes: 60 },
  { name: '🔥 四级学员', minMinutes: 180 },
  { name: '👑 学习达人', minMinutes: 420 },
] as const;

/** 会话 Cookie 名与有效期 */
export const SESSION_COOKIE = 'microclass_sid';
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

/** 默认分页 */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 200;
