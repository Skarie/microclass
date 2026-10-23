/**
 * 考试中心路由入口：只保留 `registerExamRoutes` 编排（签名与注册方式不变，
 * `routes/index.ts` 的调用方式无需改动），handler 按领域拆到同目录模块：
 *
 * - `exams-crud`     课程考试列表、我的考试成绩、考试增删改查
 * - `exams-paper`    卷面视图、加题/换题/删题/排序、试卷结构、Word 导出
 * - `exams-compose`  随机抽题、按配额/细目表组卷、平行卷、双向细目表
 * - `exams-pool`     题池挑题、选题树、知识点懒加载、细目表参考数据
 * - `exams-attempts` 取卷、交卷、我的成绩、成绩单与 CSV
 * - `exams-shared`   共用的请求体 schema 与路径参数提取
 *
 * 纯逻辑（参数解析 / 题池响应拼装）在 `domain/examRequest`、`domain/examPoolQuery`、
 * `domain/examPoolView`，可单测；路由层不再出现长段参数校验。
 * 所有路由路径、方法、请求体 schema、返回结构均与拆分前一致。
 */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.js';
import { registerExamAttemptRoutes } from './exams-attempts.js';
import { registerExamComposeRoutes } from './exams-compose.js';
import { registerExamCrudRoutes } from './exams-crud.js';
import { registerExamPaperRoutes } from './exams-paper.js';
import { registerExamPoolRoutes } from './exams-pool.js';

export async function registerExamRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  await registerExamCrudRoutes(app, deps);
  await registerExamPaperRoutes(app, deps);
  await registerExamComposeRoutes(app, deps);
  await registerExamPoolRoutes(app, deps);
  await registerExamAttemptRoutes(app, deps);
}
