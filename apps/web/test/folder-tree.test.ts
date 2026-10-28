/**
 * 文件夹树纯函数：展开/收起、缩进下拉、路径与计数。
 *
 * 这些函数同时服务左栏树、表单下拉和面包屑，行为错一处会三处一起错，
 * 所以单独覆盖（不依赖组件挂载）。
 */
import { describe, expect, it } from 'vitest';
import {
  allFolderIds,
  countFolders,
  flattenFolderOptions,
  flattenFolderRows,
  folderCountLabel,
  folderPathOf,
  hasFolder,
} from '../src/views/admin/folder-tree';
import { bankCourseName, bankFolderId, bankFolderPath, bankLessonTitle } from '../src/views/admin/bankTypes';
import type { BankFolder } from '../src/views/admin/bankTypes';

const tree: BankFolder[] = [
  {
    id: 1,
    parentId: null,
    name: '初中七年级数学',
    sort: 0,
    bankCount: 12,
    questionCount: 340,
    folderCount: 1,
    children: [
      {
        id: 2,
        parentId: 1,
        name: '第一章',
        sort: 1,
        bankCount: 5,
        questionCount: 120,
        folderCount: 0,
        children: [],
      },
    ],
  },
  {
    id: 3,
    parentId: null,
    name: '必刷题',
    sort: 1,
    bankCount: 7,
    questionCount: 80,
    folderCount: 2,
    children: [],
  },
];

describe('文件夹树：左栏行', () => {
  it('全部展开时按树序返回，带层级与路径', () => {
    const rows = flattenFolderRows(tree, new Set([1, 2, 3]));
    expect(rows.map((row) => row.id)).toEqual([1, 2, 3]);
    expect(rows[0]).toMatchObject({ depth: 0, path: '初中七年级数学', hasChildren: true });
    expect(rows[1]).toMatchObject({ depth: 1, path: '初中七年级数学 / 第一章', hasChildren: false });
  });

  it('收起父文件夹后隐藏子文件夹，但保留其它根节点', () => {
    const rows = flattenFolderRows(tree, new Set([3]));
    expect(rows.map((row) => row.id)).toEqual([1, 3]);
    expect(rows[0]?.hasChildren).toBe(true);
  });

  it('行尾计数：有子文件夹时先报子文件夹数，没有时只报库/题', () => {
    const rows = flattenFolderRows(tree, new Set([1]));
    expect(folderCountLabel(rows[0]!)).toBe('1 个文件夹 · 12 库 / 340 题');
    expect(folderCountLabel(rows[1]!)).toBe('5 库 / 120 题');
  });
});

describe('文件夹树：表单下拉与路径', () => {
  it('下拉按树序平铺，用「— 」前缀表达层级', () => {
    const options = flattenFolderOptions(tree);
    expect(options.map((option) => option.label)).toEqual(['初中七年级数学', '— 第一章', '必刷题']);
    expect(options[1]).toMatchObject({ id: 2, depth: 1, path: '初中七年级数学 / 第一章' });
  });

  it('路径 / 存在性 / 总数', () => {
    expect(folderPathOf(tree, 2)).toBe('初中七年级数学 / 第一章');
    expect(folderPathOf(tree, 99)).toBe('');
    expect(hasFolder(tree, 3)).toBe(true);
    expect(hasFolder(tree, 99)).toBe(false);
    expect(countFolders(tree)).toBe(3);
    expect(allFolderIds(tree)).toEqual([1, 2, 3]);
  });
});

describe('题库字段兼容', () => {
  it('readme 字段是 camelCase 时直接读取', () => {
    const bank = {
      folderId: 2,
      folderPath: '必刷题 / 第一章',
      courseName: 'java',
      lessonTitle: '第 1 讲',
    };
    expect(bankFolderId(bank)).toBe(2);
    expect(bankFolderPath(bank)).toBe('必刷题 / 第一章');
    expect(bankCourseName(bank)).toBe('java');
    expect(bankLessonTitle(bank)).toBe('第 1 讲');
  });

  it('snake_case（含老的 lesson_title）时也能回退', () => {
    const bank = {
      folder_id: 3,
      folder_path: '必刷题',
      course_name: '数学',
      lesson_title: '第 2 讲',
    };
    expect(bankFolderId(bank)).toBe(3);
    expect(bankFolderPath(bank)).toBe('必刷题');
    expect(bankCourseName(bank)).toBe('数学');
    expect(bankLessonTitle(bank)).toBe('第 2 讲');
  });
});
