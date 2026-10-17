import { expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * 共享工具：登录、通过 API 造数据（比 UI 点击稳定，UI 只负责验证关键路径）。
 */
export const ADMIN = { username: 'admin', password: 'admin123' };

export async function loginViaUi(page: Page, username = ADMIN.username, password = ADMIN.password): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('账号', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  // 登录页有"我已了解"协议勾选（对标学习通：不勾不能登录），测试也要勾
  const agree = page.locator('.login__agree input[type="checkbox"]');
  if ((await agree.count()) > 0) await agree.check();
  await page.getByRole('button', { name: /^登录$/ }).click();
  // 登录成功后离开登录页，并等主内容区渲染（顶栏与页面标题可能同名，不用 heading 断言）
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('#mc-main')).toBeVisible();
}

/**
 * 用 API 直接造数据：返回创建结果，供 UI 断言使用。
 *
 * `options.suffix`：给课程/课时/题库/考试名加唯一后缀。
 * **为什么要它**：E2E 共用同一个库，多个 spec 都造名为「E2E 课程」的课程后，
 * 课程大厅里会出现多张同名卡片，主流程里 `locator('.course-card', { hasText: 'E2E 课程' })`
 * 会命中多个元素直接报 strict mode violation（这不是界面 bug，是测试互相污染）。
 * 需要多次造数据的 spec 应传唯一后缀（exam-compose 早就这么做了）。
 */
export async function seedViaApi(
  request: APIRequestContext,
  options?: { suffix?: string },
): Promise<{
  courseId: number;
  lessonId: number;
  bankId: number;
  questionIds: number[];
  examId: number;
  /** 实际使用的名字（带后缀）：断言请用它们，别用子串匹配 */
  courseName: string;
  lessonTitle: string;
  bankName: string;
  examTitle: string;
}> {
  const suffix = options?.suffix ?? '';
  const login = await request.post('/api/v1/auth/login', { data: ADMIN });
  expect(login.ok(), '管理员登录应成功').toBeTruthy();

  const course = await request.post('/api/v1/courses', {
    data: { name: `E2E 课程${suffix}`, description: '端到端测试课程', published: true },
  });
  expect(course.ok()).toBeTruthy();
  const courseId = ((await course.json()) as { id: number }).id;

  const lesson = await request.post('/api/v1/lessons', {
    data: {
      title: `E2E 课时${suffix}`,
      description: '用于端到端测试',
      videoKind: 'url',
      videoPath: 'https://example.com/e2e.mp4',
      courseId,
      groupName: '第一章',
    },
  });
  expect(lesson.ok()).toBeTruthy();
  const lessonId = ((await lesson.json()) as { id: number }).id;

  const bank = await request.post('/api/v1/banks', { data: { name: `E2E 题库${suffix}`, lessonId } });
  expect(bank.ok()).toBeTruthy();
  const bankId = ((await bank.json()) as { id: number }).id;

  const specs = [
    { type: 'single', stem: 'Java 中定义常量的关键字是？', options: ['const', 'final', 'static'], answer: 'B' },
    { type: 'multiple', stem: '属于基本类型的有？', options: ['int', 'String', 'boolean'], answer: 'AC' },
    { type: 'judge', stem: 'Java 是编译型语言。', answer: '对' },
    { type: 'fill', stem: '程序入口方法是 ___ 。', answer: 'main|Main' },
  ] as const;
  const questionIds: number[] = [];
  for (const spec of specs) {
    const res = await request.post(`/api/v1/banks/${bankId}/questions`, {
      data: { bankId, ...spec },
    });
    expect(res.ok(), `创建题目失败：${await res.text()}`).toBeTruthy();
    questionIds.push(((await res.json()) as { id: number }).id);
  }

  const exam = await request.post('/api/v1/exams', {
    data: {
      courseId,
      title: `E2E 考试${suffix}`,
      description: '限时 10 分钟',
      durationMinutes: 10,
      passScore: 60,
      status: 'published',
    },
  });
  expect(exam.ok()).toBeTruthy();
  const examId = ((await exam.json()) as { id: number }).id;
  const addQuestions = await request.post(`/api/v1/exams/${examId}/questions`, {
    data: { questionIds: questionIds.slice(0, 3) },
  });
  expect(addQuestions.ok()).toBeTruthy();

  return {
    courseId,
    lessonId,
    bankId,
    questionIds,
    examId,
    courseName: `E2E 课程${suffix}`,
    lessonTitle: `E2E 课时${suffix}`,
    bankName: `E2E 题库${suffix}`,
    examTitle: `E2E 考试${suffix}`,
  };
}
