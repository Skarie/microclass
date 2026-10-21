/**
 * 平行卷（A/B 卷）配对：按原卷**逐题**配一道「同题型、同难度档、知识点尽量相同」的**不同**题。
 *
 * 为什么逐题配而不是按题型数量随机抽：平行卷的价值就在于**结构可比**——
 * 题号 i 的难度与考点要对得上，两份卷子的成绩才有可比性（随机抽做不到这一点）。
 *
 * 按题型批量取候选，再在内存里配对（原实现是逐题调 pickForCompose，
 * 每题最多 3 次查询 —— 20 题的卷子要跑 60 次查询，实测 4~5 秒）。
 */
import type { ExamPaperDeps, PaperRow } from './paperCommon.js';
import { levelBucketOf } from './paperRange.js';
import type { DifficultyLevel, ParallelMatch } from './paperTypes.js';
import { shuffle } from './quizService.js';

/** 配对候选：题型已由查询限定，这里只需要 id / 知识点 / 难度 */
export interface ParallelCandidate {
  id: number;
  point?: string;
  difficulty_level?: number;
  difficulty?: string;
}

/**
 * 在原卷某道题的目标下挑一道候选（**不改** `used` / `exclude`，由调用方落账）。
 *
 * 优先级与原 `pickForCompose` 一致：
 *   同知识点+同难度 > 同知识点 > 同难度 > 同题型任意题。
 */
export function pickParallelCandidate<T extends ParallelCandidate>(
  pool: T[],
  used: Set<number>,
  target: { point: string; level: DifficultyLevel },
): T | undefined {
  const free = (pred: (row: T) => boolean): T | undefined => pool.find((row) => !used.has(row.id) && pred(row));
  return (
    free((row) => String(row.point ?? '') === target.point && levelBucketOf(row) === target.level) ??
    free((row) => String(row.point ?? '') === target.point) ??
    free((row) => levelBucketOf(row) === target.level) ??
    free(() => true)
  );
}

export function matchParallelQuestions(
  deps: ExamPaperDeps,
  questions: PaperRow[],
  scopeCourseId: number | undefined,
): ParallelMatch {
  // 原卷的题一律不作为候选（否则"平行卷"里会出现同一道题）
  const exclude = new Set<number>(questions.map((q) => q.id));
  const pickedIds: number[] = [];
  const pairs: { picked: number; from: PaperRow }[] = [];
  const detail: { index: number; type: string; level: string; point: string; from: number; to: number | null }[] = [];

  const byType = new Map<string, number[]>();
  questions.forEach((q, i) => {
    const list = byType.get(q.type) ?? [];
    list.push(i);
    byType.set(q.type, list);
  });

  /** 按**原卷题序**记录每道题配到的候选（顺序必须与原文一致，后面要按位抄分值/大题） */
  const assigned = new Array<number | undefined>(questions.length);

  for (const [type, indices] of byType) {
    const windowSize = Math.min(400, Math.max(120, indices.length * 10));
    let pool = deps.exams.pick({
      type,
      ...(scopeCourseId === undefined ? {} : { courseId: scopeCourseId }),
      exclude: [...exclude],
      limit: windowSize,
    });
    if (pool.length < indices.length) {
      const more = deps.exams.pick({
        type,
        ...(scopeCourseId === undefined ? {} : { courseId: scopeCourseId }),
        exclude: [...exclude, ...pool.map((r) => r.id)],
        limit: windowSize,
      });
      pool = pool.concat(more);
    }
    const shuffled = shuffle(pool);
    const used = new Set<number>();

    for (const i of indices) {
      const q = questions[i];
      if (!q) continue;
      const picked = pickParallelCandidate(shuffled, used, {
        level: levelBucketOf(q),
        point: String(q.point ?? ''),
      });
      if (picked !== undefined) {
        used.add(picked.id);
        exclude.add(picked.id);
        assigned[i] = picked.id;
      }
    }
  }

  // 按原卷题序回填：配对列表的顺序决定分值/大题怎么抄，绝不能按题型分组顺序
  questions.forEach((q, i) => {
    const picked = assigned[i];
    if (picked !== undefined) {
      pickedIds.push(picked);
      pairs.push({ picked, from: q });
    }
    detail.push({
      index: i + 1,
      type: q.type,
      level: levelBucketOf(q),
      point: String(q.point ?? ''),
      from: q.id,
      to: picked ?? null,
    });
  });

  return { pickedIds, pairs, detail };
}
