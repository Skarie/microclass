/**
 * 课时拆分的纯逻辑自检：文件名 → 标题、章节推断、目录路径规范化、
 * 批量改绑 ID、拖拽排序校验与扫描插入点。都走真实导出的纯函数。
 */
import { describe, expect, it } from 'vitest';
import {
  chapterFromRelDir,
  folderSelfName,
  inferUploadGroupName,
  joinRel,
  naturalSort,
  normalizeBoundFolderPath,
  normalizeExternalVideoUrl,
  normalizeLessonInput,
  normalizeUploadTitle,
  stripExtension,
  trimFolderPath,
} from '../src/services/lessonInput.js';
import { insertionIndex, normalizeAssignIds, validateReorderIds } from '../src/services/lessonOrder.js';
import type { LessonInputDto } from '../src/services/lessonTypes.js';

function localLesson(overrides: Partial<LessonInputDto> = {}): LessonInputDto {
  return {
    title: '课时',
    videoKind: 'local',
    mediaRoot: 'uploads',
    videoPath: 'a.mp4',
    ...overrides,
  };
}

describe('课时文件名与章节推导', () => {
  it('扫描/导入：只去掉最后一个扩展名，保留序号、点号和空白', () => {
    expect(stripExtension('2. xxx.mp4')).toBe('2. xxx');
    expect(stripExtension('第1课时(拓展).MP4')).toBe('第1课时(拓展)');
    expect(stripExtension(' 前导空格.mp4')).toBe(' 前导空格');
    expect(stripExtension('没有扩展名')).toBe('没有扩展名');
  });

  it('网页上传：标题先 trim 再去扩展名', () => {
    expect(normalizeUploadTitle('  3.1 乘方.mp4  ')).toBe('3.1 乘方');
  });

  it('上传章节：显式指定优先于 relPath', () => {
    expect(inferUploadGroupName(' 第一章 ', '第二章/1.1/a.mp4')).toBe('第一章');
  });

  it('上传章节：取 relPath 的顶层目录，兼容反斜杠；单层文件不分章', () => {
    expect(inferUploadGroupName(undefined, '第一章 有理数/1.1 乘方/a.mp4')).toBe('第一章 有理数');
    expect(inferUploadGroupName(undefined, '第一章 有理数\\1.1 乘方\\a.mp4')).toBe('第一章 有理数');
    expect(inferUploadGroupName(undefined, 'a.mp4')).toBe('');
    expect(inferUploadGroupName(undefined, '/a.mp4')).toBe('');
  });

  it('上传章节：顶层目录名截断到 120 字', () => {
    const longName = '章'.repeat(150);
    expect(inferUploadGroupName(undefined, `${longName}/a.mp4`)).toHaveLength(120);
  });

  it('扫描章节策略：first 取第一层、full 取完整路径、none 不设章节', () => {
    expect(chapterFromRelDir('第一章 有理数/3.1 乘方', 'first')).toBe('第一章 有理数');
    expect(chapterFromRelDir('第一章 有理数/3.1 乘方', 'full')).toBe('第一章 有理数/3.1 乘方');
    expect(chapterFromRelDir('第一章 有理数/3.1 乘方', 'none')).toBe('');
    expect(chapterFromRelDir('', 'first')).toBe('');
  });

  it('选中文件夹自身的名字作为其直接视频的章节名', () => {
    expect(folderSelfName('课程/第一章')).toBe('第一章');
    expect(folderSelfName('')).toBe('');
  });
});

describe('目录路径规范化', () => {
  it('导入路径去首尾空白和斜杠；绑定路径额外兼容反斜杠', () => {
    expect(trimFolderPath('  /第一章/  ')).toBe('第一章');
    expect(trimFolderPath(undefined)).toBe('');
    expect(normalizeBoundFolderPath('\\第一章\\1.1\\')).toBe('第一章/1.1');
    expect(normalizeBoundFolderPath('  第一章  ')).toBe('第一章');
    expect(normalizeBoundFolderPath(undefined)).toBe('');
  });

  it('相对路径拼接忽略空段且不使用反斜杠', () => {
    expect(joinRel('课程', '', '第一章', 'a.mp4')).toBe('课程/第一章/a.mp4');
    expect(joinRel('', 'a.mp4')).toBe('a.mp4');
  });

  it('文件名自然序：2 排在 10 前面', () => {
    expect(naturalSort(['10. 十.mp4', '2. 二.mp4', '1. 一.mp4'])).toEqual(['1. 一.mp4', '2. 二.mp4', '10. 十.mp4']);
  });
});

describe('课时入参与外部视频地址', () => {
  it('本地视频入参原样返回（不 trim 路径）', () => {
    const input = localLesson({ videoPath: ' 第一章/a.mp4 ' });
    expect(normalizeLessonInput(input)).toBe(input);
  });

  it('外部视频地址经 lessonInput 归一化后写入 videoPath', () => {
    const input = localLesson({
      videoKind: 'embed',
      videoPath: '<iframe src="//player.bilibili.com/player.html?bvid=BV1"></iframe>',
    });
    expect(normalizeLessonInput(input).videoPath).toBe('https://player.bilibili.com/player.html?bvid=BV1');
    expect(normalizeExternalVideoUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('批量改绑与拖拽排序规则', () => {
  it('批量改绑：过滤非正整数并去重，保持首次出现顺序', () => {
    expect(normalizeAssignIds([3, 0, -1, 3, 1.5, 2, 2])).toEqual([3, 2]);
    expect(normalizeAssignIds([])).toEqual([]);
  });

  it('拖拽排序：课程课时的完整排列通过', () => {
    expect(validateReorderIds([3, 1, 2], [1, 2, 3])).toEqual([3, 1, 2]);
  });

  it('拖拽排序：重复 / 缺项 / 混入别的课时都被拒绝，文案不变', () => {
    expect(() => validateReorderIds([1, 1, 2], [1, 2, 3])).toThrow('排序列表里有重复的课时');
    expect(() => validateReorderIds([1, 2], [1, 2, 3])).toThrow('排序列表与课程当前课时不一致，请刷新页面后重试');
    expect(() => validateReorderIds([1, 2, 4], [1, 2, 3])).toThrow('排序列表与课程当前课时不一致，请刷新页面后重试');
  });

  it('扫描插入点：同章节最后一条之后，没有该章节则追加末尾，空列表为 0', () => {
    const layout = [{ chapter: '第一章' }, { chapter: '第二章' }, { chapter: '第一章' }, { chapter: '第三章' }];
    expect(insertionIndex(layout, '第一章')).toBe(3);
    expect(insertionIndex(layout, '第二章')).toBe(2);
    expect(insertionIndex(layout, '第四章')).toBe(4);
    expect(insertionIndex([], '第一章')).toBe(0);
  });
});
