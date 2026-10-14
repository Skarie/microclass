/**
 * 难度服务：把「内容特征先验 + 作答数据校准 + 人工优先」落到题库上。
 *
 * 三个动作：
 *  1. `preview`：按当前数据算出难度分布预览（**不写库**），老师先看清会变成什么样；
 *  2. `apply`：批量落库。用**分位数阈值**分档，保证全库难度结构合理（基础约三成、中档约一半、较难约两成）；
 *     老师手动标注（`difficulty_source = 'manual'`）与已校准（`calibrated`）的题**默认不动**；
 *  3. `calibrate`：用真实作答数据校准 —— 样本量越大越依赖数据（Beta 收缩），
 *     样本不足时几乎保持先验分。
 *
 * 阈值（cuts）存在 settings 里，改一次全库一致：三档 `difficulty` 与五级展示
 * 都从同一个 cuts 派生，不会出现「界面说 4 星、库里是 easy」这种自相矛盾。
 */
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { QuestionRepository } from '../db/repositories/questionRepository.js';
import type { SettingsRepository } from '../db/repositories/settingsRepository.js';
import { AppError, type User } from '@microclass/shared';
import {
  DEFAULT_CUTS,
  LEVEL_LABEL,
  bucketFromScore,
  calibrateScore,
  cutPoints,
  levelFromScore,
  scoreDifficulty,
  type DifficultyCuts,
} from '../domain/difficulty.js';
import { parseOptions } from '../domain/question.js';

const CUTS_KEY = 'difficulty_cuts';

export interface DifficultyPreview {
  scope: { bankId: number | null; name: string };
  total: number;
  willScore: number;
  skippedManual: number;
  skippedCalibrated: number;
  /** 分档阈值（分位数算出来的） */
  cuts: DifficultyCuts;
  /** 预览分布（应用后大致就是这个结构） */
  predicted: {
    buckets: { difficulty: string; questions: number; ratio: number }[];
    levels: { level: number; label: string; questions: number; ratio: number }[];
  };
  /** 当前库里的真实分布（对照用） */
  current: ReturnType<QuestionRepository['difficultyStats']>;
  /** 难度两端的样例题，便于老师抽查合理性 */
  samples: { easiest: SampleQuestion[]; hardest: SampleQuestion[] };
}

interface SampleQuestion {
  id: number;
  stem: string;
  score: number;
  level: number;
  difficulty: string;
  bankName: string;
  reasons: string;
}

export interface DifficultyApplyResult {
  scored: number;
  updated: number;
  skippedManual: number;
  skippedCalibrated: number;
  cuts: DifficultyCuts;
  buckets: { difficulty: string; questions: number }[];
}

export class DifficultyService {
  constructor(
    private readonly questions: QuestionRepository,
    private readonly settings: SettingsRepository,
    private readonly audit: AuditRepository,
  ) {}

  /** 当前阈值：settings 里有就用它，否则用默认（与库里的 difficulty 保持一致） */
  cuts(): DifficultyCuts {
    const raw = this.settings.get(CUTS_KEY);
    if (!raw) return DEFAULT_CUTS;
    try {
      const parsed = JSON.parse(raw) as Partial<DifficultyCuts>;
      const five = Array.isArray(parsed.five) && parsed.five.length === 4 ? parsed.five : DEFAULT_CUTS.five;
      return {
        easyMax: Number(parsed.easyMax ?? DEFAULT_CUTS.easyMax),
        mediumMax: Number(parsed.mediumMax ?? DEFAULT_CUTS.mediumMax),
        five: [five[0] ?? 24, five[1] ?? 36, five[2] ?? 50, five[3] ?? 66],
      };
    } catch {
      return DEFAULT_CUTS;
    }
  }

  /** 难度现状（体检用）：分布 + 来源统计 */
  stats(bankId?: number): ReturnType<QuestionRepository['difficultyStats']> {
    return this.questions.difficultyStats(bankId, this.cuts());
  }

  /**
   * 给一批题打分（不写库）。
   * `manual` / `calibrated` 的题默认跳过 —— 人工判断与真实数据都比模型先验可靠。
   */
  private scoreBatch(
    bankId: number | undefined,
    options: { keepManual?: boolean; keepCalibrated?: boolean; onlyUnscored?: boolean },
  ): {
    items: { id: number; score: number; source: 'auto'; reasons: string; level: number; difficulty: string }[];
    skippedManual: number;
    skippedCalibrated: number;
    total: number;
  } {
    const keepManual = options.keepManual !== false;
    const keepCalibrated = options.keepCalibrated !== false;
    const out: { id: number; score: number; source: 'auto'; reasons: string; level: number; difficulty: string }[] = [];
    let skippedManual = 0;
    let skippedCalibrated = 0;
    let afterId = 0;
    let total = 0;
    for (;;) {
      const rows = this.questions.difficultyFeatures({
        ...(bankId === undefined ? {} : { bankId }),
        afterId,
        limit: 2000,
        ...(options.onlyUnscored ? { onlyUnscored: true } : {}),
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        afterId = row.id;
        total += 1;
        const source = String(row.difficulty_source ?? '');
        if (keepManual && source === 'manual') {
          skippedManual += 1;
          continue;
        }
        if (keepCalibrated && source === 'calibrated') {
          skippedCalibrated += 1;
          continue;
        }
        const options_ = parseOptions(row.options);
        const scored = scoreDifficulty({
          type: row.type,
          stem: row.stem,
          options: options_,
          answer: row.answer,
          blanks: countBlanks(row.type, row.answer, row.stem),
          hasImage: row.has_image === 1,
          subject: row.subject,
          stage: row.stage,
          book: row.book,
          chapter: row.chapter,
          point: row.point,
          bankKind: row.bank_kind,
          bankName: row.bank_name,
          legacyDifficulty: row.difficulty,
        });
        out.push({
          id: row.id,
          score: scored.score,
          source: 'auto',
          reasons: scored.reasons
            .filter((r) => r.key !== 'base')
            .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
            .slice(0, 3)
            .map((r) => `${r.label} ${r.delta > 0 ? '+' : ''}${r.delta}`)
            .join('、'),
          level: 3,
          difficulty: 'medium',
        });
      }
    }
    return { items: out, skippedManual, skippedCalibrated, total };
  }

  /** 预览：算出这批题的新分数与分布，不写库 */
  preview(bankId?: number, options?: { keepManual?: boolean; keepCalibrated?: boolean }): DifficultyPreview {
    let name = '全库';
    if (bankId !== undefined) name = this.bankName(bankId);
    const batch = this.scoreBatch(bankId, options ?? {});
    const cuts = cutPoints(batch.items.map((i) => i.score));
    const scored = batch.items.map((i) => ({
      ...i,
      level: levelFromScore(i.score, cuts),
      difficulty: bucketFromScore(i.score, cuts),
    }));
    const bucketCount = new Map<string, number>();
    const levelCount = new Map<number, number>();
    for (const s of scored) {
      bucketCount.set(s.difficulty, (bucketCount.get(s.difficulty) ?? 0) + 1);
      levelCount.set(s.level, (levelCount.get(s.level) ?? 0) + 1);
    }
    const denom = Math.max(1, scored.length);
    const sorted = [...scored].sort((a, b) => a.score - b.score);
    const toSample = (s: (typeof scored)[number]): SampleQuestion => ({
      id: s.id,
      stem: '',
      score: s.score,
      level: s.level,
      difficulty: s.difficulty,
      bankName: '',
      reasons: s.reasons,
    });
    // 样例题干单独取（避免打分过程里把大字段读进来）
    const sampleIds = [...sorted.slice(0, 5), ...sorted.slice(-5)].map((s) => s.id);
    const stems = new Map(this.stemOf(sampleIds).map((r) => [r.id, r]));
    const decorate = (s: (typeof scored)[number]): SampleQuestion => {
      const row = stems.get(s.id);
      return {
        ...toSample(s),
        stem: String(row?.stem ?? '').slice(0, 120),
        bankName: String(row?.bank_name ?? ''),
      };
    };
    return {
      scope: { bankId: bankId ?? null, name },
      total: batch.total,
      willScore: scored.length,
      skippedManual: batch.skippedManual,
      skippedCalibrated: batch.skippedCalibrated,
      cuts,
      predicted: {
        buckets: ['easy', 'medium', 'hard'].map((d) => ({
          difficulty: d,
          questions: bucketCount.get(d) ?? 0,
          ratio: Math.round(((bucketCount.get(d) ?? 0) / denom) * 1000) / 10,
        })),
        levels: ([1, 2, 3, 4, 5] as const).map((lv) => ({
          level: lv,
          label: LEVEL_LABEL[lv],
          questions: levelCount.get(lv) ?? 0,
          ratio: Math.round(((levelCount.get(lv) ?? 0) / denom) * 1000) / 10,
        })),
      },
      current: this.questions.difficultyStats(bankId, this.cuts()),
      samples: { easiest: sorted.slice(0, 5).map(decorate), hardest: sorted.slice(-5).reverse().map(decorate) },
    };
  }

  /**
   * 落库。`cuts` 取全库分位数（在 preview 里算过；这里重新按同一口径算一次，保证一致）。
   * `applyCuts` 会把阈值写进 settings，之后全库共用。
   */
  apply(
    actor: User,
    options?: { bankId?: number; keepManual?: boolean; keepCalibrated?: boolean; dryRun?: boolean },
  ): DifficultyApplyResult {
    const bankId = options?.bankId;
    const batch = this.scoreBatch(bankId, options ?? {});
    // 阈值：整库用全库分位数；单题库也用全库阈值（保证跨题库可比），全库没算过就退回默认
    const globalScores = bankId === undefined ? batch.items.map((i) => i.score) : this.allScores();
    const cuts = globalScores.length >= 20 ? cutPoints(globalScores) : this.cuts();
    const items = batch.items.map((i) => ({
      id: i.id,
      score: i.score,
      difficulty: bucketFromScore(i.score, cuts),
      source: 'auto' as const,
    }));
    if (options?.dryRun) {
      return {
        scored: items.length,
        updated: 0,
        skippedManual: batch.skippedManual,
        skippedCalibrated: batch.skippedCalibrated,
        cuts,
        buckets: [],
      };
    }
    const updated = this.questions.setDifficulty(items);
    if (bankId === undefined) this.settings.set(CUTS_KEY, JSON.stringify(cuts));
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'question.difficulty.apply',
      targetType: 'question',
      detail: {
        scope: bankId ?? 'all',
        scored: items.length,
        updated,
        skippedManual: batch.skippedManual,
        skippedCalibrated: batch.skippedCalibrated,
        cuts,
      },
    });
    return {
      scored: items.length,
      updated,
      skippedManual: batch.skippedManual,
      skippedCalibrated: batch.skippedCalibrated,
      cuts,
      buckets: this.questions.difficultyStats(bankId, cuts).buckets,
    };
  }

  /**
   * 用真实作答数据校准难度。
   *
   * 数据来源：`attempts.answers`（JSON，逐题作答与是否正确）+ `wrong_questions`（错题本）。
   * 样本量不足（默认 < 5 次作答）的题不校准，保持先验分；
   * 校准过的题标 `calibrated`（之后的「重算先验」不会把它冲掉）。
   */
  calibrate(
    actor: User,
    options?: { minSamples?: number; k?: number; dryRun?: boolean },
  ): {
    candidates: number;
    calibrated: number;
    minSamples: number;
    k: number;
    dryRun: boolean;
    samples: { id: number; prior: number; next: number; n: number; p: number }[];
  } {
    const minSamples = Math.max(1, options?.minSamples ?? 5);
    const k = Math.max(1, options?.k ?? 20);
    const dryRun = options?.dryRun !== false;
    const stats = this.answerStats();
    const candidates = [...stats.values()].filter((s) => s.total >= minSamples);
    const samples: { id: number; prior: number; next: number; n: number; p: number }[] = [];
    const items: { id: number; score: number; difficulty: string; source: 'calibrated'; n: number; p: number }[] = [];
    const cuts = this.cuts();
    for (const stat of candidates) {
      const row = this.question(stat.id);
      if (!row) continue;
      const prior = row.difficulty_score >= 0 ? row.difficulty_score : 50;
      const blended = calibrateScore(prior, stat, { k });
      items.push({
        id: stat.id,
        score: blended.score,
        difficulty: bucketFromScore(blended.score, cuts),
        source: 'calibrated',
        n: stat.total,
        p: blended.p,
      });
      if (samples.length < 10) {
        samples.push({ id: stat.id, prior, next: blended.score, n: stat.total, p: blended.p });
      }
    }
    if (!dryRun && items.length > 0) {
      this.questions.setDifficulty(items);
      this.audit.write({
        actorId: actor.id,
        actorName: actor.username,
        action: 'question.difficulty.calibrate',
        targetType: 'question',
        detail: { calibrated: items.length, minSamples, k },
      });
    }
    return { candidates: candidates.length, calibrated: items.length, minSamples, k, dryRun, samples };
  }

  /* ---------------- 内部小工具 ---------------- */

  private bankName(bankId: number): string {
    const row = this.questions.difficultyFeatures({ bankId, limit: 1 })[0];
    if (!row) throw AppError.notFound('题库不存在或没有题目');
    return row.bank_name;
  }

  private stemOf(ids: number[]): { id: number; stem: string; bank_name: string }[] {
    return ids.length === 0 ? [] : this.questions.stemsByIds(ids);
  }

  private allScores(): number[] {
    return this.questions.allDifficultyScores();
  }

  private question(id: number): { id: number; difficulty_score: number } | undefined {
    return this.questions.difficultyScoreOf(id);
  }

  /** 每题作答统计：从 attempts.answers 与错题本里汇总 */
  private answerStats(): Map<number, { id: number; total: number; correct: number }> {
    return this.questions.answerStats();
  }
}

/** 填空题空位数：优先看题干里的空位记号，其次看答案里的多空分隔符 */
export function countBlanks(type: string, answer: string, stem: string): number {
  if (type !== 'fill') return 0;
  const marks = (stem.match(/_{2,}|＿{2,}|\(\s*\)|（\s*）/g) ?? []).length;
  if (marks > 0) return marks;
  const parts = String(answer ?? '')
    .split(/[；;]/)
    .filter((s) => s.trim() !== '');
  return parts.length;
}
