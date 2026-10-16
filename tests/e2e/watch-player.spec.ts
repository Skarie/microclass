/**
 * 观看页播放器增强（对标主流学习平台）：
 *  - 倍速按钮真的改变 playbackRate
 *  - 倍速选择被记住（localStorage），刷新后仍生效
 *  - 键盘快捷键（, / . 调速）
 *  - 快捷键提示常驻可见
 *
 * 路由注意：观看页是 `/lessons/:id/watch`（不是 `/watch/:id`）。
 */
import { expect, test } from '@playwright/test';
import { loginViaUi, seedViaApi } from './helpers';

test.describe('观看页播放器', () => {
  test.setTimeout(150_000);

  test('倍速可选、被记住，快捷键可调速，提示可见', async ({ page, request }) => {
    await loginViaUi(page);
    const seeded = await seedViaApi(request, { suffix: '-播放器' });
    await page.goto(`/lessons/${seeded.lessonId}/watch`);
    await page.locator('.player__rates').waitFor();

    // 1.5× 是第 4 个按钮：点击后播放器真的变速
    await page.locator('.player__rates button').nth(3).click();
    expect(await page.locator('video').evaluate((v) => v.playbackRate)).toBeCloseTo(1.5, 2);

    // 刷新后记住选择（主流播放器的"记住速度"）
    await page.reload();
    await page.locator('.player__rates').waitFor();
    await expect(page.locator('.player__rates button[aria-pressed="true"]')).toHaveText('1.5×');

    // 快捷键：逗号降一档
    await page.keyboard.press('Comma');
    expect(await page.locator('video').evaluate((v) => v.playbackRate)).toBeCloseTo(1.25, 2);

    // 快捷键提示常驻（学生不需要去猜）
    await expect(page.locator('.player__hint')).toContainText('空格');
  });

  test('输入框聚焦时快捷键不抢键（避免误暂停）', async ({ page, request }) => {
    await loginViaUi(page);
    const seeded = await seedViaApi(request, { suffix: '-快捷键' });
    await page.goto(`/lessons/${seeded.lessonId}/watch`);
    await page.locator('.note-form textarea, textarea').first().waitFor();

    const before = await page.locator('video').evaluate((v) => v.paused);
    await page.locator('textarea').first().click();
    await page.keyboard.type('a b');
    const after = await page.locator('video').evaluate((v) => v.paused);
    expect(after).toBe(before);
  });
});
