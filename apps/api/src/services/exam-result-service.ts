/**
 * 成绩查询：个人成绩复盘、我的全部考试成绩、管理端成绩单与 CSV。
 *
 * 渲染与汇总在 `exam-report`（纯渲染，不读库）；本模块负责取考试、作答行与（缓存的）卷面。
 *
 * P0 阶段 2（批次 1）：成绩查询全部是只读，考试/作答/卷面读取走 AsyncDb，方法均为 async。
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
  async myResult(viewer: User, examId: number): Promise<MyResult> {
    const exam = await this.lifecycle.findById(examId);
    const attempt = await this.exams.findAttempt(examId, viewer.id);
    if (!attempt) throw AppError.notFound('暂无成绩');
    return buildMyResult(exam, attempt, await this.paperCache.paperOf(examId), viewer);
  }

  /** 成绩单：全部学生作答 + 统计（管理端） */
  async scoreSheet(examId: number): Promise<ScoreSheet> {
    const exam = await this.lifecycle.findById(examId);
    return buildScoreSheet(exam, await this.exams.attemptsOf(examId));
  }

  /** 成绩单 CSV */
  async scoreSheetCsv(examId: number): Promise<{ filename: string; rows: unknown[][] }> {
    return buildScoreSheetCsv(await this.scoreSheet(examId));
  }

  /** 我的全部考试成绩 */
  async myExams(viewer: User): Promise<
    {
      exam_id: number;
      exam_title: string;
      course_id: number;
      course_name: string;
      score: number;
      total: number;
      passed: 0 | 1;
      used_seconds: number;
      created_at: number;
    }[]
  > {
    const rows = await this.exams.attemptsByUser(viewer.id);
    return rows.map((a) => ({
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
