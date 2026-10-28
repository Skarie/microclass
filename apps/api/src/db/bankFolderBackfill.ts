/**
 * 迁移 0024 的数据回填：把历史 `banks.book / section` 转成两级文件夹。
 *
 * 规则（与产品约定一致）：
 *   - 每个非空 book 建一个顶层文件夹，sort 按首次出现顺序；
 *   - book 下每个非空 section 建一个子文件夹；
 *   - 题库挂到 section 文件夹（有章节）或 book 文件夹（无章节）；
 *   - book 为空（含纯空白）的题库保持 folder_id = NULL（未分类）。
 *
 * SQLite 的递归写入能力有限，这里用 node 逐条 INSERT / UPDATE；由迁移执行器
 * 包在同一个事务里，且只会在 0024 首次应用时执行一次。
 */
import type { Db } from './client.js';

interface BookRow {
  book: string;
}

interface SectionRow {
  section: string;
}

/** 回填结果（迁移执行器不消费，测试可直接断言） */
export interface BankFolderBackfillResult {
  folders: number;
  banks: number;
}

/** 把非空 book / section 回填成文件夹树；返回创建的文件夹数与挂接的题库数 */
export function backfillBankFolders(db: Db): BankFolderBackfillResult {
  const books = db.all<BookRow>(
    `SELECT TRIM(book) AS book
       FROM banks
      WHERE TRIM(COALESCE(book, '')) <> ''
      GROUP BY TRIM(book)
      ORDER BY MIN(id)`,
  );
  let folders = 0;
  let banks = 0;

  books.forEach(({ book }, bookSort) => {
    const bookId = db.run('INSERT INTO bank_folders (parent_id, name, sort) VALUES (NULL, ?, ?)', [
      book,
      bookSort,
    ]).lastInsertRowid;
    folders += 1;
    banks += db.run(
      "UPDATE banks SET folder_id = ? WHERE TRIM(COALESCE(book, '')) = ? AND TRIM(COALESCE(section, '')) = ''",
      [bookId, book],
    ).changes;

    const sections = db.all<SectionRow>(
      `SELECT TRIM(section) AS section
         FROM banks
        WHERE TRIM(COALESCE(book, '')) = ? AND TRIM(COALESCE(section, '')) <> ''
        GROUP BY TRIM(section)
        ORDER BY MIN(id)`,
      [book],
    );
    sections.forEach(({ section }, sectionSort) => {
      const sectionId = db.run('INSERT INTO bank_folders (parent_id, name, sort) VALUES (?, ?, ?)', [
        bookId,
        section,
        sectionSort,
      ]).lastInsertRowid;
      folders += 1;
      banks += db.run("UPDATE banks SET folder_id = ? WHERE TRIM(COALESCE(book, '')) = ? AND TRIM(section) = ?", [
        sectionId,
        book,
        section,
      ]).changes;
    });
  });

  // book 为空的题库保持未分类（即使 section 有值，也不猜它属于哪个册次）
  db.run("UPDATE banks SET folder_id = NULL WHERE TRIM(COALESCE(book, '')) = ''");
  return { folders, banks };
}
