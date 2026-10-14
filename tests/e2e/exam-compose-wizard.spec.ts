import { expect, test } from '@playwright/test';
import { loginViaUi, seedViaApi } from './helpers';

/**
 * 组卷四步流程（按老师的需求原话）：
 *   ① 选范围（章节/知识点）→ ② 随机组卷（题型数量+分值）→ ③ 看卷子（能看到、能换题、能改分）
 *   → ④ 打印预览（A3/A4）
 *
 * 要挡住的是：四步里任何一步只是"看起来有"，实际没把范围/数量/分值/纸张传到后端或预览。
 */
test.describe('组卷四步流程', () => {
  test('按范围随机组卷 → 看卷子可换题 → 打印预览可选 A3', async ({ page, request }) => {
    const seeded = await seedViaApi(request, { suffix: ` 四步 ${Date.now().toString(36)}` });
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await loginViaUi(page);
    await page.goto(`/admin/exams/${seeded.examId}/compose`);
    await expect(page.locator('.stp')).toBeVisible({ timeout: 30000 });

    // 步骤条四步齐全（老师能一眼看到流程）
    for (const label of ['选范围', '选组卷方式', '看卷子', '打印预览']) {
      await expect(page.locator('.stp__item').filter({ hasText: label })).toBeVisible();
    }

    /* ① 选范围：勾一个章节（种子的题挂在课时的题库上，所以先切全库） */
    await page.getByLabel('抽题范围').selectOption('all');
    await expect(page.locator('.tree')).toBeVisible({ timeout: 30000 });
    // 种子的题没标章节，所以勾"未标注章节"这个真实节点（这本身就是一次范围选择）
    const unlabeled = page.locator('.tree__row', { hasText: '未标注' }).first().locator('input[type=checkbox]').first();
    await expect(unlabeled).toBeVisible({ timeout: 15000 });
    await unlabeled.check();
    await expect(page.getByText(/范围内共/)).toBeVisible();
    await expect(page.getByText(/当前范围：/)).toContainText('章节');

    await page.getByRole('button', { name: /下一步：选择组卷方式/ }).click();

    /* ②b 自己挑题：整页三区，行内「加入」和「全选筛选结果」都要能看到、点得到 */
    await page.locator('.stp__item').filter({ hasText: '选组卷方式' }).click();
    await page.getByRole('button', { name: '打开题库挑题' }).click();
    await expect(page.locator('.pk')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.pk__side .tree')).toBeVisible();
    await expect(page.locator('.pk__main .qt__table')).toBeVisible({ timeout: 20000 });
    // 表格里最右的「操作」列曾经被裁到屏幕外（弹窗太窄），这里必须可见
    await expect(page.locator('.pk__main .qt__table thead th').last()).toBeVisible();
    await expect(
      page.locator('.pk__main .qt__table tbody tr').first().getByRole('button', { name: '加入' }),
    ).toBeVisible();
    // 「全选本页」常驻；「全选筛选结果 N 题」只在匹配数超一页时出现（真机上 36 万题必然有，
    // 由 build/shot-4step.mjs 在真机断言）
    await expect(page.getByText(/全选本页/)).toBeVisible();
    await expect(page.getByText('已选试题')).toBeVisible();
    await page.getByRole('button', { name: /返回组卷方式/ }).click();
    await expect(page.locator('.pk')).toBeHidden();

    /*
     * ② 随机组卷：各要 1 道（E2E 是共享库，别按"只有 1 道单选"来断言，否则别的用例加题后就飘）。
     * 「范围内题量不够要如实报缺口」由 apps/api/test/exam-range-compose.test.ts 精确覆盖。
     */
    await expect(page.getByText('随机组卷')).toBeVisible();
    await page.getByLabel('单选题数量').fill('1');
    await page.getByLabel('单选题每题分值').fill('5');
    await page.getByLabel('判断题数量').fill('1');
    await page.getByLabel('判断题每题分值').fill('2');
    await page.getByRole('button', { name: /按范围随机生成试卷/ }).click();

    /* ③ 看卷子：题数正确、题干可见、能展开答案解析、能改分值、有「换一题」 */
    await expect(page.getByText(/卷子内容/)).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.stp__q')).toHaveCount(2, { timeout: 15000 });
    await expect(page.locator('.stp__qstem').first()).not.toBeEmpty();
    await expect(page.getByLabel('第 1 题分值')).toHaveValue('5');

    const firstAnswer = page.locator('.stp__answer');
    await expect(firstAnswer).toHaveCount(0);
    await page.getByRole('button', { name: '看答案与解析' }).first().click();
    await expect(firstAnswer.first()).toBeVisible();
    await expect(firstAnswer.first()).toContainText('答案：');

    await expect(page.getByRole('button', { name: '换一题' }).first()).toBeVisible();

    // 改分值 → 落库并回读（5 + 3 = 8 分）
    await page.getByLabel('第 2 题分值').fill('3');
    await page.getByLabel('第 2 题分值').blur();
    await expect(page.locator('.stp__meta')).toContainText('8 分', { timeout: 15000 });

    /* ④ 打印预览：默认 A4，能切 A3，预览 iframe 跟着换 */
    await page.getByRole('button', { name: /下一步：打印预览/ }).click();
    await expect(page.getByText(/打印预览（/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByLabel('纸张')).toHaveValue('A4');
    const frame = page.locator('.stp__preview');
    await expect(frame).toBeVisible();
    const srcA4 = await frame.getAttribute('src');
    expect(srcA4).toContain('size=A4');

    await page.getByLabel('纸张').selectOption('A3');
    await expect.poll(async () => frame.getAttribute('src'), { timeout: 15000 }).toContain('size=A3');
    // 版式选项真传进预览 URL
    await page.getByLabel('方向').selectOption('landscape');
    await expect.poll(async () => frame.getAttribute('src'), { timeout: 15000 }).toContain('orientation=landscape');
    await page.getByLabel('分栏').selectOption('2');
    await expect.poll(async () => frame.getAttribute('src'), { timeout: 15000 }).toContain('columns=2');

    // 预览内容真的渲染出来了（不是空白页）
    await expect(frame).toHaveAttribute('src', /paper\.html/);

    expect(consoleErrors, `控制台不应报错：${consoleErrors.join(' | ')}`).toEqual([]);
  });
});
