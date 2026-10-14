import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

/**
 * Vite 用 `module.builtinModules` 判断内置模块，而 Node 25 的该列表里
 * 没有 `sqlite`（实验性内置项），于是 `node:sqlite` 的前缀被剥掉、
 * 当成裸包去解析，报 “Failed to load url sqlite”。
 *
 * 这里在 Vite 内部 resolve 插件之前把它标记为外部依赖，
 * 由 Node 原生 ESM 解析 `node:sqlite`；生产代码保持原样。
 */
const nodeSqliteAsExternal: Plugin = {
  name: 'microclass:node-sqlite-as-external',
  enforce: 'pre',
  resolveId(source) {
    if (source === 'node:sqlite' || source === 'sqlite') return { id: 'node:sqlite', external: true };
    return null;
  },
};

export default defineConfig({
  plugins: [nodeSqliteAsExternal],
  test: {
    environment: 'node',
    include: ['apps/api/test/**/*.test.ts', 'apps/web/test/**/*.test.ts', 'packages/**/*.test.ts'],
    // 每个用例都会建库并引导管理员（scrypt 较耗 CPU）；并发跑或机器负载高时
    // 默认 10s 的 hook 超时偶发触发，放宽以避免 CI 假红。
    hookTimeout: 30_000,
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['apps/api/src/**/*.ts', 'packages/shared/src/**/*.ts'],
      exclude: ['**/dist/**', '**/*.d.ts'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
  },
});
