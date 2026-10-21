/**
 * 组卷的「范围 + 难度」解析与挑题。
 *
 * 范围规则（缺一条就会抽到范围外的题）：
 *   - 课程范围默认是**本场考试所属课程**，只有显式 `scope:'all'` 才跨课程；
 *   - 章节 / 知识点 / 教材册次可以多选，必须逐条带进 `pick()` 查询；
 *   - 难度优先用 0–100 难度分区间，模型没跑过时退回三档字段，最后只保证题型。
 */
import type { ExamRepository } from '../db/repositories/examRepository.js';
import { shuffle } from './quizService.js';
import type { ExamPaperDeps } from './paperCommon.js';
import type { DifficultyLevel } from './paperTypes.js';

/** `pick()` 的查询条件（`limit` 由调用方补） */
export type PickQuery = Parameters<ExamRepository['pick']>[0];

/** 一次挑题的输入：题型 + 可选范围 + 排除已选题 */
export interface ComposePickOptions {
  courseId?: number;
  point?: string;
  chapter?: string;
  /** 多选范围：教材册次 / 章节 / 知识点（可跨章节、跨册） */
  books?: string[];
  chapters?: string[];
  points?: string[];
  type: string;
  level?: DifficultyLevel;
  exclude: number[];
}

/** 难度档 → 难度分区间（与题库「三档优先、旧数据按 42/71 分档」同一口径） */
export function levelRangeOf(level: DifficultyLevel | undefined): { levelMin?: number; levelMax?: number } {
  if (level === 'easy') return { levelMin: 0, levelMax: 42 };
  if (level === 'hard') return { levelMin: 71, levelMax: 100 };
  if (level === 'medium') return { levelMin: 42, levelMax: 71 };
  return {};
}

/** 三档字段 / 难度分 → 难度档（平行卷配对与统计共用） */
export function levelBucketOf(q: { difficulty_level?: number; difficulty?: string }): DifficultyLevel {
  const lv = Number(q.difficulty_level ?? 0);
  if (lv >= 1 && lv <= 5) return lv <= 2 ? 'easy' : lv === 3 ? 'medium' : 'hard';
  if (q.difficulty === 'easy') return 'easy';
  if (q.difficulty === 'hard') return 'hard';
  return 'medium';
}

/** 把范围 / 题型 / 排除项拼成 `pick()` 的基础条件（多选为空时不传，避免范围字段被静默丢掉） */
export function composeScopeQuery(options: ComposePickOptions): PickQuery {
  return {
    type: options.type,
    ...(options.courseId === undefined ? {} : { courseId: options.courseId }),
    ...(options.point ? { point: options.point } : {}),
    ...(options.chapter ? { chapter: options.chapter } : {}),
    ...(options.books && options.books.length > 0 ? { books: options.books } : {}),
    ...(options.chapters && options.chapters.length > 0 ? { chapters: options.chapters } : {}),
    ...(options.points && options.points.length > 0 ? { points: options.points } : {}),
    exclude: options.exclude,
    limit: 30,
  };
}

/**
 * 挑题的三次尝试（**按优先级**）：
 *   1) 题型 + 范围 + 难度分区间；
 *   2) 题型 + 范围 + 旧三档难度字段；
 *   3) 题型 + 范围（宁可出题也不要空卷）。
 */
export function composePickAttempts(options: ComposePickOptions): PickQuery[] {
  const base = composeScopeQuery(options);
  return [
    { ...base, ...levelRangeOf(options.level) },
    ...(options.level ? [{ ...base, difficulty: options.level }] : []),
    base,
  ];
}

/**
 * 组卷挑一道题：优先与目标难度档位最接近的题（随机打破并列）。
 *
 * 难度判定有三级回退，保证「难度模型还没跑过」时组卷照样能用：
 *   1) `difficulty_score` 落在目标档区间（模型算出来的 0–100 分）；
 *   2) 退回旧的 `difficulty` 三档字段；
 *   3) 再不匹配就忽略难度，只保证题型与范围（宁可出题也不要空卷）。
 */
export function pickForCompose(deps: ExamPaperDeps, options: ComposePickOptions): number | undefined {
  for (const query of composePickAttempts(options)) {
    const rows = deps.exams.pick(query);
    if (rows.length > 0) return shuffle(rows)[0]?.id;
  }
  return undefined;
}
