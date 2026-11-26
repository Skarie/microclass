/**
 * 智能组卷（智学网式「一键组卷」）。
 *
 * 输入：题型配额 + 目标难度配比（%）+ 课程/知识点范围 + 每题分值 + 大题名，
 * 或：双向细目表（知识点 × 题型 × 难度 逐格数量）。
 * 做法：先算每个题型/每格要几道；题型内按难度配比分配名额；
 *       在该范围内挑难度分最贴近目标的题（同分随机），知识点优先不重复；
 *       缺口如实报告（不硬凑、不重复用题）。
 *
 * P0 阶段 2（批次 2）：题库/卷面读取全部 `await`（AsyncDb）；落库收口成
 * `applyComposition` —— **清空（replaceExisting）+ 批量加题 + 逐题分值/大题在同一个事务**，
 * 中途失败整批回滚（不会留下「清空后只加了一半」的残卷）。
 * 挑选阶段仍按「清空后」的口径排除已入卷题目（replaceExisting 时为空集合），与旧行为一致。
 */
import { AppError, type QuestionType, type User } from '@microclass/shared';
import { orderCellsForPick } from '../domain/blueprint.js';
import { findExam, writeAudit, type ExamPaperDeps } from './paperCommon.js';
import { buildBlueprint } from './paperBlueprint.js';
import { levelRangeOf, pickForCompose } from './paperRange.js';
import { allocateDifficultyBuckets, positiveEntries } from './paperQuota.js';
import type { AutoComposeInput, AutoComposeResult, DifficultyLevel } from './paperTypes.js';

export async function autoCompose(
  deps: ExamPaperDeps,
  actor: User,
  examId: number,
  input: AutoComposeInput,
): Promise<AutoComposeResult> {
  const exam = await findExam(deps.exams, examId);
  const ratio = input.ratio ?? {};
  const useRatio = Object.values(ratio).some((v) => (Number(v) || 0) > 0);
  /**
   * 组卷范围：显式传了 `courseId` 就用它，否则**默认这门考试所属课程**；
   * 只有明确 `scope: 'all'` 才会跨课程抽题。
   * 早先这里把 `input.courseId`（前端不传时是 undefined）直接传给了挑题函数，
   * 而 `undefined` 在挑题里表示「不限课程」→ 于是智能组卷会把**别门课的题**也抽进来。
   */
  const scope: 'course' | 'all' = input.scope === 'all' ? 'all' : 'course';
  const scopeCourseId = scope === 'all' ? undefined : (input.courseId ?? exam.course_id);
  // 清空推迟到写事务里；挑选阶段按「清空后」的口径算已入卷集合
  const existing = new Set<number>(input.replaceExisting ? [] : await deps.exams.questionIds(examId));
  /** 已选题（id + 题型）：题型用于落每题分值，避免再回表读一次卷面 */
  const chosen: { id: number; type: string }[] = [];
  const chosenIds = (): number[] => chosen.map((c) => c.id);
  const detail: { type: string; requested: number; added: number; missing: number }[] = [];
  const difficultyWanted: Record<DifficultyLevel, number> = { easy: 0, medium: 0, hard: 0 };
  const difficultyAdded: Record<DifficultyLevel, number> = { easy: 0, medium: 0, hard: 0 };
  let requested = 0;

  const cellsDetail: AutoComposeResult['cells'] = [];

  if (input.cells && input.cells.length > 0) {
    // ---- 细目表模式：逐格配题 ----
    if (positiveEntries(input.quota).length > 0) {
      throw AppError.badRequest('细目表与「题型配额」只能二选一：请清空其中一种');
    }
    const poolBase = {
      ...(scopeCourseId === undefined ? {} : { courseId: scopeCourseId }),
      ...(input.chapter ? { chapter: input.chapter } : {}),
    };
    for (const cell of orderCellsForPick(input.cells)) {
      requested += cell.count;
      difficultyWanted[cell.level] += cell.count;
      // 该格题池可用量：让老师知道缺口是「题池本来就没有」还是「被别的格抽走」
      const available = await deps.exams.pickCount({
        ...poolBase,
        type: cell.type,
        ...levelRangeOf(cell.level),
        ...(cell.point ? { point: cell.point } : {}),
        exclude: [...existing],
      });
      let added = 0;
      for (let i = 0; i < cell.count; i += 1) {
        const picked = await pickForCompose(deps, {
          ...(scopeCourseId === undefined ? {} : { courseId: scopeCourseId }),
          ...(cell.point ? { point: cell.point } : {}),
          ...(input.chapter ? { chapter: input.chapter } : {}),
          // 多选范围（可跨章节/跨册）：细目表逐格抽题时也要受范围约束
          ...(input.books && input.books.length > 0 ? { books: input.books } : {}),
          ...(input.chapters && input.chapters.length > 0 ? { chapters: input.chapters } : {}),
          ...(input.points && input.points.length > 0 ? { points: input.points } : {}),
          type: cell.type,
          level: cell.level,
          exclude: [...existing, ...chosenIds()],
        });
        if (picked === undefined) break;
        chosen.push({ id: picked.id, type: picked.type });
        added += 1;
        difficultyAdded[cell.level] += 1;
      }
      cellsDetail.push({
        point: cell.point,
        type: cell.type,
        level: cell.level,
        requested: cell.count,
        added,
        missing: Math.max(0, cell.count - added),
        available,
      });
    }
  } else {
    for (const { key: type, count } of positiveEntries(input.quota)) {
      requested += count;
      let added = 0;
      // 该题型内按难度配比分配名额（没给配比就整体按难度分散取）
      const buckets: DifficultyLevel[] = useRatio ? allocateDifficultyBuckets(count, ratio) : [];
      for (const level of buckets) {
        difficultyWanted[level] += 1;
        const picked = await pickForCompose(deps, {
          courseId: scopeCourseId,
          point: input.point,
          chapter: input.chapter,
          // 多选范围：老师先勾章节/知识点，再按题型数量随机抽
          ...(input.books && input.books.length > 0 ? { books: input.books } : {}),
          ...(input.chapters && input.chapters.length > 0 ? { chapters: input.chapters } : {}),
          ...(input.points && input.points.length > 0 ? { points: input.points } : {}),
          type,
          level,
          exclude: [...existing, ...chosenIds()],
        });
        if (picked === undefined) continue;
        chosen.push({ id: picked.id, type: picked.type });
        difficultyAdded[level] += 1;
        added += 1;
      }
      if (!useRatio) {
        const more = await deps.exams.pick({
          limit: count,
          type,
          courseId: scopeCourseId,
          ...(input.point ? { point: input.point } : {}),
          ...(input.chapter ? { chapter: input.chapter } : {}),
          // 同一条范围约束：漏了这里，没给难度配比时会退化成"全课程乱抽"
          ...(input.books && input.books.length > 0 ? { books: input.books } : {}),
          ...(input.chapters && input.chapters.length > 0 ? { chapters: input.chapters } : {}),
          ...(input.points && input.points.length > 0 ? { points: input.points } : {}),
          exclude: [...existing, ...chosenIds()],
        });
        for (const row of more) {
          if (added >= count) break;
          if (chosen.some((c) => c.id === row.id)) continue;
          chosen.push({ id: row.id, type: row.type });
          added += 1;
        }
      }
      detail.push({ type, requested: count, added, missing: Math.max(0, count - added) });
    }
  }

  let inserted = 0;
  // replaceExisting 时即使一道题都没挑到也要执行「清空」（与旧行为一致）
  if (chosen.length > 0 || input.replaceExisting) {
    // 生成后落分值/大题：老师按题型填的数量与分值，不必再逐题点一遍
    const meta = new Map<number, { score?: number; section?: string }>();
    for (const row of chosen) {
      const perType = input.scores?.[row.type as QuestionType];
      meta.set(row.id, {
        ...(input.sectionName ? { section: input.sectionName } : {}),
        ...(input.scorePerQuestion ? { score: input.scorePerQuestion } : {}),
        ...(perType !== undefined ? { score: perType } : {}),
      });
    }
    inserted = await deps.exams.applyComposition(examId, {
      replaceExisting: input.replaceExisting === true,
      questionIds: chosenIds(),
      meta,
    });
  }
  await writeAudit(deps, actor, 'exam.auto_compose', examId, {
    requested,
    added: inserted,
    detail,
    blueprintCells: cellsDetail.length,
  });
  return {
    added: inserted,
    requested,
    shortfall: Math.max(0, requested - inserted),
    scope: { mode: scope, courseId: scopeCourseId },
    detail,
    cells: cellsDetail,
    difficulty: (['easy', 'medium', 'hard'] as const).map((level) => ({
      level,
      requested: difficultyWanted[level],
      added: difficultyAdded[level],
    })),
    blueprint: buildBlueprint(await findExam(deps.exams, examId), await deps.exams.listQuestions(examId)),
  };
}
