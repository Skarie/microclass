/**
 * 批量导入知识点的纯函数：标题去序号、章节解析、课时匹配、图片引用重写。
 * 这些规则决定了「资料包能不能正确落到课时上」，单独测比走 HTTP 更容易定位边界。
 */
import { describe, expect, it } from 'vitest';
import {
  collectImageRefs,
  firstHeading,
  matchLesson,
  normalizeTitle,
  parseSourcePath,
  previewMediaUrl,
  resolveImagePath,
  rewriteImageLinks,
  stripSequencePrefix,
  type LessonCandidate,
} from '../src/domain/knowledgeImport.js';

const lessons: LessonCandidate[] = [
  { id: 1, title: '正数和负数的概念', group_name: '第一章 有理数' },
  { id: 2, title: '有理数的运算', group_name: '第一章 有理数' },
  { id: 3, title: '一元一次方程', group_name: '第二章 整式' },
];

describe('stripSequencePrefix：去掉序号前缀', () => {
  it('兼容 1.1 / 2.10 / 3. 等写法', () => {
    expect(stripSequencePrefix('1.1 正数和负数的概念.md')).toBe('正数和负数的概念');
    expect(stripSequencePrefix('2.10 探究规律.md')).toBe('探究规律');
    expect(stripSequencePrefix('3. 小节标题.md')).toBe('小节标题');
  });

  it('没有序号时原样保留（去掉扩展名）', () => {
    expect(stripSequencePrefix('正数和负数的概念.md')).toBe('正数和负数的概念');
    expect(stripSequencePrefix('1+1 的证明.md')).toBe('1+1 的证明');
  });
});

describe('parseSourcePath：章节与标题', () => {
  it('有目录层级：直接父目录是章节', () => {
    expect(parseSourcePath('第一章 有理数/1.1 正数和负数的概念.md')).toEqual({
      chapter: '第一章 有理数',
      title: '正数和负数的概念',
      hasChapter: true,
    });
  });

  it('多层目录只取直接父目录（册次/科目不当作章节）', () => {
    expect(parseSourcePath('数学知识点/七年级上册/第一章 有理数/1.1 正数.md').chapter).toBe('第一章 有理数');
  });

  it('平铺 md 没有章节', () => {
    expect(parseSourcePath('1.1 正数和负数的概念.md')).toEqual({
      chapter: '',
      title: '正数和负数的概念',
      hasChapter: false,
    });
  });
});

describe('firstHeading', () => {
  it('取第一个 H1，忽略正文里的井号', () => {
    expect(firstHeading('# 1.1 正数和负数的概念\n\n正文 ## 不是标题')).toBe('1.1 正数和负数的概念');
  });

  it('没有 H1 返回空串', () => {
    expect(firstHeading('## 二级标题')).toBe('');
  });
});

describe('matchLesson：课时匹配', () => {
  it('标题完全相同直接命中', () => {
    expect(matchLesson(lessons, '正数和负数的概念')).toEqual({
      kind: 'matched',
      lessonId: 1,
      lessonTitle: '正数和负数的概念',
    });
  });

  it('包含关系只在唯一命中时采用', () => {
    expect(matchLesson(lessons, '有理数')).toMatchObject({ kind: 'matched', lessonId: 2 });
  });

  it('多命中不猜，进 unmatched（multiple-lessons）', () => {
    const candidates: LessonCandidate[] = [
      { id: 1, title: '正数', group_name: '' },
      { id: 2, title: '正数和负数', group_name: '' },
    ];
    expect(matchLesson(candidates, '正数')).toEqual({ kind: 'matched', lessonId: 1, lessonTitle: '正数' });
    expect(matchLesson(candidates, '数')).toEqual({ kind: 'unmatched', reason: 'multiple-lessons' });
  });

  it('无命中返回 no-lesson', () => {
    expect(matchLesson(lessons, '不存在的标题')).toEqual({ kind: 'unmatched', reason: 'no-lesson' });
  });

  it('标题归一化折叠空白', () => {
    expect(normalizeTitle(' 正数   和 负数 ')).toBe('正数 和 负数');
  });
});

describe('resolveImagePath / collectImageRefs', () => {
  const md = '第一章 有理数/1.1 正数.md';

  it('相对路径按 md 所在目录解析', () => {
    expect(resolveImagePath(md, 'images/a.png')).toBe('第一章 有理数/images/a.png');
    expect(resolveImagePath(md, './images/a.png')).toBe('第一章 有理数/images/a.png');
    expect(resolveImagePath(md, 'images/sub/b.png')).toBe('第一章 有理数/images/sub/b.png');
    expect(resolveImagePath(md, '../images/c.png')).toBe('images/c.png');
  });

  it('越界路径与绝对 URL 返回 null', () => {
    expect(resolveImagePath(md, '../../secret.png')).toBeNull();
    expect(resolveImagePath(md, 'https://example.com/a.png')).toBeNull();
    expect(resolveImagePath(md, '/static/a.png')).toBeNull();
  });

  it('只收集相对图片引用并去重', () => {
    const content = '![](images/a.png) ![](./images/a.png) ![](https://x/y.png) ![](images/b.png)';
    expect(collectImageRefs(content, md).map((r) => r.path)).toEqual([
      '第一章 有理数/images/a.png',
      '第一章 有理数/images/b.png',
    ]);
  });
});

describe('rewriteImageLinks：图片路径重写', () => {
  const md = '第一章 有理数/1.1 正数.md';

  it('找到的图片改成 knowledge-media URL，缺失的保留原路径', () => {
    const content = 'A![](images/a.png)B![](./images/b.png)';
    const urls = new Map([['第一章 有理数/images/a.png', '/api/v1/knowledge-media/abc-a.png']]);
    const result = rewriteImageLinks(content, md, (zipPath) => urls.get(zipPath) ?? null);
    expect(result.content).toBe('A![](/api/v1/knowledge-media/abc-a.png)B![](./images/b.png)');
    expect(result.images).toBe(1);
    expect(result.missingImages).toBe(1);
  });

  it('保留 alt 文本与外部链接', () => {
    const content = '![示意图](images/a.png) ![远程](https://x/y.png)';
    const result = rewriteImageLinks(content, md, () => '/api/v1/knowledge-media/x.png');
    expect(result.content).toBe('![示意图](/api/v1/knowledge-media/x.png) ![远程](https://x/y.png)');
    expect(result.images).toBe(1);
    expect(result.missingImages).toBe(0);
  });

  it('dryRun 占位 URL 只用于估算字符数', () => {
    expect(previewMediaUrl('章节/images/a.png')).toBe('/api/v1/knowledge-media/a.png');
  });
});
