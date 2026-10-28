/**
 * 文件夹树的纯函数：扁平化渲染行、表单选项、路径与计数。
 *
 * 单独成文件的原因：树要同时服务「左栏渲染」「表单缩进下拉」「面包屑」，
 * 放在组件里会被迫用递归组件；纯函数也便于单测。
 */
import type { BankFolder, BankFolderOption, BankFolderRow } from './bankTypes';

/** 带层级地展开整棵树（不论是否展开），用于表单选项与路径查找 */
function walk(
  nodes: BankFolder[],
  depth: number,
  parentPath: string,
  visit: (node: BankFolder, depth: number, path: string) => void,
): void {
  for (const node of nodes) {
    const path = parentPath === '' ? node.name : `${parentPath} / ${node.name}`;
    visit(node, depth, path);
    walk(node.children ?? [], depth + 1, path, visit);
  }
}

/** 只展开「已展开」的文件夹，得到左栏要渲染的行 */
export function flattenFolderRows(folders: BankFolder[], expanded: ReadonlySet<number>): BankFolderRow[] {
  const rows: BankFolderRow[] = [];
  const visit = (node: BankFolder, depth: number, path: string): void => {
    const children = node.children ?? [];
    rows.push({ ...node, depth, path, hasChildren: children.length > 0 });
    if (children.length > 0 && expanded.has(node.id)) {
      for (const child of children) visit(child, depth + 1, `${path} / ${child.name}`);
    }
  };
  for (const folder of folders) visit(folder, 0, folder.name);
  return rows;
}

/** 表单下拉：所有文件夹按树序平铺，用「— 」前缀表达层级 */
export function flattenFolderOptions(folders: BankFolder[]): BankFolderOption[] {
  const options: BankFolderOption[] = [];
  walk(folders, 0, '', (node, depth, path) => {
    options.push({ id: node.id, name: node.name, depth, path, label: `${'— '.repeat(depth)}${node.name}` });
  });
  return options;
}

/** 文件夹总数（含子孙） */
export function countFolders(folders: BankFolder[]): number {
  let total = 0;
  walk(folders, 0, '', () => {
    total += 1;
  });
  return total;
}

/** 按 id 找路径（如「必刷题 / 第一章」） */
export function folderPathOf(folders: BankFolder[], id: number): string {
  let found = '';
  walk(folders, 0, '', (node, _depth, path) => {
    if (node.id === id) found = path;
  });
  return found;
}

/** 树里是否还有这个文件夹 */
export function hasFolder(folders: BankFolder[], id: number): boolean {
  return folderPathOf(folders, id) !== '';
}

/** 全部文件夹 id（首次加载默认展开用） */
export function allFolderIds(folders: BankFolder[]): number[] {
  const ids: number[] = [];
  walk(folders, 0, '', (node) => {
    ids.push(node.id);
  });
  return ids;
}

/** 左栏行尾的计数文案：有子文件夹时先报子文件夹数 */
export function folderCountLabel(row: BankFolderRow): string {
  const banks = `${row.bankCount} 库 / ${row.questionCount} 题`;
  return row.folderCount > 0 ? `${row.folderCount} 个文件夹 · ${banks}` : banks;
}
