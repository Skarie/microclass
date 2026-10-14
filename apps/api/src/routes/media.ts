/**
 * 媒体文件夹路由：列表、增删、目录浏览、扫描、按文件夹批量导入。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { AppError } from '@microclass/shared';
import { requireTeacherOrAdmin } from '../http/guards.js';
import type { Deps } from '../app.js';

export async function registerMediaRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get('/media-roots', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const roots = deps.media.list().map((r) => ({
      ...r,
      available: deps.media.isAvailable(r),
      lessons: deps.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM lessons WHERE media_root = ?', [r.id])?.c ?? 0,
    }));
    return { mediaRoots: roots };
  });

  app.post(
    '/media-roots',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'path'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 60 },
            path: { type: 'string', minLength: 1, maxLength: 500 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const user = requireTeacherOrAdmin(req, reply);
      const body = req.body as { name: string; path: string };
      const root = deps.media.add(user, body);
      deps.audit.write({
        actorId: user.id,
        actorName: user.username,
        action: 'media_root.create',
        targetType: 'media_root',
        targetId: root.id,
        detail: { path: root.path },
      });
      return { ok: true, root };
    },
  );

  app.delete('/media-roots/:id', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = (req.params as { id: string }).id;
    const used = deps.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM lessons WHERE media_root = ?', [id])?.c ?? 0;
    if (used > 0) throw AppError.badRequest(`有 ${used} 个课时正在使用该文件夹，请先改绑或删除后再移除`);
    deps.media.remove(id);
    deps.audit.write({
      actorId: user.id,
      actorName: user.username,
      action: 'media_root.delete',
      targetType: 'media_root',
      targetId: id,
    });
    return { ok: true };
  });

  /** 目录浏览（管理端选择视频用）：返回子目录与文件 */
  app.get('/media-roots/:id/browse', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const id = (req.params as { id: string }).id;
    const rel = ((req.query as { path?: string }).path ?? '').toString();
    const { abs } = deps.media.resolve(id, rel);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      throw AppError.badRequest('目录不存在或不可访问');
    }
    const dirs: string[] = [];
    const files: { name: string; size: number }[] = [];
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const child = path.join(abs, e.name);
      if (e.isDirectory()) dirs.push(e.name);
      else {
        let size = 0;
        try {
          size = fs.statSync(child).size;
        } catch {
          size = 0;
        }
        files.push({ name: e.name, size });
      }
    }
    dirs.sort((a, b) => a.localeCompare(b, 'zh'));
    files.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    return { path: rel, dirs, files };
  });

  /** 扫描：按子文件夹分组统计视频数量（导入前预览） */
  app.get('/media-roots/:id/scan', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const id = (req.params as { id: string }).id;
    const rel = ((req.query as { path?: string }).path ?? '').toString();
    return deps.media.scan(id, rel);
  });

  /**
   * 批量导入：子文件夹 → 章节，文件 → 课时。
   *
   * 三种归类方式（对应用户「一个文件夹 = 一门课程」的用法）：
   *   - `courseId`：导入到已存在的课程；
   *   - `courseName`：用这个名字**新建课程**再导入（文件夹名当课程名最省事）；
   *   - 都不传：导入为「未归类课时」，之后可用课时管理的批量改绑归类。
   *
   * `onDuplicate`：
   *   - `skip`（默认）：已存在的同路径视频跳过；
   *   - `assign`：把已存在的课时**收编**到目标课程（解决「先导入、后建课程再导入却零归入」）。
   */
  app.post('/media-roots/:id/import', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = (req.params as { id: string }).id;
    const body = req.body as {
      path?: string;
      courseId?: number | null;
      courseName?: string;
      onDuplicate?: string;
    };
    if (body.onDuplicate !== undefined && !['skip', 'assign'].includes(body.onDuplicate)) {
      throw AppError.badRequest('onDuplicate 只能是 skip 或 assign');
    }

    let courseId = body.courseId ?? null;
    let createdCourse: { id: number; name: string } | null = null;
    const courseName = (body.courseName ?? '').trim();
    if (courseName) {
      if (courseId !== null) throw AppError.badRequest('courseId 与 courseName 只能二选一');
      const newId = deps.courseService.create(user, { name: courseName, published: true });
      createdCourse = { id: newId, name: courseName };
      courseId = newId;
    }

    const result = deps.lessonService.importFromFolder(user, {
      rootId: id,
      path: body.path,
      courseId,
      ...(body.onDuplicate === undefined ? {} : { onDuplicate: body.onDuplicate as 'skip' | 'assign' }),
    });
    return { ok: true, ...result, course: createdCourse };
  });

  /** 服务器文件夹浏览（选择媒体根目录时使用，仅管理端） */
  app.get('/fs/browse', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const target = ((req.query as { path?: string }).path ?? '').toString();
    if (!target) {
      if (process.platform === 'win32') {
        const drives: string[] = [];
        for (let c = 67; c <= 90; c++) {
          const d = `${String.fromCharCode(c)}:/`;
          try {
            if (fs.existsSync(d)) drives.push(d);
          } catch {
            /* ignore */
          }
        }
        return { path: '', parent: null, roots: drives, dirs: [] };
      }
      return { path: '/', parent: null, roots: [], dirs: listDirs('/') };
    }
    const abs = path.resolve(target);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw AppError.badRequest('目录不存在或不可访问');
    const parent = path.dirname(abs) === abs ? null : path.dirname(abs);
    return { path: abs, parent, roots: [], dirs: listDirs(abs) };
  });
}

function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'zh'));
  } catch {
    return [];
  }
}
