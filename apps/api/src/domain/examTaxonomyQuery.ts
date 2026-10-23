/**
 * 选题树 / 知识点 / 细目表参考数据的范围解析（纯逻辑，可直接单测）。
 *
 * 从 `routes/exams.ts` 抽出：三处的「`scope=all` 才跨课程，否则默认本考试课程」
 * 规则一致，但 courseId 的优先级各有历史原因（细目表显式 courseId 优先于 scope），
 * 集中写在这里并配单测，避免以后再拆时把某个分支弄丢。
 */
import { EXAM_LEVELS, listParam, type ExamLevel } from './examRequest.js';

const LEVEL_SET: ReadonlySet<string> = new Set(EXAM_LEVELS);

/** 本课程范围：`scope=all` 返回 undefined（跨课程）；否则显式 courseId 优先，缺省用考试课程 */
function scopedCourseId(source: Record<string, unknown>, examCourseId: number): number | undefined {
  if (source['scope'] === 'all') return undefined;
  const raw = source['courseId'];
  return raw ? Number(raw) : examCourseId;
}

/** 选题树条件（册次 → 章节，带题量） */
export interface FacetsQueryOptions {
  courseId?: number;
  types?: string[];
  levels?: ExamLevel[];
  keyword?: string;
  books?: string[];
  bankLimit?: number;
  exclude?: number[];
}

export function parseFacetsQuery(
  source: Record<string, unknown>,
  examCourseId: number,
  exclude: number[],
): FacetsQueryOptions {
  const courseId = scopedCourseId(source, examCourseId);
  const types = listParam(source, 'types');
  const levels = listParam(source, 'levels').filter((l): l is ExamLevel => LEVEL_SET.has(l));
  const books = listParam(source, 'books');
  const keyword = source['keyword'];
  const bankLimit = source['bankLimit'];
  return {
    ...(exclude.length > 0 ? { exclude } : {}),
    ...(courseId === undefined ? {} : { courseId }),
    ...(types.length > 0 ? { types } : {}),
    ...(levels.length > 0 ? { levels } : {}),
    ...(typeof keyword === 'string' && keyword !== '' ? { keyword } : {}),
    ...(books.length > 0 ? { books } : {}),
    ...(typeof bankLimit === 'string' ? { bankLimit: Number(bankLimit) } : {}),
  };
}

/** 知识点懒加载条件 */
export interface PointsQueryOptions {
  courseId?: number;
  books?: string[];
  chapters?: string[];
  types?: string[];
  levels?: ExamLevel[];
  keyword?: string;
  pointKeyword?: string;
  limit?: number;
  exclude?: number[];
}

export function parsePointsQuery(
  source: Record<string, unknown>,
  examCourseId: number,
  exclude: number[],
): PointsQueryOptions {
  const courseId = scopedCourseId(source, examCourseId);
  const types = listParam(source, 'types');
  const levels = listParam(source, 'levels').filter((l): l is ExamLevel => LEVEL_SET.has(l));
  const books = listParam(source, 'books');
  const chapters = listParam(source, 'chapters');
  const keyword = source['keyword'];
  const pointKeyword = source['pointKeyword'];
  const limit = source['limit'];
  return {
    ...(exclude.length > 0 ? { exclude } : {}),
    ...(courseId === undefined ? {} : { courseId }),
    ...(books.length > 0 ? { books } : {}),
    ...(chapters.length > 0 ? { chapters } : {}),
    ...(types.length > 0 ? { types } : {}),
    ...(levels.length > 0 ? { levels } : {}),
    ...(typeof keyword === 'string' && keyword !== '' ? { keyword } : {}),
    ...(typeof pointKeyword === 'string' && pointKeyword !== '' ? { pointKeyword } : {}),
    ...(typeof limit === 'string' ? { limit: Number(limit) } : {}),
  };
}

/** 细目表参考数据的范围（显式 courseId 优先于 scope，与拆分前一致） */
export interface TaxonomyQueryOptions {
  scope: 'course' | 'all';
  courseId?: number;
  limit?: number;
}

export function parseTaxonomyQuery(source: Record<string, unknown>, examCourseId: number): TaxonomyQueryOptions {
  const scope: 'course' | 'all' = source['scope'] === 'all' ? 'all' : 'course';
  const rawCourseId = source['courseId'];
  const courseId = rawCourseId ? Number(rawCourseId) : scope === 'all' ? undefined : examCourseId;
  const limit = source['limit'];
  return {
    scope,
    ...(courseId === undefined ? {} : { courseId }),
    ...(limit ? { limit: Number(limit) } : {}),
  };
}
