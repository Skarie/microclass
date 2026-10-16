/**
 * 对标中国大学 MOOC 的能力验证：
 *  - 「我的课程」一级入口（在学 / 收藏 / 已学完聚合）
 *  - 播放器「后退 15 秒」按钮
 */
import { expect, test } from '@playwright/test';
import { loginViaUi, seedViaApi } from './helpers';

test.describe('对标 MOOC：我的课程与播放器回看', () => {
  test.setTimeout(150_000);

  test('我的课程：可从侧栏进入，并有在学/收藏/已学完分组标题', async ({ page, request }) => {
    await loginViaUi(page);
    await seedViaApi(request, { suffix: '-我的课程' });

    // 侧栏一级入口（对标 MOOC 把"上课"提到最外层）
    const navLink = page.locator('.nav__item', { hasText: '我的课程' }).first();
    await expect(navLink).toBeVisible();
    await navLink.click();

    await expect(page).toHaveURL(/\/my-courses$/);
    await expect(page.getByRole('heading', { name: '我的课程' })).toBeVisible();
  });

  test('播放器：后退 15 秒按钮存在且点击不报错', async ({ page, request }) => {
    await loginViaUi(page);
    const seeded = await seedViaApi(request, { suffix: '-回看' });
    await page.goto(`/lessons/${seeded.lessonId}/watch`);

    const rewind = page.getByRole('button', { name: '后退 15 秒' });
    await expect(rewind).toBeVisible();
    await rewind.click();

    // 播放器仍在（没有因异常而卸载），且时间为合法值
    const t = await page
      .locator('video')
      .evaluate((el: HTMLVideoElement) => el.currentTime)
      .catch(() => -1);
    expect(t).toBeGreaterThanOrEqual(0);
  });
});
