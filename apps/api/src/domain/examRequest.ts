/**
 * 考试路由的请求参数解析（纯逻辑：无 Fastify、无数据库，可直接单测）。
 *
 * 从 `routes/exams.ts` 抽出：题型/难度配额、配比、题目 id、试卷大题结构这些规则
 * 以前散在 680 行的路由文件里，既难复用也没法测；现在路由只负责取 deps 与拼返回。
 * 语义与拆分前逐字一致（包括「传了非法配额就报错」这类边界），
 * 测试见 `apps/api/test/exam-request.test.ts`。
 */
import type { QuestionType } from '@microclass/shared';

/** 题型白名单（与题库 / 细目表同一套取值） */
export const EXAM_TYPES = ['single', 'multiple', 'judge', 'fill', 'short'] as const;
/** 难度档白名单 */
export const EXAM_LEVELS = ['easy', 'medium', 'hard'] as const;
export type ExamLevel = (typeof EXAM_LEVELS)[number];

const TYPE_SET: ReadonlySet<string> = new Set(EXAM_TYPES);
const LEVEL_SET: ReadonlySet<string> = new Set(EXAM_LEVELS);

/**
 * 多选查询参数：`?points=a&points=b`（重复参数）与 `?points=a,b`（逗号分隔）都支持。
 * 去空白、去重并保留出现顺序。
 */
export function listParam(source: Record<string, unknown>, key: string): string[] {
  const raw = source[key];
  const out: string[] = [];
  const push = (v: unknown): void => {
    if (typeof v !== 'string') return;
    for (const part of v.split(',')) {
      const t = part.trim();
      if (t !== '') out.push(t);
    }
  };
  if (Array.isArray(raw)) raw.forEach(push);
  else push(raw);
  return [...new Set(out)];
}

/** 查询串里的数字参数：只认十进制字符串，空串与非法值都当作「没传」 */
export function queryNumber(source: Record<string, unknown>, key: string): number | undefined {
  const raw = source[key];
  if (typeof raw !== 'string' || raw === '') return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** 题目 id 列表：只保留正数（与拆分前一致，不额外做整数校验） */
export function parseQuestionIds(raw: unknown): number[] {
  return Array.isArray(raw) ? raw.map((x) => Number(x)).filter((x) => x > 0) : [];
}

/** 题型配额：忽略白名单外的键；值统一转成数字，非法值算 0 */
export function parseTypeQuota(raw: unknown): Partial<Record<QuestionType, number>> {
  const quota: Partial<Record<QuestionType, number>> = {};
  if (raw === null || typeof raw !== 'object') return quota;
  for (const [k, v] of Object.entries(raw)) {
    if (TYPE_SET.has(k)) quota[k as QuestionType] = Number(v) || 0;
  }
  return quota;
}

export interface DifficultyQuotaParse {
  quota: Partial<Record<ExamLevel, number>>;
  /** 传了难度配额，但一个合法键都没有 —— 路由据此返回 400 */
  rejected: boolean;
}

/** 难度配额：规则同题型配额，额外报告「整份配额非法」 */
export function parseDifficultyQuota(raw: unknown): DifficultyQuotaParse {
  const quota: Partial<Record<ExamLevel, number>> = {};
  if (raw === null || typeof raw !== 'object') return { quota, rejected: false };
  for (const [k, v] of Object.entries(raw)) {
    if (LEVEL_SET.has(k)) quota[k as ExamLevel] = Number(v) || 0;
  }
  return { quota, rejected: Object.keys(raw).length > 0 && Object.keys(quota).length === 0 };
}

/** 配额里是否至少有一项大于 0（「按难度抽题」分支的判断口径） */
export function hasPositiveQuota(quota: Partial<Record<string, number>>): boolean {
  return Object.values(quota).some((n) => Number(n) > 0);
}

/** 配额是否为空（与拆分前一致：0 与 undefined 算空，负数不算空） */
export function isEmptyQuota(quota: Partial<Record<string, number>>): boolean {
  return Object.values(quota).every((n) => !n);
}

/** 难度配比：规则同难度配额；是否为 1 的校验在路由里做（错误信息与原来一致） */
export function parseRatio(raw: unknown): Partial<Record<ExamLevel, number>> {
  const ratio: Partial<Record<ExamLevel, number>> = {};
  if (raw === null || typeof raw !== 'object') return ratio;
  for (const [k, v] of Object.entries(raw)) {
    if (LEVEL_SET.has(k)) ratio[k as ExamLevel] = Number(v) || 0;
  }
  return ratio;
}

/** 每个题型的分值：只保留有限且非负的数字（非法值直接丢弃，不阻断组卷） */
export function parseScores(raw: unknown): Partial<Record<QuestionType, number>> {
  if (raw === null || typeof raw !== 'object') return {};
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([, v]) => Number.isFinite(Number(v)) && Number(v) >= 0)
      .map(([k, v]) => [k, Number(v)]),
  );
}

export interface ExamSectionInput {
  name: string;
  type: string;
  score: number;
  description: string;
}

/** 试卷大题结构：非数组视为空；字段类型不对时回填空串/0（与拆分前一致） */
export function parseStructureSections(raw: unknown): ExamSectionInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const s = (item ?? {}) as Record<string, unknown>;
    return {
      name: typeof s.name === 'string' ? s.name : '',
      type: typeof s.type === 'string' ? s.type : '',
      score: Number(s.score) || 0,
      description: typeof s.description === 'string' ? s.description : '',
    };
  });
}
