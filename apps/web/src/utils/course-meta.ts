/**
 * 课程卡片共用的派生值：进度、状态、分类 tint。
 *
 * 首页与课程大厅都要判断「在学 / 已学完 / 未开始」并给无封面课程上分类色，
 * 但两边各自维护会漂移，所以把纯函数收在这里；样式仍留在渲染元素所在组件。
 */
import type { Course } from '@/api/types';

export type CourseStatus = 'new' | 'learning' | 'finished';

/** 0-100 的课时完成百分比；没有课时按 0 处理 */
export function progressOf(course: Course): number {
  const total = course.total ?? 0;
  if (total === 0) return 0;
  return Math.min(100, Math.round(((course.finished ?? 0) / total) * 100));
}

export function statusOf(course: Course): CourseStatus {
  if ((course.total ?? 0) === 0) return 'new';
  if (progressOf(course) >= 100) return 'finished';
  return (course.finished ?? 0) > 0 ? 'learning' : 'new';
}

export const STATUS_LABEL: Record<CourseStatus, string> = {
  new: '未开始',
  learning: '在学',
  finished: '已学完',
};

/**
 * 4 组品牌 tint（都不含 accent，橙色只留给每页唯一的行动按钮）：
 * 主绿 / 青 / 赭 / 紫。按分类名稳定取模，同一分类在所有卡片上同色。
 */
const TINTS = [
  { bg: 'var(--mc-primary-soft)', ink: 'var(--mc-primary-fg)' },
  { bg: 'var(--mc-cyan-soft)', ink: 'var(--mc-cyan-fg)' },
  { bg: 'var(--mc-amber-soft)', ink: 'var(--mc-amber-fg)' },
  { bg: 'var(--mc-seal-soft)', ink: 'var(--mc-seal-fg)' },
] as const;

export function tintVars(course: Course): Record<string, string> {
  const key = course.category_name || '未分类';
  let hash = 0;
  for (const char of key) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 100_000;
  const tint = TINTS[hash % TINTS.length] ?? TINTS[0];
  return { '--cover-tint': tint.bg, '--cover-ink': tint.ink };
}
