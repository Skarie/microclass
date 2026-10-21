/**
 * 考试（exams / exam_questions / exam_attempts）仓储的公开类型与共用 SQL 片段。
 *
 * 从 examRepository 抽出：CRUD、组卷、题池、统计、作答各领域模块都要用这些结构，
 * 集中定义避免模块之间互相 import；`examRepository.ts` 仍从原路径 re-export，调用方无感。
 */
import type { Exam } from '@microclass/shared';

/**
 * 难度档位的统一 SQL 口径（组卷挑题、细目表统计、筛选题树三处必须一致，
 * 否则「筛出来的题量」和「实际配到的题量」会对不上）：
 * 优先三档字段，旧数据用 difficulty_score 按 42/71 分档，没有分的算中档。
 */
export const DIFFICULTY_BUCKET_SQL = `CASE
  WHEN q.difficulty IN ('easy','medium','hard') THEN q.difficulty
  WHEN COALESCE(q.difficulty_score, -1) < 0 THEN 'medium'
  WHEN q.difficulty_score < 42 THEN 'easy'
  WHEN q.difficulty_score < 71 THEN 'medium'
  ELSE 'hard'
END`;

export interface ExamWithStats extends Exam {
  question_count: number;
  attempt_count: number;
}

export interface PoolQuestion {
  id: number;
  stem: string;
  type: string;
  bank_id: number;
  lesson_id: number | null;
  /** 难度：easy / medium / hard（空串 = 未标注）——按难度配额组卷用 */
  difficulty?: string;
}

/** pool() 专用窄类型：随机增补/按配额组卷只关心这三列 */
export interface PoolBudgetQuestion {
  id: number;
  type: string;
  /** 难度：easy / medium / hard（空串 = 未标注） */
  difficulty?: string;
}

export interface ExamInput {
  courseId: number;
  title: string;
  description?: string;
  durationMinutes?: number;
  passScore?: number;
  status?: Exam['status'];
  /** 试卷结构（大题分组 JSON 字符串，迁移 0018） */
  structure?: string;
  /** 目标难度配比 JSON，如 {"easy":0.3,"medium":0.5,"hard":0.2} */
  difficultyTarget?: string;
  /** 试卷总分（默认 100） */
  totalScore?: number;
  /** 考试设置（对标学习通）：时间窗口 / 作答次数 / 乱序 / 公布答案 */
  startAt?: number;
  endAt?: number;
  attemptLimit?: number;
  shuffleQuestions?: boolean;
  showAnswers?: boolean;
}

export interface ExamAttempt {
  id: number;
  exam_id: number;
  user_id: number;
  answers: string;
  score: number;
  total: number;
  passed: 0 | 1;
  used_seconds: number;
  created_at: number;
}

/** 卷内题目行：`listQuestions()` 的返回结构（按卷内顺序，含大题与分值） */
export interface ExamQuestionRow {
  id: number;
  bank_id: number;
  lesson_id: number | null;
  type: string;
  stem: string;
  image_path: string;
  options: string;
  answer: string;
  analysis: string;
  sort: number;
  difficulty: string;
  difficulty_score: number;
  point: string;
  book: string;
  score: number;
  section: string;
}

/** 单个题目的卷内配置（换题/改分值用） */
export interface ExamQuestionMeta {
  sort: number;
  score: number;
  section: string;
}

/** 交卷入参：answers 由仓储 JSON.stringify 后落库 */
export interface AttemptInput {
  examId: number;
  userId: number;
  answers: unknown;
  score: number;
  total: number;
  passed: boolean;
  usedSeconds: number;
}
