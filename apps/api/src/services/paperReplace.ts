/**
 * 换题 / 删题：候选项、按指定候选换题、自动换一题、加题与卷内编辑。
 *
 * 换题候选**不随机**：把级联匹配到的候选按匹配强度分组返回给老师挑。
 * 为什么改：原来的「换一题」是在 20 条里随机取一条，老师看不到换成了什么题，
 * 也没法比一比再决定。这里按匹配强度分组（同知识点同难度 → 同难度 → 相近难度 → 同题型），
 * 每组内按难度分接近程度排序，并带上题干/知识点/题库名。
 */
import { AppError, type User } from '@microclass/shared';
import { findExam, writeAudit, type ExamPaperDeps } from './paperCommon.js';
import type { PickQuery } from './paperRange.js';
import type { SimilarCandidatesResult } from './paperTypes.js';

export function similarCandidates(
  deps: ExamPaperDeps,
  examId: number,
  questionId: number,
  options?: { limit?: number },
): SimilarCandidatesResult {
  findExam(deps.exams, examId); // 校验考试存在（不关心返回值）
  const rows = deps.exams.listQuestions(examId);
  const current = rows.find((q) => q.id === questionId);
  if (!current) throw AppError.notFound('这道题不在试卷里');
  const limit = Math.min(20, Math.max(3, Number(options?.limit ?? 8) || 8));
  const inExam = new Set(deps.exams.questionIds(examId));
  const baseLevel = Number(current.difficulty_score ?? 50);
  const point = String(current.point ?? '');
  const currentDifficulty = String(current.difficulty ?? '');

  const attempts: { reason: string; query: Omit<PickQuery, 'limit'> }[] = [
    {
      reason: '同题型 + 同难度 + 同知识点',
      query: {
        type: current.type,
        ...(currentDifficulty ? { difficulty: currentDifficulty } : {}),
        ...(point ? { point } : {}),
      },
    },
    {
      reason: '同题型 + 同难度',
      query: { type: current.type, ...(currentDifficulty ? { difficulty: currentDifficulty } : {}) },
    },
    {
      reason: '同题型 + 相近难度（±15 分）',
      query: {
        type: current.type,
        levelMin: Math.max(0, baseLevel - 15),
        levelMax: Math.min(100, baseLevel + 15),
      },
    },
    { reason: '只保证同题型', query: { type: current.type } },
  ];

  const groups: SimilarCandidatesResult['groups'] = [];
  const seen = new Set<number>([questionId]);
  for (const attempt of attempts) {
    const picked = deps.exams.pick({
      ...attempt.query,
      exclude: [...inExam],
      limit: limit * 3,
    });
    const candidates = picked
      .filter((row) => !seen.has(row.id))
      .map((row) => {
        seen.add(row.id);
        return {
          id: row.id,
          stem: row.stem,
          type: row.type,
          difficulty: String(row.difficulty ?? ''),
          point: String(row.point ?? ''),
          level: Number(row.difficulty_score ?? 0),
          bankName: String(row.bank_name ?? ''),
          levelDelta: Math.abs(Number(row.difficulty_score ?? 50) - baseLevel),
        };
      })
      .sort((a, b) => a.levelDelta - b.levelDelta)
      .slice(0, limit);
    if (candidates.length > 0) groups.push({ reason: attempt.reason, candidates });
    if (groups.reduce((n, g) => n + g.candidates.length, 0) >= limit) break;
  }

  return {
    current: {
      id: current.id,
      stem: current.stem,
      type: current.type,
      difficulty: current.difficulty,
      point,
      level: baseLevel,
    },
    groups,
  };
}

/** 用**指定**的题替换试卷里的某题（老师从候选里挑中的那道） */
export function replaceWith(
  deps: ExamPaperDeps,
  actor: User,
  examId: number,
  questionId: number,
  withId: number,
): { ok: boolean; reason: string } {
  findExam(deps.exams, examId);
  const rows = deps.exams.listQuestions(examId);
  if (!rows.some((q) => q.id === questionId)) throw AppError.notFound('这道题不在试卷里');
  if (rows.some((q) => q.id === withId)) throw AppError.badRequest('这道题已经在试卷里了');
  // 目标题必须真实存在于题库（避免前端传来任意 id）
  const exists = deps.questions.findById(withId);
  if (!exists) throw AppError.notFound('要换上的题目不存在');
  deps.exams.replaceQuestion(examId, questionId, withId);
  writeAudit(deps, actor, 'exam.replace_question', examId, {
    from: questionId,
    to: withId,
    match: '手工挑选候选',
  });
  return { ok: true, reason: '手工挑选候选' };
}

export function replaceQuestion(
  deps: ExamPaperDeps,
  actor: User,
  examId: number,
  questionId: number,
  options?: { point?: string; difficulty?: string },
): { ok: boolean; replacedWith: number | null; reason: string } {
  findExam(deps.exams, examId);
  const current = deps.exams.listQuestions(examId).find((q) => q.id === questionId);
  if (!current) throw AppError.notFound('这道题不在试卷里');
  const inExam = new Set(deps.exams.questionIds(examId));
  const point = options?.point ?? current.point;
  const difficulty = options?.difficulty ?? current.difficulty;
  const attempts: { label: string; query: PickQuery }[] = [
    {
      label: '同题型 + 同难度 + 同知识点',
      query: { type: current.type, difficulty, ...(point ? { point } : {}), exclude: [...inExam] },
    },
    { label: '同题型 + 同难度', query: { type: current.type, difficulty, exclude: [...inExam] } },
    {
      label: '同题型 + 相近难度',
      query: {
        type: current.type,
        levelMin: Math.max(0, Number(current.difficulty_score ?? 50) - 15),
        levelMax: Math.min(100, Number(current.difficulty_score ?? 50) + 15),
        exclude: [...inExam],
      },
    },
    { label: '只保证同题型', query: { type: current.type, exclude: [...inExam] } },
  ];
  for (const attempt of attempts) {
    const rows = deps.exams.pick({ ...attempt.query, limit: 20 });
    if (rows.length === 0) continue;
    const next = rows[Math.floor(Math.random() * rows.length)];
    if (!next) continue;
    deps.exams.replaceQuestion(examId, questionId, next.id);
    writeAudit(deps, actor, 'exam.replace_question', examId, {
      from: questionId,
      to: next.id,
      match: attempt.label,
    });
    return { ok: true, replacedWith: next.id, reason: attempt.label };
  }
  return { ok: false, replacedWith: null, reason: '题池里没有可替换的同类型题目' };
}
