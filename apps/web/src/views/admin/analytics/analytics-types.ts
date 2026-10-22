/**
 * 学情分析页共享类型与展示口径。
 *
 * 掌握度分档阈值与后端 `analyticsService.MASTERY` 一致：作答 ≥ 3 次才下结论，
 * 正确率 ≥ 80% 掌握、60–80% 薄弱、< 60% 未掌握，不足 3 次统一「数据不足」。
 * 文案 / 色调 / 图标只在这里定义一份，页头 KPI、四个页签与导出说明共用。
 */
import type { ChartTone } from '@/components/charts/types';
import type { IconName } from '@/components/icons';

export type MasteryLevel = 'mastered' | 'weak' | 'poor' | 'insufficient';

/** 四个页签：知识点掌握度 / 学员学情 / 高频错题 / 作答趋势 */
export type AnalyticsTab = 'points' | 'students' | 'wrong' | 'trend';

export interface AnalyticsFilters {
  courseId: number | '';
  days: number;
}

export interface CourseOption {
  id: number;
  name: string;
}

export interface AnalyticsOverview {
  kpi: {
    students: number;
    activeStudents: number;
    graded: number;
    wrong: number;
    accuracy: number;
    practiceAttempts: number;
    examAttempts: number;
    questionsWithData: number;
    pointsWithData: number;
    totalQuestions: number;
    totalPoints: number;
    questionCoverage: number;
    pointCoverage: number;
  };
  trend: { day: string; graded: number; wrong: number; students: number; accuracy: number }[];
  mastery: { level: MasteryLevel; points: number }[];
  dataNote: string;
  generatedAt: number;
}

export interface PointRow {
  point: string;
  graded: number;
  wrong: number;
  accuracy: number;
  students: number;
  questions: number;
  mastery: MasteryLevel;
  topWrong: { question_id: number; stem: string; graded: number; wrong: number }[];
}

export interface StudentRow {
  user_id: number;
  username: string;
  display_name: string;
  graded: number;
  wrong: number;
  questions: number;
  points: number;
  weakest_point: string;
  weakest_wrong: number;
  accuracy: number;
  level: MasteryLevel;
}

export interface WrongRow {
  question_id: number;
  stem: string;
  type: string;
  point: string;
  difficulty: string;
  graded: number;
  wrong: number;
  students: number;
  accuracy: number;
  score: number;
}

export interface PointsResponse {
  points: PointRow[];
  dataNote: string;
}

export interface StudentsResponse {
  students: StudentRow[];
  dataNote: string;
}

export interface WrongResponse {
  questions: WrongRow[];
  minAttempts: number;
  dataNote: string;
}

/** 掌握度环形图的一段（label/tone/icon 直接喂给 DonutChart） */
export interface MasterySegment {
  label: string;
  value: number;
  tone: ChartTone;
  icon: IconName;
}

export const MASTERY_LABEL: Record<MasteryLevel, string> = {
  poor: '未掌握',
  weak: '薄弱',
  mastered: '掌握',
  insufficient: '数据不足',
};

export const MASTERY_TONE: Record<MasteryLevel, 'danger' | 'warning' | 'success' | 'neutral'> = {
  poor: 'danger',
  weak: 'warning',
  mastered: 'success',
  insufficient: 'neutral',
};

/** 掌握度图标：一眼看出好/差/数据不足（比只有文字颜色更直观） */
export const MASTERY_ICON: Record<MasteryLevel, IconName> = {
  mastered: 'award',
  weak: 'alert',
  poor: 'close',
  insufficient: 'helpCircle',
};

export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
