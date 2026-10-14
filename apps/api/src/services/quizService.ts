/**
 * 刷题服务：取题（隐藏答案/随机抽题）、提交判分、错题本、刷题记录。
 * 判分与解锁规则与 V1 保持一致（≥80% 观看解锁本地视频刷题）。
 */
import { AUTO_GRADED_TYPES, AppError, type Question, type User } from '@microclass/shared';
import type { QuestionRepository } from '../db/repositories/questionRepository.js';
import type { AttemptRepository, WrongQuestionRepository } from '../db/repositories/attemptRepository.js';
import type { LessonRepository } from '../db/repositories/lessonRepository.js';
import type { ProgressRepository } from '../db/repositories/progressRepository.js';
import type { LessonService } from './lessonService.js';
import { toViewer, type QuestionForViewer } from './bankService.js';
import { checkAnswer, fillBlankCount, parseOptions } from '../domain/question.js';

export interface QuizPayload {
  lesson: { id: number; title: string };
  questions: QuestionForViewer[];
  total: number;
  mode: string;
  unlocked: boolean;
}

export interface SubmitItem {
  qid: number;
  answer: string;
}

export interface GradedItem {
  qid: number;
  type: Question['type'];
  stem: string;
  options: string[];
  image_path: string;
  given: string;
  correct: boolean | null;
  answer: string;
  analysis: string;
}

export interface SubmitResult {
  attemptId: number;
  score: number;
  total: number;
  manual: number;
  best: number;
  results: GradedItem[];
}

export class QuizService {
  constructor(
    private readonly questions: QuestionRepository,
    private readonly attempts: AttemptRepository,
    private readonly wrongs: WrongQuestionRepository,
    private readonly lessonsRepo: LessonRepository,
    private readonly progress: ProgressRepository,
    private readonly lessonService: LessonService,
  ) {}

  /** 取题：随机打乱；count 指定时随机抽 count 题；仅教师/管理员可见答案 */
  quiz(viewer: User, lessonId: number, options?: { count?: number }): QuizPayload {
    const lesson = this.lessonsRepo.findById(lessonId);
    if (!lesson) throw AppError.notFound('视频单元不存在');
    const all = this.questions.listByLesson(lessonId);
    const count = Number(options?.count ?? 0);
    let picked = shuffle(all);
    let mode = 'all';
    if (count > 0 && count < all.length) {
      picked = picked.slice(0, count);
      mode = `random${count}`;
    }
    const withAnswer = viewer.role === 'teacher' || viewer.role === 'admin';
    return {
      lesson: { id: lesson.id, title: lesson.title },
      questions: picked.map((q) => toViewer(q, withAnswer)),
      total: picked.length,
      mode,
      unlocked: this.lessonService.isQuizUnlocked(viewer, lessonId),
    };
  }

  /** 提交判分：记录 attempt、更新错题本与课时最佳成绩 */
  submit(viewer: User, lessonId: number, answers: SubmitItem[], clientId?: string): SubmitResult {
    const lesson = this.lessonsRepo.findById(lessonId);
    if (!lesson) throw AppError.notFound('视频单元不存在');
    if (!this.lessonService.isQuizUnlocked(viewer, lessonId)) {
      throw AppError.forbidden('请先看完本视频（≥80%）再开始刷题');
    }

    const all = this.questions.listByLesson(lessonId);
    const byId = new Map(all.map((q) => [String(q.id), q]));
    const results: GradedItem[] = [];
    let score = 0;
    let manual = 0;

    for (const item of answers) {
      const q = byId.get(String(item.qid));
      if (!q) continue;
      const given = String(item.answer ?? '');
      const correct = checkAnswer(q, given);
      if (correct === true) score += 1;
      if (correct === null) manual += 1;
      results.push({
        qid: q.id,
        type: q.type,
        stem: q.stem,
        options: parseOptions(q.options),
        image_path: q.image_path,
        given,
        correct,
        answer: q.answer,
        analysis: q.analysis,
      });
    }

    // 错题本：答错收录并累加次数；答对则把未掌握的同类错题标记为已掌握
    for (const r of results) {
      if (r.correct === false && AUTO_GRADED_TYPES.includes(r.type)) {
        this.wrongs.upsertWrong(viewer.id, r.qid);
      } else if (r.correct === true) {
        this.wrongs.markMastered(viewer.id, r.qid);
      }
    }

    const total = all.length;
    const attemptId = this.attempts.create({
      userId: viewer.id,
      clientId: clientId ?? `user:${viewer.id}`,
      lessonId,
      answers: results.map((r) => ({ qid: r.qid, answer: r.given, correct: r.correct })),
      score,
      total,
    });

    // 刷题完成标记与最佳成绩（仓储内部按 MAX 保留历史最好成绩）
    if (total > 0) {
      this.progress.markQuizDone(viewer.id, lessonId, Math.round((score / total) * 100));
    }

    return {
      attemptId,
      score,
      total,
      manual,
      // 历史最好成绩按百分比返回（随机抽题时总题数不同，比较原始分没有意义）
      best: this.attempts.bestPercent(viewer.id, lessonId),
      results,
    };
  }

  /** 我的刷题记录 */
  myAttempts(
    viewer: User,
    options?: { lessonId?: number; limit?: number },
  ): {
    id: number;
    lesson_id: number;
    lesson_title: string;
    score: number;
    total: number;
    created_at: number;
  }[] {
    return this.attempts.listByUser(viewer.id, options).map((a) => ({
      id: a.id,
      lesson_id: a.lesson_id,
      lesson_title: this.lessonsRepo.findById(a.lesson_id)?.title ?? '',
      score: a.score,
      total: a.total,
      created_at: a.created_at,
    }));
  }

  /** 错题本列表（默认只看未掌握） */
  wrongBook(
    viewer: User,
    options?: { lessonId?: number; includeMastered?: boolean },
  ): {
    total: number;
    pending: number;
    items: (QuestionForViewer & { wrong_count: number; mastered: 0 | 1; last_at: number })[];
  } {
    const rows = this.wrongs.list(viewer.id, options);
    const counts = this.wrongs.count(viewer.id);
    return {
      ...counts,
      items: rows.map((r) => ({
        id: r.question_id,
        bank_id: r.bank_id,
        lesson_id: r.lesson_id,
        type: r.type as Question['type'],
        stem: r.stem,
        image_path: r.image_path,
        options: parseOptions(r.options),
        sort: 0,
        difficulty: '',
        difficulty_score: -1,
        difficulty_level: 3,
        difficulty_source: '',
        difficulty_n: 0,
        difficulty_p: null,
        blanks: fillBlankCount(r.type as Question['type'], r.answer),
        subject: '',
        stage: '',
        book: '',
        chapter: '',
        point: '',
        source_path: '',
        source_no: '',
        answer: r.answer,
        analysis: r.analysis,
        wrong_count: r.wrong_count,
        mastered: r.mastered,
        last_at: r.last_at,
      })),
    };
  }

  /** 标记/取消掌握 */
  setMastered(viewer: User, questionId: number, mastered: boolean): void {
    const q = this.questions.findById(questionId);
    if (!q) throw AppError.notFound('题目不存在');
    this.wrongs.setMastered(viewer.id, questionId, mastered);
  }

  /** 从错题本移除 */
  removeFromWrongBook(viewer: User, questionId: number): void {
    this.wrongs.remove(viewer.id, questionId);
  }
}

/** Fisher–Yates 洗牌（不改动入参） */
export function shuffle<T>(input: T[]): T[] {
  const a = input.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}
