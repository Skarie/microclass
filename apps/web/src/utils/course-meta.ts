/**
 * 课程卡片共用的派生值：进度与状态。
 *
 * 首页与课程大厅都要判断「在学 / 已学完 / 未开始」，两边各自维护会漂移，
 * 所以把纯函数收在这里；样式仍留在渲染元素所在组件。
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
