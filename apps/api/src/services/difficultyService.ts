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
import { LEVEL_LABEL, bucketFromScore, cutPoints, levelFromScore, type DifficultyCuts } from '../domain/difficulty.js';
import { planCalibration, type CalibrationItem, type CalibrationSample } from '../domain/difficultyCalibration.js';
import { DIFFICULTY_CUTS_KEY, parseDifficultyCuts } from '../domain/difficultyCuts.js';
import { yieldToEventLoop } from '../utils/async.js';
import { scoreBatch } from './difficultyScoring.js';

/** 难度阈值的 settings key（解析逻辑在 domain/difficultyCuts，worker 侧复用同一份） */
const CUTS_KEY = DIFFICULTY_CUTS_KEY;

/** 校准分块大小（题量）：实测 500/1000/2000 后取性价比最高的一档，见提交说明 */
const CALIBRATE_CHUNK = 500;

/** 返回给界面的样例条数（保持接口语义不变：最多 10 条） */
const CALIBRATE_SAMPLES = 10;

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
  current: Awaited<ReturnType<QuestionRepository['difficultyStats']>>;
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
    return parseDifficultyCuts(this.settings.getSync(CUTS_KEY));
  }

  /** 难度现状（体检用）：分布 + 来源统计 */
  async stats(bankId?: number): Promise<Awaited<ReturnType<QuestionRepository['difficultyStats']>>> {
    return this.questions.difficultyStats(bankId, this.cuts());
  }

  /** 预览：算出这批题的新分数与分布，不写库 */
  async preview(
    bankId?: number,
    options?: { keepManual?: boolean; keepCalibrated?: boolean },
  ): Promise<DifficultyPreview> {
    let name = '全库';
    if (bankId !== undefined) name = await this.bankName(bankId);
    const batch = await scoreBatch(this.questions, bankId, options ?? {});
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
    const stems = new Map((await this.stemOf(sampleIds)).map((r) => [r.id, r]));
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
      current: await this.questions.difficultyStats(bankId, this.cuts()),
      samples: { easiest: sorted.slice(0, 5).map(decorate), hardest: sorted.slice(-5).reverse().map(decorate) },
    };
  }

  /**
   * 落库。`cuts` 取全库分位数（在 preview 里算过；这里重新按同一口径算一次，保证一致）。
   * `applyCuts` 会把阈值写进 settings，之后全库共用。
   */
  async apply(
    actor: User,
    options?: { bankId?: number; keepManual?: boolean; keepCalibrated?: boolean; dryRun?: boolean },
  ): Promise<DifficultyApplyResult> {
    const bankId = options?.bankId;
    const batch = await scoreBatch(this.questions, bankId, options ?? {});
    // 阈值：整库用全库分位数；单题库也用全库阈值（保证跨题库可比），全库没算过就退回默认
    const globalScores = bankId === undefined ? batch.items.map((i) => i.score) : await this.allScores();
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
    const updated = await this.questions.setDifficulty(items);
    if (bankId === undefined) await this.settings.set(CUTS_KEY, JSON.stringify(cuts));
    await this.audit.write({
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
      buckets: (await this.questions.difficultyStats(bankId, cuts)).buckets,
    };
  }

  /**
   * 用真实作答数据校准难度。
   *
   * 数据来源：`attempts.answers`（JSON，逐题作答与是否正确）+ `wrong_questions`（错题本）。
   * 样本量不足（默认 < 5 次作答）的题不校准，保持先验分；
   * 校准过的题标 `calibrated`（之后的「重算先验」不会把它冲掉）。
   *
   * 批量策略：候选按 `chunkSize`（默认 500）分块，每块**一次**取回全部先验分
   * （`difficultyScoresByIds` 内部再按 500 个 id 拆 `IN`），在内存里算完；
   * 块与块之间让出事件循环。落库仍是一次 `setDifficulty`（一个事务 + 临时表批量 UPDATE）。
   * 迁移前这里是「逐题 `difficultyScoreOf` + 最后统一写」，39.6 万题在 PG 上就是
   * 几十万次小查询；除查询次数外，返回结构、样例顺序与 dry-run 语义都不变。
   */
  async calibrate(
    actor: User,
    options?: { minSamples?: number; k?: number; dryRun?: boolean; chunkSize?: number },
  ): Promise<{
    candidates: number;
    calibrated: number;
    minSamples: number;
    k: number;
    dryRun: boolean;
    samples: CalibrationSample[];
  }> {
    const minSamples = Math.max(1, options?.minSamples ?? 5);
    const k = Math.max(1, options?.k ?? 20);
    const dryRun = options?.dryRun !== false;
    const chunkSize = Math.max(1, options?.chunkSize ?? CALIBRATE_CHUNK);
    const stats = await this.answerStats();
    const candidates = [...stats.values()].filter((s) => s.total >= minSamples);
    const cuts = this.cuts();
    const items: CalibrationItem[] = [];
    const samples: CalibrationSample[] = [];
    for (let start = 0; start < candidates.length; start += chunkSize) {
      const chunk = candidates.slice(start, start + chunkSize);
      // 一次取回本块先验分；缺失（题已删除）由 planCalibration 跳过，与原逐题实现一致
      const priors = await this.questions.difficultyScoresByIds(chunk.map((s) => s.id));
      const plan = planCalibration(chunk, priors, cuts, { k, sampleLimit: CALIBRATE_SAMPLES - samples.length });
      items.push(...plan.items);
      samples.push(...plan.samples);
      if (start + chunkSize < candidates.length) await yieldToEventLoop();
    }
    if (!dryRun && items.length > 0) {
      await this.questions.setDifficulty(items);
      await this.audit.write({
        actorId: actor.id,
        actorName: actor.username,
        action: 'question.difficulty.calibrate',
        targetType: 'question',
        detail: { calibrated: items.length, minSamples, k },
      });
    }
    return { candidates: candidates.length, calibrated: items.length, minSamples, k, dryRun, samples };
  }

  /* ---------------- 内部小工具（全部走 AsyncDb，调用方已 await） ---------------- */

  private async bankName(bankId: number): Promise<string> {
    const row = (await this.questions.difficultyFeatures({ bankId, limit: 1 }))[0];
    if (!row) throw AppError.notFound('题库不存在或没有题目');
    return row.bank_name;
  }

  private async stemOf(ids: number[]): Promise<{ id: number; stem: string; bank_name: string }[]> {
    return ids.length === 0 ? [] : this.questions.stemsByIds(ids);
  }

  private async allScores(): Promise<number[]> {
    return this.questions.allDifficultyScores();
  }

  /** 每题作答统计：从 attempts.answers 与错题本里汇总 */
  private async answerStats(): Promise<Map<number, { id: number; total: number; correct: number }>> {
    return this.questions.answerStats();
  }
}

/** 兼容旧引用：空位数判定随打分一起搬到了 difficultyScoring */
export { countBlanks } from './difficultyScoring.js';
