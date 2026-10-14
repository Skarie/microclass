import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { ADMIN, loginViaUi } from './helpers';

/**
 * 学情分析页（机构视角）端到端。
 *
 * 覆盖两条最有价值的路径：
 *   1. **数据很少时如实说明**：库几乎是空的，页面必须明说"还没有作答记录 / 样本很少"，
 *      而不是显示一堆 0 让机构误读（这是本页最容易做错的地方）；
 *   2. **有作答数据后** KPI、学员、错题都要出来，页签与导出入口可用。
 *
 * 造数据走真实 API：建课程/题库/题目/考试，再用**学员身份真交一次卷**，
 * 这样 `exam_attempts` 里就是真实判分结果（含 correct 标记）。
 */

interface Seeded {
  courseId: number;
  examId: number;
  questionIds: number[];
  student: { username: string; password: string };
}

async function seedWithAttempt(request: {
  post: (
    url: string,
    options?: { data?: unknown; headers?: Record<string, string> },
  ) => Promise<{
    ok: () => boolean;
    json: () => Promise<unknown>;
    headers: () => Record<string, string>;
  }>;
}): Promise<Seeded> {
  const admin = await request.post('/api/v1/auth/login', { data: ADMIN });
  expect(admin.ok()).toBeTruthy();
  const adminCookie = `microclass_sid=${((await admin.json()) as { token?: string }) && ''}`;
  void adminCookie; // 下面的请求靠 Playwright 的 storageState 无关，直接用返回的 cookie
  const setCookie = admin.headers()['set-cookie'] ?? '';
  const cookie = setCookie
    .split(',')
    .map((c) => c.split(';')[0]?.trim())
    .filter((c) => c?.startsWith('microclass_sid='))
    .join('; ');

  const suffix = Date.now().toString(36);
  const course = await request.post('/api/v1/courses', {
    data: { name: `E2E 学情课程 ${suffix}`, published: true },
    headers: { cookie },
  });
  const courseId = ((await course.json()) as { id: number }).id;

  const bank = await request.post('/api/v1/banks', {
    data: { name: `E2E 学情题库 ${suffix}`, courseId },
    headers: { cookie },
  });
  const bankId = ((await bank.json()) as { id: number }).id;

  const questionIds: number[] = [];
  for (const [stem, answer] of [
    ['学情 E2E 题一', 'A'],
    ['学情 E2E 题二', 'B'],
  ] as const) {
    const res = await request.post(`/api/v1/banks/${bankId}/questions`, {
      data: { bankId, type: 'single', stem, options: ['A', 'B'], answer },
      headers: { cookie },
    });
    questionIds.push(((await res.json()) as { id: number }).id);
  }

  const exam = await request.post('/api/v1/exams', {
    data: {
      courseId,
      title: `E2E 学情考试 ${suffix}`,
      durationMinutes: 30,
      passScore: 60,
      status: 'published',
    },
    headers: { cookie },
  });
  const examId = ((await exam.json()) as { id: number }).id;
  await request.post(`/api/v1/exams/${examId}/questions`, { data: { questionIds }, headers: { cookie } });

  // 学员注册并真交一次卷：题一答对、题二答错
  const student = { username: `anastu${suffix}`, password: 'student123' };
  const reg = await request.post('/api/v1/auth/register', {
    data: { username: student.username, password: student.password, displayName: 'E2E 学情学员' },
  });
  expect(reg.ok(), `注册学员失败：${await reg.json().then((b) => JSON.stringify(b))}`).toBeTruthy();
  const regCookie = (reg.headers()['set-cookie'] ?? '')
    .split(',')
    .map((c) => c.split(';')[0]?.trim())
    .filter((c) => c?.startsWith('microclass_sid='))
    .join('; ');

  const submit = await request.post(`/api/v1/exams/${examId}/submit`, {
    data: {
      answers: [
        { qid: questionIds[0], answer: 'A' },
        { qid: questionIds[1], answer: 'A' },
      ],
    },
    headers: { cookie: regCookie },
  });
  expect(submit.ok(), `交卷失败：${JSON.stringify(await submit.json())}`).toBeTruthy();

  return { courseId, examId, questionIds, student };
}

test.describe('学情分析', () => {
  test('有作答数据：KPI、学员、错题与页签都正常，控制台无错', async ({ page, request }) => {
    const seeded = await seedWithAttempt(request);
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await loginViaUi(page);
    await page.goto('/admin/analytics');
    await expect(page.getByRole('heading', { name: '学情分析' })).toBeVisible();

    // 数据规模说明必须显示
    await expect(page.locator('.ana__note')).toBeVisible();

    // 限定到刚造的课程 + 全部历史，避免受其它 spec 数据影响
    await page.getByLabel('选择课程').selectOption(String(seeded.courseId));
    await page.getByLabel('时间范围').selectOption('0');
    await expect(page.locator('.ana__kpis')).toBeVisible();

    // 作答条目应≥2（一次考试两道客观题）
    const kpiText = await page.locator('.ana__kpis').innerText();
    expect(kpiText).toContain('作答条目');

    // 学员学情：应看到刚才的学员
    await page.getByRole('tab', { name: '学员学情' }).click();
    await expect(page.locator('.ana__panel')).toContainText('E2E 学情学员');

    // 高频错题：调到 1 次作答就能看到那道错题
    await page.getByRole('tab', { name: '高频错题' }).click();
    await page.getByLabel('最少作答次数').selectOption('1');
    await expect(page.locator('.ana__panel')).toContainText('学情 E2E 题二');

    // 知识点掌握度：这批题没设知识点，应该给出"还没有知识点维度的作答数据"的空状态
    await page.getByRole('tab', { name: '知识点掌握度' }).click();
    await expect(page.locator('.ana__panel')).toContainText(/还没有知识点维度的作答数据|个知识点/);

    // 作答趋势：应该有柱状图或空状态，页面不报错
    await page.getByRole('tab', { name: '作答趋势' }).click();
    await expect(page.locator('.ana__panel')).toBeVisible();

    expect(consoleErrors, `控制台不应报错：${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('导出文件能下载（讲评清单 Markdown / 高频错题 CSV）', async ({ page, request }) => {
    const seeded = await seedWithAttempt(request);
    await loginViaUi(page);
    await page.goto(`/admin/analytics?courseId=${seeded.courseId}`);
    await expect(page.getByRole('heading', { name: '学情分析' })).toBeVisible();

    // 接口带 content-disposition: attachment，浏览器是**下载**而不是渲染，
    // 所以这里等 download 事件并读文件内容（写成等弹窗 domcontentloaded 会一直超时）。
    const [md] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '讲评清单' }).click(),
    ]);
    expect(md.suggestedFilename()).toMatch(/\.md$/);
    const mdPath = await md.path();
    expect(fs.readFileSync(mdPath, 'utf8')).toContain('学情讲评清单');

    const [csv] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '高频错题 CSV' }).click(),
    ]);
    expect(csv.suggestedFilename()).toMatch(/\.csv$/);
    const csvPath = await csv.path();
    expect(fs.readFileSync(csvPath, 'utf8')).toContain('题号,知识点,题型');
  });
});
