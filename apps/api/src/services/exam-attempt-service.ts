/**
 * 作答编排：取卷（发布状态 / 时间窗 / 次数 / 乱序）与交卷（重复校验、结束缓冲、判分、落库、审计）。
 *
 * 判分口径全部在 `exam-grade`（纯函数），卷面读取走共享的 `ExamPaperCache`；
 * 本模块只做权限/时间判断与写入。所有错误文案与重构前逐字一致。
 */
import { AppError, type Exam, type QuestionType, type User } from '@microclass/shared';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { ExamRepository } from '../db/repositories/examRepository.js';
import { toViewer, type QuestionForViewer } from '../domain/questionView.js';
import { gradeSubmission, slimResults, type ExamSubmitResult } from './exam-grade.js';
import type { ExamLifecycleService } from './exam-lifecycle-service.js';
import type { ExamPaperCache } from './exam-paper-cache.js';
import { shuffle } from './quizService.js';

export class ExamAttemptService {
  constructor(
    private readonly exams: ExamRepository,
    private readonly audit: AuditRepository,
    private readonly paperCache: ExamPaperCache,
    private readonly lifecycle: ExamLifecycleService,
  ) {}

  /** 取卷作答：已交卷返回 already，未发布仅管理端可见 */
  take(
    viewer: User,
    examId: number,
  ): {
    already: boolean;
    exam: Partial<Exam>;
    questions?: QuestionForViewer[];
    total?: number;
  } {
    const exam = this.lifecycle.findById(examId);
    const isManager = viewer.role === 'admin' || viewer.role === 'teacher';
    if (exam.status !== 'published' && !isManager) throw AppError.notFound('考试未发布');
    // 考试设置（学员才受限；老师随时可以查看卷子）
    if (!isManager) {
      const now = Math.floor(Date.now() / 1000);
      const startAt = Number(exam.start_at ?? 0);
      const endAt = Number(exam.end_at ?? 0);
      if (startAt > 0 && now < startAt) throw AppError.badRequest('考试还没开始，请到考试时间再作答');
      if (endAt > 0 && now > endAt) throw AppError.badRequest('考试已结束，不能再作答');
      const limit = Number(exam.attempt_limit ?? 0);
      if (limit > 0) {
        const used = this.exams.attemptCount(examId, viewer.id);
        if (used >= limit) throw AppError.badRequest(`本场考试允许作答 ${limit} 次，已用完`);
      }
    }
    const previous = this.exams.findAttempt(examId, viewer.id);
    const questions = this.exams.listQuestions(examId).map((q) =>
      toViewer(
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
        isManager,
      ),
    );
    if (previous) {
      return { already: true, exam: { id: exam.id, title: exam.title, pass_score: exam.pass_score } };
    }
    // 题目乱序（学习通里的"题目顺序随机"）：只打乱展示顺序，判分仍然按题号
    const ordered = exam.shuffle_questions ? shuffle(questions) : questions;
    return {
      already: false,
      exam: {
        id: exam.id,
        title: exam.title,
        description: exam.description,
        duration_minutes: exam.duration_minutes,
        pass_score: exam.pass_score,
        show_answers: Number(exam.show_answers ?? 1) === 1 ? 1 : 0,
      },
      questions: ordered,
      total: ordered.length,
    };
  }

  /** 交卷：一次性作答，重复交卷被拒；用时上限为限时 + 30 秒缓冲 */
  submit(
    viewer: User,
    examId: number,
    answers: { qid: number; answer: string }[],
    startedAt?: number,
  ): ExamSubmitResult {
    const exam = this.lifecycle.findById(examId);
    const isManager = viewer.role === 'admin' || viewer.role === 'teacher';
    if (exam.status !== 'published' && !isManager) throw AppError.notFound('考试未发布');
    if (this.exams.findAttempt(examId, viewer.id)) throw AppError.badRequest('本场考试已交卷，不能重复作答');
    if (!isManager) {
      const now = Math.floor(Date.now() / 1000);
      const endAt = Number(exam.end_at ?? 0);
      // 结束时间给 2 分钟缓冲：学生卡在最后几秒交卷不该被判无效
      if (endAt > 0 && now > endAt + 120) throw AppError.badRequest('考试已结束，不能再交卷');
    }

    const paper = this.paperCache.paperOf(examId);
    if (paper.length === 0) throw AppError.badRequest('本场考试还没有组卷');

    // 判分口径全部在 exam-grade（纯函数），这里只负责取卷面、算用时与落库
    const graded = gradeSubmission({
      paper,
      answers,
      totalScore: Number(exam.total_score ?? 100),
      passScore: exam.pass_score,
    });
    const started = startedAt !== undefined && startedAt > 0 ? startedAt : Date.now();
    const usedSeconds = Math.min(
      exam.duration_minutes * 60 + 30,
      Math.max(0, Math.floor((Date.now() - started) / 1000)),
    );
    /**
     * 存库只留判分必需的四元组：题干/选项/解析在成绩页按卷面重建。
     * 否则一份 1000 题的卷要写 3~4MB JSON，几十人同时交卷就把写入排队成秒级。
     */
    const attemptId = this.exams.createAttempt({
      examId,
      userId: viewer.id,
      answers: slimResults(graded.results),
      score: graded.score,
      total: graded.total,
      passed: graded.passed,
      usedSeconds,
    });
    this.audit.writeBuffered({
      actorId: viewer.id,
      actorName: viewer.username,
      action: 'exam.submit',
      targetType: 'exam',
      targetId: examId,
      detail: { score: graded.score, total: graded.total, passed: graded.passed },
    });
    return {
      attemptId,
      score: graded.score,
      total: graded.total,
      passed: graded.passed,
      need: graded.need,
      usedSeconds,
      manual: graded.manual,
    };
  }
}
