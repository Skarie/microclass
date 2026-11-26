/**
 * 题目（questions）仓储。
 * options 以 JSON 字符串入库，answer 编码见 domain/question.ts。
 *
 * 本文件只保留 `QuestionRepository` 门面与薄委托，领域模块：
 * - question-query.ts        题库内列表/分页/计数、按 id 取题、跨题库检索
 * - question-write.ts        新增/编辑/删除/批量导入、题库题量维护
 * - question-stats.ts        体检计数、元数据覆盖率、知识点聚合、难度分布
 * - question-difficulty.ts   难度特征/分数/作答统计/落库/人工标注
 * - question-dedupe.ts       重复题分组、题库内去重、全量重算指纹
 * - question-maintenance.ts  预计算列/指纹回填、题库题量修复
 *
 * 对外方法签名、SQL 语义与返回结构保持不变；类型从原路径 re-export，
 * 服务层 / 运维脚本 / 测试无需改动。
 *
 * P0 阶段 2（questions 读批次，2026-11-27）：**读写全部走 `AsyncDb`**，
 * 19 个读方法改为 `async`。`app.ts` 必须注入 `asyncDb`（`new QuestionRepository(db, asyncDb)`）——
 * 只注 DI 不改读方法会变成「写 PG、读 SQLite」，只改读方法不注 DI 会变成「写 SQLite、读 PG」，
 * 两者都必须在同一批里改（见 `docs/pg-migration-progress.md` §7.7）。
 */
import type { Question } from '@microclass/shared';
import type { Db } from '../client.js';
import { createSqliteAsyncDb, type AsyncDb } from '../async.js';
import * as dedupe from './question-dedupe.js';
import type { DuplicateGroupRow, DuplicateIdGroup } from './question-dedupe.js';
import * as difficultyRepo from './question-difficulty.js';
import * as maintenance from './question-maintenance.js';
import * as query from './question-query.js';
import * as stats from './question-stats.js';
import * as write from './question-write.js';
import type {
  AnswerStat,
  DifficultyFeatureOptions,
  DifficultyFeatureRow,
  DifficultyScoreRow,
  DifficultyStats as DifficultyStatsResult,
  DifficultyStatsCuts,
  DifficultyUpdateItem,
  PointStatRow,
  PointStatsOptions,
  QuestionFilter,
  QuestionHealth,
  QuestionInput,
  QuestionPage,
  QuestionStemRow,
  QuestionWithBankName,
  SearchMetaOptions,
} from './question-types.js';

export type * from './question-types.js';
export type { DuplicateGroupRow, DuplicateIdGroup } from './question-dedupe.js';

export class QuestionRepository {
  /**
   * 读写都走 asyncDb（P0 阶段 2，questions 读批次）；`db` 只在没注入 asyncDb 时兜底（测试）。
   * PG 模式下 `db` 可以是 `null` —— 体检子进程不再打开只读 SQLite（见 `workers/bankHealthChild`）。
   */
  constructor(
    private readonly db: Db | null,
    private readonly asyncDb?: AsyncDb,
  ) {}

  private adb(): AsyncDb {
    if (this.asyncDb) return this.asyncDb;
    if (!this.db) throw new Error('QuestionRepository 未注入 AsyncDb（PG 模式不允许退回 SQLite）');
    return createSqliteAsyncDb(this.db);
  }

  async listByBank(bankId: number, filter?: QuestionFilter, page?: QuestionPage): Promise<Question[]> {
    return query.listByBank(this.adb(), bankId, filter, page);
  }

  async countByBank(bankId: number, filter?: QuestionFilter): Promise<number> {
    return query.countByBank(this.adb(), bankId, filter);
  }

  /** 跨题库列表（高级检索：按标签 / 知识点 / 关键词找题） */
  async listAll(filter: QuestionFilter | undefined, page: QuestionPage): Promise<Question[]> {
    return query.listAll(this.adb(), filter, page);
  }

  async countAll(filter?: QuestionFilter): Promise<number> {
    return query.countAll(this.adb(), filter);
  }

  async findById(id: number): Promise<Question | undefined> {
    return query.findById(this.adb(), id);
  }

  async findByIds(ids: number[]): Promise<Question[]> {
    return query.findByIds(this.adb(), ids);
  }

  async listByLesson(lessonId: number): Promise<Question[]> {
    return query.listByLesson(this.adb(), lessonId);
  }

  async create(input: QuestionInput): Promise<number> {
    return write.createQuestion(this.adb(), input);
  }

  async update(id: number, input: QuestionInput): Promise<void> {
    return write.updateQuestion(this.adb(), id, input);
  }

  /** 批量改题库内题目的章节/小节（只影响该题库，返回更新条数） */
  async setSections(bankId: number, ids: number[], patch: { chapter?: string; section?: string }): Promise<number> {
    return write.setQuestionsSections(this.adb(), bankId, ids, patch);
  }

  /** 只更新标准化元数据（回填历史数据用，不动题面与答案） */
  async setMetadata(
    id: number,
    meta: Pick<QuestionInput, 'subject' | 'stage' | 'book' | 'chapter' | 'point' | 'sourcePath' | 'contentHash'>,
  ): Promise<void> {
    return write.setQuestionMetadata(this.adb(), id, meta);
  }

  /* ---------------- 难度模型（迁移 0016） ---------------- */

  /** 取一批题的难度判定特征（分页，只读判定需要的列） */
  async difficultyFeatures(options: DifficultyFeatureOptions = {}): Promise<DifficultyFeatureRow[]> {
    return difficultyRepo.difficultyFeatures(this.adb(), options);
  }

  async stemsByIds(ids: number[]): Promise<QuestionStemRow[]> {
    return query.stemsByIds(this.adb(), ids);
  }

  async allDifficultyScores(): Promise<number[]> {
    return difficultyRepo.allDifficultyScores(this.adb());
  }

  async difficultyScoreOf(id: number): Promise<DifficultyScoreRow | undefined> {
    return difficultyRepo.difficultyScoreOf(this.adb(), id);
  }

  async answerStats(): Promise<Map<number, AnswerStat>> {
    return difficultyRepo.answerStats(this.adb());
  }

  async setDifficulty(items: DifficultyUpdateItem[]): Promise<number> {
    return difficultyRepo.setDifficulty(this.adb(), items);
  }

  /** 单题难度（老师手动指定，来源 manual） */
  async setManualDifficulty(id: number, difficulty: string, score: number): Promise<void> {
    return difficultyRepo.setManualDifficulty(this.adb(), id, difficulty, score);
  }

  /** 难度分布与来源统计（体检 / 重算预览用） */
  async difficultyStats(bankId: number | undefined, cuts: DifficultyStatsCuts): Promise<DifficultyStatsResult> {
    return stats.difficultyStats(this.adb(), bankId, cuts);
  }

  async setImage(id: number, imagePath: string): Promise<void> {
    return write.setQuestionImage(this.adb(), id, imagePath);
  }

  async delete(id: number): Promise<void> {
    return write.deleteQuestion(this.adb(), id);
  }

  /** 批量插入（CSV 导入），返回写入条数 */
  async insertMany(inputs: QuestionInput[]): Promise<number> {
    return write.insertManyQuestions(this.adb(), inputs);
  }

  /* ---------------- 体检 / 统计 / 检索 ---------------- */

  async health(bankId?: number): Promise<QuestionHealth> {
    return stats.questionHealth(this.adb(), bankId);
  }

  async countByMeta(
    bankId: number | undefined,
    column: 'subject' | 'book' | 'point' | 'content_hash',
    knownTotal?: number,
  ): Promise<number> {
    return stats.countByMeta(this.adb(), bankId, column, knownTotal);
  }

  async backfillAnalysisMediaOnly(batchSize = 2000): Promise<number> {
    return maintenance.backfillAnalysisMediaOnly(this.adb(), batchSize);
  }

  async backfillHasImage(batchSize = 5000): Promise<number> {
    return maintenance.backfillHasImage(this.adb(), batchSize);
  }

  async rehashContentHash(batchSize = 2000, onProgress?: (done: number, total: number) => void): Promise<number> {
    return dedupe.rehashContentHash(this.adb(), batchSize, onProgress);
  }

  async countMissingContentHash(): Promise<number> {
    return maintenance.countMissingContentHash(this.adb());
  }

  async backfillContentHash(batchSize = 2000): Promise<number> {
    return maintenance.backfillContentHash(this.adb(), batchSize);
  }

  async searchByMeta(options: SearchMetaOptions): Promise<QuestionWithBankName[]> {
    return query.searchByMeta(this.adb(), options);
  }

  async pointStats(options: PointStatsOptions): Promise<PointStatRow[]> {
    return stats.pointStats(this.adb(), options);
  }

  async duplicateGroups(limit: number, bankId?: number): Promise<DuplicateGroupRow[]> {
    return dedupe.duplicateGroups(this.adb(), limit, bankId);
  }

  async duplicateIdsInBank(bankId: number, limit = 5000): Promise<DuplicateIdGroup[]> {
    return dedupe.duplicateIdsInBank(this.adb(), bankId, limit);
  }

  async deleteMany(ids: number[]): Promise<number> {
    return write.deleteManyQuestions(this.adb(), ids);
  }

  async fixBankQuestionCounts(): Promise<number> {
    return maintenance.fixBankQuestionCounts(this.adb());
  }
}
