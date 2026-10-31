/**
 * 课程级知识点路由：整门课共享（不挂课时）的增删查 + 按课时拆分的批量导入。
 *
 * 批量导入 `multipart` 字段名 `file`，可传 `.zip`（md + images 目录结构）或多个 `.md`；
 * `?dryRun=1` 只解析并返回预览（不写库、不落图片），正式导入返回同样结构 + imported。
 */
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { AppError } from '@microclass/shared';
import { requireTeacherOrAdmin, requireUser } from '../http/guards.js';
import type { Deps } from '../app.js';
import {
  cleanupKnowledgeImport,
  collectKnowledgeImportUpload,
  MAX_IMPORT_BYTES,
} from '../services/knowledgeImportUpload.js';
import type { CourseKnowledgeInput } from '../services/courseKnowledgeService.js';

export async function registerCourseKnowledgeRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /** 课程级知识点列表（学生也能读，用于课时观看页的共享知识点） */
  app.get('/courses/:id/knowledge', async (req, reply) => {
    requireUser(req, reply);
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) throw AppError.badRequest('课程 ID 非法');
    return { knowledge: deps.courseKnowledgeService.list(id) };
  });

  /** 新建课程级知识点（附件类暂不支持，返回 400 说明） */
  app.post('/courses/:id/knowledge', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) throw AppError.badRequest('课程 ID 非法');
    const body = req.body as CourseKnowledgeInput;
    const knowledgeId = deps.courseKnowledgeService.add(user, id, body);
    return reply.code(201).send({ ok: true, id: knowledgeId });
  });

  /**
   * 批量导入知识点（按课时拆分）。
   * dryRun=1 只解析 + 预览；正式导入写库并落图片。
   * 体积上限 200MB，zip 流式落临时文件后逐条读取，不会整体进内存。
   */
  app.post(
    '/courses/:id/knowledge/import',
    {
      bodyLimit: MAX_IMPORT_BYTES,
      config: { multipartOptions: { limits: { fileSize: MAX_IMPORT_BYTES, files: 50 } } },
    },
    async (req, reply) => {
      const user = requireTeacherOrAdmin(req, reply);
      const id = Number((req.params as { id: string }).id);
      if (Number.isNaN(id)) throw AppError.badRequest('课程 ID 非法');
      if (!req.isMultipart()) throw AppError.badRequest('请以 multipart 方式上传（字段名 file）');
      const raw = (req.query as { dryRun?: string }).dryRun ?? '';
      const dryRun = raw === '1' || raw.toLowerCase() === 'true';
      const collected = await collectKnowledgeImportUpload(req, path.join(deps.config.dataDir, 'tmp'));
      try {
        return await deps.knowledgeImportService.importUpload(user, id, collected.upload, dryRun);
      } finally {
        cleanupKnowledgeImport(collected);
      }
    },
  );
}
