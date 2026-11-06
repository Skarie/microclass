/**
 * 课程封面出流：`GET /course-cover/:id`
 *
 * - 不带 `?w=`：原图（行为与历史一致，缓存 1 小时）；
 * - 带 `?w=120..1600`：ffmpeg 缩放后的 webp（缓存 7 天 + ETag），供课程卡片使用；
 * - 缩略图生成失败：记 warning 并回退原图，请求不 500。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { AppError } from '@microclass/shared';
import { requireUser } from '../http/guards.js';
import { mimeFor } from '../utils/mime.js';
import type { Deps } from '../app.js';
import { CoverThumbnailService, fileEtag, parseThumbnailWidth } from '../services/coverThumbnailService.js';

export async function registerCourseCoverRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const thumbs = new CoverThumbnailService({
    ffmpegPath: deps.config.ffmpegPath || 'ffmpeg',
    cacheDir: path.join(deps.config.dataDir, 'cover-cache'),
  });

  app.get('/course-cover/:id', async (req, reply) => {
    requireUser(req, reply);
    const id = Number((req.params as { id: string }).id);
    const course = deps.courses.findById(id);
    if (!course || !course.cover) throw AppError.notFound('课程无封面');
    const abs = deps.storage.resolve(course.cover);
    if (!abs || !fs.existsSync(abs)) throw AppError.notFound('封面已被移除');

    const rawWidth = (req.query as { w?: unknown }).w;
    if (rawWidth !== undefined) {
      const width = parseThumbnailWidth(rawWidth);
      if (width === null) throw AppError.badRequest('w 必须是 120~1600 的整数');
      const thumb = await thumbs.get(id, abs, width);
      if (thumb.ok) {
        const etag = fileEtag(thumb.file);
        reply.header('content-type', 'image/webp');
        reply.header('cache-control', 'private, max-age=604800');
        if (etag) reply.header('etag', etag);
        if (etag && req.headers['if-none-match'] === etag) return reply.status(304).send();
        return reply.send(fs.createReadStream(thumb.file));
      }
      req.log.warn({ courseId: id, width, error: thumb.error }, 'cover thumbnail failed, fallback to original');
    }

    reply.header('content-type', mimeFor(abs));
    reply.header('cache-control', 'private, max-age=3600');
    return reply.send(fs.createReadStream(abs));
  });
}
