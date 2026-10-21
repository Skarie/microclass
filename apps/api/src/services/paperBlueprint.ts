/**
 * 双向细目表与卷面统计（组卷工作台）。
 *
 * 参考主流组卷系统（智学网一类）的「试题篮」：老师需要随时看到
 * 「多少题、多少分、各题型几道、难度配比对不对、知识点覆盖了哪些、离目标还差什么」。
 * 本模块全是**纯计算 + 只读查询**：不写库、不改卷面，便于直接单测。
 */
import type { Exam } from '@microclass/shared';
import type { ExamRepository } from '../db/repositories/examRepository.js';
import type { PaperRow } from './paperCommon.js';
import { TYPE_NAME } from './paperStructure.js';
import type { BlueprintResult, DifficultyLevel, DifficultyTarget } from './paperTypes.js';

/** 每题默认分值：卷面没填分值（0）时按「总分 / 题数」均摊，保留 1 位小数 */
export function fallbackScoreOf(exam: Exam, count: number): number {
  return count > 0 ? Number(exam.total_score ?? 100) / count : 0;
}

/** 某行在卷面上的实际分值（老师填过就用，未填则用均摊值） */
export function scoreOfRow(row: { score: number }, fallbackScore: number): number {
  return Number(row.score) > 0 ? Number(row.score) : Math.round(fallbackScore * 10) / 10;
}

/** 难度档位：优先三档字段，旧数据按 difficulty_score 的 42/71 分档，没分算中档 */
function bucketOf(row: { difficulty: string; difficulty_score: number }): DifficultyLevel {
  if (row.difficulty === 'easy' || row.difficulty === 'medium' || row.difficulty === 'hard') return row.difficulty;
  const score = Number(row.difficulty_score ?? -1);
  if (score < 0) return 'medium';
  if (score < 42) return 'easy';
  if (score < 71) return 'medium';
  return 'hard';
}

/** 五级难度星级：难度分为 -1（还没跑模型）时按第 3 级 */
function levelOf(row: { difficulty_score: number }): number {
  return Number(row.difficulty_score ?? -1) < 0 ? 3 : Math.min(5, Math.floor(Number(row.difficulty_score) / 20) + 1);
}

/** 组卷工作台用：卷面统计 + 双向细目表（知识点 × 题型 × 难度） */
export function buildBlueprint(exam: Exam, rows: PaperRow[]): BlueprintResult {
  const fallbackScore = fallbackScoreOf(exam, rows.length);

  const byType = new Map<string, { type: string; count: number; score: number }>();
  const byDifficulty = new Map<string, { difficulty: string; count: number; score: number }>();
  const levelCount = new Map<number, number>();
  const matrix = new Map<string, Map<string, { easy: number; medium: number; hard: number }>>();
  const sections = new Map<string, { name: string; count: number; score: number }>();
  let configuredScore = 0;
  const withImage = rows.filter((row) => String(row.image_path ?? '') !== '').length;

  for (const row of rows) {
    const score = scoreOfRow(row, fallbackScore);
    configuredScore += score;
    const t = byType.get(row.type) ?? { type: row.type, count: 0, score: 0 };
    t.count += 1;
    t.score += score;
    byType.set(row.type, t);

    const bucket = bucketOf(row);
    const d = byDifficulty.get(bucket) ?? { difficulty: bucket, count: 0, score: 0 };
    d.count += 1;
    d.score += score;
    byDifficulty.set(bucket, d);

    const level = levelOf(row);
    levelCount.set(level, (levelCount.get(level) ?? 0) + 1);

    const point = row.point || '未标知识点';
    const rowCells = matrix.get(point) ?? new Map<string, { easy: number; medium: number; hard: number }>();
    const cell = rowCells.get(row.type) ?? { easy: 0, medium: 0, hard: 0 };
    cell[bucket] += 1;
    rowCells.set(row.type, cell);
    matrix.set(point, rowCells);

    const sectionName = row.section || '未分组';
    const s = sections.get(sectionName) ?? { name: sectionName, count: 0, score: 0 };
    s.count += 1;
    s.score += score;
    sections.set(sectionName, s);
  }

  const actualRatio: DifficultyTarget = {};
  for (const [key, value] of byDifficulty) {
    actualRatio[key as DifficultyLevel] = rows.length > 0 ? Math.round((value.count / rows.length) * 100) / 100 : 0;
  }
  let targetRatio: DifficultyTarget = {};
  if (exam.difficulty_target) {
    try {
      targetRatio = JSON.parse(exam.difficulty_target) as DifficultyTarget;
    } catch {
      targetRatio = {};
    }
  }
  const diff: DifficultyTarget = {};
  for (const key of ['easy', 'medium', 'hard'] as const) {
    if (targetRatio[key] === undefined) continue;
    diff[key] = Math.round(((actualRatio[key] ?? 0) - (targetRatio[key] ?? 0)) * 100) / 100;
  }
  const suggestions: string[] = [];
  for (const [key, want] of Object.entries(targetRatio)) {
    const wantCount = Math.round((want ?? 0) * rows.length);
    const haveCount = byDifficulty.get(key)?.count ?? 0;
    if (haveCount < wantCount) {
      suggestions.push(
        `建议再加 ${wantCount - haveCount} 道${TYPE_NAME[key] ?? key}…… 难度「${key}」题（当前 ${haveCount} 道）`,
      );
    }
  }

  return {
    exam,
    stats: {
      questions: rows.length,
      totalScore: Number(exam.total_score ?? 100),
      configuredScore: Math.round(configuredScore * 10) / 10,
      averageScorePerQuestion: Math.round(fallbackScore * 10) / 10,
      estimatedMinutes: Math.max(5, Math.round(rows.length * 2.5)),
      byType: [...byType.values()],
      byDifficulty: [...byDifficulty.values()].sort((a, b) => a.difficulty.localeCompare(b.difficulty)),
      byLevel: [...levelCount.entries()].map(([level, count]) => ({ level, count })).sort((a, b) => a.level - b.level),
      withImage,
    },
    target: { ratio: targetRatio, actual: actualRatio, diff },
    matrix: [...matrix.entries()]
      .map(([point, cells]) => ({
        point,
        total: [...cells.values()].reduce((s, c) => s + c.easy + c.medium + c.hard, 0),
        cells: [...cells.entries()].map(([type, c]) => ({ type, ...c })),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 50),
    sections: [...sections.values()],
    suggestions,
  };
}

/**
 * 细目表参考数据：当前范围里「知识点 × 题型 × 难度」各有多少可选题。
 * 老师在细目表编辑器里填目标数量时，能看到题池到底有多少，不用凭感觉填。
 */
export function taxonomy(
  exams: ExamRepository,
  options: { courseId?: number; scope?: 'course' | 'all'; limit?: number },
): {
  scope: { mode: 'course' | 'all'; courseId: number | undefined };
  /** 数量为题的矩阵：每个知识点下按 题型×难度 计数 */
  points: { point: string; total: number; cells: { type: string; easy: number; medium: number; hard: number }[] }[];
  total: number;
} {
  const courseId = options.scope === 'all' ? undefined : options.courseId;
  const rows = exams.taxonomy({
    ...(courseId === undefined ? {} : { courseId }),
    ...(options.limit ? { limit: options.limit } : {}),
  });
  return {
    scope: { mode: options.scope === 'all' ? 'all' : 'course', courseId },
    points: rows,
    total: rows.reduce((sum, row) => sum + row.total, 0),
  };
}
