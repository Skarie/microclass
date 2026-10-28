/**
 * 题库目录重组的两条纯解析规则（迁移 0025）：
 *   - 关联了课程的题库 → 顶层按「年级」分；
 *   - 未关联课程的题库 → 顶层按「系列名」分。
 *
 * 只做字符串判断，不读库、不建文件夹；迁移脚本与单测共用同一份口径。
 */

/** 年级归一化：阿拉伯数字统一成中文，避免「7年级」「七年级」拆成两个文件夹 */
const CN_NUMBERS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const CN_GRADE = /([一二三四五六七八九])\s*年级/;
const ARABIC_GRADE = /([1-9])\s*年级/;

/**
 * 从课程名解析年级。
 *
 * 规则：
 *   - 「X年级」优先（`初中数学·七年级上册` → 七年级），不会先命中「初中」；
 *   - 「高一/高二/高三」保留原样；
 *   - 「必修1 / 选择性必修1」视为高中（高中课程按册次命名，不细分年级）；
 *   - 只有学段时返回学段（高中 / 初中 / 小学）；
 *   - 完全判断不出 → 其他年级。
 */
export function parseGrade(courseName: string): string {
  const name = String(courseName ?? '').trim();
  // 「高一年级 / 高中一年级」优先按高一处理，避免被后面的「一年级」正则抢走
  const seniorYear = /高中([一二三])年级/.exec(name);
  if (seniorYear?.[1]) return `高${seniorYear[1]}`;
  const senior = /(高一|高二|高三)/.exec(name);
  if (senior?.[1]) return senior[1];
  const cn = CN_GRADE.exec(name);
  if (cn?.[1]) return `${cn[1]}年级`;
  const arabic = ARABIC_GRADE.exec(name);
  if (arabic?.[1]) return `${CN_NUMBERS[Number(arabic[1])] ?? arabic[1]}年级`;
  if (/必修|选择性必修/.test(name)) return '高中';
  if (/高中/.test(name)) return '高中';
  if (/初中/.test(name)) return '初中';
  if (/小学/.test(name)) return '小学';
  return '其他年级';
}

/** 已知系列词表；长词在前，保证「期末冲刺」不会被先匹配成「期末」 */
const SERIES_WORDS = [
  '考点梳理',
  '期末冲刺',
  '难点突破',
  '活页检测',
  '题典',
  '典中点',
  '必刷题',
  '一遍过',
  '课时练',
  '尖子生',
  '单元卷',
  '金考卷',
  '上分卷',
  '黄冈',
  '培优',
  '专项',
  '真题',
  '模拟',
  '学霸',
  '一本',
  '五三',
  '中考',
  '高考',
  '小升初',
  '分班',
  '衔接',
].sort((a, b) => b.length - a.length);

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SERIES_PATTERN = new RegExp(SERIES_WORDS.map(escapeRegExp).join('|'));

/** 取一段文字里命中的系列词（长词优先）；没有命中返回空串 */
function seriesWordIn(text: string): string {
  return SERIES_PATTERN.exec(String(text ?? ''))?.[0] ?? '';
}

/** book 是否像系列名：含「卷/题/练/册」等，但排除「七年级上册」「必修1」这类册次 */
function isSeriesLikeBook(book: string): boolean {
  const text = String(book ?? '').trim();
  if (text === '') return false;
  if (/[一二三四五六七八九1-9]年级|必修|选修|全一册|第[一二三四五六七八九十\d]+册|[上下]册/.test(text)) return false;
  return /[卷题练册]/.test(text) || seriesWordIn(text) !== '';
}

/**
 * 从题库名解析系列名：
 *   - 按 `·` 分段，取第一个命中已知系列词的段，返回**词表里的标准写法**
 *     （`黄冈卷` → 黄冈、`必刷题·第一章` → 必刷题）；
 *   - 都不中时看 `book`，像系列名就取它；再不行 → 其他资料。
 */
export function parseSeries(bankName: string, book = ''): string {
  for (const part of String(bankName ?? '').split('·')) {
    const word = seriesWordIn(part.trim());
    if (word) return word;
  }
  const fromBook = seriesWordIn(book);
  if (fromBook) return fromBook;
  const bookText = String(book ?? '').trim();
  if (isSeriesLikeBook(bookText)) return bookText.slice(0, 120);
  return '其他资料';
}
