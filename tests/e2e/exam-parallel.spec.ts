import { expect, test } from '@playwright/test';
import { loginViaUi, seedViaApi } from './helpers';

/**
 * 组卷方式入口（第②步）+ 平行组卷（A/B 卷）。
 *
 * 要挡住的问题：三种方式只是摆设；平行卷生成了但**结构和原卷对不上**
 * （题量/题型/分值/大题的任一环丢了，两份卷就不具备可比性）。
 */
test.describe('组卷方式入口与平行组卷', () => {
  test('第②步三种组卷方式都在，能生成结构一致的另一套卷', async ({ page, request }) => {
    const suffix = Date.now().toString(36);
    const seeded = await seedViaApi(request, { suffix: ` 平行卷 ${suffix}` });
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await loginViaUi(page);

    /*
     * 平行卷需要"同题型、同难度、同考点"的**另一道**题才配得出来；
     * 种子里 4 道题有 3 道已在卷内，剩不下可选 → 先给同一个题库补几道同型题当孪生题。
     */
    for (const spec of [
      { type: 'single', stem: `平行备选 单选 A${suffix}`, options: ['甲', '乙'], answer: 'A' },
      { type: 'single', stem: `平行备选 单选 B${suffix}`, options: ['甲', '乙'], answer: 'B' },
      { type: 'multiple', stem: `平行备选 多选 A${suffix}`, options: ['甲', '乙', '丙'], answer: 'AB' },
      { type: 'multiple', stem: `平行备选 多选 B${suffix}`, options: ['甲', '乙', '丙'], answer: 'AC' },
      { type: 'judge', stem: `平行备选 判断 A${suffix}`, answer: '对' },
      { type: 'judge', stem: `平行备选 判断 B${suffix}`, answer: '错' },
    ]) {
      const res = await request.post(`/api/v1/banks/${seeded.bankId}/questions`, {
        data: { bankId: seeded.bankId, ...spec },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
    }

    await page.goto(`/admin/exams/${seeded.examId}/compose`);
    await expect(page.locator('.stp')).toBeVisible({ timeout: 30000 });

    // ② 三种组卷方式都在
    await page.locator('.stp__item').filter({ hasText: '选组卷方式' }).click();
    for (const name of ['随机组卷', '自己挑题', '平行组卷']) {
      await expect(page.locator('.stp__mode').filter({ hasText: name })).toBeVisible();
    }

    // ③ 先给原卷设好一个大题与分值（种子已有 3 题）
    await page.locator('.stp__item').filter({ hasText: '看卷子' }).click();
    await expect(page.locator('.stp__q')).toHaveCount(3, { timeout: 15000 });
    await page.getByLabel('第 1 题分值').fill('4');
    await page.getByLabel('第 1 题分值').blur();
    await page.getByRole('button', { name: '添加大题' }).click();
    await page.getByLabel('第 1 个大题名称').fill('一、单选题');
    await page.getByLabel('第 1 题所属大题').fill('一、单选题');
    await page.getByLabel('第 1 题所属大题').blur();
    await expect(page.locator('.stp__grouphead').filter({ hasText: '一、单选题' })).toBeVisible({ timeout: 15000 });

    // ⑤ 平行组卷（入口在第②步）
    await page.locator('.stp__item').filter({ hasText: '选组卷方式' }).click();
    await page.locator('.stp__mode').filter({ hasText: '平行组卷' }).getByRole('button').click();
    const modal = page.getByRole('dialog').filter({ hasText: '平行组卷（A/B 卷）' });
    await expect(modal).toBeVisible();
    await expect(modal.getByText(/同题型、同难度档、知识点尽量相同/)).toBeVisible();
    await modal.getByLabel('新试卷名称（留空自动命名）').fill('平行卷 E2E');
    await modal.getByRole('button', { name: '生成平行卷' }).click();

    // 生成后跳到新卷的组卷页（同路由换 id、组件复用 —— 这里同时验证 examId 跟着变了）
    await expect(page.getByRole('heading', { level: 1 })).toContainText('平行卷 E2E', { timeout: 20000 });
    await expect(page.locator('.stp__q')).toHaveCount(3, { timeout: 15000 });
    await expect(page.locator('.stp__grouphead').filter({ hasText: '一、单选题' })).toBeVisible();
    await expect(page.getByLabel('第 1 题分值')).toHaveValue('4');

    expect(consoleErrors, `控制台不应报错：${consoleErrors.join(' | ')}`).toEqual([]);
  });
});
