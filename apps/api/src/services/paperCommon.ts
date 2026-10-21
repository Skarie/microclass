/**
 * 试卷领域的公共依赖：仓储集合、考试存在性校验、卷面视图与审计写入。
 *
 * 所有 paper* 模块都以显式依赖对象 `ExamPaperDeps` 调用仓储、不读 `this`，
 * 便于单独推理（与原 `exam-paper.ts` 的约定一致）。
 */
import { AppError, type Exam, type QuestionType, type User } from '@microclass/shared';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { ExamRepository } from '../db/repositories/examRepository.js';
import type { QuestionRepository } from '../db/repositories/questionRepository.js';
import { toViewer, type QuestionForViewer } from '../domain/questionView.js';

/** 组卷/结构/换题所需的仓储（由 `ExamService` 注入，避免本模块依赖服务实例） */
export interface ExamPaperDeps {
  exams: ExamRepository;
  questions: QuestionRepository;
  audit: AuditRepository;
}

/** 卷面行（exam_questions JOIN questions，含卷面分值与大题） */
export type PaperRow = ReturnType<ExamRepository['listQuestions']>[number];

/** 考试不存在时的错误口径与 `ExamService.findById` 一致 */
export function findExam(exams: ExamRepository, examId: number): Exam {
  const exam = exams.findById(examId);
  if (!exam) throw AppError.notFound('考试不存在');
  return exam;
}

/** 组卷视图：已选题目（学员视角）+ 卷面专属的分值/大题 */
export function paperView(rows: PaperRow[]): QuestionForViewer[] {
  return rows.map((q) => ({
    ...toViewer(
      {
        id: q.id,
        bank_id: q.bank_id,
        lesson_id: q.lesson_id,
        type: q.type as QuestionType,
        stem: q.stem,
        image_path: q.image_path,
        options: q.options,
        answer: q.answer,
        analysis: q.analysis,
        sort: q.sort,
        created_at: 0,
        difficulty: q.difficulty ?? '',
      },
      true,
    ),
    /**
     * 卷面专属字段：**分值**与**所属大题**（exam_questions 上的列）。
     * 之前 `/paper` 只返回学员视角的题目，组卷页拿不到分值/大题，
     * 于是"改分值/改大题"在界面上看起来毫无反应 —— 补上这两个字段。
     */
    score: Number(q.score ?? 0),
    section: String(q.section ?? ''),
  }));
}

/** 统一写审计：各领域动作只保留业务差异（action/detail） */
export function writeAudit(deps: ExamPaperDeps, actor: User, action: string, examId: number, detail?: unknown): void {
  deps.audit.write({
    actorId: actor.id,
    actorName: actor.username,
    action,
    targetType: 'exam',
    targetId: examId,
    ...(detail === undefined ? {} : { detail }),
  });
}
