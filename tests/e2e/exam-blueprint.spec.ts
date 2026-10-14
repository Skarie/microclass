import { expect, test } from '@playwright/test';
import { loginViaUi, seedViaApi } from './helpers';

/**
 * 双向细目表组卷（在**新组卷页**的第 1 步里打开）端到端：
 *   定范围 → 「按双向细目表组卷」→ 填格 → 按表配题 → 逐格结果如实返回。
 *
 * 这条用例要挡住的是：细目表只是"看起来能用"，实际没把 cells 传给后端、
 * 或者配不满时静默少配（老师以为卷子配齐了）。
 */
test.describe('双向细目表组卷（新组卷页）', () => {
  test('按「题型 × 难度 × 题量」配题，逐格结果如实返回', async ({ page, request }) => {
    const seeded = await seedViaApi(request, { suffix: ` 细目表 ${Date.now().toString(36)}` });
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await loginViaUi(page);
    await page.goto(`/admin/exams/${seeded.examId}/compose`);
    await expect(page.locator('.stp')).toBeVisible({ timeout: 30000 });

    // 新结构：细目表入口在试卷结构卡片的右上角
    await page.getByRole('button', { name: '按细目表配题' }).click();
    const modal = page.getByRole('dialog').filter({ hasText: '按双向细目表组卷' });
    await expect(modal).toBeVisible();
    await expect(modal.getByText(/逐格填写/)).toBeVisible();

    // 默认已有一行：改成「填空题 × 易 × 1」
    // （种子试卷里已有 单选/多选/判断 三题，填空题还不在卷内）
    const row = modal.locator('.bp__row').first();
    await row.getByLabel('第 1 行题型').selectOption('fill');
    await row.getByLabel('第 1 行难度').selectOption('easy');
    await row.getByLabel('第 1 行题量').fill('1');

    // 再加一格题池里没有的：简答题 × 难 × 2 → 必须如实报缺口
    await modal.getByRole('button', { name: '加一行' }).click();
    const row2 = modal.locator('.bp__row').nth(1);
    await row2.getByLabel('第 2 行题型').selectOption('short');
    await row2.getByLabel('第 2 行难度').selectOption('hard');
    await row2.getByLabel('第 2 行题量').fill('2');

    await modal.getByRole('button', { name: '按细目表组卷' }).click();

    const result = modal.locator('.bp__result');
    await expect(result).toBeVisible({ timeout: 15000 });
    await expect(result).toContainText('配到 1 / 3 题');
    await expect(result).toContainText('缺口 2');
    await expect(result.locator('.is-missing')).toHaveCount(1);
    await expect(result.locator('.is-missing')).toContainText('缺 2');

    await modal.locator('.modal-footer').getByRole('button', { name: '关闭' }).click();
    // 配完直接落在试卷上：应看到多出来的那道填空题（3 + 1 = 4 题）
    await expect(page.locator('.stp__q')).toHaveCount(4, { timeout: 15000 });

    expect(consoleErrors, `控制台不应报错：${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('「按当前试卷填充」把已有题目的分布回填成细目表', async ({ page, request }) => {
    const seeded = await seedViaApi(request, { suffix: ` 填充 ${Date.now().toString(36)}` });
    await loginViaUi(page);
    await page.goto(`/admin/exams/${seeded.examId}/compose`);
    await expect(page.locator('.stp')).toBeVisible({ timeout: 30000 });

    await page.getByRole('button', { name: '按细目表配题' }).click();
    const modal = page.getByRole('dialog').filter({ hasText: '按双向细目表组卷' });
    await modal.getByRole('button', { name: '按当前试卷填充' }).click();
    // 种子的试卷有 单选/多选/判断 三题 → 三行
    await expect(modal.locator('.bp__row')).toHaveCount(3);
    await expect(modal.locator('.bp__toolbar')).toContainText('合计 3 题');

    await modal.locator('.modal-footer').getByRole('button', { name: '关闭' }).click();
    await expect(modal).toBeHidden();
  });
});
