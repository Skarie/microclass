/**
 * 台账题干摘要的 markdown 安全截断。
 * 真机 bug：冲突题列表里图片显示成源码 `![](/api/v1/question-media`，
 * 因为摘要用的是 `stem.slice(0, 200)`，正好切在图片 URL 中间。
 */
import { describe, expect, it } from 'vitest';
import { stemSummary } from '../src/domain/stemSummary.js';

describe('题干摘要截断', () => {
  it('短文本原样返回', () => {
    expect(stemSummary('在横线里填上“>”“<”或“=”。', 200)).toBe('在横线里填上“>”“<”或“=”。');
  });

  it('超长文本截断并加省略号', () => {
    const long = '甲'.repeat(300);
    const out = stemSummary(long, 200);
    expect(out.length).toBeLessThanOrEqual(201);
    expect(out.endsWith('…')).toBe(true);
  });

  it('切点落在图片 URL 中间时，整段图片 markdown 被丢弃（这是真机 bug）', () => {
    const stem = `在横线里填上“>”“<”或“=”。 ${'数'.repeat(180)} ![](/api/v1/question-media/888c33e082cc176a06a4adab28ba902042feb100.png)`;
    const out = stemSummary(stem, 200);
    expect(out).not.toContain('![');
    expect(out).not.toContain('question-media');
    expect(out.endsWith('…')).toBe(true);
  });

  it('图片完整落在截断范围内时保留（不误删）', () => {
    const stem = '看图 ![](/api/v1/question-media/aaa.png) 然后填空';
    expect(stemSummary(stem, 200)).toBe(stem);
  });

  it('链接 `[文字](url)` 被切断时回退到文字之前', () => {
    const stem = `${'字'.repeat(195)} 请参考 [讲义](https://example.com/a/very/long/path)`;
    const out = stemSummary(stem, 200);
    expect(out).not.toContain('](');
  });
});
