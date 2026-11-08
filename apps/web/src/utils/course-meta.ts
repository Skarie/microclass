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

/**
 * 设计封面的三色盘（深主绿 / 炭灰 / 赭石）。
 *
 * 为什么是纯函数 + 固定顺序：封面必须「同分类同色、全站只有 3 种」。
 * 任何随机数或 Date 参与都会让同一门课在首页和大厅变色，所以只做字符串 hash。
 * 无分类（或分类名全空白）统一落到炭灰 —— 中性色是"没有分类"的默认表达。
 */
export type CoverTone = 'green' | 'charcoal' | 'ochre';

const COVER_TONES: readonly CoverTone[] = ['green', 'charcoal', 'ochre'];

export function coverToneForCategory(categoryName?: string | null): CoverTone {
  const key = (categoryName ?? '').trim();
  if (key === '') return 'charcoal';
  // FNV-1a：相近的分类名（小学数学 / 小学语文）也能散到不同色上，
  // 简单 hash 会让「小学数学」「初中数学」这类前缀相同的名字全撞到同一个桶。
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return COVER_TONES[(hash >>> 0) % COVER_TONES.length] as CoverTone;
}

/** 设计封面上的首字：取课程名第一个非空白字符，拉丁字母转大写 */
export function coverInitial(courseName?: string | null): string {
  const name = (courseName ?? '').trim();
  return name === '' ? '课' : name.slice(0, 1).toUpperCase();
}
