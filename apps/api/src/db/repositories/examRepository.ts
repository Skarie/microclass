/**
 * 考试（exams / exam_questions / exam_attempts）仓储。
 *
 * 本文件只保留 `ExamRepository` 门面与薄委托，领域模块：
 * - exam-crud.ts       考试增删改查、列表统计（题量/参与人数/我的最近成绩）
 * - exam-questions.ts  卷内题目（listQuestions / add / remove / reorder / 换题 / 大题分值 / 组卷落库）
 * - exam-pool-filter.ts 挑题条件构造（纯函数）与分页收敛
 * - exam-pool.ts       挑题/计数/取 id、课程候选池、跨题库检索
 * - exam-stats.ts      细目表「知识点 × 题型 × 难度」、知识点聚合统计
 * - exam-facets.ts     选题树（册次 → 章节）与知识点懒加载
 * - exam-attempts.ts   作答次数、交卷落库、成绩单、个人成绩
 *
 * SQL 文本、排序与返回结构保持不变；类型从原路径 re-export。
 *
 * ## P0 阶段 2（exams/attempts 批次 2：写 + 交卷）
 *
 * - **读写一体**：所有方法（含 create/update/delete/setStructure、卷内加删改/排序/换题、
 *   组卷落库、交卷落库）统一注入 `AsyncDb` 并返回 Promise；单测只注入 `Db` 时退回
 *   sqlite 包装（行为等价）。
 * - **自增**：`create` / `createAttempt` 改 `INSERT … RETURNING id`，不再用 `lastInsertRowid`。
 * - **事务**：组卷 `applyComposition`（清空 + 加题 + 逐题分值）与考试交卷 `recordAttempt`
 *   用 `AsyncDb.transaction(async tx)`；审计由服务层在事务提交后写。
 * - 批次 1 留下的 `findByIdSync` / `questionInExamSync` 已删除：写路径读旧值统一 `await`。
 */
import type { Exam } from '@microclass/shared';
import { createSqliteAsyncDb, type AsyncDb } from '../async.js';
import type { Db } from '../client.js';
import * as attempts from './exam-attempts.js';
import type { AttemptWithExam, AttemptWithStudent } from './exam-attempts.js';
import * as crud from './exam-crud.js';
import * as facetsRepo from './exam-facets.js';
import type { FacetsOptions, FacetsResult, PointRow, PointsOfOptions } from './exam-facets.js';
import * as pool from './exam-pool.js';
import type { PickRow, SearchOptions } from './exam-pool.js';
import type { PickOptions } from './exam-pool-filter.js';
import * as questions from './exam-questions.js';
import type { CompositionInput } from './exam-questions.js';
import * as stats from './exam-stats.js';
import type { PointStatsOptions, PointStatsRow, TaxonomyOptions, TaxonomyPoint } from './exam-stats.js';
import type {
  AttemptInput,
  ExamAttempt,
  ExamInput,
  ExamQuestionMeta,
  ExamQuestionRow,
  ExamWithStats,
  PoolBudgetQuestion,
  PoolQuestion,
} from './exam-types.js';

export type * from './exam-types.js';
export type { AttemptWithExam, AttemptWithStudent } from './exam-attempts.js';
export type { CompositionInput } from './exam-questions.js';

export class ExamRepository {
  constructor(
    private readonly db: Db,
    private readonly asyncDb?: AsyncDb,
  ) {}

  /** 所有读写方法统一走异步端口；单测只注入 `Db` 时退回 sqlite 包装（行为等价） */
  private adb(): AsyncDb {
    return this.asyncDb ?? createSqliteAsyncDb(this.db);
  }

  /* ---------------- 考试主体 ---------------- */

  async listByCourse(courseId: number): Promise<Exam[]> {
    return crud.listByCourse(this.adb(), courseId);
  }

  /** 考试列表（含题量、参与人数与我的最近成绩） */
  async listByCourseWithStats(
    courseId: number,
    viewerId: number | null,
  ): Promise<(ExamWithStats & { my: ExamAttempt | null })[]> {
    return crud.listByCourseWithStats(this.adb(), courseId, viewerId);
  }

  async findById(id: number): Promise<Exam | undefined> {
    return crud.findById(this.adb(), id);
  }

  async create(input: ExamInput): Promise<number> {
    return crud.create(this.adb(), input);
  }

  async update(id: number, input: ExamInput): Promise<void> {
    return crud.update(this.adb(), id, input);
  }

  /** 只更新试卷结构/目标配比（组卷工作台里改大题、分值） */
  async setStructure(id: number, structure: string, difficultyTarget?: string, totalScore?: number): Promise<void> {
    return crud.setStructure(this.adb(), id, structure, difficultyTarget, totalScore);
  }

  async delete(id: number): Promise<void> {
    return crud.remove(this.adb(), id);
  }

  /* ---------------- 组卷 / 卷内题目 ---------------- */

  /** 已选入试卷的题目（按卷内顺序，含大题与分值） */
  async listQuestions(examId: number): Promise<ExamQuestionRow[]> {
    return questions.listQuestions(this.adb(), examId);
  }

  /** 单个题目的卷内配置（换题/改分值用） */
  async questionInExam(examId: number, questionId: number): Promise<ExamQuestionMeta | undefined> {
    return questions.questionInExam(this.adb(), examId, questionId);
  }

  /** 改某题的分值 / 大题分组 */
  async setQuestionMeta(examId: number, questionId: number, meta: { score?: number; section?: string }): Promise<void> {
    return questions.setQuestionMeta(this.adb(), examId, questionId, meta);
  }

  /** 重排卷内顺序（传完整 id 顺序） */
  async reorder(examId: number, questionIds: number[]): Promise<void> {
    return questions.reorder(this.adb(), examId, questionIds);
  }

  /** 用另一道题替换卷内某题（保持位置/分值/大题） */
  async replaceQuestion(examId: number, oldQuestionId: number, newQuestionId: number): Promise<void> {
    return questions.replaceQuestion(this.adb(), examId, oldQuestionId, newQuestionId);
  }

  /** 批量加题；已在卷内的自动跳过，返回实际新增数 */
  async addQuestions(examId: number, questionIds: number[]): Promise<number> {
    return questions.addQuestions(this.adb(), examId, questionIds);
  }

  /** 组卷原子落库：清空（可选）+ 加题 + 逐题分值/大题，同一事务 */
  async applyComposition(examId: number, input: CompositionInput): Promise<number> {
    return questions.applyComposition(this.adb(), examId, input);
  }

  async removeQuestion(examId: number, questionId: number): Promise<void> {
    return questions.removeQuestion(this.adb(), examId, questionId);
  }

  /** 把某题型的所有题统一刷成「大题名 + 每题分值」（组卷按题型生成大题用） */
  async applySection(examId: number, type: string, sectionName: string, score: number): Promise<number> {
    return questions.applySection(this.adb(), examId, type, sectionName, score);
  }

  /** 清空卷内题目（智能组卷「重新生成」用） */
  async clearQuestions(examId: number): Promise<number> {
    return questions.clearQuestions(this.adb(), examId);
  }

  async questionIds(examId: number): Promise<number[]> {
    return questions.questionIds(this.adb(), examId);
  }

  /* ---------------- 题池 / 统计 ---------------- */

  /** 挑题（组卷/选题的核心查询） */
  async pick(options: PickOptions): Promise<PickRow[]> {
    return pool.pick(this.adb(), options);
  }

  /** 细目表参考数据：「知识点 × 题型 × 难度」各有多少题 */
  async taxonomy(options: TaxonomyOptions): Promise<TaxonomyPoint[]> {
    return stats.taxonomy(this.adb(), options);
  }

  /** 选题树数据（册次 → 章节，带题量） */
  async facets(options: FacetsOptions): Promise<FacetsResult> {
    return facetsRepo.facets(this.adb(), options);
  }

  /** 知识点清单 + 题量（知识点树懒加载 / 搜索用） */
  async pointsOf(options: PointsOfOptions): Promise<PointRow[]> {
    return facetsRepo.pointsOf(this.adb(), options);
  }

  /** 符合筛选条件的全部题目 id（「全选筛选结果」用）；有上限保护 */
  async pickIds(options: PickOptions & { cap?: number }): Promise<number[]> {
    return pool.pickIds(this.adb(), options);
  }

  /** 挑题总数（分页用；条件与 `pick` 完全一致） */
  async pickCount(options: PickOptions): Promise<number> {
    return pool.pickCount(this.adb(), options);
  }

  /** 课程范围内的候选题目（课时直属题目或课时所属题库的题目） */
  async pool(courseId: number): Promise<PoolBudgetQuestion[]> {
    return pool.pool(this.adb(), courseId);
  }

  /** 全库候选题（跨题库）——按知识点 / 书册 / 难度筛题用 */
  async search(options: SearchOptions): Promise<PoolQuestion[]> {
    return pool.search(this.adb(), options);
  }

  /** 按知识点聚合的题目统计（一个知识点有多少题、难度分布、来自几个题库） */
  async pointStats(options: PointStatsOptions): Promise<PointStatsRow[]> {
    return stats.pointStats(this.adb(), options);
  }

  /* ---------------- 作答与成绩 ---------------- */

  /** 该学员在这场考试上的作答次数（学习通式"允许作答次数"要用） */
  async attemptCount(examId: number, userId: number): Promise<number> {
    return attempts.attemptCount(this.adb(), examId, userId);
  }

  async findAttempt(examId: number, userId: number): Promise<ExamAttempt | undefined> {
    return attempts.findAttempt(this.adb(), examId, userId);
  }

  /**
   * 交卷落库（考试）。用**单事务**包住：判分是纯内存计算，落库只有这一条语句，
   * 事务边界显式化是为了「审计只在提交成功后写」——回滚时不能留下「已交卷」审计。
   */
  async recordAttempt(input: AttemptInput): Promise<number> {
    return this.adb().transaction((tx) => attempts.createAttempt(tx, input));
  }

  /** 成绩单：某场考试的全部作答（含学生信息与统计） */
  async attemptsOf(examId: number): Promise<AttemptWithStudent[]> {
    return attempts.attemptsOf(this.adb(), examId);
  }

  /** 我的所有考试成绩（个人中心用） */
  async attemptsByUser(userId: number): Promise<AttemptWithExam[]> {
    return attempts.attemptsByUser(this.adb(), userId);
  }
}
