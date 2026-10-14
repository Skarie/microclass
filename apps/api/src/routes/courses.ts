/**
 * 课程路由：列表/详情/增删改、封面、收藏、分类、知识点讲义导出。
 */
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { AppError } from '@microclass/shared';
import { requireAdmin, requireTeacherOrAdmin, requireUser } from '../http/guards.js';
import { mimeFor } from '../utils/mime.js';
import { textHeaders, docxHeaders } from '../utils/download.js';
import type { Deps } from '../app.js';

export async function registerCourseRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get('/courses', async (req, reply) => {
    const user = requireUser(req, reply);
    return deps.courseService.list(user);
  });

  app.get('/courses/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) throw AppError.badRequest('课程 ID 非法');
    const course = deps.courses.findById(id);
    if (!course) throw AppError.notFound('课程不存在');
    if (course.published !== 1 && user.role === 'student') throw AppError.notFound('课程未发布');
    const lessons = deps.lessonService.listForViewer(user, id);
    return { course: { ...course, fav: deps.courses.isFavorite(user.id, id) }, lessons };
  });

  app.post(
    '/courses',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 120 },
            description: { type: 'string', maxLength: 2000 },
            sort: { type: 'integer' },
            categoryId: { type: ['integer', 'null'] },
            published: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const user = requireTeacherOrAdmin(req, reply);
      const body = req.body as {
        name: string;
        description?: string;
        sort?: number;
        categoryId?: number | null;
        published?: boolean;
      };
      const id = deps.courseService.create(user, body);
      return { ok: true, id };
    },
  );

  app.put('/courses/:id', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    const body = req.body as {
      name: string;
      description?: string;
      sort?: number;
      categoryId?: number | null;
      published?: boolean;
    };
    deps.courseService.update(user, id, body);
    return { ok: true };
  });

  app.delete('/courses/:id', async (req, reply) => {
    const user = requireAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    deps.courseService.remove(user, id);
    return { ok: true };
  });

  /**
   * 课程课时管理页的数据：课程 + 课时（含进度）+ 课程文件夹绑定情况。
   * 与面向学生的 `GET /courses/:id` 分开，避免把管理字段带到学习端。
   */
  app.get('/courses/:id/manage', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) throw AppError.badRequest('课程 ID 非法');
    const course = deps.courseService.detail(user, id).course;
    return {
      course,
      lessons: deps.lessonService.listForViewer(user, id),
      folder: deps.lessonService.courseFolderInfo(id),
    };
  });

  /**
   * 绑定 / 更换 / 解绑课程文件夹。
   * `rootId: null` 表示解绑（已导入的课时保留，只是不再与磁盘目录联动）。
   */
  app.put('/courses/:id/folder', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) throw AppError.badRequest('课程 ID 非法');
    const body = req.body as { rootId?: string | null; path?: string };
    const folder = deps.lessonService.bindCourseFolder(user, id, {
      rootId: body.rootId === undefined ? null : body.rootId,
      ...(body.path === undefined ? {} : { path: body.path }),
    });
    return { ok: true, folder };
  });

  /**
   * 扫描课程文件夹并导入课时。
   * `dryRun: true` 先给出「新增 / 收编 / 缺失」统计，确认后再真正导入；
   * `removeMissing: true` 顺带清理磁盘上已消失的扫描课时（手工课时永不自动删除）。
   */
  app.post('/courses/:id/scan', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) throw AppError.badRequest('课程 ID 非法');
    const body = (req.body ?? {}) as {
      dryRun?: boolean;
      removeMissing?: boolean;
      onDuplicate?: string;
      chapterMode?: string;
    };
    if (body.onDuplicate !== undefined && !['skip', 'assign'].includes(body.onDuplicate)) {
      throw AppError.badRequest('onDuplicate 只能是 skip 或 assign');
    }
    if (body.chapterMode !== undefined && !['first', 'full', 'none'].includes(body.chapterMode)) {
      throw AppError.badRequest('chapterMode 只能是 first / full / none');
    }
    const result = deps.lessonService.scanCourseFolder(user, id, {
      ...(body.dryRun === undefined ? {} : { dryRun: body.dryRun }),
      ...(body.removeMissing === undefined ? {} : { removeMissing: body.removeMissing }),
      ...(body.onDuplicate === undefined ? {} : { onDuplicate: body.onDuplicate as 'skip' | 'assign' }),
      ...(body.chapterMode === undefined ? {} : { chapterMode: body.chapterMode as 'first' | 'full' | 'none' }),
    });
    // 新导入的视频在后台抽取时长/封面，不阻塞本次请求（失败不影响导入结果）
    if (!result.dryRun && result.newLessonIds.length > 0) {
      void deps.lessonService.probeQuietly(result.newLessonIds).catch(() => {
        /* 后台抽取失败忽略：可在列表里点「抽取时长/封面」重试 */
      });
    }
    return result;
  });

  /** 保存课程内的课时顺序（拖拽排序后调用），ids 必须是该课程课时的一个排列 */
  app.put('/courses/:id/lessons/order', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) throw AppError.badRequest('课程 ID 非法');
    const body = req.body as { ids?: unknown };
    if (!Array.isArray(body.ids)) throw AppError.badRequest('ids 必须是课时 ID 数组');
    const ids = body.ids.map((v) => Number(v));
    if (ids.some((v) => !Number.isInteger(v) || v <= 0)) throw AppError.badRequest('课时 ID 非法');
    return { ok: true, ...deps.lessonService.reorderLessons(user, id, ids) };
  });

  /** 知识点讲义导出：整门课程按「章节 → 课时」组织（Markdown / Word） */
  app.get('/courses/:id/knowledge.md', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) throw AppError.badRequest('课程 ID 非法');
    const { filename, body } = deps.lessonService.knowledgeToMarkdown({ courseId: id });
    return reply.headers(textHeaders(filename, 'text/markdown; charset=utf-8')).send(body);
  });

  app.get('/courses/:id/knowledge.docx', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) throw AppError.badRequest('课程 ID 非法');
    const { filename, body } = deps.lessonService.knowledgeToDocx({ courseId: id });
    return reply.headers(docxHeaders(filename)).send(body);
  });

  app.post('/courses/:id/fav', async (req, reply) => {
    const user = requireUser(req, reply);
    const id = Number((req.params as { id: string }).id);
    const fav = deps.courseService.toggleFavorite(user, id);
    return { ok: true, fav };
  });

  app.post('/courses/:id/cover', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    const file = await req.file();
    if (!file) throw AppError.badRequest('未收到图片');
    const buffer = await file.toBuffer();
    const saved = deps.storage.save({
      subdir: 'covers',
      fileName: file.filename,
      data: buffer,
      mimeType: file.mimetype,
      imagesOnly: true,
    });
    deps.courseService.setCover(user, id, saved.relPath);
    return { ok: true, cover: saved.relPath };
  });

  app.get('/course-cover/:id', async (req, reply) => {
    requireUser(req, reply);
    const id = Number((req.params as { id: string }).id);
    const course = deps.courses.findById(id);
    if (!course || !course.cover) throw AppError.notFound('课程无封面');
    const abs = deps.storage.resolve(course.cover);
    if (!abs || !fs.existsSync(abs)) throw AppError.notFound('封面已被移除');
    reply.header('content-type', mimeFor(abs));
    reply.header('cache-control', 'private, max-age=3600');
    return reply.send(fs.createReadStream(abs));
  });

  app.get('/categories', async (req, reply) => {
    requireUser(req, reply);
    return { categories: deps.courses.listCategories() };
  });

  app.post(
    '/categories',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string', minLength: 1, maxLength: 40 } },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const user = requireTeacherOrAdmin(req, reply);
      const body = req.body as { name: string };
      const id = deps.courseService.createCategory(user, body.name);
      return { ok: true, id };
    },
  );

  app.delete('/categories/:id', async (req, reply) => {
    const user = requireAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    deps.courseService.deleteCategory(user, id);
    return { ok: true };
  });
}
