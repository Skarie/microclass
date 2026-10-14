/**
 * 难度模型单测：特征 → 分数 → 三档/五级，以及作答校准的收缩行为。
 * 重点验证「主流口径」是否站得住：低年级基础题低分、多步/含参/压轴题高分、
 * 看图与长材料题偏难、判断题比解答题易。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CUTS,
  bucketFromScore,
  calibrateScore,
  cutPoints,
  levelFromScore,
  maxBracketDepth,
  scoreDifficulty,
  type DifficultyInput,
} from '../src/domain/difficulty.js';

/** 只取分数（多数断言只关心相对高低） */
function scoreOf(input: DifficultyInput): number {
  return scoreDifficulty(input).score;
}

describe('难度先验分', () => {
  it('低年级口算明显低于高中多步题', () => {
    const easy = scoreOf({ type: 'fill', stem: '3 + 5 = ____', stage: '小学', book: '一年级上册' });
    const harder = scoreOf({
      type: 'fill',
      stem: '已知函数 $f(x)=x^2-2ax+3$ 在区间 $[1,2]$ 上的最大值为 $5$，求实数 $a$ 的取值范围。',
      stage: '高中',
      book: '高一必修一',
      bankKind: 'paper',
      bankName: '高一 · 期末考试 · 函数综合',
    });
    expect(harder - easy).toBeGreaterThan(25);
    expect(easy).toBeLessThan(40);
    expect(harder).toBeGreaterThan(60);
  });

  it('题型序：判断题最易、解答题最难（同题干同来源）', () => {
    const base = { stem: '两个三角形全等。', stage: '初中', book: '八年级上册', bankKind: 'lesson' as const };
    const judge = scoreOf({ ...base, type: 'judge' });
    const single = scoreOf({ ...base, type: 'single', options: ['A', 'B', 'C', 'D'] });
    const fill = scoreOf({ ...base, type: 'fill' });
    const short = scoreOf({ ...base, type: 'short', answer: '因为……所以两个三角形全等。' });
    expect(judge).toBeLessThan(single);
    expect(single).toBeLessThan(fill);
    expect(fill).toBeLessThan(short);
  });

  it('公式复杂度：分数/根式/多层括号/多步运算都加分', () => {
    const plain = scoreOf({ type: 'fill', stem: '计算 $12+8$。', stage: '初中', book: '七年级上册' });
    const frac = scoreOf({
      type: 'fill',
      stem: '计算 $\\frac{1}{2}+\\frac{1}{3}-\\frac{1}{6}$。',
      stage: '初中',
      book: '七年级上册',
    });
    const nested = scoreOf({
      type: 'fill',
      stem: '化简 $((a+b)-(c-(d-e)))$ 的结果。',
      stage: '初中',
      book: '七年级上册',
    });
    const radical = scoreOf({
      type: 'fill',
      stem: '计算 $\\sqrt{18}-\\sqrt{8}+\\sqrt{\\frac{1}{2}}$。',
      stage: '初中',
      book: '八年级下册',
    });
    expect(frac).toBeGreaterThan(plain);
    expect(nested).toBeGreaterThan(plain);
    expect(radical).toBeGreaterThan(plain);
    expect(maxBracketDepth('$((a+b)-(c-(d-e)))$')).toBe(3);
  });

  it('高阶目标与卷型：找规律、含参、压轴卷更难', () => {
    const plain = scoreOf({ type: 'fill', stem: '填空：$2+2=$____', stage: '初中', book: '七年级上册' });
    const pattern = scoreOf({
      type: 'fill',
      stem: '观察下列各数的规律：$1,3,6,10,15,\\cdots$ 第 $n$ 个数是____。',
      stage: '初中',
      book: '七年级上册',
    });
    const param = scoreOf({
      type: 'fill',
      stem: '若关于 $x$ 的方程 $2x+a=3$ 的解是正数，求 $a$ 的取值范围。',
      stage: '初中',
      book: '七年级上册',
    });
    const finalPaper = scoreOf({
      type: 'fill',
      stem: '填空：$2+2=$____',
      stage: '初中',
      book: '七年级上册',
      bankKind: 'paper',
      bankName: '七年级上册 · 期末测评 · 综合卷',
    });
    expect(pattern).toBeGreaterThan(plain);
    expect(param).toBeGreaterThan(plain);
    expect(finalPaper).toBeGreaterThan(plain);
  });

  it('看图题与多空填空题偏难', () => {
    const text = scoreOf({
      type: 'fill',
      stem: '一个数加上 3 得 10，这个数是____。',
      stage: '小学',
      book: '二年级上册',
    });
    const withImage = scoreOf({
      type: 'fill',
      stem: '如图，下面每个图形中的四个数都是按相同规律填写的。![](/api/v1/question-media/ab/cd.png)',
      stage: '小学',
      book: '二年级上册',
      hasImage: true,
    });
    const multiBlanks = scoreOf({
      type: 'fill',
      stem: '计算并填空：____、____、____。',
      stage: '小学',
      book: '二年级上册',
      blanks: 3,
    });
    expect(withImage).toBeGreaterThan(text);
    expect(multiBlanks).toBeGreaterThan(text);
  });

  it('分数落在 0–100，且给出可解释的理由', () => {
    const scored = scoreDifficulty({
      type: 'fill',
      stem: '证明：直角三角形的两条直角边的平方和等于斜边的平方（勾股定理）。',
      stage: '初中',
      book: '八年级下册',
      bankKind: 'paper',
      bankName: '八年级下册 · 期末测评 · 综合卷',
      hasImage: false,
    });
    expect(scored.score).toBeGreaterThanOrEqual(0);
    expect(scored.score).toBeLessThanOrEqual(100);
    const labels = scored.reasons.map((r) => r.label).join(' ');
    expect(labels).toContain('证明');
    expect(labels).toContain('学段');
    expect(labels).toContain('题型');
  });
});

describe('分档与分位数', () => {
  it('三档按阈值切，五级按 p20/p40/p60/p80 切', () => {
    expect(bucketFromScore(10)).toBe('easy');
    expect(bucketFromScore(50)).toBe('medium');
    expect(bucketFromScore(90)).toBe('hard');
    expect(levelFromScore(10)).toBe(1);
    expect(levelFromScore(45)).toBe(3);
    expect(levelFromScore(95)).toBe(5);
  });

  it('分位数阈值：正态分布下基础/中档/较难约 30/50/20', () => {
    const scores = Array.from({ length: 200 }, (_, i) => i * 0.5); // 0–99.5
    const cuts = cutPoints(scores);
    expect(cuts.easyMax).toBeGreaterThan(20);
    expect(cuts.easyMax).toBeLessThan(40);
    expect(cuts.mediumMax).toBeGreaterThan(70);
    expect(cuts.mediumMax).toBeLessThan(90);
    const buckets = scores.map((s) => bucketFromScore(s, cuts));
    expect(buckets.filter((b) => b === 'easy').length / scores.length).toBeGreaterThan(0.25);
    expect(buckets.filter((b) => b === 'hard').length / scores.length).toBeGreaterThan(0.15);
  });

  it('样本太少时退回默认阈值（避免小样本把分档带偏）', () => {
    expect(cutPoints([10, 20, 30])).toEqual(DEFAULT_CUTS);
  });
});

describe('作答数据校准', () => {
  it('没有作答数据时保持先验分', () => {
    const res = calibrateScore(70, { correct: 0, total: 0 });
    expect(res.score).toBe(70);
    expect(res.weight).toBe(0);
  });

  it('样本越多越听数据：全班做错的题比先验更难', () => {
    const few = calibrateScore(50, { correct: 0, total: 2 });
    const many = calibrateScore(50, { correct: 0, total: 100 });
    expect(few.score).toBeGreaterThan(30);
    expect(few.score).toBeLessThan(60); // 小样本只轻微上调
    expect(many.score).toBeGreaterThan(90); // 大样本几乎完全按正确率
  });

  it('全班做对的题变简单（但保留先验的最低限度）', () => {
    const res = calibrateScore(50, { correct: 100, total: 100 });
    expect(res.score).toBeLessThan(12);
    expect(res.p).toBeGreaterThan(0.9);
  });
});
