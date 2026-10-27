/**
 * 题库章节：按「册次 → 章节」的目录数据，以及历史题库的批量回填。
 *
 * 目录不依赖课程（没有课程的题库也能归类），课程视图只是另一种聚合口径；
 * 回填按「课时 group_name 优先，其次解析题库名」补齐 section，dryRun 只算不写。
 */
import type { User } from '@microclass/shared';
import type { BankKind, BankRepository } from '../db/repositories/bankRepository.js';
import type { BankSectionCatalog, BankSectionView } from '../db/repositories/bankSectionQueries.js';
import { sectionFromBankName } from '../db/repositories/bankRepository.js';
import type { AuditRepository } from '../db/repositories/auditRepository.js';

/** 章节名上限（与请求体 schema、服务端 trim 保持一致） */
export const SECTION_MAX_LENGTH = 120;

/** 回填结果：samples / skippedSamples 各最多 10 条，避免接口返回过大 */
export interface BackfillSectionsResult {
  dryRun: boolean;
  filled: number;
  skipped: number;
  samples: { id: number; name: string; section: string }[];
  skippedSamples: { id: number; name: string }[];
}

const SAMPLE_LIMIT = 10;

/**
 * 章节入参：trim + 截断到 120；为空且绑了课时则继承 group_name（没有则留空）。
 * 编辑时 `fallback` 传题库原值，实现「不传 section = 保留原值」。
 */
export function resolveSection(raw: string | undefined, groupName: string | undefined, fallback = ''): string {
  const text = (raw ?? fallback).trim().slice(0, SECTION_MAX_LENGTH);
  if (text !== '') return text;
  return (groupName ?? '').trim().slice(0, SECTION_MAX_LENGTH);
}

/**
 * 回填单个题库的章节：课时 group_name 优先；没有则解析题库名第一段；
 * 都不像章节时返回空串（跳过）。
 */
export function backfillSectionOf(row: { name: string; groupName: string }): string {
  const fromLesson = (row.groupName ?? '').trim().slice(0, SECTION_MAX_LENGTH);
  if (fromLesson !== '') return fromLesson;
  return sectionFromBankName(row.name);
}

export class BankSectionService {
  constructor(
    private readonly banks: BankRepository,
    private readonly audit: AuditRepository,
  ) {}

  /** 目录：view=book 全部题库按册次分组；view=course 只统计已归属课程的题库 */
  catalogSections(view: BankSectionView = 'book', kind: BankKind | '' = ''): BankSectionCatalog {
    return view === 'course' ? this.banks.sectionCatalogByCourse(kind) : this.banks.sectionCatalogByBook(kind);
  }

  /**
   * 批量回填 `section` 为空的题库。
   * dryRun=true 时只统计候选与样本，不写库（前端先预览再确认）。
   */
  backfillSections(actor: User, input: { dryRun?: boolean; kind?: BankKind | '' }): BackfillSectionsResult {
    const dryRun = input.dryRun === true;
    const kind = input.kind ?? '';
    const rows = this.banks.banksWithoutSection(kind);
    const plan: { id: number; section: string }[] = [];
    const samples: BackfillSectionsResult['samples'] = [];
    const skippedSamples: BackfillSectionsResult['skippedSamples'] = [];
    for (const row of rows) {
      const section = backfillSectionOf(row);
      if (section === '') {
        if (skippedSamples.length < SAMPLE_LIMIT) skippedSamples.push({ id: row.id, name: row.name });
        continue;
      }
      plan.push({ id: row.id, section });
      if (samples.length < SAMPLE_LIMIT) samples.push({ id: row.id, name: row.name, section });
    }
    const filled = dryRun ? plan.length : this.banks.applyBankSections(plan);
    if (!dryRun) {
      this.audit.write({
        actorId: actor.id,
        actorName: actor.username,
        action: 'bank.backfill_sections',
        targetType: 'bank',
        detail: { filled, skipped: rows.length - plan.length, kind },
      });
    }
    return {
      dryRun,
      filled,
      skipped: rows.length - plan.length,
      samples,
      skippedSamples,
    };
  }
}
