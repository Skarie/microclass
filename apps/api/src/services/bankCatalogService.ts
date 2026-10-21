/**
 * 题库目录与跨聚合编排：课程 → 章节 → 小节 → 题库导航、按册次批量归属课程、
 * 以及「整卷题库一键建考试」。不负责题库自身的增删改。
 */
import { AppError, type User } from '@microclass/shared';
import type { BankKind, BankRepository } from '../db/repositories/bankRepository.js';
import { normalizeBookKey } from '../db/repositories/bankRepository.js';
import type { QuestionRepository } from '../db/repositories/questionRepository.js';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { ExamService } from './examService.js';

export class BankCatalogService {
  constructor(
    private readonly banks: BankRepository,
    private readonly questions: QuestionRepository,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * 筛选树第一层：课程列表。
   *
   * 原来题库只能按「课时 / 类型 / 书册」平铺筛，7,000+ 个章节题库与整卷试卷
   * 因为不挂课时而根本筛不出来；现在统一按「课程 → 章节 → 小节 → 题库」组织。
   */
  catalog(kind: BankKind | '' = ''): {
    courses: ReturnType<BankRepository['catalogCourses']>;
    unbound: { bankCount: number; questionCount: number };
    /** 未归属课程按册次分组（复习类/未建课程的册次仍能分类导航） */
    unboundBooks: ReturnType<BankRepository['catalogUnboundBooks']>;
    binding: { bound: number; unbound: number; banks: number };
  } {
    return {
      courses: this.banks.catalogCourses(kind),
      unbound: this.banks.catalogUnbound(kind),
      unboundBooks: this.banks.catalogUnboundBooks(kind),
      binding: this.banks.courseBindingStats(kind)[0] ?? { bound: 0, unbound: 0, banks: 0 },
    };
  }

  /** 某门课的章节 → 小节 → 题库 目录 */
  catalogCourse(courseId: number): ReturnType<BankRepository['catalogCourse']> {
    const res = this.banks.catalogCourse(courseId);
    if (!res.course) throw AppError.notFound('课程不存在');
    return res;
  }

  /**
   * 把某个**册次**下所有未归属题库挂到指定课程（courseId 为 null 表示移出课程）。
   * 界面「未归属课程 → 按册次」里的批量操作走这里，避免 1700+ 个题库一个个点。
   */
  bindUnboundByBook(
    actor: User,
    book: string,
    courseId: number | null,
  ): { updated: number; book: string; courseId: number | null; courseName: string } {
    const name = book.trim();
    if (!name) throw AppError.badRequest('册次不能为空');
    let courseName = '';
    if (courseId !== null) {
      // 用仓储已有的课程目录查询做存在性校验（不存在会抛 notFound），顺便拿课程名
      const course = this.banks.catalogCourse(courseId).course;
      if (!course) throw AppError.notFound('课程不存在');
      courseName = course.name;
    }
    const updated = this.banks.bindUnboundByBook(name, courseId);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'bank.bindByBook',
      targetType: 'course',
      targetId: courseId ?? 0,
      detail: { book: name, updated, courseId },
    });
    return { updated, book: name, courseId, courseName };
  }

  /**
   * 一键回填「题库归属课程」：
   *   1) 课时配套题库按 lesson → course 直接归属；
   *   2) 章节题库 / 整卷试卷按册次匹配（课程名 `·` 之后的册次 vs `banks.book`，取最长匹配）；
   *   3) 匹配不上的留在「未归属课程」，界面里可手工挂。
   */
  rebindCourses(actor: User): {
    byLesson: number;
    byBook: number;
    unmatched: number;
    unmatchedBooks: { book: string; banks: number }[];
    binding: { bound: number; unbound: number; banks: number };
  } {
    const byLesson = this.banks.bindCourseByLesson();
    const courses = this.banks.courseBookKeys().filter((c) => c.key !== '');
    const unbound = this.banks.unboundWithBook();
    const updates: { bankId: number; courseId: number }[] = [];
    for (const bank of unbound) {
      const book = normalizeBookKey(bank.book);
      if (!book) continue;
      let best: { id: number; key: string } | undefined;
      for (const course of courses) {
        const key = normalizeBookKey(course.key);
        if (!key) continue;
        const hit =
          book === key || book.startsWith(key) || key.endsWith(book) || (book.length >= 3 && key.includes(book));
        if (!hit) continue;
        if (!best || key.length > best.key.length) best = { id: course.id, key };
      }
      if (best) updates.push({ bankId: bank.id, courseId: best.id });
    }
    const byBook = this.banks.setCourseBindings(updates);
    const stillUnbound = this.banks.unboundWithBook();
    const grouped = new Map<string, number>();
    for (const bank of stillUnbound) {
      const key = String(bank.book ?? '').trim() || '(无册次信息)';
      grouped.set(key, (grouped.get(key) ?? 0) + 1);
    }
    const unmatchedBooks = [...grouped.entries()]
      .map(([book, banks]) => ({ book, banks }))
      .sort((a, b) => b.banks - a.banks);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'bank.rebind_courses',
      targetType: 'bank',
      detail: { byLesson, byBook, unmatched: stillUnbound.length },
    });
    return {
      byLesson,
      byBook,
      unmatched: stillUnbound.length,
      unmatchedBooks: unmatchedBooks.slice(0, 20),
      binding: this.banks.courseBindingStats()[0] ?? { bound: 0, unbound: 0, banks: 0 },
    };
  }

  /**
   * 整卷试卷题库 → 一键建考试（多样化：导入进来的期中/期末/单元测试卷可以直接变成一场考试）。
   * 返回考试 id 与加入的题目数；试卷为空时拒绝（避免建出空考试）。
   */
  createExamFromBank(
    actor: User,
    bankId: number,
    input: { courseId: number; title?: string; durationMinutes?: number; passScore?: number; publish?: boolean },
    examService: ExamService,
  ): { examId: number; questions: number } {
    const bank = this.banks.findById(bankId);
    if (!bank) throw AppError.notFound('题库不存在');
    const rows = this.questions.listByBank(bankId);
    if (rows.length === 0) throw AppError.badRequest('这个题库还没有题目，无法建考试');
    if (!Number.isInteger(input.courseId) || input.courseId <= 0) {
      throw AppError.badRequest('请选择要挂到哪门课程（考试必须属于一门课程）');
    }
    const title = (input.title ?? bank.name).trim().slice(0, 100) || bank.name;
    // 课程是否存在由 ExamService.prepare 校验（它持有课程仓储），这里不重复实现
    const examId = examService.create(actor, {
      courseId: input.courseId,
      title,
      description: `由题库「${bank.name}」一键生成（共 ${rows.length} 题）`,
      ...(input.durationMinutes ? { durationMinutes: Math.max(1, Math.floor(input.durationMinutes)) } : {}),
      ...(input.passScore ? { passScore: Math.max(0, Math.floor(input.passScore)) } : {}),
      status: input.publish === false ? 'draft' : 'published',
    });
    const added = examService.addQuestions(
      actor,
      examId,
      rows.map((q) => q.id),
    );
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'bank.create_exam',
      targetType: 'exam',
      targetId: examId,
      detail: { bankId, questions: added },
    });
    return { examId, questions: added };
  }
}
