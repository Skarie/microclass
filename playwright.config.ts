import { defineConfig, devices } from '@playwright/test';

/**
 * E2E 配置：面向生产构建产物（API 同源托管 apps/web/dist）。
 *
 * 前置：`npm run build`（构建后端与前端）。
 * 每次运行使用**独立且全新**的数据目录与端口，避免污染本地 data/：
 *   - 数据目录：build/e2e-data/<runId>（runId 默认取时间戳）
 *   - 端口：8099（可用 MC_E2E_PORT 覆盖）
 *
 * 注意：Playwright 会先启动 webServer 再执行 globalSetup，
 * 因此这里不能在 setup 阶段删除服务已打开的数据目录（Windows 会 EPERM），
 * 而是让每次运行天然使用新目录，由 globalTeardown 尽力清理历史目录。
 */
const PORT = Number(process.env.MC_E2E_PORT ?? 8099);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const RUN_ID = process.env.MC_E2E_RUN_ID ?? String(Date.now());
const DATA_DIR = `build/e2e-data/${RUN_ID}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: {
    baseURL: BASE_URL,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node apps/api/dist/server.js`,
    url: `${BASE_URL}/api/v1/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      MC_ENV: 'production',
      MC_HOST: '127.0.0.1',
      MC_PORT: String(PORT),
      MC_DATA_DIR: DATA_DIR,
      MC_LOG_LEVEL: 'warn',
      MC_ADMIN_USER: 'admin',
      MC_ADMIN_PASS: 'admin123',
      MC_ALLOW_REGISTER: 'true',
      MC_RATE_LIMIT_MAX: '10000',
    },
  },
});
