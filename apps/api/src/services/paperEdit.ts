/**
 * 卷内题目维护：批量加题、随机加题、改分值/大题、拖拽排序、删题。
 *
 * 都是「卷面小幅修改」，与组卷策略无关；每个动作校验考试存在并写审计。
 *
 * P0 阶段 2（批次 2）：落库（addQuestions/setQuestionMeta/reorder/removeQuestion）走 AsyncDb，
 * 全部 `await` 后再写审计 —— 审计只记录真正成功的改动。
 * 卷面缓存由调用方（`exam-paper-edit-service`）在写成功后失效。
 */
import { AppError, type User } from '@microclass/shared';
import { findExam, writeAudit, type ExamPaperDeps } from './paperCommon.js';
import { shuffle } from './quizService.js';

export async function addQuestions(
  deps: ExamPaperDeps,
  actor: User,
  examId: number,
  questionIds: number[],
): Promise<number> {
  await findExam(deps.exams, examId);
  const added = await deps.exams.addQuestions(examId, questionIds);
  await writeAudit(deps, actor, 'exam.add_questions', examId, { added });
  return added;
}

/** 随机抽题：默认在课程题池内排除已选题目 */
export async function addRandom(deps: ExamPaperDeps, actor: User, examId: number, count: number): Promise<number> {
  const exam = await findExam(deps.exams, examId);
  const have = new Set(await deps.exams.questionIds(examId));
  const candidates = (await deps.exams.pool(exam.course_id)).filter((q) => !have.has(q.id));
  const picked = shuffle(candidates)
    .slice(0, Math.max(1, count))
    .map((q) => q.id);
  const added = await deps.exams.addQuestions(examId, picked);
  await writeAudit(deps, actor, 'exam.add_random', examId, { requested: count, added });
  return added;
}

/** 改卷内某题的分值 / 大题分组 */
export async function setQuestionMeta(
  deps: ExamPaperDeps,
  actor: User,
  examId: number,
  questionId: number,
  meta: { score?: number; section?: string },
): Promise<void> {
  await findExam(deps.exams, examId);
  if (!(await deps.exams.questionInExam(examId, questionId))) throw AppError.notFound('这道题不在试卷里');
  await deps.exams.setQuestionMeta(examId, questionId, meta);
  await writeAudit(deps, actor, 'exam.question_meta', examId, { questionId, ...meta });
}

/** 重排卷内顺序（拖拽排序） */
export async function reorder(deps: ExamPaperDeps, actor: User, examId: number, questionIds: number[]): Promise<void> {
  await findExam(deps.exams, examId);
  await deps.exams.reorder(examId, questionIds);
  await writeAudit(deps, actor, 'exam.reorder', examId, { count: questionIds.length });
}

export async function removeQuestion(
  deps: ExamPaperDeps,
  actor: User,
  examId: number,
  questionId: number,
): Promise<void> {
  await findExam(deps.exams, examId);
  await deps.exams.removeQuestion(examId, questionId);
  await writeAudit(deps, actor, 'exam.remove_question', examId, { questionId });
}
