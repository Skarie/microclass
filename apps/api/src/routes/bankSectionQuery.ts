/**
 * 题库章节目录 / 批量回填接口的参数解析（纯函数，便于单测）。
 *
 * 与 `bankQuery`（课程目录、列表、体检等老接口）分开：章节相关只有两条新接口，
 * 参数规则放在一起不挤占老文件的篇幅。
 */
import { AppError } from '@microclass/shared';
import type { BankKind } from '../db/repositories/bankRepository.js';
import type { BankSectionView } from '../db/repositories/bankSectionQueries.js';
import { parseBankKind } from './bankQuery.js';

/** `GET /banks/catalog-sections` 的原始查询串 */
export interface BankSectionCatalogQuery {
  view?: string;
  kind?: string;
}

/** 章节目录选择：view 默认 book（按册次），kind 为空表示全部类型 */
export interface BankSectionCatalogRequest {
  view: BankSectionView;
  kind: BankKind | '';
}

/** 章节目录：view 只认 book / course，kind 复用现有白名单校验 */
export function parseBankSectionCatalogQuery(q: BankSectionCatalogQuery): BankSectionCatalogRequest {
  const kind = parseBankKind(q.kind);
  const view = q.view === undefined || q.view === '' ? 'book' : q.view;
  if (view !== 'book' && view !== 'course') throw AppError.badRequest('view 只能是 book/course');
  return { view, kind };
}

/** `POST /banks/backfill-sections` 的 body（可省略，默认 dryRun=false、kind=全部） */
export interface BackfillSectionsBody {
  dryRun?: boolean;
  kind?: string;
}

export interface BackfillSectionsRequest {
  dryRun: boolean;
  kind: BankKind | '';
}

/** 回填参数：dryRun 只在显式 true 时预览；kind 复用白名单校验 */
export function parseBackfillSectionsBody(raw: unknown): BackfillSectionsRequest {
  const body = (raw ?? {}) as BackfillSectionsBody;
  if (body.kind !== undefined && typeof body.kind !== 'string') {
    throw AppError.badRequest('kind 只能是 lesson/chapter/paper');
  }
  return { dryRun: body.dryRun === true, kind: parseBankKind(body.kind) };
}
