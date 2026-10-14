/**
 * 题库标准化：内容指纹（查重）与题库体检（元数据/质量统计）。
 */
import { describe, expect, it } from 'vitest';
import { questionFingerprint } from '../src/domain/question.js';

describe('题目内容指纹', () => {
  it('同一道题（空白/标点/全角差异）指纹相同', () => {
    const a = questionFingerprint('下列 说法正确的是（　）', ['甲、乙', '丙']);
    const b = questionFingerprint('下列说法正确的是( )', ['甲，乙', '丙']);
    expect(a).toBe(b);
  });

  it('图片按地址参与指纹：同图同指纹、异图不同指纹', () => {
    const url = '/api/v1/question-media/ab/cd1234.png';
    // 同一张图（内容寻址 → 地址相同），alt 文本写法不同不影响指纹
    expect(questionFingerprint(`如图，求 $x$。![](a)`, [])).not.toBe(questionFingerprint('如图，求 $x$。', []));
    expect(questionFingerprint(`如图，求 $x$。![示意图](${url})`, [])).toBe(
      questionFingerprint(`如图，求 $x$。![](${url})`, []),
    );
    // 不同的图 = 不同的题：不能并成同一组（否则会把一组不同的看图题算成「同题不同答案」）
    expect(questionFingerprint('计算 ![](/api/v1/question-media/ab/cd1234.png)', [])).not.toBe(
      questionFingerprint('计算 ![](/api/v1/question-media/ab/ef5678.png)', []),
    );
    // 图片地址相同但选项不同 → 仍然区分
    expect(questionFingerprint(`看图填空 ![](${url})`, ['1'])).not.toBe(
      questionFingerprint(`看图填空 ![](${url})`, ['2']),
    );
  });

  it('题干相同但选项不同 → 指纹不同；题干或选项不同都能区分', () => {
    expect(questionFingerprint('下列说法正确的是', ['甲', '乙'])).not.toBe(
      questionFingerprint('下列说法正确的是', ['甲', '丙']),
    );
    expect(questionFingerprint('题干一', [])).not.toBe(questionFingerprint('题干二', []));
  });

  it('填空题（无选项）按题干区分', () => {
    expect(questionFingerprint('$2$ 的相反数是 ____', [])).toBe(questionFingerprint('$2$的相反数是____', []));
  });
});
