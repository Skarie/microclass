/**
 * 试卷领域的对外数据类型：结构、细目表、智能组卷、平行卷与换题候选。
 *
 * 只放类型（编译期擦除），实现分别在同目录 paper* 模块；原 `exam-paper.ts` 继续 re-export，
 * 因此 `ExamService` 与路由的签名不变。
 */
import type { Exam, QuestionType } from '@microclass/shared';
import type { BlueprintCell } from '../domain/blueprint.js';
import type { PaperRow } from './paperCommon.js';

/** 难度档位（与细目表 / 题库三档字段同一口径） */
export type DifficultyLevel = 'easy' | 'medium' | 'hard';

/** 目标难度配比，如 `{"easy":0.3,"medium":0.5,"hard":0.2}` */
export type DifficultyTarget = Partial<Record<DifficultyLevel, number>>;

/** 试卷大题：名称 / 题型 / 每题分值 / 说明 */
export interface PaperSection {
  name: string;
  type: string;
  score: number;
  description: string;
}

export interface BlueprintResult {
  exam: Exam;
  stats: {
    questions: number;
    totalScore: number;
    configuredScore: number;
    averageScorePerQuestion: number;
    estimatedMinutes: number;
    byType: { type: string; count: number; score: number }[];
    byDifficulty: { difficulty: string; count: number; score: number }[];
    byLevel: { level: number; count: number }[];
    withImage: number;
  };
  /** 目标难度配比与达成情况 */
  target: {
    ratio: DifficultyTarget;
    actual: DifficultyTarget;
    diff: DifficultyTarget;
  };
  /** 双向细目表：一行一个知识点，列是题型 × 难度 */
  matrix: {
    point: string;
    total: number;
    cells: { type: string; easy: number; medium: number; hard: number }[];
  }[];
  sections: { name: string; count: number; score: number }[];
  /** 缺口提示（题型/难度差多少题），供「智能组卷」参考 */
  suggestions: string[];
}

export interface AutoComposeInput {
  quota: Partial<Record<QuestionType, number>>;
  /** 双向细目表（与 quota 二选一）：逐格指定「知识点 × 题型 × 难度」的数量 */
  cells?: BlueprintCell[];
  ratio?: DifficultyTarget;
  /** `course`（默认，抽本课程题）/ `all`（明确要求才跨课程） */
  scope?: 'course' | 'all';
  courseId?: number;
  point?: string;
  chapter?: string;
  /** 多选范围（可跨章节/跨册）：与细目表/配额一起用时，只在这些范围里抽 */
  books?: string[];
  chapters?: string[];
  points?: string[];
  /** 每个题型的分值（生成后直接落到卷面，老师不必再逐题填） */
  scores?: Partial<Record<QuestionType, number>>;
  sectionName?: string;
  scorePerQuestion?: number;
  replaceExisting?: boolean;
  seed?: number;
}

export interface AutoComposeResult {
  added: number;
  requested: number;
  shortfall: number;
  /** 本次组卷实际使用的范围（便于前端/验收确认没有跨课程抽题） */
  scope: { mode: 'course' | 'all'; courseId: number | undefined };
  detail: { type: string; requested: number; added: number; missing: number }[];
  /** 逐格结果（细目表输入时才有）：缺口 + 该格题池可用量 */
  cells: {
    point: string;
    type: string;
    level: string;
    requested: number;
    added: number;
    missing: number;
    available: number;
  }[];
  difficulty: { level: string; requested: number; added: number }[];
  blueprint: BlueprintResult;
}

export interface ParallelMatch {
  pickedIds: number[];
  pairs: { picked: number; from: PaperRow }[];
  detail: { index: number; type: string; level: string; point: string; from: number; to: number | null }[];
}

export interface SimilarCandidatesResult {
  current: { id: number; stem: string; type: string; difficulty: string; point: string; level: number };
  groups: {
    reason: string;
    candidates: {
      id: number;
      stem: string;
      type: string;
      difficulty: string;
      point: string;
      level: number;
      bankName: string;
      /** 与当前题的难度分差（越小越像） */
      levelDelta: number;
    }[];
  }[];
}
