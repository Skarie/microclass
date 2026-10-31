/**
 * 启动后的后台任务：faststart 巡检与题库体检预热。
 * 从 app.ts 拆出，避免装配文件继续膨胀（单文件行数守卫）。
 */
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config/env.js';
import type { MediaOptimizeService } from './mediaOptimizeService.js';
import type { BankService } from './bankService.js';

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
 * **启动预热**：容器刚起来时页缓存是空的，而「题库体检」要把全库统计跑一遍
 * （真机实测冷缓存 69 秒，用户看到的就是"卡死"；热缓存只要几百毫秒）。
 * 这里在服务就绪后**后台**算一次并写进内存缓存，让第一次点击体检的人直接命中缓存。
 * 预热失败不影响启动（只在日志里留一条）。
 */
export function warmBankHealth(app: FastifyInstance, banks: BankService): void {
  setTimeout(() => {
    try {
      const t0 = Date.now();
      banks.health(undefined, 20);
      app.log.info({ ms: Date.now() - t0 }, '题库体检预热完成');
    } catch (e) {
      app.log.warn({ err: e instanceof Error ? e.message : String(e) }, '题库体检预热失败（忽略）');
    }
  }, 1000).unref?.();
}
