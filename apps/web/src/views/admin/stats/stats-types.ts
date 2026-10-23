import type { CourseStats, LessonStats } from '@/api/types';

/** 学习统计页的页签类型。 */
export type StatsTab = 'lesson' | 'course';

/**
 * KPI 卡片：value 已拼好百分号等单位，文案与拆分前逐字一致。
 * 课时维度 7 项、课程维度 4 项，顺序即页面展示顺序。
 */
export interface StatItem {
  label: string;
  value: string | number;
}

export function lessonSummary(stats: LessonStats): StatItem[] {
  const s = stats.summary;
  return [
    { value: s.students, label: '学生数' },
    { value: s.watched, label: '已观看' },
    { value: s.finished, label: '已完成' },
    { value: s.not_started, label: '未开始' },
    { value: s.quizzed, label: '已刷题' },
    { value: s.avg, label: '平均分' },
    { value: s.best, label: '最高分' },
  ];
}

export function courseSummary(stats: CourseStats): StatItem[] {
  const s = stats.summary;
  return [
    { value: s.lessons, label: '课时数' },
    { value: s.students, label: '学生数' },
    { value: `${s.avg_finish_rate}%`, label: '平均完成率' },
    { value: `${s.avg_quiz_rate}%`, label: '平均刷题率' },
  ];
}

/** 更新时间：后端给 Unix 秒，空值统一显示破折号。 */
export function formatTime(unixSeconds: number | null): string {
  if (!unixSeconds) return '—';
  return new Date(unixSeconds * 1000).toLocaleString('zh-CN');
}
