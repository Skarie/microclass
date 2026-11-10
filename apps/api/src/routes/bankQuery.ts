/**
 * 题库 / 题目接口的查询参数解析（纯函数，路由与业务共用，便于单测）。
 *
 * 从 `routes/banks.ts` 抽出：列表筛选与分页、目录、体检、题目列表与跨库检索
 * 的取值规则以前散在 550 行路由文件里，既难复用也没法测；现在路由只负责
 * 取 deps 与拼返回。语义与拆分前逐字一致（包括「传了非法值就报 400」这类边界），
 * 测试见 `apps/api/test/bank-request.test.ts`。
 */
import { AppError, type QuestionType } from '@microclass/shared';
import type { BankKind, BankListFilter } from '../db/repositories/bankRepository.js';

/**
 * 解析 `kind` 查询参数：空串 = 全部类型。
 * 非法值直接 400，而不是静默忽略筛选（否则界面切换后看似生效、实际没筛）。
 * 重载保证：调用方已判空（字符串）时拿到的一定是具体类型，目录接口才需要保留空串。
 */
export function parseBankKind(raw: string): BankKind;
export function parseBankKind(raw: string | undefined): BankKind | '';
export function parseBankKind(raw: string | undefined): BankKind | '' {
  if (!raw) return '';
  if (raw === 'lesson' || raw === 'chapter' || raw === 'paper') return raw;
  throw AppError.badRequest('kind 只能是 lesson/chapter/paper');
}

/** `GET /banks` 的原始查询串（Fastify 把每个参数都解析成字符串） */
export interface BankListQuery {
  lesson?: string;
  kind?: string;
  subject?: string;
  book?: string;
  /** 章节精确筛选；空串 = 只看未分章（注意与「不传」不同） */
  section?: string;
  keyword?: string;
  courseId?: string;
  /** 文件夹直属筛选；`none` = 只看未分类 */
  folderId?: string;
  limit?: string;
  offset?: string;
}

/** 题库列表默认分页大小：全库上万个题库，一次全拉既慢又没法用（页面默认取前 300 个） */
const DEFAULT_BANK_PAGE_SIZE = 300;

/**
 * 题库列表的筛选 + 分页。
 *
 * `lesson=orphan` 只看没有课时归属的题库；`kind=lesson|chapter|paper` 按题库类型筛选
 * （章节题库 / 整卷试卷是「全量导入」进来的，量很大，管理端要能筛）；
 * `courseId=unbound` 只看未归属课程的题库。
 */
export function parseBankListQuery(q: BankListQuery): BankListFilter {
  const filter: BankListFilter = {};
  if (q.lesson === 'orphan') filter.lessonId = null;
  else if (q.lesson !== undefined && q.lesson !== '') {
    const lessonId = Number.parseInt(q.lesson, 10);
    if (Number.isNaN(lessonId)) throw AppError.badRequest('lesson 参数非法');
    filter.lessonId = lessonId;
  }
  if (q.kind) filter.kind = parseBankKind(q.kind);
  if (q.subject) filter.subject = q.subject;
  // 空串也要保留：`?book=` 表示「未归类册次」，没传才是全部
  if (q.book !== undefined) filter.book = q.book;
  // 空串也要保留：`?section=` 表示「只看未分章」，没传才是全部
  if (q.section !== undefined) filter.section = q.section;
  if (q.keyword) filter.keyword = q.keyword;
  if (q.courseId === 'unbound') filter.courseId = null;
  else if (q.courseId) {
    const courseId = Number.parseInt(q.courseId, 10);
    if (Number.isNaN(courseId)) throw AppError.badRequest('courseId 参数非法');
    filter.courseId = courseId;
  }
  // 文件夹：数字 = 只看直属题库；none = 未分类；不传 = 全部
  if (q.folderId === 'none') filter.folderId = null;
  else if (q.folderId) {
    const folderId = Number.parseInt(q.folderId, 10);
    if (Number.isNaN(folderId)) throw AppError.badRequest('folderId 参数非法');
    filter.folderId = folderId;
  }
  const limit = q.limit === undefined || q.limit === '' ? DEFAULT_BANK_PAGE_SIZE : Number.parseInt(q.limit, 10);
  if (Number.isNaN(limit) || limit < 1) throw AppError.badRequest('limit 参数非法');
  const offset = q.offset === undefined || q.offset === '' ? 0 : Number.parseInt(q.offset, 10);
  if (Number.isNaN(offset) || offset < 0) throw AppError.badRequest('offset 参数非法');
  filter.limit = limit;
  filter.offset = offset;
  return filter;
}

/** `GET /banks/catalog` 的原始查询串 */
export interface BankCatalogQuery {
  courseId?: string;
  kind?: string;
}

/** 目录接口的选择：带 `courseId` 时看某门课的目录树，否则看课程列表 */
export interface BankCatalogSelection {
  courseId?: number;
  kind: BankKind | '';
}

/** 目录 / 绑定的筛选：kind 先校验（错误顺序与拆分前一致），courseId 只认数字 */
export function parseBankCatalogQuery(q: BankCatalogQuery): BankCatalogSelection {
  const kind = parseBankKind(q.kind);
  if (!q.courseId) return { kind };
  const courseId = Number.parseInt(q.courseId, 10);
  if (Number.isNaN(courseId)) throw AppError.badRequest('courseId 参数非法');
  return { courseId, kind };
}

/** `GET /banks/health` 的原始查询串 */
export interface BankHealthQuery {
  bankId?: string;
  limit?: string;
  refresh?: string;
}

/** 体检参数：`refresh=1` 强制重算；limit 收敛到 1~100，默认 20 */
export interface BankHealthRequest {
  bankId: number | undefined;
  limit: number;
  refresh: boolean;
}

/**
 * 题库体检参数。
 * 注意：`bankId=` 传空串在拆分前就会 400（空串不是整数），这里保持同样的判定。
 */
export function parseBankHealthQuery(q: BankHealthQuery): BankHealthRequest {
  const bankId = q.bankId ? Number.parseInt(q.bankId, 10) : undefined;
  if (q.bankId !== undefined && !Number.isInteger(bankId)) throw AppError.badRequest('bankId 参数非法');
  const limit = q.limit ? Math.min(100, Math.max(1, Number.parseInt(q.limit, 10))) : 20;
  return { bankId, limit, refresh: q.refresh === '1' };
}

/** `GET /banks/:id/questions` 的原始查询串 */
export interface BankQuestionListQuery {
  type?: string;
  keyword?: string;
  difficulty?: string;
  /** 章节 / 小节精确筛选（迁移 0025）；空串表示「未分章 / 未分小节」 */
  chapter?: string;
  section?: string;
  mediaOnlyAnalysis?: string;
  /** 只看某个题组里的题（迁移 0029） */
  groupId?: string;
  /** 标签筛选（迁移 0030）：`tagIds=1,2` 或重复参数；tagMode=any(默认)/all */
  tagIds?: string | string[];
  tagMode?: string;
  /** 知识点多选：`points=a&points=b`；pointMode=any(默认)/all */
  points?: string | string[];
  pointMode?: string;
  page?: string;
  pageSize?: string;
}

/** 题库内题目列表的筛选（`page`/`pageSize` 由服务层收敛） */
export interface BankQuestionListRequest {
  type?: QuestionType;
  keyword?: string;
  difficulty?: string;
  chapter?: string;
  section?: string;
  mediaOnlyAnalysis?: true;
  groupId?: number;
  /** 标签筛选：命中任意 / 同时包含 */
  tagIds?: number[];
  tagMode?: 'any' | 'all';
  /** 知识点多选（与标签同一套 any/all 语义） */
  points?: string[];
  pointMode?: 'any' | 'all';
  page?: number;
  pageSize?: number;
}

/**
 * 题库内题目列表参数。
 * 「解析只有图片」的题（`mediaOnlyAnalysis=1`）：图片里是解析文字，搜不到也改不了，
 * 教师需要能把它们筛出来。
 */
export function parseBankQuestionListQuery(q: BankQuestionListQuery): BankQuestionListRequest {
  return {
    ...(q.type ? { type: q.type as QuestionType } : {}),
    ...(q.keyword ? { keyword: q.keyword } : {}),
    ...(q.difficulty ? { difficulty: q.difficulty } : {}),
    ...(q.chapter !== undefined ? { chapter: q.chapter } : {}),
    ...(q.section !== undefined ? { section: q.section } : {}),
    ...(q.mediaOnlyAnalysis === '1' ? { mediaOnlyAnalysis: true } : {}),
    ...parseGroupId(q.groupId),
    ...parseTagFilter(q.tagIds, q.tagMode),
    ...parsePointFilter(q.points, q.pointMode),
    ...(q.page ? { page: Number.parseInt(q.page, 10) } : {}),
    ...(q.pageSize ? { pageSize: Number.parseInt(q.pageSize, 10) } : {}),
  };
}

/** 题组筛选：数字 = 该组；空串/缺省 = 不筛；非法值 400（与 folderId 等同口径） */
function parseGroupId(raw: string | undefined): { groupId?: number } {
  if (raw === undefined || raw === '') return {};
  const groupId = Number.parseInt(raw, 10);
  if (Number.isNaN(groupId) || groupId <= 0) throw AppError.badRequest('groupId 参数非法');
  return { groupId };
}

/** 查询串里的数字列表：支持 `a,b` 与重复参数两种写法；非法值 400（不静默忽略） */
function numberList(raw: string | string[] | undefined, label: string): number[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const out: number[] = [];
  for (const part of parts) {
    const text = part.trim();
    if (text === '') continue;
    const value = Number.parseInt(text, 10);
    if (Number.isNaN(value) || value <= 0) throw AppError.badRequest(`${label} 参数非法`);
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

/** 查询串里的文本列表（知识点名）：支持逗号与重复参数 */
function textList(raw: string | string[] | undefined): string[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const out: string[] = [];
  for (const part of parts) {
    const text = part.trim();
    if (text !== '' && !out.includes(text)) out.push(text);
  }
  return out;
}

/** 标签筛选：tagIds + tagMode（any 默认 / all 同时包含） */
function parseTagFilter(
  rawIds: string | string[] | undefined,
  rawMode: string | undefined,
): { tagIds?: number[]; tagMode?: 'any' | 'all' } {
  const tagIds = numberList(rawIds, 'tagIds');
  if (tagIds.length === 0) return {};
  if (rawMode !== undefined && rawMode !== '' && rawMode !== 'any' && rawMode !== 'all') {
    throw AppError.badRequest('tagMode 只能是 any 或 all');
  }
  return { tagIds, tagMode: rawMode === 'all' ? 'all' : 'any' };
}

/** 知识点多选：与标签共用 any/all 语义 */
function parsePointFilter(
  rawPoints: string | string[] | undefined,
  rawMode: string | undefined,
): { points?: string[]; pointMode?: 'any' | 'all' } {
  const points = textList(rawPoints);
  if (points.length === 0) return {};
  if (rawMode !== undefined && rawMode !== '' && rawMode !== 'any' && rawMode !== 'all') {
    throw AppError.badRequest('pointMode 只能是 any 或 all');
  }
  return { points, pointMode: rawMode === 'all' ? 'all' : 'any' };
}

/** `GET /questions/search` 的原始查询串 */
export interface QuestionSearchQuery {
  subject?: string;
  book?: string;
  chapter?: string;
  point?: string;
  difficulty?: string;
  type?: string;
  page?: string;
  pageSize?: string;
}

/** 跨题库检索条件：空值直接省略（不生成「= ''」的条件） */
export type QuestionSearchRequest = Omit<QuestionSearchQuery, 'page' | 'pageSize'> & {
  page?: number;
  pageSize?: number;
};

/** 跨题库按知识点 / 书册 / 难度找题的参数（聚合浏览、组卷选题用） */
export function parseQuestionSearchQuery(q: QuestionSearchQuery): QuestionSearchRequest {
  return {
    ...(q.subject ? { subject: q.subject } : {}),
    ...(q.book ? { book: q.book } : {}),
    ...(q.chapter ? { chapter: q.chapter } : {}),
    ...(q.point ? { point: q.point } : {}),
    ...(q.difficulty ? { difficulty: q.difficulty } : {}),
    ...(q.type ? { type: q.type } : {}),
    ...(q.page ? { page: Number.parseInt(q.page, 10) } : {}),
    ...(q.pageSize ? { pageSize: Number.parseInt(q.pageSize, 10) } : {}),
  };
}

/** 导出 / 打印的 `?answers=0` 关闭答案解析，其余（含不传）都带答案 */
export function withAnswersFlag(raw: string | undefined): boolean {
  return raw !== '0';
}
