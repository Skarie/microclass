/**
 * 平行卷（A/B 卷）：按原卷逐题配「同题型、同难度档、知识点尽量相同」的不同题，
 * 生成一场新考试，并沿用原卷的分值、大题、考试设置与试卷结构。
 *
 * 配对逻辑在 `paperParallel`（纯查询 + 匹配），这里只负责建卷、抄结构、逐题落分值。
 */
import { AppError, type User } from '@microclass/shared';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { ExamRepository } from '../db/repositories/examRepository.js';
import type { QuestionRepository } from '../db/repositories/questionRepository.js';
import { matchParallelQuestions, type ExamPaperDeps } from './exam-paper.js';
import type { ExamLifecycleService } from './exam-lifecycle-service.js';
import type { ExamPaperEditService } from './exam-paper-edit-service.js';

export class ExamParallelService {
  constructor(
    private readonly exams: ExamRepository,
    private readonly questions: QuestionRepository,
    private readonly audit: AuditRepository,
    private readonly lifecycle: ExamLifecycleService,
    private readonly paperEditor: ExamPaperEditService,
  ) {}

  private get paperDeps(): ExamPaperDeps {
    return { exams: this.exams, questions: this.questions, audit: this.audit };
  }

  parallelPaper(
    actor: User,
    examId: number,
    input: { title?: string; scope?: 'course' | 'all'; replaceExisting?: boolean } = {},
  ): {
    examId: number;
    title: string;
    requested: number;
    matched: number;
    shortfall: number;
    detail: { index: number; type: string; level: string; point: string; from: number; to: number | null }[];
  } {
    const source = this.lifecycle.findById(examId);
    const questions = this.exams.listQuestions(examId);
    if (questions.length === 0) throw AppError.badRequest('原卷里还没有题目，无法生成平行卷');

    const scope: 'course' | 'all' = input.scope === 'all' ? 'all' : 'course';
    const scopeCourseId = scope === 'all' ? undefined : source.course_id;

    const newId = this.lifecycle.create(actor, {
      courseId: source.course_id,
      title: (input.title ?? '').trim() !== '' ? String(input.title) : `${source.title}（平行卷）`,
      description: source.description,
      durationMinutes: source.duration_minutes,
      passScore: source.pass_score,
      status: 'draft',
      startAt: Number(source.start_at ?? 0),
      endAt: Number(source.end_at ?? 0),
      attemptLimit: Number(source.attempt_limit ?? 0),
      shuffleQuestions: Number(source.shuffle_questions ?? 0) === 1,
      showAnswers: Number(source.show_answers ?? 1) === 1,
    });
    if (input.replaceExisting) this.exams.clearQuestions(newId);
    // 沿用原卷的试卷结构与目标配比（分值也在下面逐题抄）
    this.exams.setStructure(
      newId,
      String(source.structure ?? '[]'),
      String(source.difficulty_target ?? ''),
      Number(source.total_score ?? 100),
    );

    const { pickedIds, pairs, detail } = matchParallelQuestions(this.paperDeps, questions, scopeCourseId);
    if (pickedIds.length > 0) this.paperEditor.addQuestions(actor, newId, pickedIds);
    // 逐题沿用分值与大题（第 i 道新题对应原卷第 i 道题）
    pairs.forEach(({ picked, from }) => {
      this.paperEditor.setQuestionMeta(actor, newId, picked, {
        score: Number(from.score ?? 0),
        section: String(from.section ?? ''),
      });
    });

    return {
      examId: newId,
      title: this.lifecycle.findById(newId).title,
      requested: questions.length,
      matched: pickedIds.length,
      shortfall: questions.length - pickedIds.length,
      detail,
    };
  }
}
