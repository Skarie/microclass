/**
 * 考试（exams / exam_questions / exam_attempts）仓储。
 *
 * 本文件只保留 `ExamRepository` 门面与薄委托，领域模块：
 * - exam-crud.ts       考试增删改查、列表统计（题量/参与人数/我的最近成绩）
 * - exam-questions.ts  卷内题目（listQuestions / add / remove / reorder / 换题 / 大题分值）
 * - exam-pool-filter.ts 挑题条件构造（纯函数）与分页收敛
 * - exam-pool.ts       挑题/计数/取 id、课程候选池、跨题库检索
 * - exam-stats.ts      细目表「知识点 × 题型 × 难度」、知识点聚合统计
 * - exam-facets.ts     选题树（册次 → 章节）与知识点懒加载
 * - exam-attempts.ts   作答次数、交卷落库、成绩单、个人成绩
 *
 * SQL 文本、排序与返回结构保持不变；类型从原路径 re-export。
 * 读方法在批次 1 改为 `Promise` 返回，调用方（服务/路由/测试）已同步补 `await`。
 *
 * ## P0 阶段 2（exams/attempts 批次 1：只读方法）
 *
 * - **读方法**（list/findById/paper/pool/facets/stats/成绩查询）统一注入 `AsyncDb`，
 *   返回 Promise；sqlite 下与旧同步实现等价，PG 下走连接池。
 * - **写方法**（create/update/delete/setStructure/卷内加删改/交卷落库）仍是同步 `Db`，
 *   事务边界与 SQL 一律不变 —— 批次 2 再迁，避免把组卷/交卷的写路径混进只读批次。
 * - `adb()` 是唯一的异步入口：测试只注入 `Db` 时退回 sqlite 包装（行为等价），
 *   与 users/courses/lessons/progress 等已迁域同一口径。
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

export class ExamRepository {
  constructor(
    private readonly db: Db,
    private readonly asyncDb?: AsyncDb,
  ) {}

  /** 已迁移的读方法统一走异步端口；单测只注入 `Db` 时退回 sqlite 包装（行为等价） */
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

  create(input: ExamInput): number {
    return crud.create(this.db, input);
  }

  update(id: number, input: ExamInput): void {
    crud.update(this.db, id, input);
  }

  /** 只更新试卷结构/目标配比（组卷工作台里改大题、分值） */
  setStructure(id: number, structure: string, difficultyTarget?: string, totalScore?: number): void {
    crud.setStructure(this.db, id, structure, difficultyTarget, totalScore);
  }

  delete(id: number): void {
    crud.remove(this.db, id);
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
  setQuestionMeta(examId: number, questionId: number, meta: { score?: number; section?: string }): void {
    questions.setQuestionMeta(this.db, examId, questionId, meta);
  }

  /** 重排卷内顺序（传完整 id 顺序） */
  reorder(examId: number, questionIds: number[]): void {
    questions.reorder(this.db, examId, questionIds);
  }

  /** 用另一道题替换卷内某题（保持位置/分值/大题） */
  replaceQuestion(examId: number, oldQuestionId: number, newQuestionId: number): void {
    questions.replaceQuestion(this.db, examId, oldQuestionId, newQuestionId);
  }

  /** 批量加题；已在卷内的自动跳过，返回实际新增数 */
  addQuestions(examId: number, questionIds: number[]): number {
    return questions.addQuestions(this.db, examId, questionIds);
  }

  removeQuestion(examId: number, questionId: number): void {
    questions.removeQuestion(this.db, examId, questionId);
  }

  /** 把某题型的所有题统一刷成「大题名 + 每题分值」（组卷按题型生成大题用） */
  applySection(examId: number, type: string, sectionName: string, score: number): number {
    return questions.applySection(this.db, examId, type, sectionName, score);
  }

  /** 清空卷内题目（智能组卷「重新生成」用） */
  clearQuestions(examId: number): number {
    return questions.clearQuestions(this.db, examId);
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

  createAttempt(input: AttemptInput): number {
    return attempts.createAttempt(this.db, input);
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
