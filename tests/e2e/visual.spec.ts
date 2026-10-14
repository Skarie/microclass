import { expect, test } from '@playwright/test';
import { loginViaUi } from './helpers';

/**
 * 视觉回归：把界面的"标准长相"锁住，防止样式改动把别的页面改坏。
 *
 * 靶子选择：
 *  - `/login`：无业务数据，完全确定；
 *  - `/admin/design`（设计系统页）：不依赖业务数据，一页覆盖令牌/按钮/表格/标签/进度/空状态/图标；
 *  - 深色主题下同样截一遍（暗色最容易在改令牌时被忽略）。
 *
 * 首次生成基线：`npx playwright test visual --update-snapshots`
 * 平时对比：`npx playwright test visual`（差异超过阈值即失败，并输出 diff 图）
 *
 * ⚠️ 基线**按平台维护**：Playwright 的截图快照名会带平台后缀（`*-chromium-win32.png` /
 * `*-chromium-linux.png`）。仓库当前只有 Windows 基线，而不同系统的字体渲染/抗锯齿差异
 * 会让像素比对必然失败（`maxDiffPixelRatio` 只有 1%），因此在没有对应基线平台上跳过，
 * 而不是让它红着——需要 Linux 覆盖时，在 Linux 上跑一次
 * `npx playwright test visual --update-snapshots` 并把生成的 `*-linux.png` 提交上来即可。
 */
test.describe('视觉回归', () => {
  test.skip(process.platform !== 'win32', '当前仅维护 Windows 视觉基线（见上方说明）');

  test('登录页（浅色 / 深色）', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /^登录$/ })).toBeVisible();
    await expect(page).toHaveScreenshot('login-light.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.01,
    });

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await expect(page.getByRole('button', { name: /^登录$/ })).toBeVisible();
    await expect(page).toHaveScreenshot('login-dark.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.01,
    });
  });

  test('设计系统页：组件与令牌（浅色 / 深色）', async ({ page }) => {
    await loginViaUi(page);
    await page.goto('/admin/design');
    await expect(page.getByRole('heading', { name: '设计系统' })).toBeVisible();
    // 图标集是最后一屏，等它渲染完再截
    await expect(page.getByText(/图标集（\d+ 个）/)).toBeVisible();
    // 下拉菜单展开态也要锁定：菜单层级/间距最容易在改令牌时被带偏
    await page.getByRole('button', { name: /更多/ }).click();
    await expect(page.getByRole('menuitem', { name: '导出 CSV' })).toBeVisible();
    await expect(page).toHaveScreenshot('design-system-light.png', {
      fullPage: true,
      animations: 'disabled',
      maxDiffPixelRatio: 0.01,
    });
    await page.keyboard.press('Escape');

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await expect(page.getByRole('heading', { name: '设计系统' })).toBeVisible();
    await expect(page).toHaveScreenshot('design-system-dark.png', {
      fullPage: true,
      animations: 'disabled',
      maxDiffPixelRatio: 0.01,
    });
  });
});
