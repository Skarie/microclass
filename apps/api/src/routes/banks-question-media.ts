/**
 * 题目配图路由：单题配图上传 / 访问，以及题干内联图（内容寻址）的上传与读取。
 *
 * 从 `routes/banks.ts` 拆出；路径、方法、返回结构全部保持不变。
 * 配图的落盘与去重在 `services/questionMediaStore`、`services/bankQuestionImageService`；
 * 这里只做权限、multipart 读取与响应头（缓存 / Range）。
 */
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import { AppError } from '@microclass/shared';
import { requireTeacherOrAdmin, requireUser } from '../http/guards.js';
import { sendFileWithRange } from '../utils/range.js';
import { mimeFor } from '../utils/mime.js';
import type { Deps } from '../app.js';
import { questionIdOf } from './banks-shared.js';

export async function registerBankQuestionMediaRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /** 题目配图上传（multipart，仅图片）：存进题图仓库并返回相对路径 */
  app.post('/questions/:id/image', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = questionIdOf(req);
    const file = await req.file();
    if (!file) throw AppError.badRequest('请选择图片文件');
    const data = await file.toBuffer();
    const imagePath = deps.bankService.attachImage(user, id, {
      fileName: file.filename,
      data,
      mimeType: file.mimetype,
    });
    return { ok: true, imagePath };
  });

  /** 题目配图访问（内联）：支持 Range，供 Word / 打印导出复用 */
  app.get('/question-images/:id', async (req, reply) => {
    requireUser(req, reply);
    const question = deps.bankService.findQuestion(questionIdOf(req));
    if (!question) throw AppError.notFound('题目不存在');
    const abs = deps.bankService.resolveImage(question);
    if (!abs) throw AppError.notFound('配图不存在');
    return sendFileWithRange(req, reply, abs);
  });

  /**
   * 上传题图（内容寻址，自动去重）：返回可直接写进题干的 `![](url)` 用法。
   * 用于"资料里的公式/图形是一张图"的场景 —— 只有把图按原位内联，题目才完整。
   */
  app.post('/question-media', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    if (!req.isMultipart()) throw AppError.badRequest('请以 multipart 方式上传（文件字段名 file）');
    const file = await req.file();
    if (!file) throw AppError.badRequest('请选择图片文件');
    const data = await file.toBuffer();
    const saved = deps.questionMedia.save(data);
    if (!saved) throw AppError.badRequest('只支持 PNG / JPEG / GIF / WebP 图片');
    deps.audit.write({
      actorId: user.id,
      actorName: user.username,
      action: 'question_media.upload',
      targetType: 'media',
      detail: { file: saved.file, bytes: data.length },
    });
    return { url: saved.url, relPath: saved.relPath, file: saved.file, deduped: saved.deduped };
  });

  /**
   * 题目图片（内容寻址）：题干/选项/解析里的 `![](/api/v1/question-media/<sha1>.png)` 走这里。
   * 文件名严格校验（40 位 sha1 + 白名单扩展名），内容不会变所以可长缓存。
   */
  app.get('/question-media/:file', async (req, reply) => {
    requireUser(req, reply);
    const file = (req.params as { file: string }).file;
    const abs = deps.questionMedia.resolve(file);
    if (!abs) throw AppError.notFound('图片不存在');
    reply.header('content-type', mimeFor(abs));
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    return reply.send(fs.createReadStream(abs));
  });
}
