/**
 * 双面板验证 + 我的课程入口：
 *  - 管理员登录后默认落在**教学管理面板**（/admin/overview）
 *  - 切到学员视图后，顶部导航出现学员项，"我的课程"可进
 */
import { expect, test } from '@playwright/test';
import { loginViaUi, seedViaApi } from './helpers';

test.describe('双面板与我的课程', () => {
  test.setTimeout(150_000);

  test('管理员默认教学管理面板，切学员视图后可用学员导航', async ({ page, request }) => {
    await loginViaUi(page);
    await seedViaApi(request, { suffix: '-双面板' });

    // 默认落在教学管理面板
    await expect(page).toHaveURL(/\/admin\/overview$/);
    await expect(page.locator('.panel-switch__btn', { hasText: '教学管理' })).toHaveAttribute('aria-pressed', 'true');

    // 切到学员视图：导航换成学员项
    await page.locator('.panel-switch__btn', { hasText: '学员视图' }).click();
    await expect(page.locator('.panel-switch__btn', { hasText: '学员视图' })).toHaveAttribute('aria-pressed', 'true');

    const navLink = page.locator('.nav__item', { hasText: '我的课程' }).first();
    await expect(navLink).toBeVisible();
    await navLink.click();
    await expect(page).toHaveURL(/\/my-courses$/);
    await expect(page.getByRole('heading', { name: '我的课程' })).toBeVisible();
  });

  test('学员视图下访问管理页会被切回教学管理面板', async ({ page }) => {
    await loginViaUi(page);
    await page.locator('.panel-switch__btn', { hasText: '学员视图' }).click();
    await expect(page).toHaveURL(/\/(my-courses)?$/);

    await page.goto('/admin/courses');
    // 守卫会把面板切回教学管理，并允许进入（管理员本人）
    await expect(page).toHaveURL(/\/admin\/courses$/);
    await expect(page.locator('.panel-switch__btn', { hasText: '教学管理' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('播放器：后退 15 秒按钮存在且点击不报错', async ({ page, request }) => {
    await loginViaUi(page);
    const seeded = await seedViaApi(request, { suffix: '-回看' });
    await page.goto(`/lessons/${seeded.lessonId}/watch`);

    const rewind = page.getByRole('button', { name: '后退 15 秒' });
    await expect(rewind).toBeVisible();
    await rewind.click();
    const t = await page
      .locator('video')
      .evaluate((el: HTMLVideoElement) => el.currentTime)
      .catch(() => -1);
    expect(t).toBeGreaterThanOrEqual(0);
  });
});
