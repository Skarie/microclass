/**
 * 考试路由共用的请求体 schema 与参数提取（拆分后集中一处，避免各模块各写一份）。
 *
 * 字段、必填项、枚举与边界值都保持拆分前 `routes/exams.ts` 的原样：
 * 老师端的「新建/编辑考试」与学员端的「交卷」走同一套 Fastify JSON Schema 校验。
 */
import type { FastifyRequest } from 'fastify';

/** 新建/编辑考试的请求体 */
export const examBodySchema = {
  type: 'object',
  required: ['courseId', 'title'],
  properties: {
    courseId: { type: 'integer' },
    title: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', maxLength: 4000 },
    durationMinutes: { type: 'integer', minimum: 1, maximum: 600 },
    passScore: { type: 'integer', minimum: 0, maximum: 100 },
    status: { type: 'string', enum: ['draft', 'published'] },
    // 考试设置（对标学习通）
    startAt: { type: 'integer', minimum: 0 },
    endAt: { type: 'integer', minimum: 0 },
    attemptLimit: { type: 'integer', minimum: 0, maximum: 99 },
    shuffleQuestions: { type: 'boolean' },
    showAnswers: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

/** 交卷请求体 */
export const submitSchema = {
  type: 'object',
  required: ['answers'],
  properties: {
    answers: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['qid'],
        properties: {
          qid: { type: 'integer' },
          answer: { type: 'string', maxLength: 4000 },
        },
        additionalProperties: false,
      },
    },
    startedAt: { type: 'integer' },
  },
  additionalProperties: false,
} as const;

/** `/exams/:id` 的考试 id（拆分前每个 handler 都重复写一遍） */
export function examIdOf(req: FastifyRequest): number {
  return Number((req.params as { id: string }).id);
}

/** `/exams/:id/questions/:qid` 的两个 id */
export function examQuestionIdsOf(req: FastifyRequest): { examId: number; questionId: number } {
  const params = req.params as { id: string; qid: string };
  return { examId: Number(params.id), questionId: Number(params.qid) };
}
