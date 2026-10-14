/**
 * 题目难度模型（纯函数，无 IO）——**冷启动先验分**。
 *
 * 为什么要有这一层：采集来源自带的「难度值」只是单一标量（≈正确率），
 * 落到库里 66% 的题都是 medium，跨学段还互相矛盾（真机数据：小学 hard 16,347 道、
 * 高中只有 95 道），老师看不出难易梯度。主流题库产品的做法是
 * **「内容特征先验 + 作答数据校准 + 人工标注优先」**：
 *
 *  1. 冷启动（本文件）：从题型、学段/年级、算式与公式复杂度、题干阅读量、
 *     空位个数、是否看图、高阶认知动词、题库来源（课时/章节/期末综合卷）、
 *     知识点难易后缀等**可解释特征**打出一个 0–100 分；
 *  2. 数据校准（`DifficultyService.calibrate`）：有真实作答后按经验正确率做贝叶斯收缩，
 *     样本越多越依赖数据；
 *  3. 人工优先：老师手改过的题（`difficulty_source = 'manual'`）**永不被自动覆盖**。
 *
 * 分数只是中间量，落库时还要按**分位数**分档（保证全库分布合理，见 `cutPoints`）：
 * 三档 `easy / medium / hard`（兼容既有组卷难度配额），五级 1–5 用于展示（国内题库主流口径）。
 */
import type { QuestionType } from '@microclass/shared';

/** 打分输入：只取判定难度真正需要的字段 */
export interface DifficultyInput {
  type: QuestionType;
  stem: string;
  options?: string[];
  answer?: string;
  /** 填空题的空位数（多空通常步骤更多、更难） */
  blanks?: number;
  hasImage?: boolean;
  subject?: string;
  /** 小学 / 初中 / 高中 */
  stage?: string;
  /** 书册名，如「三年级上册」「七年级上册（新）」 */
  book?: string;
  chapter?: string;
  /** 知识点 */
  point?: string;
  /** 题库类型：lesson 课时配套 / chapter 章节题库 / paper 整卷试卷 */
  bankKind?: string;
  /** 题库名（含「期末」「单元」「综合」「提优」这类卷型信息） */
  bankName?: string;
  /** 采集来源里那个旧难度值（作为弱特征保留，不直接采用） */
  legacyDifficulty?: string;
}

/** 单条特征的贡献（正=更难，负=更基础），保留下来便于老师看懂「为什么判成难」 */
export interface DifficultyReason {
  key: string;
  label: string;
  delta: number;
}

export interface DifficultyScore {
  /** 0–100，越大越难 */
  score: number;
  reasons: DifficultyReason[];
}

/** 三档 / 五级分档阈值（按分位数算出来，见 `cutPoints`） */
export interface DifficultyCuts {
  /** 三档分界：score < easyMax → easy；< mediumMax → medium；否则 hard */
  easyMax: number;
  mediumMax: number;
  /** 五级分界：p20 / p40 / p60 / p80 */
  five: [number, number, number, number];
}

export const DEFAULT_CUTS: DifficultyCuts = { easyMax: 38, mediumMax: 62, five: [24, 36, 50, 66] };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;

/** 匹配次数（用于算式/关键词类特征） */
function countMatches(text: string, re: RegExp): number {
  return text.match(re)?.length ?? 0;
}

/** 由书册名推断学段（题目没标 stage 时兜底，例如手工新建的题只继承了题库的书册） */
export function inferStage(book: string): string {
  const text = String(book ?? '');
  if (/高一|高二|高三|高中|必修/.test(text)) return '高中';
  if (/[七八九]年级|初中/.test(text)) return '初中';
  if (/[一二三四五六]年级|小学/.test(text)) return '小学';
  return '';
}

/** 学段 + 年级的基础分：高中 > 初中 > 小学（同一学段内随年级小幅递增） */
export function baseScore(input: Pick<DifficultyInput, 'stage' | 'book' | 'subject'>): number {
  const stage = String(input.stage ?? '') || inferStage(String(input.book ?? ''));
  const book = String(input.book ?? '');
  let base = 45;
  if (stage === '小学') base = 30;
  else if (stage === '初中') base = 45;
  else if (stage === '高中') base = 62;

  const gradeMap: Record<string, number> = {
    一: -5,
    二: -4,
    三: -2,
    四: 0,
    五: 2,
    六: 4,
    七: 0,
    八: 3,
    九: 6,
  };
  const cn = /([一二三四五六七八九])年级/.exec(book)?.[1];
  if (cn && gradeMap[cn] !== undefined) base += gradeMap[cn] ?? 0;
  if (/高一|高二|高三/.test(book)) base += /高三/.test(book) ? 6 : /高二/.test(book) ? 3 : 0;
  // 语文/英语的阅读理解与数学的算式特征不同：给一个很小的语言学科偏移，避免全靠题型区分
  if (/语文|英语/.test(String(input.subject ?? ''))) base += 2;
  return base;
}

/**
 * 计算难度先验分。返回分数与全部特征贡献（可解释，界面可展示）。
 */
export function scoreDifficulty(input: DifficultyInput): DifficultyScore {
  const reasons: DifficultyReason[] = [];
  const add = (key: string, label: string, delta: number): void => {
    if (delta === 0) return;
    reasons.push({ key, label, delta: round1(delta) });
  };

  const base = baseScore(input);
  add('base', `学段/年级基准（${input.stage || '未标'}${input.book ? ` · ${input.book}` : ''}）`, base);

  const stem = String(input.stem ?? '');
  const options = input.options ?? [];
  const answer = String(input.answer ?? '');
  const type = input.type;

  // 1) 题型：判断题最易，解答/简答最难
  const typeDelta: Record<QuestionType, number> = { judge: -7, single: 0, fill: 2, multiple: 6, short: 10 };
  add('type', `题型（${type}）`, typeDelta[type] ?? 0);

  // 2) 算式 / 公式复杂度：步数越多越难
  const frac = countMatches(stem, /\\frac|\\dfrac|\\tfrac/g);
  add('frac', `分数式 ×${frac}`, clamp(frac * 3, 0, 9));
  const sqrt = countMatches(stem, /\\sqrt/g);
  add('sqrt', `根式 ×${sqrt}`, clamp(sqrt * 2.5, 0, 7));
  const pow = countMatches(stem, /\^\{|\\cdot|\^{2}|²|³/g);
  add('pow', `乘方/幂 ×${pow}`, clamp(pow * 1.5, 0, 6));
  const abs = countMatches(stem, /\\left\||\\right\||\|/g);
  add('abs', `绝对值/竖线 ×${abs}`, clamp(abs * 1, 0, 3));
  const ops = countMatches(stem, /[+\-×÷±]/g);
  add('ops', `运算符 ×${ops}`, clamp(ops * 0.6, 0, 9));
  const eqs = countMatches(stem, /[=＝]/g);
  add('eq', `等号/方程 ×${eqs}`, clamp(eqs * 2, 0, 8));
  const longNums = countMatches(stem, /\d{5,}/g);
  add('bignum', `多位数字 ×${longNums}`, clamp(longNums * 1.5, 0, 6));
  const depth = maxBracketDepth(stem);
  add('nest', `括号嵌套深度 ${depth}`, clamp((depth - 1) * 1.5, 0, 6));
  // 小问数（「(1)(2)(3)」这种多步题，主流难度标注里是很强的信号）
  const subQuestions = countMatches(stem, /（[1-9１-９]）|\([1-9]\)|①|②|③/g);
  add('subQuestions', `小问 ×${subQuestions}`, clamp(subQuestions * 2, 0, 6));

  // 3) 阅读量与建模：长题干（应用题/材料题）更难
  const len = stem.replace(/!\[[^\]]*\]\([^)]*\)/g, '').length;
  const lenDelta = len > 260 ? 8 : len > 160 ? 6 : len > 80 ? 3 : len > 40 ? 1 : 0;
  add('length', `题干长度 ${len} 字`, lenDelta);

  // 4) 空位数（多空填空步骤更多）
  const blanks = input.blanks ?? 0;
  add('blanks', `${blanks} 个空`, blanks >= 3 ? 5 : blanks === 2 ? 3 : 0);

  // 5) 看图题需要读图建模
  add('image', '看图/图表建模', input.hasImage ? 4 : 0);

  // 6) 高阶认知动词（布卢姆分类的高阶目标：分析/评价/创造）
  const highOrder: [RegExp, string, number][] = [
    [/证明|求证/, '证明/求证', 8],
    [/规律|探究|探索|猜想/, '规律探究', 6],
    [/分类讨论|分情况/, '分类讨论', 8],
    [/是否存在|能否|是否成立/, '存在性判断', 6],
    [/方案|设计|最省钱|最优/, '方案设计', 7],
    [/综合|拓展|阅读理解/, '综合/拓展', 6],
    [/取值范围|最大值|最小值|最值/, '最值/取值范围', 5],
    [/应用|实际|情境/, '实际应用', 3],
  ];
  let highOrderSum = 0;
  const hitLabels: string[] = [];
  for (const [re, label, delta] of highOrder) {
    if (re.test(stem)) {
      highOrderSum += delta;
      hitLabels.push(label);
    }
  }
  add('highOrder', `高阶目标（${hitLabels.join('、')}）`, clamp(highOrderSum, 0, 16));

  // 7) 选项/答案形态
  if ((type === 'single' || type === 'multiple') && options.length > 4) add('options', `选项 ${options.length} 个`, 2);
  if (/\|/.test(answer)) add('multiAnswer', '答案有多个可接受写法', 2);
  if (type === 'short' && answer.length > 12) add('longAnswer', '解答题参考答案较长', 3);

  // 8) 来源与卷型：课时配套偏基础，期末/综合/升学模拟偏难
  const kind = String(input.bankKind ?? '');
  add('bankKind', `题库类型（${kind || '未标'}）`, kind === 'lesson' ? -4 : kind === 'paper' ? 4 : 0);
  const bankName = String(input.bankName ?? '');
  let bankDelta = 0;
  const bankHits: string[] = [];
  const bankRules: [RegExp, string, number][] = [
    [/升学|中考|高考|模拟|联考|压轴|拔高|提优|培优/, '升学/拔高卷', 6],
    [/综合/, '综合卷', 5],
    [/期末/, '期末卷', 4],
    [/期中/, '期中卷', 2],
    [/单元|月考|阶段/, '单元/阶段卷', 1],
    [/基础|巩固|预习|随堂|教材/, '基础/随堂', -4],
  ];
  for (const [re, label, delta] of bankRules) {
    if (re.test(bankName)) {
      bankDelta += delta;
      bankHits.push(label);
    }
  }
  add('bankName', `来源卷型（${bankHits.join('、')}）`, clamp(bankDelta, -6, 8));

  // 9) 知识点/章节里的难易后缀（采集数据常带「-求参」「-直接代入」这类标注）
  const pointText = `${input.point ?? ''} ${input.chapter ?? ''}`;
  let pointDelta = 0;
  const pointHits: string[] = [];
  for (const [re, label, delta] of [
    [/压轴|竞赛|拓展/, '压轴/竞赛', 6],
    [/求参|参数|含参/, '含参问题', 4],
    [/综合|实际应用/, '综合应用', 3],
    [/概念|认识|初步|意义|读写/, '概念认识', -3],
    [/基础|简单|直接/, '基础型', -2],
  ] as [RegExp, string, number][]) {
    if (re.test(pointText)) {
      pointDelta += delta;
      pointHits.push(label);
    }
  }
  add('point', `知识点标注（${pointHits.join('、')}）`, clamp(pointDelta, -4, 8));

  // 10) 采集来源的旧难度值：只当弱特征，避免完全丢弃既有信号
  const legacy = String(input.legacyDifficulty ?? '');
  add('legacy', `来源旧标注（${legacy || '无'}）`, legacy === 'hard' ? 5 : legacy === 'easy' ? -4 : 0);

  const score = clamp(
    reasons.reduce((sum, r) => sum + r.delta, 0),
    0,
    100,
  );
  return { score: Math.round(score), reasons };
}

/** 括号最大嵌套深度（含 `（）(){}[]`） */
export function maxBracketDepth(text: string): number {
  let depth = 0;
  let max = 0;
  for (const ch of text) {
    if ('([{（【'.includes(ch)) {
      depth += 1;
      if (depth > max) max = depth;
    } else if (')] }）】'.replace(/ /g, '').includes(ch)) {
      depth = Math.max(0, depth - 1);
    }
  }
  return max;
}

/** 分数 → 三档（兼容组卷难度配额） */
export function bucketFromScore(score: number, cuts: DifficultyCuts = DEFAULT_CUTS): 'easy' | 'medium' | 'hard' {
  if (score < cuts.easyMax) return 'easy';
  if (score < cuts.mediumMax) return 'medium';
  return 'hard';
}

/** 分数 → 五级（1 最易 … 5 最难；国内题库常用五级口径，界面展示用） */
export function levelFromScore(score: number, cuts: DifficultyCuts = DEFAULT_CUTS): 1 | 2 | 3 | 4 | 5 {
  const [p20, p40, p60, p80] = cuts.five;
  if (score < p20) return 1;
  if (score < p40) return 2;
  if (score < p60) return 3;
  if (score < p80) return 4;
  return 5;
}

export const LEVEL_LABEL: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: '很容易',
  2: '容易',
  3: '中等',
  4: '较难',
  5: '很难',
};

/**
 * 由一批分数算出分档阈值（**分位数**，而不是拍脑袋写死）。
 *
 * 主流题库的难度结构是「基础约三成、中档约一半、较难约两成」，
 * 因此三档按 p30 / p80 切；五级按 p20 / p40 / p60 / p80 切。
 * 样本太少（< 20 题）时直接用 `DEFAULT_CUTS`，避免小样本把阈值带偏。
 */
export function cutPoints(scores: number[]): DifficultyCuts {
  if (scores.length < 20) return DEFAULT_CUTS;
  const sorted = [...scores].sort((a, b) => a - b);
  const q = (p: number): number => sorted[clamp(Math.floor(p * (sorted.length - 1)), 0, sorted.length - 1)] ?? 50;
  return {
    easyMax: q(0.3),
    mediumMax: q(0.8),
    five: [q(0.2), q(0.4), q(0.6), q(0.8)],
  };
}

/**
 * 作答数据校准：把「先验分」与「真实正确率」按样本量融合。
 *
 * 用 Beta 先验收缩（`(correct + α) / (n + α + β)`）：样本少时几乎听先验，
 * 样本多时听数据；`k` 是「先验相当于多少道题的证据量」（默认 20，主流取 10–30）。
 * 返回 0–100 的融合分（正确率越低越难）。
 */
export function calibrateScore(
  priorScore: number,
  stats: { correct: number; total: number },
  options?: { k?: number; alpha?: number; beta?: number },
): { score: number; p: number; weight: number } {
  const k = options?.k ?? 20;
  const alpha = options?.alpha ?? 1;
  const beta = options?.beta ?? 1;
  const n = Math.max(0, stats.total);
  if (n === 0) return { score: priorScore, p: 0, weight: 0 };
  // 先验分越高 → 先验正确率越低（线性映射，分数中点 50 对应 p=0.5）
  const priorP = clamp(1 - priorScore / 100, 0.05, 0.95);
  const p = (stats.correct + alpha) / (n + alpha + beta);
  const w = n / (n + k);
  const blended = (1 - w) * priorP + w * p;
  return { score: Math.round(clamp(100 * (1 - blended), 0, 100)), p: round1(p), weight: round1(w) };
}
