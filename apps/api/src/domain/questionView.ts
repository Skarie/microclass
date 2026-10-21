/**
 * 题目数据行 → 视图对象。学生/考试视角剥掉答案与解析，教师视角保留。
 * 从 BankService 抽成纯映射，组卷、考试与题库列表共用同一口径。
 */
import type { Question, QuestionType } from '@microclass/shared';
import { levelFromScore } from './difficulty.js';
import { fillBlankCount, parseOptions } from './question.js';

/** 面向学生/考试的题面：剥掉答案与解析 */
export interface QuestionForViewer {
  id: number;
  bank_id: number;
  lesson_id: number | null;
  type: QuestionType;
  stem: string;
  image_path: string;
  options: string[];
  sort: number;
  /** 难度：easy / medium / hard（空串 = 未标注） */
  difficulty: string;
  /** 难度模型（迁移 0016）：0–100 综合分与五级星级（1 最易 … 5 最难） */
  difficulty_score: number;
  difficulty_level: number;
  /** 难度来源：auto / calibrated / manual（空串 = 还没算过） */
  difficulty_source: string;
  /** 参与校准的作答样本数与经验正确率 */
  difficulty_n: number;
  difficulty_p: number | null;
  /** 填空题空位数（>1 时提示学生按顺序用「；」分隔；其他题型为 0） */
  blanks: number;
  /** 标准化元数据（迁移 0008；历史数据为空串） */
  subject: string;
  stage: string;
  book: string;
  chapter: string;
  point: string;
  source_path: string;
  source_no: string;
  answer?: string;
  analysis?: string;
}

/** 行数据 → 视图对象：学生视角不返回答案与解析 */
export function toViewer(q: Question, withAnswer: boolean): QuestionForViewer {
  const base: QuestionForViewer = {
    id: q.id,
    bank_id: q.bank_id,
    lesson_id: q.lesson_id,
    type: q.type,
    stem: q.stem,
    image_path: q.image_path,
    options: parseOptions(q.options),
    sort: q.sort,
    difficulty: q.difficulty ?? '',
    difficulty_score: Number.isFinite(Number(q.difficulty_score)) ? Number(q.difficulty_score) : -1,
    difficulty_level: levelFromScore(Number.isFinite(Number(q.difficulty_score)) ? Number(q.difficulty_score) : 50),
    difficulty_source: q.difficulty_source ?? '',
    difficulty_n: Number(q.difficulty_n ?? 0),
    difficulty_p: q.difficulty_p === null || q.difficulty_p === undefined ? null : Number(q.difficulty_p),
    blanks: fillBlankCount(q.type, q.answer),
    subject: q.subject ?? '',
    stage: q.stage ?? '',
    book: q.book ?? '',
    chapter: q.chapter ?? '',
    point: q.point ?? '',
    source_path: q.source_path ?? '',
    source_no: q.source_no ?? '',
  };
  if (withAnswer) {
    base.answer = q.answer;
    base.analysis = q.analysis;
  }
  return base;
}
