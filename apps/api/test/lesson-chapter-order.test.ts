import { describe, expect, it } from 'vitest';
import { chapterOrderOf, chineseNumeralToInt, sortLessonsByChapter } from '../src/domain/lessonChapterOrder.js';

describe('章节序号解析', () => {
  it('中文数字转整数', () => {
    expect(chineseNumeralToInt('一')).toBe(1);
    expect(chineseNumeralToInt('两')).toBe(2);
    expect(chineseNumeralToInt('九')).toBe(9);
    expect(chineseNumeralToInt('十')).toBe(10);
    expect(chineseNumeralToInt('十二')).toBe(12);
    expect(chineseNumeralToInt('二十三')).toBe(23);
    expect(chineseNumeralToInt('一百零五')).toBe(105);
    expect(chineseNumeralToInt('12')).toBe(12);
    expect(chineseNumeralToInt('')).toBeNull();
  });

  it('从常见章节名里取序号', () => {
    expect(chapterOrderOf('第一章 分类与整理')).toBe(1);
    expect(chapterOrderOf('第十二章 全等三角形')).toBe(12);
    expect(chapterOrderOf('第三单元 走进化学世界')).toBe(3);
    expect(chapterOrderOf('第二单元 空气和氧气')).toBe(2);
    expect(chapterOrderOf('一 认识厘米和米')).toBe(1);
    expect(chapterOrderOf('四、平移与旋转')).toBe(4);
    expect(chapterOrderOf('12. 小数乘法')).toBe(12);
    expect(chapterOrderOf('7')).toBe(7);
  });

  it('没有序号的章节返回 null', () => {
    expect(chapterOrderOf('拓展训练')).toBeNull();
    expect(chapterOrderOf('期末复习')).toBeNull();
    expect(chapterOrderOf('')).toBeNull();
    expect(chapterOrderOf(null)).toBeNull();
  });
});

describe('课时按章节重排', () => {
  const rows = [
    { id: 1, group_name: '一 认识厘米和米' },
    { id: 2, group_name: '三 观察物体' },
    { id: 3, group_name: '二 表内乘法和除法（一）' },
    { id: 4, group_name: '三 观察物体' },
    { id: 5, group_name: '拓展训练' },
    { id: 6, group_name: '五 表内乘法和除法（二）' },
    { id: 7, group_name: '四 平移与旋转' },
    { id: 8, group_name: '期末复习' },
  ];

  it('章节按序号排，章节内保持原顺序', () => {
    const sorted = sortLessonsByChapter(rows).map((r) => r.id);
    expect(sorted).toEqual([1, 3, 2, 4, 7, 6, 5, 8]);
  });

  it('没有序号的章节排在最后，并保持出现顺序', () => {
    const sorted = sortLessonsByChapter(rows);
    expect(sorted.slice(-2).map((r) => r.group_name)).toEqual(['拓展训练', '期末复习']);
  });

  it('不修改传入数组', () => {
    const copy = [...rows];
    sortLessonsByChapter(rows);
    expect(rows).toEqual(copy);
  });

  it('第一章 / 第十一章 这类中文序号也按数值排', () => {
    const list = [
      { id: 1, group_name: '第二章 整式' },
      { id: 2, group_name: '第十一章 三角形' },
      { id: 3, group_name: '第一章 有理数' },
    ];
    expect(sortLessonsByChapter(list).map((r) => r.id)).toEqual([3, 1, 2]);
  });
});
