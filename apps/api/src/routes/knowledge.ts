/**
 * 知识点路由（课时级 + 图片）：
 * 课时知识点的增删改、附件上传/下载、批量导入后图片的只读访问。
 * 课程级知识点的 CRUD / 批量导入在 `courseKnowledge.ts`。
 */
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { AppError } from '@microclass/shared';
import { requireTeacherOrAdmin, requireUser } from '../http/guards.js';
import { sendFileWithRange } from '../utils/range.js';
import { isInlineMime, mimeFor } from '../utils/mime.js';
import type { Deps } from '../app.js';

export async function registerKnowledgeRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /** 知识点文件下载/内联：按 MIME 决定 inline 还是 attachment */
  app.get('/knowledge/:id/file', async (req, reply) => {
    requireUser(req, reply);
    const id = Number((req.params as { id: string }).id);
    const row = deps.knowledge.findById(id);
    if (!row || row.kind !== 'file') throw AppError.notFound('文件不存在');
    const abs = deps.storage.resolve(row.file_path);
    if (!abs || !fs.existsSync(abs)) throw AppError.notFound('文件已被移除');
    const mime = mimeFor(row.file_name || abs);
    const disposition = isInlineMime(mime) ? 'inline' : 'attachment';
    reply.header(
      'content-disposition',
      `${disposition}; filename*=UTF-8''${encodeURIComponent(row.file_name || 'file')}`,
    );
    reply.header('cache-control', 'private, max-age=3600');
    return sendFileWithRange(req, reply, abs);
  });

  app.post('/lessons/:id/knowledge', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    const body = req.body as {
      title: string;
      kind: 'text' | 'file' | 'link';
      content?: string;
      url?: string;
      fileName?: string;
      filePath?: string;
    };
    const knowledgeId = deps.lessonService.addKnowledge(user, { ...body, lessonId: id });
    return { ok: true, id: knowledgeId };
  });

  /** 上传知识点附件（课件/讲义/图片等） */
  app.post('/lessons/:id/knowledge/file', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    const file = await req.file();
    if (!file) throw AppError.badRequest('请选择要上传的文件');
    const data = await file.toBuffer();
    const saved = deps.lessonService.uploadKnowledgeFile(user, {
      lessonId: id,
      fileName: file.filename,
      data,
    });
    return { ok: true, ...saved };
  });

  app.put('/knowledge/:id', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    deps.lessonService.updateKnowledge(user, id, req.body as { title?: string; content?: string; url?: string });
    return { ok: true };
  });

  app.delete('/knowledge/:id', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    const { filePath } = deps.lessonService.removeKnowledge(user, id);
    if (filePath) deps.storage.remove(filePath);
    return { ok: true };
  });

  /**
   * 知识点配图（批量导入时从 zip 抽出的图片）。
   * 文件名白名单校验、禁止目录穿越；内容寻址前缀保证可私有缓存一天。
   */
  app.get('/knowledge-media/:file', async (req, reply) => {
    requireUser(req, reply);
    const file = String((req.params as { file: string }).file ?? '');
    const abs = deps.knowledgeMedia.resolve(file);
    if (!abs) {
      if (!deps.knowledgeMedia.isValidName(file)) throw AppError.badRequest('文件名非法');
      throw AppError.notFound('图片不存在');
    }
    reply.header('content-type', mimeFor(abs));
    reply.header('cache-control', 'private, max-age=86400');
    return sendFileWithRange(req, reply, abs, { cacheControl: 'private, max-age=86400' });
  });
}
