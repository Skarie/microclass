/**
 * 学习统计服务：课时/课程维度的观看与刷题统计、CSV 导出、个人考试总览。
 */
import { AppError, type User } from '@microclass/shared';
import type { LessonStatRow, StatsRepository } from '../db/repositories/noteRepository.js';
import type { LessonRepository } from '../db/repositories/lessonRepository.js';
import type { CourseRepository } from '../db/repositories/courseRepository.js';
import type { ExamRepository } from '../db/repositories/examRepository.js';
import { toCsv } from '../utils/csv.js';

export interface LessonStats {
  lesson: { id: number; title: string };
  summary: {
    students: number;
    watched: number;
    finished: number;
    not_started: number;
    quizzed: number;
    not_quizzed: number;
    avg: number;
    best: number;
  };
  rows: LessonStatRow[];
}

export class StatsService {
  constructor(
    private readonly stats: StatsRepository,
    private readonly lessons: LessonRepository,
    private readonly courses: CourseRepository,
    private readonly exams: ExamRepository,
  ) {}

  lessonStats(lessonId: number): LessonStats {
    const lesson = this.lessons.findById(lessonId);
    if (!lesson) throw AppError.notFound('课时不存在');
    const rows = this.stats.lessonRows(lessonId);
    return { lesson: { id: lesson.id, title: lesson.title }, summary: this.stats.lessonSummary(rows), rows };
  }

  lessonStatsCsv(lessonId: number): { filename: string; body: string } {
    const { lesson, rows } = this.lessonStats(lessonId);
    return {
      filename: `${lesson.title}_学习统计.csv`,
      body: toCsv([
        ['学号', '姓名', '视频状态', '观看进度%', '是否刷题', '最好成绩', '刷题次数'],
        ...rows.map((r) => [
          r.username,
          r.display_name,
          r.finished ? '已完成' : r.watched ? '观看中' : '未开始',
          r.percent,
          r.quiz_done ? '是' : '否',
          r.best_score,
          r.attempts,
        ]),
      ]),
    };
  }

  /** 课程维度的汇总：每个课时的学生完成情况 */
  courseStats(courseId: number): {
    course: { id: number; name: string };
    summary: {
      lessons: number;
      students: number;
      avg_finish_rate: number;
      avg_quiz_rate: number;
    };
    lessons: {
      id: number;
      title: string;
      group_name: string;
      watched: number;
      finished: number;
      quizzed: number;
      finish_rate: number;
      quiz_rate: number;
      avg_score: number;
    }[];
  } {
    const course = this.courses.findById(courseId);
    if (!course) throw AppError.notFound('课程不存在');
    const lessons = this.lessons.listByCourse(courseId);
    const studentCount = this.stats.students().length;
    const rows = lessons.map((l) => {
      const statRows = this.stats.lessonRows(l.id);
      const summary = this.stats.lessonSummary(statRows);
      return {
        id: l.id,
        title: l.title,
        group_name: l.group_name,
        watched: summary.watched,
        finished: summary.finished,
        quizzed: summary.quizzed,
        finish_rate: summary.students > 0 ? Math.round((summary.finished / summary.students) * 1000) / 10 : 0,
        quiz_rate: summary.students > 0 ? Math.round((summary.quizzed / summary.students) * 1000) / 10 : 0,
        avg_score: summary.avg,
      };
    });
    const avgOf = (pick: (r: (typeof rows)[number]) => number): number =>
      rows.length > 0 ? Math.round((rows.reduce((a, r) => a + pick(r), 0) / rows.length) * 10) / 10 : 0;
    return {
      course: { id: course.id, name: course.name },
      summary: {
        lessons: rows.length,
        students: studentCount,
        avg_finish_rate: avgOf((r) => r.finish_rate),
        avg_quiz_rate: avgOf((r) => r.quiz_rate),
      },
      lessons: rows,
    };
  }

  courseStatsCsv(courseId: number): { filename: string; body: string } {
    const { course, lessons } = this.courseStats(courseId);
    return {
      filename: `${course.name}_课程统计.csv`,
      body: toCsv([
        ['章节', '课时', '观看人数', '完成人数', '刷题人数', '完成率%', '刷题率%', '平均成绩'],
        ...lessons.map((l) => [
          l.group_name || '未分章',
          l.title,
          l.watched,
          l.finished,
          l.quizzed,
          l.finish_rate,
          l.quiz_rate,
          l.avg_score,
        ]),
      ]),
    };
  }

  /** 个人学习总览：进度概览 + 考试成绩 + 错题数 */
  meOverview(viewer: User): {
    exams: ReturnType<ExamRepository['attemptsByUser']>;
    exam_summary: { attempts: number; passed: number; avg: number };
  } {
    const attempts = this.exams.attemptsByUser(viewer.id);
    const passed = attempts.filter((a) => a.passed === 1).length;
    const avg =
      attempts.length > 0 ? Math.round((attempts.reduce((a, x) => a + x.score, 0) / attempts.length) * 10) / 10 : 0;
    return { exams: attempts, exam_summary: { attempts: attempts.length, passed, avg } };
  }
}
