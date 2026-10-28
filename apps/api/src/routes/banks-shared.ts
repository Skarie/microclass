/**
 * 题库 / 题目路由共用的请求体 schema 与路径参数提取（拆分后集中一处，避免各模块各写一份）。
 *
 * 字段、必填项、枚举与边界值都保持拆分前 `routes/banks.ts` 的原样：
 * 这些 schema 是 Fastify 的 JSON Schema 校验入口，并且应用开着
 * `additionalProperties: false` + `removeAdditional` —— **漏声明的字段会被静默丢掉**，
 * 所以下面每个字段（尤其 difficulty / 学科元数据）都不能随手删。
 */
import type { FastifyRequest } from 'fastify';

/** 新建 / 编辑题库的请求体 */
export const bankBodySchema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    lessonId: { type: ['integer', 'null'] },
    // 标准化元数据：新建题目会继承题库的学科/书册，难度模型据此判断学段基准
    kind: { type: 'string', enum: ['lesson', 'chapter', 'paper', ''] },
    subject: { type: 'string', maxLength: 40 },
    book: { type: 'string', maxLength: 80 },
    /**
     * 章节（迁移 0023）：服务端 trim 并截断到 120 字（超长不报错，按 120 存）。
     * 这里不设 maxLength，避免入口就 400、让「自动截断」永远走不到。
     */
    section: { type: 'string' },
    /** 归属课程（目录树/组卷题池用）；`null` = 移出课程 */
    courseId: { type: ['integer', 'null'] },
    /** 归属文件夹（迁移 0024）；`null` = 移到未分类，不传 = 不变 */
    folderId: { type: ['integer', 'null'] },
  },
  additionalProperties: false,
} as const;

/** 新建 / 编辑题目的请求体 */
export const questionBodySchema = {
  type: 'object',
  required: ['bankId', 'type', 'stem'],
  properties: {
    bankId: { type: 'integer' },
    lessonId: { type: ['integer', 'null'] },
    type: { type: 'string', enum: ['single', 'multiple', 'judge', 'fill', 'short'] },
    stem: { type: 'string', minLength: 1, maxLength: 4000 },
    options: { type: 'array', items: { type: 'string', maxLength: 1000 }, maxItems: 26 },
    answer: { type: 'string', maxLength: 2000 },
    analysis: { type: 'string', maxLength: 4000 },
    sort: { type: 'integer' },
    imagePath: { type: 'string', maxLength: 300 },
    /**
     * 难度：easy / medium / hard（空串 = 不指定，交给难度模型）。
     * 这个字段以前**漏在 schema 里**，而 schema 是 `additionalProperties: false`
     * + `removeAdditional`，于是老师从界面提交的难度被静默丢掉 —— 这就是「有难度下拉框但
     * 题目难度一直没被划分」的原因。
     */
    difficulty: { type: 'string', enum: ['', 'easy', 'medium', 'hard'] },
    /**
     * 标准化元数据（学科 / 学段 / 册次 / 章节 / 知识点）。
     * 和上面 difficulty 是**同一类坑**：schema 是 additionalProperties:false + removeAdditional，
     * 漏声明就会被静默丢掉 —— 而"按章节/知识点组卷"完全依赖这几个字段，
     * 丢了以后老师在组卷页勾章节永远是空结果。`QuestionDto` 一直都支持它们，是 schema 漏了。
     */
    subject: { type: 'string', maxLength: 40 },
    stage: { type: 'string', maxLength: 20 },
    book: { type: 'string', maxLength: 80 },
    chapter: { type: 'string', maxLength: 120 },
    point: { type: 'string', maxLength: 120 },
  },
  additionalProperties: false,
} as const;

/** 批量操作的 body：ids 上限 500（一次多选一页以内的量级） */
export const bulkIdsSchema = {
  type: 'object',
  required: ['ids'],
  properties: {
    ids: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'integer' } },
  },
  additionalProperties: false,
} as const;

/** 批量设置难度的 body */
export const bulkDifficultySchema = {
  type: 'object',
  required: ['ids', 'difficulty'],
  properties: {
    ids: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'integer' } },
    difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
  },
  additionalProperties: false,
} as const;

/** 按册次批量挂课程（未归属题库的批量归类） */
export const bindByBookBodySchema = {
  type: 'object',
  required: ['book'],
  properties: {
    book: { type: 'string', minLength: 1, maxLength: 120 },
    courseId: { type: ['integer', 'null'] },
  },
  additionalProperties: false,
} as const;

/** `/banks/:id` 的题库 id（拆分前每个 handler 都重复写一遍） */
export function bankIdOf(req: FastifyRequest): number {
  return Number((req.params as { id: string }).id);
}

/** `/questions/:id` 的题目 id */
export function questionIdOf(req: FastifyRequest): number {
  return Number((req.params as { id: string }).id);
}
