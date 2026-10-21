/**
 * 卷内题目维护：批量加题、随机加题、改分值/大题、拖拽排序、删题。
 *
 * 都是「卷面小幅修改」，与组卷策略无关；每个动作校验考试存在并写审计。
 */
import { AppError, type User } from '@microclass/shared';
import { findExam, writeAudit, type ExamPaperDeps } from './paperCommon.js';
import { shuffle } from './quizService.js';

export function addQuestions(deps: ExamPaperDeps, actor: User, examId: number, questionIds: number[]): number {
  findExam(deps.exams, examId);
  const added = deps.exams.addQuestions(examId, questionIds);
  writeAudit(deps, actor, 'exam.add_questions', examId, { added });
  return added;
}

/** 随机抽题：默认在课程题池内排除已选题目 */
export function addRandom(deps: ExamPaperDeps, actor: User, examId: number, count: number): number {
  const exam = findExam(deps.exams, examId);
  const have = new Set(deps.exams.questionIds(examId));
  const candidates = deps.exams.pool(exam.course_id).filter((q) => !have.has(q.id));
  const picked = shuffle(candidates)
    .slice(0, Math.max(1, count))
    .map((q) => q.id);
  const added = deps.exams.addQuestions(examId, picked);
  writeAudit(deps, actor, 'exam.add_random', examId, { requested: count, added });
  return added;
}

/** 改卷内某题的分值 / 大题分组 */
export function setQuestionMeta(
  deps: ExamPaperDeps,
  actor: User,
  examId: number,
  questionId: number,
  meta: { score?: number; section?: string },
): void {
  findExam(deps.exams, examId);
  if (!deps.exams.questionInExam(examId, questionId)) throw AppError.notFound('这道题不在试卷里');
  deps.exams.setQuestionMeta(examId, questionId, meta);
  writeAudit(deps, actor, 'exam.question_meta', examId, { questionId, ...meta });
}

/** 重排卷内顺序（拖拽排序） */
export function reorder(deps: ExamPaperDeps, actor: User, examId: number, questionIds: number[]): void {
  findExam(deps.exams, examId);
  deps.exams.reorder(examId, questionIds);
  writeAudit(deps, actor, 'exam.reorder', examId, { count: questionIds.length });
}

export function removeQuestion(deps: ExamPaperDeps, actor: User, examId: number, questionId: number): void {
  findExam(deps.exams, examId);
  deps.exams.removeQuestion(examId, questionId);
  writeAudit(deps, actor, 'exam.remove_question', examId, { questionId });
}
