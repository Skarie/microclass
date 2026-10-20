/**
 * 试卷服务：组卷（手工选题 / 随机抽题 / 按题型配额 / 智能组卷 / 平行卷）、
 * 试卷结构（大题/分值/目标配比）与换题、删题。
 *
 * 这里只做「卷面怎么来、怎么改」，不负责交卷判分（见 exam-grade）与成绩/打印（见 exam-report）；
 * `ExamService` 保留对外方法并做编排，本模块的函数都以显式依赖对象 `ExamPaperDeps` 调用仓储，
 * 不读 `this`，便于单独推理。
 */
import { AppError, type Exam, type QuestionType, type User } from '@microclass/shared';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { ExamRepository } from '../db/repositories/examRepository.js';
import type { QuestionRepository } from '../db/repositories/questionRepository.js';
import type { QuestionForViewer } from './bankService.js';
import { toViewer } from './bankService.js';
import { orderCellsForPick, type BlueprintCell } from '../domain/blueprint.js';
import { shuffle } from './quizService.js';

/** 试卷大题习惯用中文序号（一、单选题 二、填空题…） */
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

export function cnNumber(n: number): string {
  return CN_NUM[n - 1] ?? String(n);
}

/** 题型中文名（大题默认名与细目表展示用） */
export const TYPE_NAME: Record<string, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  fill: '填空题',
  short: '简答题',
};

/** 试卷结构（大题）解析：坏数据不炸，退化成空数组 */
export function parseStructure(raw: unknown): { name: string; type: string; score: number; description: string }[] {
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

/** 组卷/结构/换题所需的仓储（由 `ExamService` 注入，避免本模块依赖服务实例） */
export interface ExamPaperDeps {
  exams: ExamRepository;
  questions: QuestionRepository;
  audit: AuditRepository;
}

/** 考试不存在时的错误口径与 `ExamService.findById` 一致 */
export function findExam(exams: ExamRepository, examId: number): Exam {
  const exam = exams.findById(examId);
  if (!exam) throw AppError.notFound('考试不存在');
  return exam;
}

/** 组卷视图：已选题目（学员视角）+ 卷面专属的分值/大题 */
export function paperView(rows: ReturnType<ExamRepository['listQuestions']>): QuestionForViewer[] {
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

export type PaperRow = ReturnType<ExamRepository['listQuestions']>[number];

export interface BlueprintResult {
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
}

/**
 * 组卷工作台用：卷面统计 + 双向细目表（知识点 × 题型 × 难度）。
 *
 * 参考主流组卷系统（智学网一类）的「试题篮」：老师需要随时看到
 * 「多少题、多少分、各题型几道、难度配比对不对、知识点覆盖了哪些、离目标还差什么」。
 */
export function buildBlueprint(exam: Exam, rows: PaperRow[]): BlueprintResult {
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
      byLevel: [...levelCount.entries()].map(([level, count]) => ({ level, count })).sort((a, b) => a.level - b.level),
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

export interface AutoComposeInput {
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
}

export interface AutoComposeResult {
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
  blueprint: BlueprintResult;
}

/**
 * 智能组卷（智学网式「一键组卷」）：
 *   输入：题型配额 + 目标难度配比（%）+ 课程/知识点范围 + 每题分值 + 大题名
 *   做法：先按题型配额算出每个题型要几道；题型内按难度配比分配名额；
 *         在该范围内挑难度分最贴近目标的题（同分随机），知识点优先不重复；
 *         缺口如实报告（不硬凑、不重复用题）。
 */
export function autoCompose(
  deps: ExamPaperDeps,
  actor: User,
  examId: number,
  input: AutoComposeInput,
): AutoComposeResult {
  const exam = findExam(deps.exams, examId);
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
  if (input.replaceExisting) deps.exams.clearQuestions(examId);
  const existing = new Set(deps.exams.questionIds(examId));
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
      const available = deps.exams.pickCount({
        ...poolBase,
        type: cell.type,
        ...levelRange(cell.level),
        ...(cell.point ? { point: cell.point } : {}),
        exclude: [...existing],
      });
      let added = 0;
      for (let i = 0; i < cell.count; i += 1) {
        const picked = pickForCompose(deps, {
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
        const picked = pickForCompose(deps, {
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
        const more = deps.exams.pick({
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
    inserted = deps.exams.addQuestions(examId, chosen);
    // 生成后落分值/大题：老师按题型填的数量与分值，不必再逐题点一遍
    const typeOf = new Map<number, string>();
    for (const row of deps.exams.listQuestions(examId)) typeOf.set(row.id, String(row.type));
    for (const qid of chosen) {
      const perType = input.scores?.[(typeOf.get(qid) ?? '') as QuestionType];
      deps.exams.setQuestionMeta(examId, qid, {
        ...(input.sectionName ? { section: input.sectionName } : {}),
        ...(input.scorePerQuestion ? { score: input.scorePerQuestion } : {}),
        ...(perType !== undefined ? { score: perType } : {}),
      });
    }
  }
  deps.audit.write({
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
    blueprint: buildBlueprint(findExam(deps.exams, examId), deps.exams.listQuestions(examId)),
  };
}

/** 难度档位：优先用难度模型的五级，其次旧的 difficulty 字段 */
function levelBucketOf(q: { difficulty_level?: number; difficulty?: string }): 'easy' | 'medium' | 'hard' {
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
function pickForCompose(
  deps: ExamPaperDeps,
  options: {
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
  },
): number | undefined {
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
    const rows = deps.exams.pick(query);
    if (rows.length > 0) return shuffle(rows)[0]?.id;
  }
  return undefined;
}

export interface ParallelMatch {
  pickedIds: number[];
  pairs: { picked: number; from: PaperRow }[];
  detail: { index: number; type: string; level: string; point: string; from: number; to: number | null }[];
}

/**
 * 平行卷配对：按原卷**逐题**配一道"同题型、同难度档、知识点尽量相同"的**不同**题。
 *
 * 为什么逐题配而不是按题型数量随机抽：平行卷的价值就在于**结构可比**——
 * 题号 i 的难度与考点要对得上，两份卷子的成绩才有可比性（随机抽做不到这一点）。
 *
 * 按题型批量取候选，再在内存里配对（原实现是逐题调 pickForCompose，
 * 每题最多 3 次查询 —— 20 题的卷子要跑 60 次查询，实测 4~5 秒）。
 * 配对优先级与原 `pickForCompose` 一致：同知识点+同难度 > 同知识点 > 同难度 > 同题型任意题。
 */
export function matchParallelQuestions(
  deps: ExamPaperDeps,
  questions: PaperRow[],
  scopeCourseId: number | undefined,
): ParallelMatch {
  // 原卷的题一律不作为候选（否则"平行卷"里会出现同一道题）
  const exclude = new Set<number>(questions.map((q) => q.id));
  const pickedIds: number[] = [];
  const pairs: { picked: number; from: PaperRow }[] = [];
  const detail: { index: number; type: string; level: string; point: string; from: number; to: number | null }[] = [];

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
    let pool = deps.exams.pick({
      type,
      ...(scopeCourseId === undefined ? {} : { courseId: scopeCourseId }),
      exclude: [...exclude],
      limit: windowSize,
    });
    if (pool.length < indices.length) {
      const more = deps.exams.pick({
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
      const level = levelBucketOf(q);
      const point = String(q.point ?? '');
      const free = (pred: (row: (typeof shuffled)[number]) => boolean): (typeof shuffled)[number] | undefined =>
        shuffled.find((row) => !used.has(row.id) && pred(row));
      const picked =
        free((row) => String(row.point ?? '') === point && levelBucketOf(row) === level) ??
        free((row) => String(row.point ?? '') === point) ??
        free((row) => levelBucketOf(row) === level) ??
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
      level: levelBucketOf(q),
      point: String(q.point ?? ''),
      from: q.id,
      to: picked ?? null,
    });
  });

  return { pickedIds, pairs, detail };
}

export interface SimilarCandidatesResult {
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
}

/**
 * 换题候选：**不随机**，把级联匹配到的候选返回给老师挑。
 *
 * 为什么改：原来的「换一题」是在 20 条里随机取一条，老师看不到换成了什么题，
 * 也没法比一比再决定。这里按匹配强度分组返回（同知识点同难度 → 同难度 → 相近难度 → 同题型），
 * 每组内按难度分接近程度排序，并带上题干/知识点/题库名。
 */
export function similarCandidates(
  deps: ExamPaperDeps,
  examId: number,
  questionId: number,
  options?: { limit?: number },
): SimilarCandidatesResult {
  findExam(deps.exams, examId); // 校验考试存在（不关心返回值）
  const rows = deps.exams.listQuestions(examId);
  const current = rows.find((q) => q.id === questionId);
  if (!current) throw AppError.notFound('这道题不在试卷里');
  const limit = Math.min(20, Math.max(3, Number(options?.limit ?? 8) || 8));
  const inExam = new Set(deps.exams.questionIds(examId));
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

  const groups: SimilarCandidatesResult['groups'] = [];
  const seen = new Set<number>([questionId]);
  for (const attempt of attempts) {
    const picked = deps.exams.pick({
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
export function replaceWith(
  deps: ExamPaperDeps,
  actor: User,
  examId: number,
  questionId: number,
  withId: number,
): { ok: boolean; reason: string } {
  findExam(deps.exams, examId);
  const rows = deps.exams.listQuestions(examId);
  if (!rows.some((q) => q.id === questionId)) throw AppError.notFound('这道题不在试卷里');
  if (rows.some((q) => q.id === withId)) throw AppError.badRequest('这道题已经在试卷里了');
  // 目标题必须真实存在于题库（避免前端传来任意 id）
  const exists = deps.questions.findById(withId);
  if (!exists) throw AppError.notFound('要换上的题目不存在');
  deps.exams.replaceQuestion(examId, questionId, withId);
  deps.audit.write({
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
export function taxonomy(
  exams: ExamRepository,
  options: { courseId?: number; scope?: 'course' | 'all'; limit?: number },
): {
  scope: { mode: 'course' | 'all'; courseId: number | undefined };
  /** 数量为题的矩阵：每个知识点下按 题型×难度 计数 */
  points: { point: string; total: number; cells: { type: string; easy: number; medium: number; hard: number }[] }[];
  total: number;
} {
  const courseId = options.scope === 'all' ? undefined : options.courseId;
  const rows = exams.taxonomy({
    ...(courseId === undefined ? {} : { courseId }),
    ...(options.limit ? { limit: options.limit } : {}),
  });
  return {
    scope: { mode: options.scope === 'all' ? 'all' : 'course', courseId },
    points: rows,
    total: rows.reduce((sum, row) => sum + row.total, 0),
  };
}

export function replaceQuestion(
  deps: ExamPaperDeps,
  actor: User,
  examId: number,
  questionId: number,
  options?: { point?: string; difficulty?: string },
): { ok: boolean; replacedWith: number | null; reason: string } {
  findExam(deps.exams, examId);
  const current = deps.exams.listQuestions(examId).find((q) => q.id === questionId);
  if (!current) throw AppError.notFound('这道题不在试卷里');
  const inExam = new Set(deps.exams.questionIds(examId));
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
    const rows = deps.exams.pick({ ...attempt.query, limit: 20 });
    if (rows.length === 0) continue;
    const next = rows[Math.floor(Math.random() * rows.length)];
    if (!next) continue;
    deps.exams.replaceQuestion(examId, questionId, next.id);
    deps.audit.write({
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

export function addQuestions(deps: ExamPaperDeps, actor: User, examId: number, questionIds: number[]): number {
  findExam(deps.exams, examId);
  const added = deps.exams.addQuestions(examId, questionIds);
  deps.audit.write({
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
export function addRandom(deps: ExamPaperDeps, actor: User, examId: number, count: number): number {
  const exam = findExam(deps.exams, examId);
  const have = new Set(deps.exams.questionIds(examId));
  const candidates = deps.exams.pool(exam.course_id).filter((q) => !have.has(q.id));
  const picked = shuffle(candidates)
    .slice(0, Math.max(1, count))
    .map((q) => q.id);
  const added = deps.exams.addQuestions(examId, picked);
  deps.audit.write({
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
export function addByQuota(
  deps: ExamPaperDeps,
  actor: User,
  examId: number,
  quota: Partial<Record<QuestionType, number>>,
  difficultyQuota?: Partial<Record<'easy' | 'medium' | 'hard', number>>,
): { added: number; requested: number; shortfall: number } {
  const exam = findExam(deps.exams, examId);
  const have = new Set(deps.exams.questionIds(examId));
  const pool = deps.exams.pool(exam.course_id).filter((q) => !have.has(q.id));
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
  const added = deps.exams.addQuestions(examId, unique);
  deps.audit.write({
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
  deps.audit.write({
    actorId: actor.id,
    actorName: actor.username,
    action: 'exam.question_meta',
    targetType: 'exam',
    targetId: examId,
    detail: { questionId, ...meta },
  });
}

/** 重排卷内顺序（拖拽排序） */
export function reorder(deps: ExamPaperDeps, actor: User, examId: number, questionIds: number[]): void {
  findExam(deps.exams, examId);
  deps.exams.reorder(examId, questionIds);
  deps.audit.write({
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
export function setStructure(
  deps: ExamPaperDeps,
  actor: User,
  examId: number,
  sections: { name: string; type: string; score: number; description: string }[],
  difficultyTarget?: Partial<Record<'easy' | 'medium' | 'hard', number>>,
  totalScore?: number,
  applyScores = true,
): void {
  findExam(deps.exams, examId);
  deps.exams.setStructure(
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
      touched += deps.exams.applySection(examId, section.type, name, Number(section.score) || 0);
    }
  }
  deps.audit.write({
    actorId: actor.id,
    actorName: actor.username,
    action: 'exam.structure',
    targetType: 'exam',
    targetId: examId,
    detail: { sections: sections.length, difficultyTarget: difficultyTarget ?? {}, totalScore, touched },
  });
}

export function removeQuestion(deps: ExamPaperDeps, actor: User, examId: number, questionId: number): void {
  findExam(deps.exams, examId);
  deps.exams.removeQuestion(examId, questionId);
  deps.audit.write({
    actorId: actor.id,
    actorName: actor.username,
    action: 'exam.remove_question',
    targetType: 'exam',
    targetId: examId,
    detail: { questionId },
  });
}
