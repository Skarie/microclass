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
 * 五组分类色（全站按分类名稳定取模，同一分类在首页、大厅、列表里永远同色）：
 * 主绿 / 青 / 靛 / 赭 / 琥珀。不用中性墨做课程封面，避免整页出现大片黑块。
 * `--cat-bg` 是封面实底色（与 player 黑混一点，保证任何主题下白字都够对比）；
 * `--cat-soft` / `--cat-fg` 用于分类 chip 的浅底与文字；`--cat-strong` 用于数字。
 */
const TONES = [
  {
    bg: 'color-mix(in srgb, var(--mc-primary) 84%, var(--mc-player-bg))',
    soft: 'var(--mc-primary-soft)',
    fg: 'var(--mc-primary-fg)',
    strong: 'var(--mc-primary-strong)',
  },
  {
    bg: 'color-mix(in srgb, var(--mc-cyan) 64%, var(--mc-player-bg))',
    soft: 'var(--mc-cyan-soft)',
    fg: 'var(--mc-cyan-fg)',
    strong: 'var(--mc-cyan-strong)',
  },
  {
    bg: 'color-mix(in srgb, var(--mc-indigo) 88%, var(--mc-player-bg))',
    soft: 'var(--mc-indigo-soft)',
    fg: 'var(--mc-indigo-fg)',
    strong: 'var(--mc-indigo-strong)',
  },
  {
    bg: 'color-mix(in srgb, var(--mc-terra) 90%, var(--mc-player-bg))',
    soft: 'var(--mc-terra-soft)',
    fg: 'var(--mc-terra-fg)',
    strong: 'var(--mc-terra-strong)',
  },
  {
    bg: 'color-mix(in srgb, var(--mc-amber) 76%, var(--mc-player-bg))',
    soft: 'var(--mc-amber-soft)',
    fg: 'var(--mc-amber-fg)',
    strong: 'var(--mc-warning-fg)',
  },
] as const;

/** 分类名 → 0..4 的固定色位（空 key = 「全部」，固定主色） */
export function categoryTone(key: string): number {
  if (!key) return 0;
  let hash = 0;
  for (const char of key) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 100_000;
  return hash % TONES.length;
}

/** 给渲染元素注入分类色变量（颜色本身仍来自 tokens.css） */
export function categoryVars(key: string): Record<string, string> {
  const tone = TONES[categoryTone(key)] ?? TONES[0];
  return {
    '--cat-bg': tone.bg,
    '--cat-soft': tone.soft,
    '--cat-fg': tone.fg,
    '--cat-strong': tone.strong,
    '--cat-on': 'var(--mc-hero-fg)',
  };
}
