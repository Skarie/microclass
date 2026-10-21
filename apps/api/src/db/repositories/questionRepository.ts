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
 */
import type { Question } from '@microclass/shared';
import type { Db } from '../client.js';
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
  constructor(private readonly db: Db) {}

  listByBank(bankId: number, filter?: QuestionFilter, page?: QuestionPage): Question[] {
    return query.listByBank(this.db, bankId, filter, page);
  }

  countByBank(bankId: number, filter?: QuestionFilter): number {
    return query.countByBank(this.db, bankId, filter);
  }

  findById(id: number): Question | undefined {
    return query.findById(this.db, id);
  }

  findByIds(ids: number[]): Question[] {
    return query.findByIds(this.db, ids);
  }

  listByLesson(lessonId: number): Question[] {
    return query.listByLesson(this.db, lessonId);
  }

  create(input: QuestionInput): number {
    return write.createQuestion(this.db, input);
  }

  update(id: number, input: QuestionInput): void {
    write.updateQuestion(this.db, id, input);
  }

  /** 只更新标准化元数据（回填历史数据用，不动题面与答案） */
  setMetadata(
    id: number,
    meta: Pick<QuestionInput, 'subject' | 'stage' | 'book' | 'chapter' | 'point' | 'sourcePath' | 'contentHash'>,
  ): void {
    write.setQuestionMetadata(this.db, id, meta);
  }

  /* ---------------- 难度模型（迁移 0016） ---------------- */

  /** 取一批题的难度判定特征（分页，只读判定需要的列） */
  difficultyFeatures(options: DifficultyFeatureOptions = {}): DifficultyFeatureRow[] {
    return difficultyRepo.difficultyFeatures(this.db, options);
  }

  stemsByIds(ids: number[]): QuestionStemRow[] {
    return query.stemsByIds(this.db, ids);
  }

  allDifficultyScores(): number[] {
    return difficultyRepo.allDifficultyScores(this.db);
  }

  difficultyScoreOf(id: number): DifficultyScoreRow | undefined {
    return difficultyRepo.difficultyScoreOf(this.db, id);
  }

  answerStats(): Map<number, AnswerStat> {
    return difficultyRepo.answerStats(this.db);
  }

  setDifficulty(items: DifficultyUpdateItem[]): number {
    return difficultyRepo.setDifficulty(this.db, items);
  }

  /** 单题难度（老师手动指定，来源 manual） */
  setManualDifficulty(id: number, difficulty: string, score: number): void {
    difficultyRepo.setManualDifficulty(this.db, id, difficulty, score);
  }

  /** 难度分布与来源统计（体检 / 重算预览用） */
  difficultyStats(bankId: number | undefined, cuts: DifficultyStatsCuts): DifficultyStatsResult {
    return stats.difficultyStats(this.db, bankId, cuts);
  }

  setImage(id: number, imagePath: string): void {
    write.setQuestionImage(this.db, id, imagePath);
  }

  delete(id: number): void {
    write.deleteQuestion(this.db, id);
  }

  /** 批量插入（CSV 导入），返回写入条数 */
  insertMany(inputs: QuestionInput[]): number {
    return write.insertManyQuestions(this.db, inputs);
  }

  /* ---------------- 体检 / 统计 / 检索 ---------------- */

  health(bankId?: number): QuestionHealth {
    return stats.questionHealth(this.db, bankId);
  }

  countByMeta(
    bankId: number | undefined,
    column: 'subject' | 'book' | 'point' | 'content_hash',
    knownTotal?: number,
  ): number {
    return stats.countByMeta(this.db, bankId, column, knownTotal);
  }

  backfillAnalysisMediaOnly(batchSize = 2000): number {
    return maintenance.backfillAnalysisMediaOnly(this.db, batchSize);
  }

  backfillHasImage(batchSize = 5000): number {
    return maintenance.backfillHasImage(this.db, batchSize);
  }

  rehashContentHash(batchSize = 2000, onProgress?: (done: number, total: number) => void): number {
    return dedupe.rehashContentHash(this.db, batchSize, onProgress);
  }

  countMissingContentHash(): number {
    return maintenance.countMissingContentHash(this.db);
  }

  backfillContentHash(batchSize = 2000): number {
    return maintenance.backfillContentHash(this.db, batchSize);
  }

  searchByMeta(options: SearchMetaOptions): QuestionWithBankName[] {
    return query.searchByMeta(this.db, options);
  }

  pointStats(options: PointStatsOptions): PointStatRow[] {
    return stats.pointStats(this.db, options);
  }

  duplicateGroups(limit: number, bankId?: number): DuplicateGroupRow[] {
    return dedupe.duplicateGroups(this.db, limit, bankId);
  }

  duplicateIdsInBank(bankId: number, limit = 5000): DuplicateIdGroup[] {
    return dedupe.duplicateIdsInBank(this.db, bankId, limit);
  }

  deleteMany(ids: number[]): number {
    return write.deleteManyQuestions(this.db, ids);
  }

  fixBankQuestionCounts(): number {
    return maintenance.fixBankQuestionCounts(this.db);
  }
}
