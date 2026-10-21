/**
 * 题库命名解析：册次归一化、课程名 → 册次、题库名分段与归章。
 *
 * 从 bankRepository 抽出：这些是纯字符串函数，与 SQL 访问无关，
 * 单独成文件后仓储只保留数据访问职责。
 */

/**
 * 册次写法归一化：把「必修一 / 新必修1 / 必修第二册 / 选修3-1」这类写法收敛成同一种形式，
 * 让题库的 `book` 能和课程名里的册次对上（真机上 1,900+ 个题库因为写法差异匹配不上）。
 */
export function normalizeBookKey(raw: string): string {
  const digits: Record<string, string> = {
    一: '1',
    二: '2',
    三: '3',
    四: '4',
    五: '5',
    六: '6',
    七: '7',
    八: '8',
    九: '9',
    十: '10',
  };
  return String(raw ?? '')
    .trim()
    .replace(/^新/, '')
    .replace(/第/g, '')
    .replace(/册/g, '')
    .replace(/[一二三四五六七八九十]/g, (c) => digits[c] ?? c)
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** 课程名 → 册次关键字。
 * 课程命名形如「小学数学·二年级上册（新）」「高中数学·新必修1」，
 * 取 `·` 之后的部分作为册次；没有 `·` 时退回「X年级YY」或「必修N」片段。
 */
export function bookKeyOfCourseName(name: string): string {
  const text = String(name ?? '').trim();
  const afterDot = text.includes('·') ? text.slice(text.lastIndexOf('·') + 1).trim() : '';
  if (afterDot) return afterDot;
  const grade = /[一二三四五六七八九1-9]年级[上下]?册?（?[新旧]?）?/.exec(text);
  if (grade) return grade[0];
  const required = /(新?必修\s?\d|新?选修\s?\d|选择性必修\s?\d)/.exec(text);
  return required ? required[0].replace(/\s/g, '') : '';
}

/** 题库名的分段：`册次 · 章节 · 知识点` → ['册次','章节','知识点'] */
export function bankNameParts(name: string): string[] {
  return String(name ?? '')
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 章节题库/整卷试卷的归章依据：题库名的第二段（没有第二段就用第一段） */
export function chapterKeyFromBankName(name: string): string {
  const parts = bankNameParts(name);
  return parts[1] ?? parts[0] ?? '';
}

/** 题库名里更细的那一段（知识点），用于界面展示 */
export function bankSectionOfName(name: string): string {
  const parts = bankNameParts(name);
  return parts.length >= 3 ? (parts[parts.length - 1] ?? '') : '';
}
