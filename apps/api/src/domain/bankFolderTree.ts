/**
 * 题库文件夹树的组装（纯函数）：直属计数 → 含子孙合计、父子嵌套、层级裁剪。
 *
 * 从 `services/bankFolderService` 抽出：树结构只跟数据形状有关，与权限/审计无关，
 * 单独放这里便于复用与单测。
 */
import type { BankFolderRow, FolderDirectCount, FolderTotals } from '../db/repositories/bankFolderQueries.js';

/** 展示层最大嵌套层级：超过的子孙平铺到该层 */
export const FOLDER_MAX_DEPTH = 12;

export interface BankFolderNode {
  id: number;
  parentId: number | null;
  name: string;
  sort: number;
  /** 含子孙的题库数 */
  bankCount: number;
  /** 含子孙的题量（banks.question_count 预计算列） */
  questionCount: number;
  /** 直接子文件夹数 */
  folderCount: number;
  children: BankFolderNode[];
}

export interface BankFolderTree {
  folders: BankFolderNode[];
  unfiled: FolderTotals;
}

const bySort = (a: BankFolderNode, b: BankFolderNode): number => a.sort - b.sort || a.id - b.id;

/**
 * 把扁平的文件夹行组装成树：
 *   - bankCount / questionCount 先取直属值，自底向上累加子孙；
 *   - folderCount 保持「直接子文件夹数」，不因层级裁剪而改变；
 *   - 超过 FOLDER_MAX_DEPTH 的层级把整棵子树平铺成直接子节点。
 */
export function buildFolderTree(
  rows: BankFolderRow[],
  counts: FolderDirectCount[],
  unfiled: FolderTotals,
): BankFolderTree {
  const countMap = new Map(counts.map((c) => [c.folderId, c]));
  const nodes = new Map<number, BankFolderNode>();
  for (const row of rows) {
    const count = countMap.get(row.id);
    nodes.set(row.id, {
      id: row.id,
      parentId: row.parent_id,
      name: row.name,
      sort: row.sort,
      bankCount: count?.bankCount ?? 0,
      questionCount: count?.questionCount ?? 0,
      folderCount: 0,
      children: [],
    });
  }

  const roots: BankFolderNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId === null ? undefined : nodes.get(node.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const seen = new Set<number>();
  const aggregate = (node: BankFolderNode): void => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    for (const child of node.children) {
      aggregate(child);
      node.bankCount += child.bankCount;
      node.questionCount += child.questionCount;
    }
    node.folderCount = node.children.length;
  };
  for (const root of roots) aggregate(root);

  // 最大层级保护：第 12 层以下（含）全部平铺到第 12 层，树最多 12 级
  const collect = (list: BankFolderNode[]): BankFolderNode[] => {
    const flat: BankFolderNode[] = [];
    for (const node of list) flat.push({ ...node, children: [] }, ...collect(node.children));
    return flat;
  };
  const clip = (list: BankFolderNode[], level: number): void => {
    list.sort(bySort);
    for (const node of list) {
      // level 是当前节点的层级（根 = 1）；到第 11 层时把整棵子树平铺成第 12 层
      if (level >= FOLDER_MAX_DEPTH - 1) node.children = collect(node.children);
      else clip(node.children, level + 1);
    }
  };
  clip(roots, 1);

  return { folders: roots, unfiled };
}
