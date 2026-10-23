/**
 * 题库与题目路由入口：只保留 `registerBankRoutes` 编排（签名与注册方式不变，
 * `routes/index.ts` 的调用方式无需改动），handler 按资源/动作拆到同目录模块：
 *
 * - `banks-crud`          题库列表（筛选/分页）、题库 CRUD、整卷题库一键建考试
 * - `banks-catalog`       题库目录树、按册次挂课程、回填课程归属
 * - `banks-health`        题库体检、库内去重、批量设置难度、重算题量
 * - `banks-questions`     跨库检索、题库内题目列表/新建、单题读写、批量删除
 * - `banks-question-media` 单题配图上传/访问、题干内联图（内容寻址）上传/读取
 * - `banks-import-export` CSV / Markdown / Word 导出与模板、文件导入、批量导入
 * - `banks-shared`        共用的请求体 schema 与路径参数提取
 *
 * 纯逻辑（查询参数解析 / 导入清单校验）在 `routes/bankQuery.ts`、`domain/bankImport.ts`，
 * 可单测；路由层不再出现长段参数校验。所有路由路径、方法、请求体 schema、
 * 返回结构均与拆分前一致，路由清单由 `test/bank-routes.test.ts` 用 `app.hasRoute` 守护。
 */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.js';
import { registerBankCatalogRoutes } from './banks-catalog.js';
import { registerBankCrudRoutes } from './banks-crud.js';
import { registerBankHealthRoutes } from './banks-health.js';
import { registerBankImportExportRoutes } from './banks-import-export.js';
import { registerBankQuestionMediaRoutes } from './banks-question-media.js';
import { registerBankQuestionRoutes } from './banks-questions.js';

export async function registerBankRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  await registerBankCrudRoutes(app, deps);
  await registerBankCatalogRoutes(app, deps);
  await registerBankHealthRoutes(app, deps);
  await registerBankQuestionRoutes(app, deps);
  await registerBankQuestionMediaRoutes(app, deps);
  await registerBankImportExportRoutes(app, deps);
}
