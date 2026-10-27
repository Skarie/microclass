/**
 * 名称的自然序：册次 / 章节都先解析序号（第一章 = 1、三年级 = 3、必修10 = 10），
 * 没有序号的再按中文本地化排序（数字按数值比较）。
 *
 * 复用 `lessonChapterOrder` 的章节解析与中文数字转换，不再复制一份。
 * 空串是「未归类」/「未分章」的占位，统一排在最后。
 */
import { chapterOrderOf, chineseNumeralToInt } from './lessonChapterOrder.js';

const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });
const CN_NUMBER = '[一二三四五六七八九十百零〇两\\d]+';

/** 册次 / 章节的序号：章节写法优先，其次「X年级」「模块X」「必修X」、开头的阿拉伯数字 */
export function naturalOrderOf(raw: string): number | null {
  const name = String(raw ?? '').trim();
  if (name === '') return null;
  const chapter = chapterOrderOf(name);
  if (chapter !== null) return chapter;
  const patterns = [
    new RegExp(`(${CN_NUMBER})\\s*年级`),
    new RegExp(`^模块\\s*(${CN_NUMBER})`),
    new RegExp(`(?:选择性必修|必修|选修)\\s*(${CN_NUMBER})`),
    /^(\d{1,3})(?:\s|[、.．:：]|$)/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(name);
    if (!match?.[1]) continue;
    const num = chineseNumeralToInt(match[1]);
    if (num !== null) return num;
  }
  return null;
}

export function compareNaturalName(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '') return 1;
  if (b === '') return -1;
  const na = naturalOrderOf(a);
  const nb = naturalOrderOf(b);
  if (na !== null && nb === null) return -1;
  if (na === null && nb !== null) return 1;
  if (na !== null && nb !== null && na !== nb) return na - nb;
  return collator.compare(a, b);
}
