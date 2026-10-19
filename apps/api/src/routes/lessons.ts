/**
 * 课时路由：列表/详情/增删改、知识点、视频流、本地文件夹批量导入。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { AppError, VIDEO_EXTENSIONS } from '@microclass/shared';
import { requireTeacherOrAdmin, requireUser } from '../http/guards.js';
import { sendFileWithRange } from '../utils/range.js';
import { isInlineMime, mimeFor } from '../utils/mime.js';
import { textHeaders, docxHeaders } from '../utils/download.js';
import type { Deps } from '../app.js';
import type { LessonInputDto } from '../services/lessonService.js';

export async function registerLessonRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get('/lessons', async (req, reply) => {
    const user = requireUser(req, reply);
    const q = req.query as { course?: string };
    let courseId: number | null | undefined;
    if (q.course === 'orphan') courseId = null;
    else if (q.course !== undefined && q.course !== '') {
      const parsed = Number.parseInt(q.course, 10);
      if (Number.isNaN(parsed)) throw AppError.badRequest('course 参数非法');
      courseId = parsed;
    }
    return { lessons: deps.lessonService.listForViewer(user, courseId) };
  });

  app.get('/lessons/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) throw AppError.badRequest('课时 ID 非法');
    return deps.lessonService.detail(user, id);
  });

  const lessonBodySchema = {
    type: 'object',
    required: ['title', 'videoKind', 'videoPath'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: 'string', maxLength: 2000 },
      videoKind: { type: 'string', enum: ['local', 'embed', 'url'] },
      mediaRoot: { type: 'string', maxLength: 64 },
      videoPath: { type: 'string', minLength: 1, maxLength: 1000 },
      sort: { type: 'integer' },
      groupName: { type: 'string', maxLength: 120 },
      courseId: { type: ['integer', 'null'] },
    },
    additionalProperties: false,
  } as const;

  app.post('/lessons', { schema: { body: lessonBodySchema } }, async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const body = req.body as LessonInputDto;
    const id = deps.lessonService.create(user, body);
    return { ok: true, id };
  });

  app.put('/lessons/:id', { schema: { body: lessonBodySchema } }, async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    deps.lessonService.update(user, id, req.body as LessonInputDto);
    return { ok: true };
  });

  app.delete('/lessons/:id', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    deps.lessonService.remove(user, id);
    return { ok: true };
  });

  /**
   * 网页直接上传视频并建成课时（老师最省事的路径，无需运维挂载宿主机目录）。
   *
   * multipart 字段：
   *   file      视频文件（必填）
   *   courseId  目标课程 id（可选；不传则成为「未归类课时」）
   *   groupName 统一章节名（可选）
   *   relPath   上传时的相对路径（拖拽整个文件夹时由前端提供，用于自动分章）
   *   sort      排序值（可选）
   */
  app.post('/lessons/upload', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const maxBytes = deps.config.maxVideoMb * 1024 * 1024;
    const file = await req.file({ limits: { fileSize: maxBytes, files: 1 } });
    if (!file) throw AppError.badRequest('请选择要上传的视频文件');

    const field = (name: string): string => {
      const v = file.fields[name];
      if (!v || Array.isArray(v) || typeof v !== 'object' || !('value' in v)) return '';
      const value: unknown = (v as { value: unknown }).value;
      return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
    };

    if (!VIDEO_EXTENSIONS.includes(path.extname(file.filename).toLowerCase() as (typeof VIDEO_EXTENSIONS)[number])) {
      throw AppError.badRequest(`仅支持视频文件：${VIDEO_EXTENSIONS.join(' / ')}`);
    }

    // 边收边写盘；大小超限时 saveStream 会中断并清理半成品文件
    const saved = await deps.storage.saveStream({
      subdir: 'videos',
      fileName: file.filename,
      source: file.file,
      allowedExtensions: VIDEO_EXTENSIONS,
      maxBytes,
    });

    const courseIdRaw = field('courseId');
    const courseId = courseIdRaw === '' ? null : Number.parseInt(courseIdRaw, 10);
    if (courseIdRaw !== '' && Number.isNaN(courseId)) throw AppError.badRequest('courseId 参数非法');

    const sortRaw = field('sort');
    const sort = sortRaw === '' ? undefined : Number.parseInt(sortRaw, 10);

    const id = deps.lessonService.createFromUpload(user, {
      title: file.filename,
      // 媒体根「uploads」指向 <dataDir>/uploads/videos，因此入库路径只取文件名
      videoPath: path.basename(saved.relPath),
      relPath: field('relPath') || undefined,
      groupName: field('groupName') || undefined,
      courseId,
      ...(sort === undefined || Number.isNaN(sort) ? {} : { sort }),
    });

    return { ok: true, id, size: saved.size, fileName: saved.fileName };
  });

  /**
   * 批量改绑课时归属（课程 / 章节）。
   * body: { lessonIds: number[], courseId: number|null, groupName?: string }
   * courseId 为 null 表示移出课程、回到「未归类」；groupName 省略时保留各自原章节。
   */
  app.post('/lessons/batch-assign', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const body = req.body as { lessonIds?: unknown; courseId?: number | null; groupName?: string };
    const raw = Array.isArray(body?.lessonIds) ? body.lessonIds : [];
    const lessonIds = raw.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0);
    return {
      ok: true,
      ...deps.lessonService.batchAssign(user, {
        lessonIds,
        courseId: body?.courseId ?? null,
        ...(body?.groupName === undefined ? {} : { groupName: body.groupName }),
      }),
    };
  });

  /** 单个课时的知识点讲义导出（Markdown / Word） */
  app.get('/lessons/:id/knowledge.md', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) throw AppError.badRequest('课时 ID 非法');
    const { filename, body } = deps.lessonService.knowledgeToMarkdown({ lessonId: id });
    return reply.headers(textHeaders(filename, 'text/markdown; charset=utf-8')).send(body);
  });

  app.get('/lessons/:id/knowledge.docx', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) throw AppError.badRequest('课时 ID 非法');
    const { filename, body } = deps.lessonService.knowledgeToDocx({ lessonId: id });
    return reply.headers(docxHeaders(filename)).send(body);
  });

  /** 本地视频流（Range） */
  app.get('/lessons/:id/video', async (req, reply) => {
    requireUser(req, reply);
    const id = Number((req.params as { id: string }).id);
    const lesson = deps.lessons.findById(id);
    if (!lesson) throw AppError.notFound('视频不存在');
    if (lesson.video_kind !== 'local') throw AppError.badRequest('该课时不是本地视频');
    const { abs } = deps.media.resolve(lesson.media_root, lesson.video_path);
    /**
     * 视频是重资源：允许浏览器私有缓存一天（原来 no-store，二次播放还得整片重下）。
     * ETag 用 大小+修改时间 生成，内容变了自然失效。
     */
    try {
      const st = fs.statSync(abs);
      reply.header('cache-control', 'private, max-age=86400');
      reply.header('etag', `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`);
      reply.header('last-modified', st.mtime.toUTCString());
    } catch {
      /* stat 失败交给 sendFileWithRange 返回 404 */
    }
    return sendFileWithRange(req, reply, abs, { cacheControl: 'private, max-age=86400' });
  });

  /**
   * 抽取视频元数据（时长 + 封面）：参考轻课堂用 ffprobe/ffmpeg 的做法。
   * 需要运行环境里有 ffprobe/ffmpeg；缺失时返回 200 + available:false，不报错打断流程。
   */
  app.post('/lessons/:id/probe', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    const result = await deps.lessonService.probeMetadata(user, id);
    return { ok: true, ...result };
  });

  /**
   * 批量抽取尚未抽取过的本地视频元数据（默认一次 20 个，`?limit=` 可在 1–100 之间调整）。
   * 前端会循环调用直到 `remaining` 为 0；也可以用脚本/定时任务在后台慢慢跑。
   */
  app.post('/lessons/probe-pending', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const raw = (req.query as { limit?: string }).limit;
    const parsed = raw === undefined ? 20 : Number.parseInt(raw, 10);
    const limit = Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 100) : 20;
    return { ok: true, ...(await deps.lessonService.probePending(user, limit)) };
  });

  /** 课时封面（抽取的帧图） */
  app.get('/lesson-covers/:id', async (req, reply) => {
    requireUser(req, reply);
    const id = Number((req.params as { id: string }).id);
    const lesson = deps.lessons.findById(id);
    if (!lesson || !lesson.cover_path) throw AppError.notFound('封面不存在');
    const abs = deps.storage.resolve(lesson.cover_path);
    if (!abs || !fs.existsSync(abs)) throw AppError.notFound('封面文件已被移除');
    reply.header('cache-control', 'private, max-age=86400');
    return sendFileWithRange(req, reply, abs);
  });

  /** 知识点文件下载/内联：按 MIME 决定 inline 还是 attachment */ app.get('/knowledge/:id/file', async (req, reply) => {
    requireUser(req, reply);
    const id = Number((req.params as { id: string }).id);
    const row = deps.lessons.findKnowledge(id);
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
}
