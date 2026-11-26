/**
 * 启动后的后台任务：faststart 巡检与题库体检预热。
 * 从 app.ts 拆出，避免装配文件继续膨胀（单文件行数守卫）。
 */
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config/env.js';
import type { SettingsRepository } from '../db/repositories/settingsRepository.js';
import type { MediaRootService } from './mediaRootService.js';
import type { MediaOptimizeService } from './mediaOptimizeService.js';
import type { BankHealthCoordinator } from './bankHealthCoordinator.js';

/**
 * 首次启动播种媒体根（来自 MC_MEDIA_ROOTS），并把站内上传目录登记进去。
 * 必须在 `settings.load()` 之后调用：读的是进程内快照，写库后快照同步更新。
 */
export async function seedMediaRoots(
  settings: SettingsRepository,
  media: MediaRootService,
  config: AppConfig,
): Promise<void> {
  if (!settings.getSync('media_roots') && config.mediaRoots.length > 0) {
    await settings.set('media_roots', JSON.stringify(config.mediaRoots));
  }
  await media.ensureUploadRoot(config.dataDir);
}

/** 遍历所有媒体根做一次 faststart（单目录失败不影响其它） */
function sweepAll(faststart: MediaOptimizeService, config: AppConfig): void {
  for (const root of config.mediaRoots as { path: string }[]) {
    try {
      faststart.sweep(root.path);
    } catch {
      /* 单个目录失败不影响其它 */
    }
  }
}

/**
 * faststart 后台巡检：启动 1 分钟后跑第一次，之后每 15 分钟一轮。
 * 老师上传/挂载视频后不需要任何手工操作，下一轮自动把索引挪到文件头。
 */
export function startFaststartSweeps(faststart: MediaOptimizeService, config: AppConfig): NodeJS.Timeout | null {
  if (!config.autoFaststart) return null;
  const timer = setInterval(() => sweepAll(faststart, config), 15 * 60 * 1000);
  timer.unref();
  const firstRun = setTimeout(() => sweepAll(faststart, config), 60 * 1000);
  firstRun.unref();
  return timer;
}

/**
 * **启动预热**：服务就绪后 30 秒检查体检缓存，过期就在后台 worker 里算一次。
 *
 * 为什么不再在这里同步调用体检：全库聚合在生产（39.6 万题 / 库 1.2GB、NAS 机械盘）要 6 分钟级，
 * 同步跑会把事件循环占住 —— 期间所有接口超时、健康检查变 unhealthy。
 * 现在只「触发」不「等待」：worker 算完写持久缓存（迁移 0031），第一次请求直接命中。
 *
 * 自 2.3.2 起**默认不预热**（`MC_HEALTH_AUTO=0`）：预热也是一次全库扫描，
 * 夜里在机械盘上曾把整站拖死；现在只有管理员点「重新体检」（`?refresh=1`）才算。
 */
export function warmBankHealth(app: FastifyInstance, coordinator: BankHealthCoordinator, config: AppConfig): void {
  if (!config.autoBankHealth) {
    app.log.info('题库体检自动预热已关闭（MC_HEALTH_AUTO=0）：仅管理员手动「重新体检」时才计算');
    return;
  }
  const timer = setTimeout(() => {
    try {
      void coordinator.ensureFresh();
      app.log.info('题库体检缓存检查完成（过期则在后台 worker 重算，不阻塞服务）');
    } catch (e) {
      app.log.warn({ err: e instanceof Error ? e.message : String(e) }, '题库体检缓存预热失败（忽略）');
    }
  }, 30 * 1000);
  timer.unref?.();
}
