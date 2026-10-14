import { expect, test } from '@playwright/test';
import { loginViaUi, seedViaApi } from './helpers';
import { blockingOf, scanPage } from './a11y-scan';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 组卷向导页的无障碍扫描（独立用例，自带数据）。
 *
 * 为什么不并进 a11y.spec.ts：那个文件刻意**不种数据**（避免往共享库塞同名课程干扰其它用例），
 * 而组卷页必须有考试才能打开 —— 动态路由 + 需要试卷，所以这里单独 seed 一条唯一命名的数据，
 * 并对**三个步骤**各扫一遍（步骤内容差别很大：树 / 大表格 / 两行式试卷）。
 */
test.describe('组卷页无障碍', () => {
  test('试卷页与选题弹窗都无 serious/critical 无障碍问题', async ({ page, request }) => {
    const seeded = await seedViaApi(request, { suffix: ` a11y ${Date.now().toString(36)}` });
    await loginViaUi(page);
    await page.goto(`/admin/exams/${seeded.examId}/compose`);
    await expect(page.locator('.stp')).toBeVisible({ timeout: 30000 });

    const reports: string[] = [];

    /** 扫一处并落盘报告，返回阻塞项数量 */
    async function scan(name: string): Promise<number> {
      await page.waitForTimeout(700);
      const violations = await scanPage(page);
      const blocking = blockingOf(violations);
      fs.mkdirSync('test-results', { recursive: true });
      fs.writeFileSync(
        path.join('test-results', `a11y-组卷-${name}.txt`),
        `# 组卷 ${name}\n阻塞项：${blocking.length}\n${JSON.stringify(violations, null, 2)}\n`,
      );
      reports.push(`${name}:${blocking.length}`);
      expect(blocking, `${name} 不应有 serious/critical 问题：${JSON.stringify(blocking)}`).toEqual([]);
      return blocking.length;
    }

    // 1) 第①步：范围树
    await scan('第1步-选范围');

    // 2) 第②步：组卷方式
    await page.getByRole('button', { name: /下一步：选择组卷方式/ }).click();
    await scan('第2步-选组卷方式');

    // 3) 第④步：打印预览（含 iframe 与控制项）
    await page.locator('.stp__item').filter({ hasText: '打印预览' }).click();
    await scan('第4步-打印预览');

    // 4) 自己挑题（整页三区：左筛选 + 中列表 + 右已选篮）
    await page.locator('.stp__item').filter({ hasText: '选组卷方式' }).click();
    await page.getByRole('button', { name: '打开题库挑题' }).click();
    await expect(page.locator('.pk')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.pk__side .tree')).toBeVisible({ timeout: 20000 });
    await scan('自己挑题（整页）');

    console.log(`组卷无障碍扫描：${reports.join('｜')}`);
  });
});
