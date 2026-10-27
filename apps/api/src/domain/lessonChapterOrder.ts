/**
 * 课时章节的自然顺序。
 *
 * 背景：课时列表按导入时的 `sort` 排，但导入顺序常常是文件名字典序，
 * 于是章节会呈现「一、三、二、五、四」这种乱序。这里按章节名里的序号
 * （第一章 / 第二单元 / 一、 / 12. …）重新排，序号相同再退回导入顺序。
 */

/** 中文数字（一到九十九够用；更长的按逐位解析） */
const CN_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 把「一」「十二」「二十三」「一百零五」这类中文数字转成整数 */
export function chineseNumeralToInt(raw: string): number | null {
  const text = raw.trim();
  if (text === '') return null;
  if (/^\d+$/.test(text)) return Number.parseInt(text, 10);
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const ch of text) {
    if (CN_DIGITS[ch] !== undefined) {
      digit = CN_DIGITS[ch];
      continue;
    }
    if (ch === '十') {
      section += (digit === 0 ? 1 : digit) * 10;
      digit = 0;
      continue;
    }
    if (ch === '百') {
      section += (digit === 0 ? 1 : digit) * 100;
      digit = 0;
      continue;
    }
    return null;
  }
  total += section + digit;
  return total > 0 ? total : null;
}

/** 从章节名里取序号：第一章 → 1，第二单元 → 2，一、xxx → 1，12. xxx → 12 */
export function chapterOrderOf(groupName: string | null | undefined): number | null {
  const name = (groupName ?? '').trim();
  if (name === '') return null;
  const patterns = [
    /第\s*([一二三四五六七八九十百零〇两\d]+)\s*[章节单元课讲篇部]/,
    /第\s*([一二三四五六七八九十百零〇两\d]+)/,
    /^([一二三四五六七八九十百零〇两]+)\s*[、.．:：\s]/,
    /^(\d{1,3})\s*[、.．:：\s]/,
    /^(\d{1,3})$/,
  ];
  for (const re of patterns) {
    const m = re.exec(name);
    if (m?.[1]) {
      const n = chineseNumeralToInt(m[1]);
      if (n !== null) return n;
    }
  }
  return null;
}

/**
 * 按章节序号重排课时：章节有序，章节内保持传入顺序；
 * 没有序号的章节排在最后，并保持它们第一次出现的先后。
 */
export function sortLessonsByChapter<T extends { group_name: string }>(rows: T[]): T[] {
  /**
   * 排序分组：
   *   0 = 没有章节的课时（如「01 课程介绍」），通常相当于课程导言，排最前；
   *   1 = 有编号的章节，按编号升序；
   *   2 = 有名字但没有编号的章节（如「拓展训练」），排最后，保持出现顺序。
   */
  const bucket = new Map<string, { tier: number; num: number | null }>();
  for (const row of rows) {
    const name = row.group_name ?? '';
    if (bucket.has(name)) continue;
    if (name.trim() === '') {
      bucket.set(name, { tier: 0, num: null });
      continue;
    }
    const num = chapterOrderOf(name);
    bucket.set(name, { tier: num === null ? 2 : 1, num });
  }
  const rank = new Map<string, number>();
  let next = 0;
  for (const name of bucket.keys()) rank.set(name, next++);
  return [...rows].sort((a, b) => {
    const ga = bucket.get(a.group_name ?? '') ?? { tier: 2, num: null };
    const gb = bucket.get(b.group_name ?? '') ?? { tier: 2, num: null };
    if (ga.tier !== gb.tier) return ga.tier - gb.tier;
    if (ga.tier === 1 && ga.num !== null && gb.num !== null && ga.num !== gb.num) return ga.num - gb.num;
    return (rank.get(a.group_name ?? '') ?? 0) - (rank.get(b.group_name ?? '') ?? 0);
  });
}
