/**
 * 题库文件夹：树形目录（含子孙计数）与教师/管理员可用的增删改。
 *
 * - 文件夹可多层嵌套，题库是叶子（`banks.folder_id`）；未挂文件夹的题库归「未分类」；
 * - 树节点的 bankCount / questionCount 是**含子孙**的合计，folderCount 是直接子文件夹数；
 * - 层级不限制，但展示时超过 12 层直接平铺到第 12 层，避免脏数据把页面撑爆；
 * - 移动防环（不能移到自己或自己的子孙下），同级重名 409，只有空文件夹可删。
 */
import { AppError, type User } from '@microclass/shared';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { BankFolderRepository, CourseSummaryRow, FolderTotals } from '../db/repositories/bankFolderQueries.js';
import { buildFolderTree } from '../domain/bankFolderTree.js';
import type { BankFolderNode, BankFolderTree } from '../domain/bankFolderTree.js';

export type { BankFolderNode, BankFolderTree } from '../domain/bankFolderTree.js';

/** 文件夹名上限（与路由 schema、服务端 trim 保持一致） */
export const FOLDER_NAME_MAX_LENGTH = 120;

/** 增删改接口返回的文件夹节点（与树节点同构，便于前端直接替换） */
export type BankFolderSummary = BankFolderNode;

export interface FolderCreateInput {
  parentId?: number | null;
  name: string;
}

export interface FolderUpdateInput {
  name?: string;
  parentId?: number | null;
  sort?: number;
}

export interface CourseSummary {
  courses: CourseSummaryRow[];
  unbound: FolderTotals;
}

/** trim + 长度校验；空名 / 超长都 400（错误文案与前端提示一致） */
function normalizeName(raw: string): string {
  const name = (raw ?? '').trim();
  if (name.length === 0) throw AppError.badRequest('文件夹名称不能为空');
  if (name.length > FOLDER_NAME_MAX_LENGTH) {
    throw AppError.badRequest(`文件夹名称不能超过 ${FOLDER_NAME_MAX_LENGTH} 个字符`);
  }
  return name;
}

export class BankFolderService {
  constructor(
    private readonly folders: BankFolderRepository,
    private readonly audit: AuditRepository,
  ) {}

  /** 文件夹树 + 未分类统计 */
  tree(): BankFolderTree {
    return buildFolderTree(this.folders.all(), this.folders.directCounts(), this.folders.unfiled());
  }

  /** 文件夹是否存在（题库创建/编辑校验 folderId 用） */
  exists(id: number): boolean {
    return Number.isInteger(id) && id > 0 && this.folders.findById(id) !== undefined;
  }

  create(actor: User, input: FolderCreateInput): BankFolderSummary {
    const name = normalizeName(input.name);
    const parentId = input.parentId === undefined ? null : input.parentId;
    if (parentId !== null) {
      if (!this.exists(parentId)) throw AppError.badRequest('父文件夹不存在');
    }
    if (this.folders.findByParentAndName(parentId, name)) {
      throw AppError.conflict('同级已存在同名文件夹');
    }
    const sort = this.folders.nextSort(parentId);
    const row = this.folders.insert(parentId, name, sort);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'bank.folder.create',
      targetType: 'bank_folder',
      targetId: row.id,
      detail: { name, parentId, sort },
    });
    return this.nodeOf(row.id);
  }

  update(actor: User, id: number, input: FolderUpdateInput): BankFolderSummary {
    const row = this.folders.findById(id);
    if (!row) throw AppError.notFound('文件夹不存在');

    const name = input.name === undefined ? row.name : normalizeName(input.name);
    let parentId = row.parent_id;
    if (input.parentId !== undefined) {
      parentId = input.parentId;
      if (parentId !== null) {
        if (!this.exists(parentId)) throw AppError.badRequest('父文件夹不存在');
        if (this.isDescendant(parentId, id)) {
          throw AppError.badRequest('不能把文件夹移动到它自己或它的子文件夹下');
        }
      }
    }
    const sort = input.sort === undefined ? row.sort : Math.trunc(input.sort);

    const duplicate = this.folders.findByParentAndName(parentId, name);
    if (duplicate && duplicate.id !== id) throw AppError.conflict('同级已存在同名文件夹');

    this.folders.update(id, { name, parentId, sort });
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'bank.folder.update',
      targetType: 'bank_folder',
      targetId: id,
      detail: { name, parentId, sort },
    });
    return this.nodeOf(id);
  }

  remove(actor: User, id: number): void {
    const row = this.folders.findById(id);
    if (!row) throw AppError.notFound('文件夹不存在');
    if (this.folders.childCount(id) > 0 || this.folders.bankCount(id) > 0) {
      throw AppError.conflict('请先移走其中的题库或子文件夹');
    }
    this.folders.remove(id);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'bank.folder.delete',
      targetType: 'bank_folder',
      targetId: id,
      detail: { name: row.name },
    });
  }

  /** 课程关联视图的汇总（只返回有题库的课程） */
  courseSummary(): CourseSummary {
    return this.folders.courseSummary();
  }

  /** 单个文件夹节点（增删改的返回体，与树节点同构） */
  private nodeOf(id: number): BankFolderNode {
    const find = (list: BankFolderNode[]): BankFolderNode | undefined => {
      for (const node of list) {
        if (node.id === id) return node;
        const hit = find(node.children);
        if (hit) return hit;
      }
      return undefined;
    };
    const node = find(this.tree().folders);
    if (!node) throw AppError.notFound('文件夹不存在');
    return node;
  }

  /** candidate 是否是 ancestorId 本身或它的子孙（沿 parent 链向上找） */
  private isDescendant(candidate: number, ancestorId: number): boolean {
    let current: number | null = candidate;
    const seen = new Set<number>();
    while (current !== null) {
      if (current === ancestorId) return true;
      if (seen.has(current)) return false; // 脏数据成环时停止，避免死循环
      seen.add(current);
      current = this.folders.findById(current)?.parent_id ?? null;
    }
    return false;
  }
}
