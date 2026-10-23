/**
 * 组卷题池的查询参数解析（纯逻辑，可直接单测）。
 *
 * 从 `routes/exams.ts` 抽出。原先 handler 里有一份「范围（本课程 / 全库）
 * + 多选条件 + 分页」的拼装逻辑，且只有路由自己知道默认值；抽出来后：
 *  - 默认范围仍是**本考试所属课程**（要跨课程必须显式 `scope=all`）；
 *  - 分页收敛（page ≥ 1、pageSize 1~50）与易错题窗口（minAttempts ≥ 1）集中在一处；
 *  - 路由只负责取 `exam.course_id`、已在卷内的题目 id（exclude）并交给仓储。
 *
 * 选题树 / 知识点 / 细目表范围见 `examTaxonomyQuery.ts`。
 */
import { EXAM_LEVELS, EXAM_TYPES, listParam, queryNumber, type ExamLevel } from './examRequest.js';

/** 题池多选筛选（与 ExamRepository.pick 的参数同名） */
export interface PoolFilters {
  courseId?: number;
  type?: string;
  books?: string[];
  chapters?: string[];
  points?: string[];
  types?: string[];
  levels?: ExamLevel[];
  keyword?: string;
  hasImage?: boolean;
  orderBy?: PoolOrderBy;
}

export type PoolOrderBy = 'default' | 'difficulty_asc' | 'difficulty_desc' | 'error_desc';

/** 挑题条件：题池 / 全选加入 / 分页计数共用 */
export interface PoolPickOptions extends PoolFilters {
  lessonId?: number;
  bankId?: number;
  difficulty?: string;
  levelMin?: number;
  levelMax?: number;
  point?: string;
  chapter?: string;
  exclude?: number[];
}

const TYPE_SET: ReadonlySet<string> = new Set(EXAM_TYPES);
const LEVEL_SET: ReadonlySet<string> = new Set(EXAM_LEVELS);
const ORDER_BY_SET: ReadonlySet<string> = new Set(['difficulty_asc', 'difficulty_desc', 'error_desc']);

/** 取第一个非空字符串（兼容重复参数 `?type=a&type=b`） */
function firstString(source: Record<string, unknown>, key: string): string | undefined {
  const v = source[key];
  if (typeof v === 'string' && v !== '') return v;
  if (Array.isArray(v) && typeof v[0] === 'string' && v[0] !== '') return v[0];
  return undefined;
}

/**
 * 查询串 / 请求体 → 题库筛选条件。
 * 多选是精确值（题型/难度会过滤掉白名单外的值），`hasImage` 兼容 `1/0` 与布尔。
 */
export function poolFiltersFrom(source: Record<string, unknown>): PoolFilters {
  const courseId = queryNumber(source, 'courseId');
  const types = listParam(source, 'types').filter((t) => TYPE_SET.has(t));
  const singleType = firstString(source, 'type');
  const levels = listParam(source, 'levels').filter((l): l is ExamLevel => LEVEL_SET.has(l));
  const orderByRaw = firstString(source, 'orderBy');
  const keyword = firstString(source, 'keyword');
  return {
    ...(courseId === undefined ? {} : { courseId }),
    ...(singleType ? { type: singleType } : {}),
    ...(listParam(source, 'books').length > 0 ? { books: listParam(source, 'books') } : {}),
    ...(listParam(source, 'chapters').length > 0 ? { chapters: listParam(source, 'chapters') } : {}),
    ...(listParam(source, 'points').length > 0 ? { points: listParam(source, 'points') } : {}),
    ...(types.length > 0 ? { types } : {}),
    ...(levels.length > 0 ? { levels } : {}),
    ...(keyword ? { keyword } : {}),
    ...(source['hasImage'] === '1' || source['hasImage'] === true ? { hasImage: true } : {}),
    ...(source['hasImage'] === '0' || source['hasImage'] === false ? { hasImage: false } : {}),
    ...(orderByRaw && ORDER_BY_SET.has(orderByRaw) ? { orderBy: orderByRaw as PoolOrderBy } : {}),
  };
}

export interface PoolQueryOptions {
  picks: PoolPickOptions;
  page: number;
  pageSize: number;
  orderBy?: PoolOrderBy;
  /** 易错题模式的最小作答次数（普通模式不参与） */
  minAttempts: number;
}

/**
 * 题池查询参数 → 挑题条件 + 分页。
 *
 * `exclude` 由路由传入（排除已在卷内的题），这样这里保持纯函数、可单测。
 */
export function parsePoolQuery(
  source: Record<string, unknown>,
  examCourseId: number,
  exclude: number[],
): PoolQueryOptions {
  const scopeAll = source['scope'] === 'all';
  const baseFilter = poolFiltersFrom(source);
  const courseId = scopeAll ? undefined : (baseFilter.courseId ?? examCourseId);
  const lessonId = queryNumber(source, 'lessonId');
  const bankId = queryNumber(source, 'bankId');
  const levelMin = queryNumber(source, 'levelMin');
  const levelMax = queryNumber(source, 'levelMax');
  const difficulty = typeof source['difficulty'] === 'string' ? source['difficulty'] : undefined;
  const point = typeof source['point'] === 'string' ? source['point'] : undefined;
  const chapter = typeof source['chapter'] === 'string' ? source['chapter'] : undefined;
  const picks: PoolPickOptions = {
    ...baseFilter,
    ...(courseId === undefined ? {} : { courseId }),
    ...(lessonId === undefined ? {} : { lessonId }),
    ...(bankId === undefined ? {} : { bankId }),
    ...(difficulty ? { difficulty } : {}),
    ...(levelMin === undefined ? {} : { levelMin }),
    ...(levelMax === undefined ? {} : { levelMax }),
    ...(point ? { point } : {}),
    ...(chapter ? { chapter } : {}),
    exclude,
  };
  const page = Math.max(1, queryNumber(source, 'page') ?? 1);
  const pageSize = Math.min(50, Math.max(1, queryNumber(source, 'pageSize') ?? 20));
  const minAttempts = Math.max(1, queryNumber(source, 'minAttempts') ?? 2);
  return { picks, page, pageSize, ...(baseFilter.orderBy ? { orderBy: baseFilter.orderBy } : {}), minAttempts };
}
