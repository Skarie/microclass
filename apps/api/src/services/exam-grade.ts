/**
 * 判分（纯函数，无 DB / 无 Fastify 依赖，可直接单测）。
 *
 * 口径（与重构前的 `ExamService.submit` 完全一致，勿单独改动）：
 *  - 卷面**有任何一题设了分值**：每题按自己的分值累加；没设分值的题按
 *    `total_score / 题数`（fallbackScore）折算。得分与总分都按同一套分值取整，
 *    保证 `pass_score` 始终是「百分比」语义。
 *  - **一题分值都没有**：按题数折算，1 题 1 分，总分 = 题数。
 *  - `correct === null`（简答题）：不得分，计入 `manual`（待人工判分）。
 *  - 只判「交上来的答案」：漏交的题不会出现在 `results` 里，但仍占卷面总分。
 *  - 及格线 `need = ceil(total × pass_score / 100)`（向上取整），`score >= need` 即及格。
 */
import type { QuestionType } from '@microclass/shared';
import { checkAnswer, parseOptions } from '../domain/question.js';

/** 成绩页逐题结果（题干/选项/解析用于复盘） */
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
  /** 交卷不再回带整卷结果（成绩页单独取 /result），只有 myResult 会填充 */
  results?: ExamGradedItem[];
}

/**
 * 判分所需的卷面行：`ExamRepository.listQuestions()` 的子集。
 * 用宽类型 `string` 接题型（仓储行就是 string），内部再收窄为 `QuestionType`。
 */
export interface GradingPaperRow {
  id: number;
  type: string;
  stem: string;
  options: string;
  image_path: string;
  answer: string;
  analysis: string;
  score: number;
}

export interface GradingAnswer {
  qid: number;
  answer: string;
}

export interface GradingInput {
  paper: GradingPaperRow[];
  answers: GradingAnswer[];
  /** 试卷总分（`exam.total_score`；调用方没设时传 100） */
  totalScore: number;
  /** 及格百分比（`exam.pass_score`，0–100） */
  passScore: number;
}

export interface GradingOutcome {
  score: number;
  total: number;
  /** 及格所需分数（百分比向上取整） */
  need: number;
  passed: boolean;
  /** 简答题数量（correct === null） */
  manual: number;
  results: ExamGradedItem[];
}

/** 存库用的四元组：题干/选项/解析在成绩页按卷面重建，避免把整卷 JSON 写进每次交卷 */
export interface StoredGradedItem {
  qid: number;
  given: string;
  correct: boolean | null;
  score?: number;
}

/** 判分主入口：纯内存计算，不改任何入参 */
export function gradeSubmission(input: GradingInput): GradingOutcome {
  const { paper } = input;
  const byId = new Map(paper.map((q) => [String(q.id), q]));
  const results: ExamGradedItem[] = [];
  const anyScore = paper.some((q) => Number(q.score) > 0);
  const fallbackScore = paper.length > 0 ? Number(input.totalScore) / paper.length : 0;

  let gained = 0;
  let maximum = 0;
  let manual = 0;
  for (const q of paper) {
    maximum += anyScore ? scoreOf(q, fallbackScore) : 1;
  }

  for (const item of input.answers) {
    const q = byId.get(String(item.qid));
    if (!q) continue;
    const given = String(item.answer ?? '');
    const correct = checkAnswer({ type: q.type as QuestionType, answer: q.answer }, given);
    const perQuestion = anyScore ? scoreOf(q, fallbackScore) : 1;
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
  const need = Math.ceil((total * Number(input.passScore)) / 100);
  return { score, total, need, passed: score >= need, manual, results };
}

/** 本题满分：有分值按分值，没分值按 fallbackScore */
function scoreOf(q: GradingPaperRow, fallbackScore: number): number {
  const score = Number(q.score);
  return score > 0 ? score : fallbackScore;
}

/** 成绩单落库只保留四元组（兼容老数据：老数据里可能带 stem 等完整结构） */
export function slimResults(results: ExamGradedItem[]): StoredGradedItem[] {
  return results.map((r) => ({ qid: r.qid, given: r.given, correct: r.correct, score: r.score }));
}
