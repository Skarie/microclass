/** 视频 faststart 后台优化：状态查询 + 手动触发一轮巡检 */
import type { FastifyInstance } from 'fastify';
import { requireTeacherOrAdmin } from '../http/guards.js';
import type { Deps } from '../app.js';

export async function registerFaststartRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /** 当前队列与处理进度 */
  app.get('/admin/media/faststart', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    return deps.faststart.status();
  });

  /** 手动触发一轮巡检（只入队，不阻塞请求） */
  app.post('/admin/media/faststart/run', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    let added = 0;
    const raw = deps.settings.get('media_roots');
    const roots = raw ? (JSON.parse(raw) as { path?: string }[]) : [];
    for (const root of roots) {
      if (!root.path) continue;
      try {
        added += deps.faststart.sweep(root.path);
      } catch {
        /* 单个目录失败跳过 */
      }
    }
    return { ok: true, added, ...deps.faststart.status() };
  });
}
