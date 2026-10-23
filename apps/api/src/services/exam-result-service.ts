/**
 * 成绩查询：个人成绩复盘、我的全部考试成绩、管理端成绩单与 CSV。
 *
 * 渲染与汇总在 `exam-report`（纯渲染，不读库）；本模块负责取考试、作答行与（缓存的）卷面。
 */
import { AppError, type User } from '@microclass/shared';
import type { ExamRepository } from '../db/repositories/examRepository.js';
import { buildMyResult, buildScoreSheet, buildScoreSheetCsv, type MyResult, type ScoreSheet } from './exam-report.js';
import type { ExamLifecycleService } from './exam-lifecycle-service.js';
import type { ExamPaperCache } from './exam-paper-cache.js';

export class ExamResultService {
  constructor(
    private readonly exams: ExamRepository,
    private readonly paperCache: ExamPaperCache,
    private readonly lifecycle: ExamLifecycleService,
  ) {}

  /** 我的成绩（含逐题结果，便于复盘） */
  myResult(viewer: User, examId: number): MyResult {
    const exam = this.lifecycle.findById(examId);
    const attempt = this.exams.findAttempt(examId, viewer.id);
    if (!attempt) throw AppError.notFound('暂无成绩');
    return buildMyResult(exam, attempt, this.paperCache.paperOf(examId), viewer);
  }

  /** 成绩单：全部学生作答 + 统计（管理端） */
  scoreSheet(examId: number): ScoreSheet {
    const exam = this.lifecycle.findById(examId);
    return buildScoreSheet(exam, this.exams.attemptsOf(examId));
  }

  /** 成绩单 CSV */
  scoreSheetCsv(examId: number): { filename: string; rows: unknown[][] } {
    return buildScoreSheetCsv(this.scoreSheet(examId));
  }

  /** 我的全部考试成绩 */
  myExams(viewer: User): {
    exam_id: number;
    exam_title: string;
    course_id: number;
    course_name: string;
    score: number;
    total: number;
    passed: 0 | 1;
    used_seconds: number;
    created_at: number;
  }[] {
    return this.exams.attemptsByUser(viewer.id).map((a) => ({
      exam_id: a.exam_id,
      exam_title: a.exam_title,
      course_id: a.course_id,
      course_name: a.course_name,
      score: a.score,
      total: a.total,
      passed: a.passed,
      used_seconds: a.used_seconds,
      created_at: a.created_at,
    }));
  }
}
