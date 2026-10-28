/**
 * 迁移 0025 的数据重组：把 0024 生成的「book 顶层 → section」目录
 * 改成「年级/系列 → book → section」。
 *
 * - 关联课程的题库：顶层 = 课程名解析出的年级；
 * - 未关联课程的题库：顶层 = 题库名/册次解析出的系列（判断不出 → 其他资料）；
 * - 尽量**移动**已有 book / section 文件夹而不是重建；同一 book 被不同年级共用时，
 *   按年级各建一份，避免题库串到别的年级下；
 * - 幂等：已符合要求的题库不改 folder_id，重复执行不会新建同名同级文件夹。
 */
import type { Db } from './client.js';
import { parseGrade, parseSeries } from '../domain/bankFolderGrouping.js';

interface FolderRow {
  id: number;
  parent_id: number | null;
  name: string;
  sort: number;
}

interface BankRow {
  id: number;
  name: string;
  book: string;
  section: string;
  course_id: number | null;
  courseName: string;
  folder_id: number | null;
}

interface BankMeta {
  id: number;
  book: string;
  section: string;
  folderId: number | null;
  groupKey: string;
  topName: string;
  topKind: 'grade' | 'series';
}

export interface BankFolderReorgResult {
  /** 新建文件夹数 */
  created: number;
  /** 实际改了 folder_id 的题库数 */
  moved: number;
  /** 处理的题库总数 */
  banks: number;
  gradeFolders: string[];
  seriesFolders: string[];
  /** 落「其他年级」/「其他资料」的题库数（便于迁移后核对） */
  otherGradeBanks: number;
  otherSeriesBanks: number;
}

const GRADE_ORDER = [
  '一年级',
  '二年级',
  '三年级',
  '四年级',
  '五年级',
  '六年级',
  '七年级',
  '八年级',
  '九年级',
  '高中',
  '初中',
  '小学',
  '其他年级',
];

const normalizedBook = (book: string): string => String(book ?? '').trim();
const normalizedSection = (section: string): string => String(section ?? '').trim();

function groupKeyOf(bank: BankRow): string {
  if (bank.course_id !== null) return `g\u0000${parseGrade(bank.courseName)}\u0000${normalizedBook(bank.book)}`;
  return `s\u0000${parseSeries(bank.name, bank.book)}\u0000${normalizedBook(bank.book)}`;
}

export function reorgBankFolders(db: Db): BankFolderReorgResult {
  const folders = db.all<FolderRow>('SELECT id, parent_id, name, sort FROM bank_folders ORDER BY id');
  const byId = new Map<number, FolderRow>(folders.map((f) => [f.id, f]));
  const childKey = (parentId: number | null, name: string): string => `${parentId ?? 'root'}\u0000${name}`;
  const childMap = new Map<string, number>();
  for (const folder of folders) {
    const key = childKey(folder.parent_id, folder.name);
    if (!childMap.has(key)) childMap.set(key, folder.id);
  }
  let created = 0;

  const nextSort = (parentId: number | null): number => {
    let max = -1;
    for (const folder of byId.values()) {
      if (folder.parent_id === parentId && folder.sort > max) max = folder.sort;
    }
    return max + 1;
  };

  /** 系列文件夹排在年级之后（年级用 0..n-1 的固定序），避免两类顶层交错 */
  const nextSeriesSort = (): number => {
    let max = GRADE_ORDER.length;
    for (const folder of byId.values()) {
      // 「其他资料」固定排最后，不参与递增
      if (folder.parent_id === null && folder.name !== '其他资料' && folder.sort > max) max = folder.sort;
    }
    return max + 1;
  };

  const ensureFolder = (parentId: number | null, name: string, sort?: number): number => {
    const key = childKey(parentId, name);
    const hit = childMap.get(key);
    if (hit !== undefined) return hit;
    const folderSort = sort ?? nextSort(parentId);
    const id = db.run('INSERT INTO bank_folders (parent_id, name, sort) VALUES (?,?,?)', [
      parentId,
      name,
      folderSort,
    ]).lastInsertRowid;
    byId.set(id, { id, parent_id: parentId, name, sort: folderSort });
    childMap.set(key, id);
    created += 1;
    return id;
  };

  const moveFolder = (id: number, parentId: number): void => {
    const row = byId.get(id);
    if (!row || row.parent_id === parentId) return;
    childMap.delete(childKey(row.parent_id, row.name));
    db.run('UPDATE bank_folders SET parent_id = ? WHERE id = ?', [parentId, id]);
    row.parent_id = parentId;
    childMap.set(childKey(parentId, row.name), id);
  };

  const isAncestor = (candidate: number, ofFolder: number): boolean => {
    let current: number | null = ofFolder;
    const seen = new Set<number>();
    while (current !== null && !seen.has(current)) {
      if (current === candidate) return true;
      seen.add(current);
      current = byId.get(current)?.parent_id ?? null;
    }
    return false;
  };

  const banksUnder = (folderId: number): BankRow[] =>
    db.all<BankRow>(
      `WITH RECURSIVE subtree(id) AS (
         SELECT ? UNION ALL
         SELECT f.id FROM bank_folders f JOIN subtree s ON f.parent_id = s.id
       )
       SELECT b.id, b.name, COALESCE(b.book, '') AS book, COALESCE(b.section, '') AS section,
              b.course_id, COALESCE(c.name, '') AS courseName, b.folder_id
         FROM banks b JOIN subtree s ON b.folder_id = s.id
         LEFT JOIN courses c ON c.id = b.course_id
        ORDER BY b.id`,
      [folderId],
    );

  /** 文件夹子树里的题库是否全部属于同一组（同年级/系列 + 同 book） */
  const canClaim = (folderId: number, groupKey: string): boolean =>
    banksUnder(folderId).every((bank) => groupKeyOf(bank) === groupKey);

  const claimOrCreateBook = (topId: number, book: string, groupKey: string): number => {
    const under = childMap.get(childKey(topId, book));
    if (under !== undefined) return under;
    const root = childMap.get(childKey(null, book));
    if (root !== undefined && root !== topId && canClaim(root, groupKey)) {
      moveFolder(root, topId);
      return root;
    }
    return ensureFolder(topId, book);
  };

  const ensureSection = (bookId: number, section: string, groupKey: string): number => {
    const direct = childMap.get(childKey(bookId, section));
    if (direct !== undefined) return direct;
    // 复用 0024 生成的同名 section 文件夹：只在这个子树全部属于本组时才移动
    for (const folder of byId.values()) {
      if (folder.name !== section || folder.parent_id === null) continue;
      if (folder.id === bookId || isAncestor(folder.id, bookId)) continue;
      if (!canClaim(folder.id, groupKey)) continue;
      moveFolder(folder.id, bookId);
      return folder.id;
    }
    return ensureFolder(bookId, section);
  };

  const rows = db.all<BankRow>(
    `SELECT b.id, b.name, COALESCE(b.book, '') AS book, COALESCE(b.section, '') AS section,
            b.course_id, COALESCE(c.name, '') AS courseName, b.folder_id
       FROM banks b LEFT JOIN courses c ON c.id = b.course_id
      ORDER BY b.id`,
  );
  const metas: BankMeta[] = rows.map((row) => {
    const topKind: 'grade' | 'series' = row.course_id !== null ? 'grade' : 'series';
    return {
      id: row.id,
      book: normalizedBook(row.book),
      section: normalizedSection(row.section),
      folderId: row.folder_id,
      groupKey: groupKeyOf(row),
      topName: topKind === 'grade' ? parseGrade(row.courseName) : parseSeries(row.name, row.book),
      topKind,
    };
  });

  const groups = new Map<string, { key: string; topName: string; topKind: 'grade' | 'series'; banks: BankMeta[] }>();
  for (const meta of metas) {
    let group = groups.get(meta.groupKey);
    if (!group) {
      group = { key: meta.groupKey, topName: meta.topName, topKind: meta.topKind, banks: [] };
      groups.set(meta.groupKey, group);
    }
    group.banks.push(meta);
  }

  const gradeSet = new Set<string>();
  const seriesSet = new Set<string>();
  let moved = 0;
  let otherGradeBanks = 0;
  let otherSeriesBanks = 0;

  for (const group of groups.values()) {
    const topSort =
      group.topKind === 'grade'
        ? GRADE_ORDER.indexOf(group.topName)
        : group.topName === '其他资料'
          ? 10000
          : nextSeriesSort();
    const topId = ensureFolder(null, group.topName, topSort);
    if (group.topKind === 'grade') gradeSet.add(group.topName);
    else seriesSet.add(group.topName);

    const book = group.banks[0]?.book ?? '';
    const bookId = book === '' || book === group.topName ? topId : claimOrCreateBook(topId, book, group.key);
    for (const meta of group.banks) {
      // 没有 book 时也保留 section（直接挂在年级/系列下）：老师手填的章节不该丢
      const target = meta.section !== '' ? ensureSection(bookId, meta.section, group.key) : bookId;
      if (meta.folderId !== target) {
        db.run('UPDATE banks SET folder_id = ? WHERE id = ?', [target, meta.id]);
        moved += 1;
      }
      if (meta.topKind === 'grade' && meta.topName === '其他年级') otherGradeBanks += 1;
      if (meta.topKind === 'series' && meta.topName === '其他资料') otherSeriesBanks += 1;
    }
  }

  return {
    created,
    moved,
    banks: metas.length,
    gradeFolders: [...gradeSet].sort((a, b) => GRADE_ORDER.indexOf(a) - GRADE_ORDER.indexOf(b)),
    seriesFolders: [...seriesSet].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    otherGradeBanks,
    otherSeriesBanks,
  };
}
