import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { blockingOf, formatViolations, scanPage } from './a11y-scan';
import { loginViaUi } from './helpers';

/**
 * 无障碍（a11y）自动化扫描：纳入验收，防止"界面越改越不可用"。
 *
 * 口径：WCAG 2.0/2.1 A + AA（wcag2a/wcag2aa/wcag21aa），**只卡 serious / critical**；
 * minor/moderate 打印出来当改进清单，不阻塞交付。
 *
 * 注意：这里**不调用 seedViaApi**。扫描不需要业务数据，而种数据会往共享库里塞同名课程，
 * 干扰其它用例（真机踩过：主流程用例因为多了 N 个「E2E 课程」而失败）。
 */
const SCAN_PAGES: { path: string; name: string }[] = [
  { path: '/wrong-book', name: '错题本' },
  { path: '/me', name: '个人中心' },
  { path: '/admin/overview', name: '总览' },
  { path: '/admin/courses', name: '课程管理' },
  { path: '/admin/banks', name: '题库管理' },
  { path: '/admin/exams', name: '考试管理' },
  { path: '/admin/question-conflicts', name: '冲突题核对' },
  { path: '/admin/stats', name: '学习统计' },
  { path: '/admin/users', name: '学员与账号' },
  { path: '/admin/settings', name: '系统设置' },
  { path: '/admin/design', name: '设计系统' },
];

function writeReport(name: string, pagePath: string, body: string): string {
  fs.mkdirSync('test-results', { recursive: true });
  const file = path.join('test-results', `a11y-${name.replace(/[^\w\u4e00-\u9fff]+/g, '_')}.txt`);
  fs.writeFileSync(file, `# ${name} ${pagePath}\n${body}\n`);
  return file;
}

test.describe('无障碍扫描（明色主题）', () => {
  for (const target of SCAN_PAGES) {
    test(`${target.name} 无 serious/critical 无障碍问题`, async ({ page }) => {
      await loginViaUi(page);
      await page.goto(target.path);
      await page.locator('#mc-main').waitFor({ state: 'visible', timeout: 30000 });
      await page.waitForTimeout(700);

      const violations = await scanPage(page);
      const blocking = blockingOf(violations);
      const advisory = violations.filter((v) => !blocking.includes(v));

      if (advisory.length > 0) {
        console.log(
          `[a11y 改进项] ${target.name}: ` +
            advisory.map((v) => `${v.id}(${v.impact ?? 'n/a'}×${v.nodes.length})`).join(', '),
        );
      }
      if (violations.length > 0) {
        console.log(`[a11y 报告] ${writeReport(target.name, target.path, formatViolations(violations))}`);
      }
      expect(
        blocking.map((v) => `${v.id}×${v.nodes.length}`),
        `${target.name} 存在 serious/critical 无障碍问题（详见 test-results/a11y-*.txt）`,
      ).toEqual([]);
    });
  }
});

test('深色主题：课程大厅与题库管理无 serious/critical 无障碍问题', async ({ page }) => {
  await loginViaUi(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const pagePath of ['/', '/admin/banks']) {
    await page.goto(pagePath);
    await page.locator('#mc-main').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(700);
    const blocking = blockingOf(await scanPage(page));
    if (blocking.length > 0) console.log(`[a11y 阻塞项·深色] ${pagePath}\n${formatViolations(blocking)}`);
    expect(
      blocking.map((v) => `${v.id}×${v.nodes.length}`),
      `深色主题 ${pagePath}`,
    ).toEqual([]);
  }
});
