/**
 * 按「题型配额 + 难度配额」组卷（快捷组卷，不做范围树/细目表）。
 *
 * 纯逻辑（配额归一、难度名额分配）与落库分开：
 *   - `positiveEntries` / `allocateDifficultyBuckets` 可直接单测；
 *   - `addByQuota` 只负责取题池、随机抽题与审计。
 */
import type { QuestionType, User } from '@microclass/shared';
import { findExam, writeAudit, type ExamPaperDeps } from './paperCommon.js';
import type { DifficultyLevel } from './paperTypes.js';
import { shuffle } from './quizService.js';

/** 只保留数量 > 0 的配额项（老师留空的题型/难度不参与组卷） */
export function positiveEntries<K extends string>(
  record: Partial<Record<K, number>> | undefined,
): { key: K; count: number }[] {
  const out: { key: K; count: number }[] = [];
  for (const [key, raw] of Object.entries(record ?? {})) {
    const count = Math.max(0, Number(raw) || 0);
    if (count > 0) out.push({ key: key as K, count });
  }
  return out;
}

/**
 * 题型内按难度配比分配名额：`count` 道按 `ratio`（如 0.3/0.5/0.2）拆开。
 * 配比没铺满时补「中档」，超了则截断 —— 保证返回长度**恰好**等于 `count`。
 */
export function allocateDifficultyBuckets(
  count: number,
  ratio: Partial<Record<DifficultyLevel, number>>,
): DifficultyLevel[] {
  const out: DifficultyLevel[] = [];
  for (const level of ['easy', 'medium', 'hard'] as const) {
    const n = Math.round((Number(ratio[level]) || 0) * count);
    for (let i = 0; i < n; i += 1) out.push(level);
  }
  while (out.length < count) out.push('medium');
  return out.slice(0, count);
}

/**
 * 组卷：在课程题池里按「题型配额 + 难度配额」抽题。
 * 难度配额（如 `{easy:5, medium:3, hard:2}`）与题型配额可同时给，也可以只给难度。
 * 池内没有足够的某类题时按实际数量抽，并在返回值里如实报告缺口。
 */
export function addByQuota(
  deps: ExamPaperDeps,
  actor: User,
  examId: number,
  quota: Partial<Record<QuestionType, number>>,
  difficultyQuota?: Partial<Record<DifficultyLevel, number>>,
): { added: number; requested: number; shortfall: number } {
  const exam = findExam(deps.exams, examId);
  const have = new Set(deps.exams.questionIds(examId));
  const pool = deps.exams.pool(exam.course_id).filter((q) => !have.has(q.id));
  const typeEntries = positiveEntries(quota);
  const diffEntries = positiveEntries(difficultyQuota);

  const ids: number[] = [];
  let requested = 0;

  if (typeEntries.length > 0) {
    for (const { key: type, count } of typeEntries) {
      requested += count;
      let candidates = pool.filter((q) => q.type === type);
      // 同时给了难度配额时，先按难度在该题型内部分配
      if (diffEntries.length > 0) {
        const perDifficulty = diffEntries.map(({ key: level }) => ({
          level,
          take: shuffle(candidates.filter((q) => q.difficulty === level)).slice(0, count),
        }));
        const pickedByDiff = perDifficulty.flatMap((x) => x.take);
        candidates = pickedByDiff.length > 0 ? pickedByDiff : candidates;
      }
      ids.push(
        ...shuffle(candidates)
          .slice(0, count)
          .map((q) => q.id),
      );
    }
  } else if (diffEntries.length > 0) {
    for (const { key: level, count } of diffEntries) {
      requested += count;
      ids.push(
        ...shuffle(pool.filter((q) => q.difficulty === level))
          .slice(0, count)
          .map((q) => q.id),
      );
    }
  }

  const unique = [...new Set(ids)];
  const added = deps.exams.addQuestions(examId, unique);
  writeAudit(deps, actor, 'exam.add_quota', examId, {
    quota,
    difficultyQuota: difficultyQuota ?? {},
    requested,
    added,
  });
  return { added, requested, shortfall: Math.max(0, requested - unique.length) };
}
