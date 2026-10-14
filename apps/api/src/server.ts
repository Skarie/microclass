/**
 * 进程入口：加载配置 → 构建应用 → 监听 → 优雅退出。
 */
import { loadConfig } from './config/env.js';
import { buildApp } from './app.js';

const config = loadConfig();

const { app, migrations } = await buildApp(config);

app.log.info(
  {
    env: config.env,
    port: config.port,
    migrations: { applied: migrations.applied.length, skipped: migrations.skipped.length },
  },
  '微课堂 API 启动中',
);

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, '收到退出信号，正在优雅关闭');
  try {
    await app.close();
    process.exit(0);
  } catch (e) {
    app.log.error({ err: e }, '关闭失败');
    process.exit(1);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`微课堂 API 就绪：http://${config.host}:${config.port}/api/v1/healthz`);
} catch (e) {
  app.log.error({ err: e }, '监听失败');
  process.exit(1);
}
