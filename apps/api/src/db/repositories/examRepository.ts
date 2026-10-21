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
 * 对外方法签名、SQL 语义与返回结构保持不变；类型从原路径 re-export，
 * 服务层 / 路由 / 测试无需改动。
 */
import type { Exam } from '@microclass/shared';
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

export class ExamRepository {
  constructor(private readonly db: Db) {}

  /* ---------------- 考试主体 ---------------- */

  listByCourse(courseId: number): Exam[] {
    return crud.listByCourse(this.db, courseId);
  }

  /** 考试列表（含题量、参与人数与我的最近成绩） */
  listByCourseWithStats(courseId: number, viewerId: number | null): (ExamWithStats & { my: ExamAttempt | null })[] {
    return crud.listByCourseWithStats(this.db, courseId, viewerId);
  }

  findById(id: number): Exam | undefined {
    return crud.findById(this.db, id);
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
  listQuestions(examId: number): ExamQuestionRow[] {
    return questions.listQuestions(this.db, examId);
  }

  /** 单个题目的卷内配置（换题/改分值用） */
  questionInExam(examId: number, questionId: number): ExamQuestionMeta | undefined {
    return questions.questionInExam(this.db, examId, questionId);
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

  questionIds(examId: number): number[] {
    return questions.questionIds(this.db, examId);
  }

  /* ---------------- 题池 / 统计 ---------------- */

  /** 挑题（组卷/选题的核心查询） */
  pick(options: PickOptions): PickRow[] {
    return pool.pick(this.db, options);
  }

  /** 细目表参考数据：「知识点 × 题型 × 难度」各有多少题 */
  taxonomy(options: TaxonomyOptions): TaxonomyPoint[] {
    return stats.taxonomy(this.db, options);
  }

  /** 选题树数据（册次 → 章节，带题量） */
  facets(options: FacetsOptions): FacetsResult {
    return facetsRepo.facets(this.db, options);
  }

  /** 知识点清单 + 题量（知识点树懒加载 / 搜索用） */
  pointsOf(options: PointsOfOptions): PointRow[] {
    return facetsRepo.pointsOf(this.db, options);
  }

  /** 符合筛选条件的全部题目 id（「全选筛选结果」用）；有上限保护 */
  pickIds(options: PickOptions & { cap?: number }): number[] {
    return pool.pickIds(this.db, options);
  }

  /** 挑题总数（分页用；条件与 `pick` 完全一致） */
  pickCount(options: PickOptions): number {
    return pool.pickCount(this.db, options);
  }

  /** 课程范围内的候选题目（课时直属题目或课时所属题库的题目） */
  pool(courseId: number): PoolBudgetQuestion[] {
    return pool.pool(this.db, courseId);
  }

  /** 全库候选题（跨题库）——按知识点 / 书册 / 难度筛题用 */
  search(options: SearchOptions): PoolQuestion[] {
    return pool.search(this.db, options);
  }

  /** 按知识点聚合的题目统计（一个知识点有多少题、难度分布、来自几个题库） */
  pointStats(options: PointStatsOptions): PointStatsRow[] {
    return stats.pointStats(this.db, options);
  }

  /* ---------------- 作答与成绩 ---------------- */

  /** 该学员在这场考试上的作答次数（学习通式"允许作答次数"要用） */
  attemptCount(examId: number, userId: number): number {
    return attempts.attemptCount(this.db, examId, userId);
  }

  findAttempt(examId: number, userId: number): ExamAttempt | undefined {
    return attempts.findAttempt(this.db, examId, userId);
  }

  createAttempt(input: AttemptInput): number {
    return attempts.createAttempt(this.db, input);
  }

  /** 成绩单：某场考试的全部作答（含学生信息与统计） */
  attemptsOf(examId: number): AttemptWithStudent[] {
    return attempts.attemptsOf(this.db, examId);
  }

  /** 我的所有考试成绩（个人中心用） */
  attemptsByUser(userId: number): AttemptWithExam[] {
    return attempts.attemptsByUser(this.db, userId);
  }
}
