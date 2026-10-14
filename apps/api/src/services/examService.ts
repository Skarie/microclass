/**
 * 考试服务：组卷（手工选题 / 随机抽题 / 按题型配额组卷）、限时作答、
 * 交卷判分（含及格线）、成绩单与个人成绩。
 *
 * 与 V1 的差异（均为修正）：V1 组卷查询漏了 `WHERE eq.exam_id = ?`，
 * 会把全库题目当作本卷题目；V2 严格按考试过滤。
 */
import { AppError, type Exam, type QuestionType, type User } from '@microclass/shared';
import type { ExamAttempt, ExamRepository, ExamWithStats } from '../db/repositories/examRepository.js';
import type { CourseRepository } from '../db/repositories/courseRepository.js';
import type { QuestionRepository } from '../db/repositories/questionRepository.js';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { QuestionForViewer } from './bankService.js';
import { toViewer } from './bankService.js';
import type { QuestionMediaStore } from './questionMediaStore.js';
import { buildDocx, type DocxBlock, type DocxImage } from '../utils/docx.js';
import { inlineImagesToDocx } from '../utils/questionDocxImages.js';
import { orderCellsForPick, type BlueprintCell } from '../domain/blueprint.js';
import { checkAnswer, parseOptions } from '../domain/question.js';
import { shuffle } from './quizService.js';
import { DEFAULT_PAPER_OPTIONS, buildSections, renderPaperHtml, type PaperRenderOptions } from '../domain/paperHtml.js';

/** 试卷大题习惯用中文序号（一、单选题 二、填空题…） */
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/** 题型中文名（试卷导出 Word 用） */
const TYPE_LABEL_CN: Record<string, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  fill: '填空题',
  short: '简答题',
};

function cnNumber(n: number): string {
  return CN_NUM[n - 1] ?? String(n);
}

/** 题型中文名（大题默认名与细目表展示用） */
const TYPE_NAME: Record<string, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  fill: '填空题',
  short: '简答题',
};

export interface ExamDto {
  courseId: number;
  title: string;
  description?: string;
  durationMinutes?: number;
  passScore?: number;
  status?: Exam['status'];
  /** 考试设置（对标学习通）：时间窗口 / 作答次数 / 题目乱序 / 交卷后公布答案 */
  startAt?: number;
  endAt?: number;
  attemptLimit?: number;
  shuffleQuestions?: boolean;
  showAnswers?: boolean;
}

export interface ExamGradedItem {
  qid: number;
  type: QuestionType;
  stem: string;
  options: string[];
  image_path: string;
  given: string;
  correct: boolean | null;
  answer: string;
  analysis: string;
  /** 该题满分（按试卷分值计算；没设分值时为折算值） */
  score?: number;
}

export interface ExamSubmitResult {
  attemptId: number;
  score: number;
  total: number;
  passed: boolean;
  need: number;
  usedSeconds: number;
  manual: number;
  results: ExamGradedItem[];
}

/** 试卷结构（大题）解析：坏数据不炸，退化成空数组 */
function parseStructure(raw: unknown): { name: string; type: string; score: number; description: string }[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => {
      const row = (item ?? {}) as Record<string, unknown>;
      return {
        name: typeof row.name === 'string' ? row.name : '',
        type: typeof row.type === 'string' ? row.type : '',
        score: Number(row.score) || 0,
        description: typeof row.description === 'string' ? row.description : '',
      };
    });
  } catch {
    return [];
  }
}

export class ExamService {
  constructor(
    private readonly exams: ExamRepository,
    private readonly courses: CourseRepository,
    private readonly audit: AuditRepository,
    /** 换题时要校验"要换上的题"确实存在，因此需要题库仓储 */
    private readonly questions: QuestionRepository,
    /** 试卷导出 Word 时要内联题图（与题库导出同一套工具） */
    private readonly media: QuestionMediaStore,
  ) {}

  /** 课程下的考试列表；学生只看已发布，且带自己的最近成绩 */
  listForCourse(viewer: User, courseId: number): { course: { id: number; name: string }; exams: unknown[] } {
    const course = this.courses.findById(courseId);
    if (!course) throw AppError.notFound('课程不存在');
    const isManager = viewer.role === 'admin' || viewer.role === 'teacher';
    const exams = this.exams
      .listByCourseWithStats(courseId, isManager ? null : viewer.id)
      .filter((e) => isManager || e.status === 'published')
      .map((e: ExamWithStats & { my: ExamAttempt | null }) => ({
        ...e,
        qcount: e.question_count,
        my: e.my
          ? {
              score: e.my.score,
              total: e.my.total,
              passed: e.my.passed,
              used_seconds: e.my.used_seconds,
              created_at: e.my.created_at,
            }
          : null,
      }));
    return { course: { id: course.id, name: course.name }, exams };
  }

  findById(examId: number): Exam {
    const exam = this.exams.findById(examId);
    if (!exam) throw AppError.notFound('考试不存在');
    return exam;
  }

  create(actor: User, input: ExamDto): number {
    const prepared = this.prepare(input);
    const id = this.exams.create(prepared);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'exam.create',
      targetType: 'exam',
      targetId: id,
      detail: { courseId: prepared.courseId, title: prepared.title },
    });
    return id;
  }

  update(actor: User, examId: number, input: ExamDto): void {
    this.findById(examId);
    const prepared = this.prepare(input);
    this.exams.update(examId, prepared);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'exam.update',
      targetType: 'exam',
      targetId: examId,
    });
  }

  remove(actor: User, examId: number): void {
    const exam = this.findById(examId);
    this.exams.delete(examId);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'exam.delete',
      targetType: 'exam',
      targetId: examId,
      detail: { title: exam.title },
    });
  }

  /** 组卷视图：已选题目 + 课程范围内的候选题池 */
  paper(examId: number): {
    exam: Exam;
    questions: QuestionForViewer[];
    pool: { id: number; stem: string; type: string; inExam: boolean }[];
  } {
    const exam = this.findById(examId);
    const selected = this.exams.listQuestions(examId);
    const inExam = new Set(selected.map((q) => q.id));
    const pool = this.exams.pool(exam.course_id).map((q) => ({
      id: q.id,
      stem: q.stem,
      type: q.type,
      inExam: inExam.has(q.id),
    }));
    return {
      exam,
      questions: selected.map((q) => ({
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
      })),
      pool,
    };
  }

  /**
   * 组卷工作台用：卷面统计 + 双向细目表（知识点 × 题型 × 难度）。
   *
   * 参考主流组卷系统（智学网一类）的「试题篮」：老师需要随时看到
   * 「多少题、多少分、各题型几道、难度配比对不对、知识点覆盖了哪些、离目标还差什么」。
   */
  /**
   * 导出试卷 Word（.docx）：版式与题库导出一致，题图内联，可按需带答案解析。
   * 为什么要有它：老师交卷给教研/印刷时常用 Word 二次排版，PDF 打印解决不了这个需求。
   */
  paperDocx(examId: number, options?: { withAnswers?: boolean }): { filename: string; body: Buffer } {
    const exam = this.findById(examId);
    const withAnswers = options?.withAnswers !== false;
    // 用 listQuestions：它是卷内题目的原始行（含 score / section / answer / analysis），
    // 而 paper() 给的是学员视角的题目（没有分值与答案），导出 Word 不够用。
    const questions = this.exams.listQuestions(examId);

    const blocks: DocxBlock[] = [
      { type: 'title', text: exam.title },
      {
        type: 'subtitle',
        text: `共 ${questions.length} 题 · 满分 ${Number(exam.total_score ?? 100)} 分 · 限时 ${exam.duration_minutes} 分钟 · 及格 ${exam.pass_score}%`,
      },
    ];
    const images: DocxImage[] = [];

    let lastSection = '';
    questions.forEach((q, i) => {
      const section = String(q.section ?? '');
      if (section !== '' && section !== lastSection) {
        blocks.push({ type: 'heading', text: section });
        lastSection = section;
      }
      blocks.push({
        type: 'heading2',
        text: `${i + 1}. ${TYPE_LABEL_CN[q.type] ?? q.type}（${Number(q.score) || 0} 分）`,
      });
      blocks.push({
        type: 'text',
        text: inlineImagesToDocx(String(q.stem ?? ''), images, (file) => this.media.resolve(file)),
      });

      const optionTexts = parseOptions(String(q.options ?? '[]'));
      const isChoice = q.type === 'single' || q.type === 'multiple';
      optionTexts.forEach((opt, oi) => {
        const label = String.fromCharCode(65 + oi);
        blocks.push({
          type: 'option',
          text: `${label}. ${inlineImagesToDocx(opt, images, (file) => this.media.resolve(file))}`,
        });
      });
      void isChoice;

      if (withAnswers) {
        blocks.push({ type: 'answer', text: `答案：${String(q.answer ?? '') || '（未录入）'}` });
        const analysis = String(q.analysis ?? '');
        if (analysis.trim() !== '') {
          blocks.push({
            type: 'analysis',
            text: `解析：${inlineImagesToDocx(analysis, images, (file) => this.media.resolve(file))}`,
          });
        }
      }
      blocks.push({ type: 'divider', text: '' });
    });

    return { filename: `${exam.title}_试卷.docx`, body: buildDocx({ title: exam.title, blocks, images }) };
  }

  blueprint(examId: number): {
    exam: Exam;
    stats: {
      questions: number;
      totalScore: number;
      configuredScore: number;
      averageScorePerQuestion: number;
      estimatedMinutes: number;
      byType: { type: string; count: number; score: number }[];
      byDifficulty: { difficulty: string; count: number; score: number }[];
      byLevel: { level: number; count: number }[];
      withImage: number;
    };
    /** 目标难度配比与达成情况 */
    target: {
      ratio: Partial<Record<'easy' | 'medium' | 'hard', number>>;
      actual: Partial<Record<'easy' | 'medium' | 'hard', number>>;
      diff: Partial<Record<'easy' | 'medium' | 'hard', number>>;
    };
    /** 双向细目表：一行一个知识点，列是题型 × 难度 */
    matrix: {
      point: string;
      total: number;
      cells: { type: string; easy: number; medium: number; hard: number }[];
    }[];
    sections: { name: string; count: number; score: number }[];
    /** 缺口提示（题型/难度差多少题），供「智能组卷」参考 */
    suggestions: string[];
  } {
    const exam = this.findById(examId);
    const rows = this.exams.listQuestions(examId);
    const typeLabels: Record<string, string> = {
      single: '单选题',
      multiple: '多选题',
      judge: '判断题',
      fill: '填空题',
      short: '简答题',
    };
    const bucketOf = (row: { difficulty: string; difficulty_score: number }): 'easy' | 'medium' | 'hard' => {
      if (row.difficulty === 'easy' || row.difficulty === 'medium' || row.difficulty === 'hard') return row.difficulty;
      const score = Number(row.difficulty_score ?? -1);
      if (score < 0) return 'medium';
      if (score < 42) return 'easy';
      if (score < 71) return 'medium';
      return 'hard';
    };
    const fallbackScore = rows.length > 0 ? Number(exam.total_score ?? 100) / rows.length : 0;
    const scoreOf = (row: { score: number }): number =>
      Number(row.score) > 0 ? Number(row.score) : Math.round(fallbackScore * 10) / 10;

    const byType = new Map<string, { type: string; count: number; score: number }>();
    const byDifficulty = new Map<string, { difficulty: string; count: number; score: number }>();
    const levelCount = new Map<number, number>();
    const matrix = new Map<string, Map<string, { easy: number; medium: number; hard: number }>>();
    const sections = new Map<string, { name: string; count: number; score: number }>();
    let configuredScore = 0;
    const withImage = rows.filter((row) => String(row.image_path ?? '') !== '').length;

    for (const row of rows) {
      const score = scoreOf(row);
      configuredScore += score;
      const t = byType.get(row.type) ?? { type: row.type, count: 0, score: 0 };
      t.count += 1;
      t.score += score;
      byType.set(row.type, t);

      const bucket = bucketOf(row);
      const d = byDifficulty.get(bucket) ?? { difficulty: bucket, count: 0, score: 0 };
      d.count += 1;
      d.score += score;
      byDifficulty.set(bucket, d);

      const level =
        Number(row.difficulty_score ?? -1) < 0 ? 3 : Math.min(5, Math.floor(Number(row.difficulty_score) / 20) + 1);
      levelCount.set(level, (levelCount.get(level) ?? 0) + 1);

      const point = row.point || '未标知识点';
      const rowCells = matrix.get(point) ?? new Map<string, { easy: number; medium: number; hard: number }>();
      const cell = rowCells.get(row.type) ?? { easy: 0, medium: 0, hard: 0 };
      cell[bucket] += 1;
      rowCells.set(row.type, cell);
      matrix.set(point, rowCells);

      const sectionName = row.section || '未分组';
      const s = sections.get(sectionName) ?? { name: sectionName, count: 0, score: 0 };
      s.count += 1;
      s.score += score;
      sections.set(sectionName, s);
    }

    const actualRatio: Partial<Record<'easy' | 'medium' | 'hard', number>> = {};
    for (const [key, value] of byDifficulty) {
      actualRatio[key as 'easy' | 'medium' | 'hard'] =
        rows.length > 0 ? Math.round((value.count / rows.length) * 100) / 100 : 0;
    }
    let targetRatio: Partial<Record<'easy' | 'medium' | 'hard', number>> = {};
    if (exam.difficulty_target) {
      try {
        targetRatio = JSON.parse(exam.difficulty_target) as Partial<Record<'easy' | 'medium' | 'hard', number>>;
      } catch {
        targetRatio = {};
      }
    }
    const diff: Partial<Record<'easy' | 'medium' | 'hard', number>> = {};
    for (const key of ['easy', 'medium', 'hard'] as const) {
      if (targetRatio[key] === undefined) continue;
      diff[key] = Math.round(((actualRatio[key] ?? 0) - (targetRatio[key] ?? 0)) * 100) / 100;
    }
    const suggestions: string[] = [];
    for (const [key, want] of Object.entries(targetRatio)) {
      const wantCount = Math.round((want ?? 0) * rows.length);
      const haveCount = byDifficulty.get(key)?.count ?? 0;
      if (haveCount < wantCount) {
        suggestions.push(
          `建议再加 ${wantCount - haveCount} 道${typeLabels[key] ?? key}…… 难度「${key}」题（当前 ${haveCount} 道）`,
        );
      }
    }

    return {
      exam,
      stats: {
        questions: rows.length,
        totalScore: Number(exam.total_score ?? 100),
        configuredScore: Math.round(configuredScore * 10) / 10,
        averageScorePerQuestion: Math.round(fallbackScore * 10) / 10,
        estimatedMinutes: Math.max(5, Math.round(rows.length * 2.5)),
        byType: [...byType.values()],
        byDifficulty: [...byDifficulty.values()].sort((a, b) => a.difficulty.localeCompare(b.difficulty)),
        byLevel: [...levelCount.entries()]
          .map(([level, count]) => ({ level, count }))
          .sort((a, b) => a.level - b.level),
        withImage,
      },
      target: { ratio: targetRatio, actual: actualRatio, diff },
      matrix: [...matrix.entries()]
        .map(([point, cells]) => ({
          point,
          total: [...cells.values()].reduce((s, c) => s + c.easy + c.medium + c.hard, 0),
          cells: [...cells.entries()].map(([type, c]) => ({ type, ...c })),
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 50),
      sections: [...sections.values()],
      suggestions,
    };
  }

  /**
   * 智能组卷（智学网式「一键组卷」）：
   *   输入：题型配额 + 目标难度配比（%）+ 课程/知识点范围 + 每题分值 + 大题名
   *   做法：先按题型配额算出每个题型要几道；题型内按难度配比分配名额；
   *         在该范围内挑难度分最贴近目标的题（同分随机），知识点优先不重复；
   *         缺口如实报告（不硬凑、不重复用题）。
   */
  autoCompose(
    actor: User,
    examId: number,
    input: {
      quota: Partial<Record<QuestionType, number>>;
      /** 双向细目表（与 quota 二选一）：逐格指定「知识点 × 题型 × 难度」的数量 */
      cells?: BlueprintCell[];
      ratio?: Partial<Record<'easy' | 'medium' | 'hard', number>>;
      /** `course`（默认，抽本课程题）/ `all`（明确要求才跨课程） */
      scope?: 'course' | 'all';
      courseId?: number;
      point?: string;
      chapter?: string;
      /** 多选范围（可跨章节/跨册）：与细目表/配额一起用时，只在这些范围里抽 */
      books?: string[];
      chapters?: string[];
      points?: string[];
      /** 每个题型的分值（生成后直接落到卷面，老师不必再逐题填） */
      scores?: Partial<Record<QuestionType, number>>;
      sectionName?: string;
      scorePerQuestion?: number;
      replaceExisting?: boolean;
      seed?: number;
    },
  ): {
    added: number;
    requested: number;
    shortfall: number;
    /** 本次组卷实际使用的范围（便于前端/验收确认没有跨课程抽题） */
    scope: { mode: 'course' | 'all'; courseId: number | undefined };
    detail: { type: string; requested: number; added: number; missing: number }[];
    /** 逐格结果（细目表输入时才有）：缺口 + 该格题池可用量 */
    cells: {
      point: string;
      type: string;
      level: string;
      requested: number;
      added: number;
      missing: number;
      available: number;
    }[];
    difficulty: { level: string; requested: number; added: number }[];
    blueprint: ReturnType<ExamService['blueprint']>;
  } {
    const exam = this.findById(examId);
    const ratio = input.ratio ?? {};
    const useRatio = Object.values(ratio).some((v) => (Number(v) || 0) > 0);
    /**
     * 组卷范围：显式传了 `courseId` 就用它，否则**默认这门考试所属课程**；
     * 只有明确 `scope: 'all'` 才会跨课程抽题。
     * 早先这里把 `input.courseId`（前端不传时是 undefined）直接传给了挑题函数，
     * 而 `undefined` 在挑题里表示「不限课程」→ 于是智能组卷会把**别门课的题**也抽进来。
     */
    const scope: 'course' | 'all' = input.scope === 'all' ? 'all' : 'course';
    const scopeCourseId = scope === 'all' ? undefined : (input.courseId ?? exam.course_id);
    if (input.replaceExisting) this.exams.clearQuestions(examId);
    const existing = new Set(this.exams.questionIds(examId));
    const chosen: number[] = [];
    const detail: { type: string; requested: number; added: number; missing: number }[] = [];
    const difficultyWanted: Record<'easy' | 'medium' | 'hard', number> = { easy: 0, medium: 0, hard: 0 };
    const difficultyAdded: Record<'easy' | 'medium' | 'hard', number> = { easy: 0, medium: 0, hard: 0 };
    let requested = 0;

    const cellsDetail: {
      point: string;
      type: string;
      level: string;
      requested: number;
      added: number;
      missing: number;
      available: number;
    }[] = [];

    if (input.cells && input.cells.length > 0) {
      // ---- 细目表模式：逐格配题 ----
      if (Object.values(input.quota).some((n) => (Number(n) || 0) > 0)) {
        throw AppError.badRequest('细目表与「题型配额」只能二选一：请清空其中一种');
      }
      const levelRange = (level: 'easy' | 'medium' | 'hard'): { levelMin: number; levelMax: number } =>
        level === 'easy'
          ? { levelMin: 0, levelMax: 42 }
          : level === 'hard'
            ? { levelMin: 71, levelMax: 100 }
            : { levelMin: 42, levelMax: 71 };
      const poolBase = {
        ...(scopeCourseId === undefined ? {} : { courseId: scopeCourseId }),
        ...(input.chapter ? { chapter: input.chapter } : {}),
      };
      for (const cell of orderCellsForPick(input.cells)) {
        requested += cell.count;
        difficultyWanted[cell.level] += cell.count;
        // 该格题池可用量：让老师知道缺口是「题池本来就没有」还是「被别的格抽走」
        const available = this.exams.pickCount({
          ...poolBase,
          type: cell.type,
          ...levelRange(cell.level),
          ...(cell.point ? { point: cell.point } : {}),
          exclude: [...existing],
        });
        let added = 0;
        for (let i = 0; i < cell.count; i += 1) {
          const picked = this.pickForCompose({
            ...(scopeCourseId === undefined ? {} : { courseId: scopeCourseId }),
            ...(cell.point ? { point: cell.point } : {}),
            ...(input.chapter ? { chapter: input.chapter } : {}),
            // 多选范围（可跨章节/跨册）：细目表逐格抽题时也要受范围约束
            ...(input.books && input.books.length > 0 ? { books: input.books } : {}),
            ...(input.chapters && input.chapters.length > 0 ? { chapters: input.chapters } : {}),
            ...(input.points && input.points.length > 0 ? { points: input.points } : {}),
            type: cell.type,
            level: cell.level,
            exclude: [...existing, ...chosen],
          });
          if (picked === undefined) break;
          chosen.push(picked);
          added += 1;
          difficultyAdded[cell.level] += 1;
        }
        cellsDetail.push({
          point: cell.point,
          type: cell.type,
          level: cell.level,
          requested: cell.count,
          added,
          missing: Math.max(0, cell.count - added),
          available,
        });
      }
    } else {
      for (const [type, rawCount] of Object.entries(input.quota)) {
        const count = Math.max(0, Number(rawCount) || 0);
        if (count === 0) continue;
        requested += count;
        let added = 0;
        // 该题型内按难度配比分配名额（没给配比就整体按难度分散取）
        const buckets: ('easy' | 'medium' | 'hard')[] = useRatio
          ? (() => {
              const out: ('easy' | 'medium' | 'hard')[] = [];
              for (const level of ['easy', 'medium', 'hard'] as const) {
                const n = Math.round((Number(ratio[level]) || 0) * count);
                for (let i = 0; i < n; i += 1) out.push(level);
              }
              while (out.length < count) out.push('medium');
              return out.slice(0, count);
            })()
          : [];
        for (const level of buckets) {
          difficultyWanted[level] += 1;
          const picked = this.pickForCompose({
            courseId: scopeCourseId,
            point: input.point,
            chapter: input.chapter,
            // 多选范围：老师先勾章节/知识点，再按题型数量随机抽
            ...(input.books && input.books.length > 0 ? { books: input.books } : {}),
            ...(input.chapters && input.chapters.length > 0 ? { chapters: input.chapters } : {}),
            ...(input.points && input.points.length > 0 ? { points: input.points } : {}),
            type,
            level,
            exclude: [...existing, ...chosen],
          });
          if (picked === undefined) continue;
          chosen.push(picked);
          difficultyAdded[level] += 1;
          added += 1;
        }
        if (!useRatio) {
          const more = this.exams.pick({
            limit: count,
            type,
            courseId: scopeCourseId,
            ...(input.point ? { point: input.point } : {}),
            ...(input.chapter ? { chapter: input.chapter } : {}),
            // 同一条范围约束：漏了这里，没给难度配比时会退化成"全课程乱抽"
            ...(input.books && input.books.length > 0 ? { books: input.books } : {}),
            ...(input.chapters && input.chapters.length > 0 ? { chapters: input.chapters } : {}),
            ...(input.points && input.points.length > 0 ? { points: input.points } : {}),
            exclude: [...existing, ...chosen],
          });
          for (const row of more) {
            if (added >= count) break;
            if (chosen.includes(row.id)) continue;
            chosen.push(row.id);
            added += 1;
          }
        }
        detail.push({ type, requested: count, added, missing: Math.max(0, count - added) });
      }
    }

    let inserted = 0;
    if (chosen.length > 0) {
      inserted = this.exams.addQuestions(examId, chosen);
      // 生成后落分值/大题：老师按题型填的数量与分值，不必再逐题点一遍
      const typeOf = new Map<number, string>();
      for (const row of this.exams.listQuestions(examId)) typeOf.set(row.id, String(row.type));
      for (const qid of chosen) {
        const perType = input.scores?.[(typeOf.get(qid) ?? '') as QuestionType];
        this.exams.setQuestionMeta(examId, qid, {
          ...(input.sectionName ? { section: input.sectionName } : {}),
          ...(input.scorePerQuestion ? { score: input.scorePerQuestion } : {}),
          ...(perType !== undefined ? { score: perType } : {}),
        });
      }
    }
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'exam.auto_compose',
      targetType: 'exam',
      targetId: examId,
      detail: { requested, added: inserted, detail, blueprintCells: cellsDetail.length },
    });
    return {
      added: inserted,
      requested,
      shortfall: Math.max(0, requested - inserted),
      scope: { mode: scope, courseId: scopeCourseId },
      detail,
      cells: cellsDetail,
      difficulty: (['easy', 'medium', 'hard'] as const).map((level) => ({
        level,
        requested: difficultyWanted[level],
        added: difficultyAdded[level],
      })),
      blueprint: this.blueprint(examId),
    };
  }

  /**
   * 平行组卷（菁优网叫「平行卷/相似卷」，机构里常用于 A/B 卷）：
   * 按原卷**逐题**配一道"同题型、同难度档、知识点尽量相同"的**不同**题，
   * 生成一场新考试，并沿用原卷的分值、大题、考试设置（时长/及格/乱序/公布答案）与试卷结构。
   *
   * 为什么逐题配而不是按题型数量随机抽：平行卷的价值就在于**结构可比**——
   * 题号 i 的难度与考点要对得上，两份卷子的成绩才有可比性（随机抽做不到这一点）。
   */
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
    const source = this.findById(examId);
    const questions = this.exams.listQuestions(examId);
    if (questions.length === 0) throw AppError.badRequest('原卷里还没有题目，无法生成平行卷');

    const scope: 'course' | 'all' = input.scope === 'all' ? 'all' : 'course';
    const scopeCourseId = scope === 'all' ? undefined : source.course_id;

    const newId = this.create(actor, {
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

    // 原卷的题一律不作为候选（否则"平行卷"里会出现同一道题）
    const exclude = new Set<number>(questions.map((q) => q.id));
    const pickedIds: number[] = [];
    const pairs: { picked: number; from: (typeof questions)[number] }[] = [];
    const detail: { index: number; type: string; level: string; point: string; from: number; to: number | null }[] = [];

    /**
     * **按题型批量取候选，再在内存里配对**（原实现是逐题调 pickForCompose，
     * 每题最多 3 次查询 —— 20 题的卷子要跑 60 次查询，实测 4~5 秒）。
     *
     * 配对优先级与原 `pickForCompose` 一致：同知识点+同难度 > 同知识点 > 同难度 > 同题型任意题。
     * 每题型先取一页候选（200 条），不够再取一页；候选池打乱，避免每次都抽到同样的题。
     */
    const byType = new Map<string, number[]>();
    questions.forEach((q, i) => {
      const list = byType.get(q.type) ?? [];
      list.push(i);
      byType.set(q.type, list);
    });

    /** 按**原卷题序**记录每道题配到的候选（顺序必须与原文一致，后面要按位抄分值/大题） */
    const assigned = new Array<number | undefined>(questions.length);

    for (const [type, indices] of byType) {
      const windowSize = Math.min(400, Math.max(120, indices.length * 10));
      let pool = this.exams.pick({
        type,
        ...(scopeCourseId === undefined ? {} : { courseId: scopeCourseId }),
        exclude: [...exclude],
        limit: windowSize,
      });
      if (pool.length < indices.length) {
        const more = this.exams.pick({
          type,
          ...(scopeCourseId === undefined ? {} : { courseId: scopeCourseId }),
          exclude: [...exclude, ...pool.map((r) => r.id)],
          limit: windowSize,
        });
        pool = pool.concat(more);
      }
      const shuffled = shuffle(pool);
      const used = new Set<number>();

      for (const i of indices) {
        const q = questions[i];
        if (!q) continue;
        const level = this.levelBucketOf(q);
        const point = String(q.point ?? '');
        const free = (pred: (row: (typeof shuffled)[number]) => boolean): (typeof shuffled)[number] | undefined =>
          shuffled.find((row) => !used.has(row.id) && pred(row));
        const picked =
          free((row) => String(row.point ?? '') === point && this.levelBucketOf(row) === level) ??
          free((row) => String(row.point ?? '') === point) ??
          free((row) => this.levelBucketOf(row) === level) ??
          free(() => true);
        if (picked !== undefined) {
          used.add(picked.id);
          exclude.add(picked.id);
          assigned[i] = picked.id;
        }
      }
    }

    // 按原卷题序回填：配对列表的顺序决定分值/大题怎么抄，绝不能按题型分组顺序
    questions.forEach((q, i) => {
      const picked = assigned[i];
      if (picked !== undefined) {
        pickedIds.push(picked);
        pairs.push({ picked, from: q });
      }
      detail.push({
        index: i + 1,
        type: q.type,
        level: this.levelBucketOf(q),
        point: String(q.point ?? ''),
        from: q.id,
        to: picked ?? null,
      });
    });

    if (pickedIds.length > 0) this.addQuestions(actor, newId, pickedIds);
    // 逐题沿用分值与大题（第 i 道新题对应原卷第 i 道题）
    pairs.forEach(({ picked, from }) => {
      this.setQuestionMeta(actor, newId, picked, {
        score: Number(from.score ?? 0),
        section: String(from.section ?? ''),
      });
    });

    return {
      examId: newId,
      title: this.findById(newId).title,
      requested: questions.length,
      matched: pickedIds.length,
      shortfall: questions.length - pickedIds.length,
      detail,
    };
  }

  /** 难度档位：优先用难度模型的五级，其次旧的 difficulty 字段 */
  private levelBucketOf(q: { difficulty_level?: number; difficulty?: string }): 'easy' | 'medium' | 'hard' {
    const lv = Number(q.difficulty_level ?? 0);
    if (lv >= 1 && lv <= 5) return lv <= 2 ? 'easy' : lv === 3 ? 'medium' : 'hard';
    if (q.difficulty === 'easy') return 'easy';
    if (q.difficulty === 'hard') return 'hard';
    return 'medium';
  }

  /**
   * 组卷挑一道题：优先与目标难度档位最接近的题（随机打破并列）。
   *
   * 难度判定有三级回退，保证「难度模型还没跑过」时组卷照样能用：
   *   1) `difficulty_score` 落在目标档区间（模型算出来的 0–100 分）；
   *   2) 退回旧的 `difficulty` 三档字段；
   *   3) 再不匹配就忽略难度，只保证题型与范围（宁可出题也不要空卷）。
   */
  private pickForCompose(options: {
    courseId?: number;
    point?: string;
    chapter?: string;
    /** 多选范围：教材册次 / 章节 / 知识点（可跨章节、跨册） */
    books?: string[];
    chapters?: string[];
    points?: string[];
    type: string;
    level?: 'easy' | 'medium' | 'hard';
    exclude: number[];
  }): number | undefined {
    const range =
      options.level === 'easy'
        ? { levelMin: 0, levelMax: 42 }
        : options.level === 'hard'
          ? { levelMin: 71, levelMax: 100 }
          : options.level === 'medium'
            ? { levelMin: 42, levelMax: 71 }
            : {};
    const base = {
      type: options.type,
      ...(options.courseId === undefined ? {} : { courseId: options.courseId }),
      ...(options.point ? { point: options.point } : {}),
      ...(options.chapter ? { chapter: options.chapter } : {}),
      ...(options.books && options.books.length > 0 ? { books: options.books } : {}),
      ...(options.chapters && options.chapters.length > 0 ? { chapters: options.chapters } : {}),
      ...(options.points && options.points.length > 0 ? { points: options.points } : {}),
      exclude: options.exclude,
      limit: 30,
    };
    const attempts: Parameters<ExamRepository['pick']>[0][] = [
      { ...base, ...range },
      ...(options.level ? [{ ...base, difficulty: options.level }] : []),
      base,
    ];
    for (const query of attempts) {
      const rows = this.exams.pick(query);
      if (rows.length > 0) return shuffle(rows)[0]?.id;
    }
    return undefined;
  }

  /**
   * 换一题：用同题型、同难度档、知识点尽量相同的另一道题替换（智学网的「换一题」）。
   * 找不到完全匹配时放宽到同题型同难度，再不行就只保证同题型，并在返回值里说明。
   */
  /**
   * 换题候选：**不随机**，把级联匹配到的候选返回给老师挑。
   *
   * 为什么改：原来的「换一题」是在 20 条里随机取一条，老师看不到换成了什么题，
   * 也没法比一比再决定。这里按匹配强度分组返回（同知识点同难度 → 同难度 → 相近难度 → 同题型），
   * 每组内按难度分接近程度排序，并带上题干/知识点/题库名。
   */
  similarCandidates(
    examId: number,
    questionId: number,
    options?: { limit?: number },
  ): {
    current: { id: number; stem: string; type: string; difficulty: string; point: string; level: number };
    groups: {
      reason: string;
      candidates: {
        id: number;
        stem: string;
        type: string;
        difficulty: string;
        point: string;
        level: number;
        bankName: string;
        /** 与当前题的难度分差（越小越像） */
        levelDelta: number;
      }[];
    }[];
  } {
    this.findById(examId); // 校验考试存在（不关心返回值）
    const rows = this.exams.listQuestions(examId);
    const current = rows.find((q) => q.id === questionId);
    if (!current) throw AppError.notFound('这道题不在试卷里');
    const limit = Math.min(20, Math.max(3, Number(options?.limit ?? 8) || 8));
    const inExam = new Set(this.exams.questionIds(examId));
    const baseLevel = Number(current.difficulty_score ?? 50);
    const point = String(current.point ?? '');
    const currentDifficulty = String(current.difficulty ?? '');

    const attempts: { reason: string; query: Omit<Parameters<ExamRepository['pick']>[0], 'limit'> }[] = [
      {
        reason: '同题型 + 同难度 + 同知识点',
        query: {
          type: current.type,
          ...(currentDifficulty ? { difficulty: currentDifficulty } : {}),
          ...(point ? { point } : {}),
        },
      },
      {
        reason: '同题型 + 同难度',
        query: { type: current.type, ...(currentDifficulty ? { difficulty: currentDifficulty } : {}) },
      },
      {
        reason: '同题型 + 相近难度（±15 分）',
        query: {
          type: current.type,
          levelMin: Math.max(0, baseLevel - 15),
          levelMax: Math.min(100, baseLevel + 15),
        },
      },
      { reason: '只保证同题型', query: { type: current.type } },
    ];

    const groups: {
      reason: string;
      candidates: {
        id: number;
        stem: string;
        type: string;
        difficulty: string;
        point: string;
        level: number;
        bankName: string;
        levelDelta: number;
      }[];
    }[] = [];
    const seen = new Set<number>([questionId]);
    for (const attempt of attempts) {
      const picked = this.exams.pick({
        ...attempt.query,
        exclude: [...inExam],
        limit: limit * 3,
      });
      const candidates = picked
        .filter((row) => !seen.has(row.id))
        .map((row) => {
          seen.add(row.id);
          return {
            id: row.id,
            stem: row.stem,
            type: row.type,
            difficulty: String(row.difficulty ?? ''),
            point: String(row.point ?? ''),
            level: Number(row.difficulty_score ?? 0),
            bankName: String(row.bank_name ?? ''),
            levelDelta: Math.abs(Number(row.difficulty_score ?? 50) - baseLevel),
          };
        })
        .sort((a, b) => a.levelDelta - b.levelDelta)
        .slice(0, limit);
      if (candidates.length > 0) groups.push({ reason: attempt.reason, candidates });
      if (groups.reduce((n, g) => n + g.candidates.length, 0) >= limit) break;
    }

    return {
      current: {
        id: current.id,
        stem: current.stem,
        type: current.type,
        difficulty: current.difficulty,
        point,
        level: baseLevel,
      },
      groups,
    };
  }

  /** 用**指定**的题替换试卷里的某题（老师从候选里挑中的那道） */
  replaceWith(actor: User, examId: number, questionId: number, withId: number): { ok: boolean; reason: string } {
    this.findById(examId);
    const rows = this.exams.listQuestions(examId);
    if (!rows.some((q) => q.id === questionId)) throw AppError.notFound('这道题不在试卷里');
    if (rows.some((q) => q.id === withId)) throw AppError.badRequest('这道题已经在试卷里了');
    // 目标题必须真实存在于题库（避免前端传来任意 id）
    const exists = this.questions.findById(withId);
    if (!exists) throw AppError.notFound('要换上的题目不存在');
    this.exams.replaceQuestion(examId, questionId, withId);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'exam.replace_question',
      targetType: 'exam',
      targetId: examId,
      detail: { from: questionId, to: withId, match: '手工挑选候选' },
    });
    return { ok: true, reason: '手工挑选候选' };
  }

  /**
   * 细目表参考数据：当前范围里「知识点 × 题型 × 难度」各有多少可选题。
   * 老师在细目表编辑器里填目标数量时，能看到题池到底有多少，不用凭感觉填。
   */
  taxonomy(options: { courseId?: number; scope?: 'course' | 'all'; limit?: number }): {
    scope: { mode: 'course' | 'all'; courseId: number | undefined };
    /** 数量为题的矩阵：每个知识点下按 题型×难度 计数 */
    points: { point: string; total: number; cells: { type: string; easy: number; medium: number; hard: number }[] }[];
    total: number;
  } {
    const courseId = options.scope === 'all' ? undefined : options.courseId;
    const rows = this.exams.taxonomy({
      ...(courseId === undefined ? {} : { courseId }),
      ...(options.limit ? { limit: options.limit } : {}),
    });
    return {
      scope: { mode: options.scope === 'all' ? 'all' : 'course', courseId },
      points: rows,
      total: rows.reduce((sum, row) => sum + row.total, 0),
    };
  }

  replaceQuestion(
    actor: User,
    examId: number,
    questionId: number,
    options?: { point?: string; difficulty?: string },
  ): { ok: boolean; replacedWith: number | null; reason: string } {
    this.findById(examId);
    const current = this.exams.listQuestions(examId).find((q) => q.id === questionId);
    if (!current) throw AppError.notFound('这道题不在试卷里');
    const inExam = new Set(this.exams.questionIds(examId));
    const point = options?.point ?? current.point;
    const difficulty = options?.difficulty ?? current.difficulty;
    const attempts: { label: string; query: Parameters<ExamRepository['pick']>[0] }[] = [
      {
        label: '同题型 + 同难度 + 同知识点',
        query: { type: current.type, difficulty, ...(point ? { point } : {}), exclude: [...inExam] },
      },
      { label: '同题型 + 同难度', query: { type: current.type, difficulty, exclude: [...inExam] } },
      {
        label: '同题型 + 相近难度',
        query: {
          type: current.type,
          levelMin: Math.max(0, Number(current.difficulty_score ?? 50) - 15),
          levelMax: Math.min(100, Number(current.difficulty_score ?? 50) + 15),
          exclude: [...inExam],
        },
      },
      { label: '只保证同题型', query: { type: current.type, exclude: [...inExam] } },
    ];
    for (const attempt of attempts) {
      const rows = this.exams.pick({ ...attempt.query, limit: 20 });
      if (rows.length === 0) continue;
      const next = rows[Math.floor(Math.random() * rows.length)];
      if (!next) continue;
      this.exams.replaceQuestion(examId, questionId, next.id);
      this.audit.write({
        actorId: actor.id,
        actorName: actor.username,
        action: 'exam.replace_question',
        targetType: 'exam',
        targetId: examId,
        detail: { from: questionId, to: next.id, match: attempt.label },
      });
      return { ok: true, replacedWith: next.id, reason: attempt.label };
    }
    return { ok: false, replacedWith: null, reason: '题池里没有可替换的同类型题目' };
  }

  addQuestions(actor: User, examId: number, questionIds: number[]): number {
    this.findById(examId);
    const added = this.exams.addQuestions(examId, questionIds);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'exam.add_questions',
      targetType: 'exam',
      targetId: examId,
      detail: { added },
    });
    return added;
  }

  /** 随机抽题：默认在课程题池内排除已选题目 */
  addRandom(actor: User, examId: number, count: number): number {
    const exam = this.findById(examId);
    const have = new Set(this.exams.questionIds(examId));
    const candidates = this.exams.pool(exam.course_id).filter((q) => !have.has(q.id));
    const picked = shuffle(candidates)
      .slice(0, Math.max(1, count))
      .map((q) => q.id);
    const added = this.exams.addQuestions(examId, picked);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'exam.add_random',
      targetType: 'exam',
      targetId: examId,
      detail: { requested: count, added },
    });
    return added;
  }

  /**
   * 组卷：在课程题池里按「题型配额 + 难度配额」抽题。
   * 难度配额（如 `{easy:5, medium:3, hard:2}`）与题型配额可同时给，也可以只给难度。
   * 池内没有足够的某类题时按实际数量抽，并在返回值里如实报告缺口。
   */
  addByQuota(
    actor: User,
    examId: number,
    quota: Partial<Record<QuestionType, number>>,
    difficultyQuota?: Partial<Record<'easy' | 'medium' | 'hard', number>>,
  ): { added: number; requested: number; shortfall: number } {
    const exam = this.findById(examId);
    const have = new Set(this.exams.questionIds(examId));
    const pool = this.exams.pool(exam.course_id).filter((q) => !have.has(q.id));
    const typeEntries = Object.entries(quota).filter(([, n]) => (Number(n) || 0) > 0);
    const diffEntries = Object.entries(difficultyQuota ?? {}).filter(([, n]) => (Number(n) || 0) > 0);

    const ids: number[] = [];
    let requested = 0;

    if (typeEntries.length > 0) {
      for (const [type, rawCount] of typeEntries) {
        const count = Math.max(0, Number(rawCount) || 0);
        requested += count;
        let candidates = pool.filter((q) => q.type === type);
        // 同时给了难度配额时，先按难度在该题型内部分配
        if (diffEntries.length > 0) {
          const perDifficulty = diffEntries.map(([level, n]) => ({
            level,
            take: shuffle(candidates.filter((q) => q.difficulty === level)).slice(0, count),
            n: Number(n) || 0,
          }));
          const pickedByDiff = perDifficulty.flatMap((x) => x.take);
          candidates = pickedByDiff.length > 0 ? pickedByDiff.map((q) => q) : candidates;
        }
        ids.push(
          ...shuffle(candidates)
            .slice(0, count)
            .map((q) => q.id),
        );
      }
    } else if (diffEntries.length > 0) {
      for (const [level, rawCount] of diffEntries) {
        const count = Math.max(0, Number(rawCount) || 0);
        requested += count;
        ids.push(
          ...shuffle(pool.filter((q) => q.difficulty === level))
            .slice(0, count)
            .map((q) => q.id),
        );
      }
    }

    const unique = [...new Set(ids)];
    const added = this.exams.addQuestions(examId, unique);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'exam.add_quota',
      targetType: 'exam',
      targetId: examId,
      detail: { quota, difficultyQuota: difficultyQuota ?? {}, requested, added },
    });
    return { added, requested, shortfall: Math.max(0, requested - unique.length) };
  }

  /** 改卷内某题的分值 / 大题分组 */
  setQuestionMeta(actor: User, examId: number, questionId: number, meta: { score?: number; section?: string }): void {
    this.findById(examId);
    if (!this.exams.questionInExam(examId, questionId)) throw AppError.notFound('这道题不在试卷里');
    this.exams.setQuestionMeta(examId, questionId, meta);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'exam.question_meta',
      targetType: 'exam',
      targetId: examId,
      detail: { questionId, ...meta },
    });
  }

  /** 重排卷内顺序（拖拽排序） */
  reorder(actor: User, examId: number, questionIds: number[]): void {
    this.findById(examId);
    this.exams.reorder(examId, questionIds);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'exam.reorder',
      targetType: 'exam',
      targetId: examId,
      detail: { count: questionIds.length },
    });
  }

  /**
   * 保存试卷结构：大题分组（名称/题型/每题分值/说明）+ 目标难度配比 + 总分。
   * `applyScores` 会把「某大题下的题目」分值统一刷成该大题的标准分值。
   */
  setStructure(
    actor: User,
    examId: number,
    sections: { name: string; type: string; score: number; description: string }[],
    difficultyTarget?: Partial<Record<'easy' | 'medium' | 'hard', number>>,
    totalScore?: number,
    applyScores = true,
  ): void {
    this.findById(examId);
    this.exams.setStructure(
      examId,
      JSON.stringify(sections),
      difficultyTarget ? JSON.stringify(difficultyTarget) : undefined,
      totalScore,
    );
    // 把每个大题的「名称 + 每题分值」刷到该题型的题目上（组卷按题型生成大题）
    let touched = 0;
    if (applyScores) {
      let index = 0;
      for (const section of sections) {
        index += 1;
        if (!section.type) continue;
        const name = section.name || `${cnNumber(index)}、${TYPE_NAME[section.type] ?? section.type}`;
        touched += this.exams.applySection(examId, section.type, name, Number(section.score) || 0);
      }
    }
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'exam.structure',
      targetType: 'exam',
      targetId: examId,
      detail: { sections: sections.length, difficultyTarget: difficultyTarget ?? {}, totalScore, touched },
    });
  }

  removeQuestion(actor: User, examId: number, questionId: number): void {
    this.findById(examId);
    this.exams.removeQuestion(examId, questionId);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'exam.remove_question',
      targetType: 'exam',
      targetId: examId,
      detail: { questionId },
    });
  }

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
    const exam = this.findById(examId);
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
    const exam = this.findById(examId);
    const isManager = viewer.role === 'admin' || viewer.role === 'teacher';
    if (exam.status !== 'published' && !isManager) throw AppError.notFound('考试未发布');
    if (this.exams.findAttempt(examId, viewer.id)) throw AppError.badRequest('本场考试已交卷，不能重复作答');
    if (!isManager) {
      const now = Math.floor(Date.now() / 1000);
      const endAt = Number(exam.end_at ?? 0);
      // 结束时间给 2 分钟缓冲：学生卡在最后几秒交卷不该被判无效
      if (endAt > 0 && now > endAt + 120) throw AppError.badRequest('考试已结束，不能再交卷');
    }

    const paper = this.exams.listQuestions(examId);
    if (paper.length === 0) throw AppError.badRequest('本场考试还没有组卷');

    const byId = new Map(paper.map((q) => [String(q.id), q]));
    const results: ExamGradedItem[] = [];
    /**
     * 判分：每题有分值就按分值累加，没分值则退回「对几题」（100 分制按题数折算）。
     * `score`（得分）与 `total`（满分）都按同一口径取整，保证 `pass_score` 是百分比语义。
     */
    const anyScore = paper.some((q) => Number(q.score) > 0);
    const fallbackScore = paper.length > 0 ? Number(exam.total_score ?? 100) / paper.length : 0;
    let gained = 0;
    let maximum = 0;
    let manual = 0;
    for (const q of paper) {
      maximum += anyScore ? (Number(q.score) > 0 ? Number(q.score) : fallbackScore) : 1;
    }
    for (const item of answers) {
      const q = byId.get(String(item.qid));
      if (!q) continue;
      const given = String(item.answer ?? '');
      const correct = checkAnswer({ type: q.type as QuestionType, answer: q.answer }, given);
      const perQuestion = anyScore ? (Number(q.score) > 0 ? Number(q.score) : fallbackScore) : 1;
      if (correct === true) gained += perQuestion;
      if (correct === null) manual += 1;
      results.push({
        qid: q.id,
        type: q.type as QuestionType,
        stem: q.stem,
        options: parseOptions(q.options),
        image_path: q.image_path,
        given,
        correct,
        answer: q.answer,
        analysis: q.analysis,
        score: Math.round(perQuestion * 10) / 10,
      });
    }

    const score = Math.round(gained);
    const total = Math.round(anyScore ? maximum : paper.length);
    const started = startedAt !== undefined && startedAt > 0 ? startedAt : Date.now();
    const usedSeconds = Math.min(
      exam.duration_minutes * 60 + 30,
      Math.max(0, Math.floor((Date.now() - started) / 1000)),
    );
    const need = Math.ceil((total * exam.pass_score) / 100);
    const passed = score >= need;
    const attemptId = this.exams.createAttempt({
      examId,
      userId: viewer.id,
      answers: results,
      score,
      total,
      passed,
      usedSeconds,
    });
    this.audit.write({
      actorId: viewer.id,
      actorName: viewer.username,
      action: 'exam.submit',
      targetType: 'exam',
      targetId: examId,
      detail: { score, total, passed },
    });
    return { attemptId, score, total, passed, need, usedSeconds, manual, results };
  }

  /**
   * 可打印试卷 HTML（A4/A3、横竖版、双栏、含答案、答题卡、密封线）。
   * 版式与公式排版都在服务端完成，保证任何浏览器「打印 / 另存为 PDF」的结果一致。
   */
  paperHtml(examId: number, overrides?: Partial<PaperRenderOptions>): string {
    const exam = this.findById(examId);
    const rows = this.exams.listQuestions(examId);
    const fallbackScore = rows.length > 0 ? Number(exam.total_score ?? 100) / rows.length : 0;
    const structure = parseStructure(exam.structure);
    const structureByType = new Map(structure.map((s) => [s.type, s]));

    // 卷面按常见顺序分大题：单选 → 多选 → 判断 → 填空 → 解答
    const order: QuestionType[] = ['single', 'multiple', 'judge', 'fill', 'short'];
    const groups: Parameters<typeof buildSections>[0] = [];
    let index = 0;
    for (const type of order) {
      const list = rows.filter((q) => q.type === type);
      if (list.length === 0) continue;
      index += 1;
      const configured = structureByType.get(type);
      groups.push({
        type,
        label: configured?.name || `${cnNumber(index)}、${TYPE_NAME[type] ?? type}`,
        score: configured?.score ?? Number(list[0]?.score ?? 0),
        questions: list.map((q) => ({
          type: q.type as QuestionType,
          stem: q.stem,
          options: parseOptions(q.options),
          answer: q.answer,
          analysis: q.analysis,
          score: Number(q.score) > 0 ? Number(q.score) : Math.round(fallbackScore * 10) / 10,
          difficulty: q.difficulty ?? '',
          point: q.point ?? '',
        })),
      });
    }
    const sections = buildSections(groups);
    return renderPaperHtml({
      sections,
      katexHref: '/api/v1/paper-assets/katex.min.css',
      options: {
        ...DEFAULT_PAPER_OPTIONS,
        title: exam.title,
        durationMinutes: exam.duration_minutes,
        totalScore: Number(exam.total_score ?? 100),
        ...(overrides ?? {}),
      },
    });
  }

  /** 我的成绩（含逐题结果，便于复盘） */
  myResult(viewer: User, examId: number): ExamSubmitResult & { created_at: number; answersHidden?: boolean } {
    const exam = this.findById(examId);
    const attempt = this.exams.findAttempt(examId, viewer.id);
    if (!attempt) throw AppError.notFound('暂无成绩');
    const need = Math.ceil((attempt.total * exam.pass_score) / 100);
    const results = safeParseResults(attempt.answers);
    /**
     * 交卷后是否公布答案解析（学习通里的"答案公布"开关）：
     * 老师/管理员始终能看；学员在 show_answers=0 时只看到得分与是否答对，看不到正确答案与解析。
     * 这样安排是因为"考完先讲评再公布"是常见做法。
     */
    const isManager = viewer.role === 'admin' || viewer.role === 'teacher';
    const hideAnswers = !isManager && Number(exam.show_answers ?? 1) === 0;
    return {
      attemptId: attempt.id,
      score: attempt.score,
      total: attempt.total,
      passed: attempt.passed === 1,
      need,
      usedSeconds: attempt.used_seconds,
      manual: results.filter((r) => r.correct === null).length,
      results: hideAnswers ? results.map((r) => ({ ...r, answer: '', analysis: '' })) : results,
      ...(hideAnswers ? { answersHidden: true } : {}),
      created_at: attempt.created_at,
    };
  }

  /** 成绩单：全部学生作答 + 统计（管理端） */
  scoreSheet(examId: number): {
    exam: Exam;
    rows: {
      user_id: number;
      username: string;
      display_name: string;
      score: number;
      total: number;
      passed: 0 | 1;
      used_seconds: number;
      created_at: number;
    }[];
    summary: {
      attempts: number;
      passed: number;
      pass_rate: number;
      avg: number;
      best: number;
      worst: number;
      avg_seconds: number;
    };
  } {
    const exam = this.findById(examId);
    const rows = this.exams.attemptsOf(examId).map((a) => ({
      user_id: a.user_id,
      username: a.username,
      display_name: a.display_name,
      score: a.score,
      total: a.total,
      passed: a.passed,
      used_seconds: a.used_seconds,
      created_at: a.created_at,
    }));
    const scores = rows.map((r) => r.score);
    const passedCount = rows.filter((r) => r.passed === 1).length;
    const avg = scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;
    const avgSeconds = rows.length > 0 ? Math.round(rows.reduce((a, r) => a + r.used_seconds, 0) / rows.length) : 0;
    return {
      exam,
      rows,
      summary: {
        attempts: rows.length,
        passed: passedCount,
        pass_rate: rows.length > 0 ? Math.round((passedCount / rows.length) * 1000) / 10 : 0,
        avg,
        best: scores.length > 0 ? Math.max(...scores) : 0,
        worst: scores.length > 0 ? Math.min(...scores) : 0,
        avg_seconds: avgSeconds,
      },
    };
  }

  /** 成绩单 CSV */
  scoreSheetCsv(examId: number): { filename: string; rows: unknown[][] } {
    const { exam, rows } = this.scoreSheet(examId);
    return {
      filename: `${exam.title}_成绩单.csv`,
      rows: [
        ['学号', '姓名', '得分', '总分', '是否及格', '用时(秒)', '交卷时间'],
        ...rows.map((r) => [
          r.username,
          r.display_name,
          r.score,
          r.total,
          r.passed === 1 ? '及格' : '不及格',
          r.used_seconds,
          new Date(r.created_at * 1000).toLocaleString('zh-CN'),
        ]),
      ],
    };
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

  private prepare(input: ExamDto): {
    courseId: number;
    title: string;
    description: string;
    durationMinutes: number;
    passScore: number;
    status: Exam['status'];
    /** 考试设置（对标学习通）：只在显式传入时覆盖，未传的项保持原值 */
    startAt?: number;
    endAt?: number;
    attemptLimit?: number;
    shuffleQuestions?: boolean;
    showAnswers?: boolean;
  } {
    const courseId = Number(input.courseId);
    if (!Number.isInteger(courseId) || !this.courses.findById(courseId)) throw AppError.badRequest('课程不存在');
    const title = String(input.title ?? '').trim();
    if (!title) throw AppError.badRequest('考试标题不能为空');
    const rawDuration = Number(input.durationMinutes);
    const durationMinutes = Number.isFinite(rawDuration) && rawDuration >= 1 ? Math.floor(rawDuration) : 60;
    const rawPass = Number(input.passScore);
    const passScore = Number.isFinite(rawPass) && rawPass >= 0 && rawPass <= 100 ? Math.round(rawPass) : 60;
    /** 时间戳：只接受非负整数（0 = 不限） */
    const stamp = (v: unknown): number | undefined => {
      if (v === undefined || v === null || v === '') return undefined;
      const n = Math.floor(Number(v));
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    const startAt = stamp(input.startAt);
    const endAt = stamp(input.endAt);
    if (startAt !== undefined && endAt !== undefined && startAt > 0 && endAt > 0 && endAt <= startAt) {
      throw AppError.badRequest('结束时间必须晚于开始时间');
    }
    const limit =
      input.attemptLimit === undefined
        ? undefined
        : Math.min(99, Math.max(0, Math.floor(Number(input.attemptLimit) || 0)));
    return {
      courseId,
      title,
      description: String(input.description ?? ''),
      durationMinutes,
      passScore,
      status: input.status === 'published' ? 'published' : 'draft',
      ...(startAt === undefined ? {} : { startAt }),
      ...(endAt === undefined ? {} : { endAt }),
      ...(limit === undefined ? {} : { attemptLimit: limit }),
      ...(input.shuffleQuestions === undefined ? {} : { shuffleQuestions: input.shuffleQuestions === true }),
      ...(input.showAnswers === undefined ? {} : { showAnswers: input.showAnswers !== false }),
    };
  }
}

/** 解析历史作答 JSON，坏数据不至于让接口整体失败 */
function safeParseResults(raw: string): ExamGradedItem[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ExamGradedItem[]) : [];
  } catch {
    return [];
  }
}
