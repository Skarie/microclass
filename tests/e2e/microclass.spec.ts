import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ADMIN, loginViaUi, seedViaApi } from './helpers';

/**
 * 全链路 E2E：登录 → 课程大厅 → 课程详情 → 观看页 → 课后练习 → 错题本 → 考试 → 管理端。
 * 浏览器控制台错误与页面级异常都会被断言，用于兜住「组件导入失败/运行时异常」这类问题。
 */
test.describe('微课堂端到端', () => {
  test('登录 → 课程大厅 → 课程详情 → 观看页 → 刷题判分 → 错题本', async ({ page, request }) => {
    const seeded = await seedViaApi(request, { suffix: ` 3` });
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    // 1. 登录
    await loginViaUi(page);

    // 2. 课程大厅能看到刚建的课程，并能进入详情
    // 注意：首页（/）现在是数据看板，课程在独立的 /hall
    await page.goto('/hall');
    await page.locator('#mc-main').waitFor({ state: 'visible' });
    // 用**课程 id 的链接**精确锁定自己造的课程：E2E 共用一个库，
    // 别的用例造的「E2E 课程 xxx」也会被 hasText 子串命中（真机表现：resolved to 3 elements）。
    const card = page.locator('.course-card').filter({ has: page.locator(`a[href$="/courses/${seeded.courseId}"]`) });
    await expect(card).toBeVisible();
    await card.getByRole('link', { name: /开始学习|继续学习/ }).click();
    await expect(page.getByRole('heading', { name: seeded.courseName })).toBeVisible();

    // 3. 章节分组与课时
    await expect(page.getByText('第一章')).toBeVisible();
    await page
      .getByRole('link', { name: /E2E 课时/ })
      .first()
      .click();

    // 4. 观看页：视频元素、知识点面板、笔记面板
    await expect(page.getByRole('heading', { name: 'E2E 课时' })).toBeVisible();
    await expect(page.locator('video')).toBeVisible();
    await expect(page.locator('.mc-card__title', { hasText: '知识点' })).toBeVisible();
    await expect(page.locator('.mc-card__title', { hasText: '我的笔记' })).toBeVisible();

    // 写入一条笔记并断言出现在列表里
    await page.getByLabel('笔记内容').fill('E2E 笔记：这里讲的是常量');
    await page.getByRole('button', { name: '保存笔记' }).click();
    await expect(page.getByText('E2E 笔记：这里讲的是常量')).toBeVisible();

    // 5. 课后练习：直链课时无需看完即可作答
    await page
      .getByRole('link', { name: /课后练习/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: /课后练习 · E2E 课时/ })).toBeVisible();

    // 作答：单选 B、多选 AC、判断对、填空 main
    // 注意：取题接口会打乱顺序，必须按题干定位而不是按序号
    const questions = page.locator('.question');
    await expect(questions).toHaveCount(4);

    const single = page.locator('.question', { hasText: 'Java 中定义常量的关键字是？' });
    await single.getByRole('radio').nth(1).check();

    const multiple = page.locator('.question', { hasText: '属于基本类型的有？' });
    await multiple.getByRole('checkbox').nth(0).check();
    await multiple.getByRole('checkbox').nth(2).check();
    // 两个选项都要保持勾选（多选状态不能被覆盖）
    await expect(multiple.getByRole('checkbox').nth(0)).toBeChecked();
    await expect(multiple.getByRole('checkbox').nth(2)).toBeChecked();

    const judge = page.locator('.question', { hasText: 'Java 是编译型语言。' });
    await judge.getByRole('radio').first().check();

    const fill = page.locator('.question', { hasText: '程序入口方法是' });
    await fill.locator('input.mc-input').fill('main');

    await page.getByRole('button', { name: '提交并判分' }).click();

    // 6. 判分结果：4 题全对
    await expect(page.locator('.quiz__score-num')).toHaveText('4');
    await expect(page.getByText(/历史最好 100%/)).toBeVisible();

    // 7. 错题本可从结果区进入
    await page.getByRole('link', { name: '查看错题本' }).click();
    await expect(page).toHaveURL(/\/wrong-book/);

    expect(consoleErrors, `控制台不应报错：${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('在线考试：倒计时作答 → 交卷 → 成绩复盘', async ({ page, request }) => {
    const seeded = await seedViaApi(request, { suffix: ` 1` });
    await loginViaUi(page);

    await page.goto(`/exams/${seeded.examId}/take`);
    await expect(page.getByText('E2E 考试').first()).toBeVisible();
    // 倒计时在页面上可见（10 分钟限时）
    await expect(page.getByText(/10:00|09:5\d/)).toBeVisible();

    const questions = page.locator('.question');
    await expect(questions).toHaveCount(3);

    // 按题干定位（考试卷内顺序固定，但仍不依赖序号）
    const single = page.locator('.question', { hasText: 'Java 中定义常量的关键字是？' });
    await single.getByRole('radio').nth(1).check();

    const multiple = page.locator('.question', { hasText: '属于基本类型的有？' });
    await multiple.getByRole('checkbox').nth(0).check();
    await multiple.getByRole('checkbox').nth(2).check();
    // 倒计时每秒重渲染，多选状态必须保持
    await page.waitForTimeout(1200);
    await expect(multiple.getByRole('checkbox').nth(0)).toBeChecked();
    await expect(multiple.getByRole('checkbox').nth(2)).toBeChecked();

    const judge = page.locator('.question', { hasText: 'Java 是编译型语言。' });
    await judge.getByRole('radio').first().check();

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: /交卷/ }).click();

    await expect(page).toHaveURL(/\/exams\/\d+\/result/);
    await expect(page.getByText(/及格/).first()).toBeVisible();
  });

  test('课时批量改绑：勾选未归类课时 → 改绑到课程并统一章节', async ({ page, request }) => {
    const seeded = await seedViaApi(request, { suffix: ` 2` });

    // 造两个「未归类」课时（视频用直链，避免依赖文件与权限）
    for (const n of [1, 2]) {
      const res = await request.post('/api/v1/lessons', {
        data: {
          title: `E2E 待归类 ${n}`,
          videoKind: 'url',
          videoPath: `https://example.com/orphan-${n}.mp4`,
        },
      });
      expect(res.ok()).toBeTruthy();
    }

    await loginViaUi(page);
    await page.goto('/admin/courses');

    // 切到「未归类课时」选项卡
    await page.getByRole('tab', { name: /未归类课时/ }).click();
    await expect(page.getByText('E2E 待归类 1')).toBeVisible();

    // 勾选两条（表头有全选，这里逐条勾选以验证单选逻辑）
    await page.getByLabel('选择课时 E2E 待归类 1').check();
    await page.getByLabel('选择课时 E2E 待归类 2').check();
    await expect(page.getByText(/已选 2 个课时/)).toBeVisible();

    // 打开批量改绑弹窗
    await page.getByRole('button', { name: /批量改绑到课程/ }).click();
    await page.getByLabel('目标课程').selectOption(String(seeded.courseId));
    await page.getByLabel('统一章节名（可选）').fill('第一章 E2E 归入');
    await page.getByRole('button', { name: '确认改绑' }).click();

    // 断言：未归类列表里不应再出现，且课程课时管理里能看到它们与统一后的章节
    await expect(page.getByText('E2E 待归类 1')).toHaveCount(0);

    await page.goto(`/admin/courses/${seeded.courseId}`);
    await expect(page.getByText('E2E 待归类 1')).toBeVisible();
    await expect(page.getByText('第一章 E2E 归入').first()).toBeVisible();

    // 「全部课时」选项卡：跨课程检索（按课程筛选 + 关键词搜索）
    await page.goto('/admin/courses');
    await page.getByRole('tab', { name: /全部课时/ }).click();
    await expect(page.getByText('E2E 课时').first()).toBeVisible();
    await page.getByLabel('按课程筛选课时').selectOption('orphan');
    await expect(page.getByText('E2E 待归类 1')).toHaveCount(0);
    await page.getByLabel('按课程筛选课时').selectOption(String(seeded.courseId));
    await expect(page.getByText('E2E 待归类 1')).toBeVisible();
    await page.getByLabel('搜索课时').fill('待归类 2');
    await expect(page.getByText('E2E 待归类 2')).toBeVisible();
    await expect(page.getByText('E2E 待归类 1')).toHaveCount(0);
  });

  test('网页直接上传视频：上传时新建课程 → 自动归入该课程', async ({ page, request }) => {
    await seedViaApi(request, { suffix: ` 4` });
    await loginViaUi(page);
    await page.goto('/admin/courses');

    await page.getByRole('tab', { name: /未归类课时/ }).click();
    // 工具栏那个按钮；空状态里还有一个同名按钮
    await page
      .locator('.toolbar')
      .getByRole('button', { name: /上传视频/ })
      .click();
    await expect(page.getByText('把视频或整个文件夹拖到这里')).toBeVisible();

    // 与原「课时管理」一致的两项能力：选择整个文件夹、上传时新建课程
    await expect(page.getByText('选择整个文件夹')).toBeVisible();
    await page.getByLabel('上传到哪门课程').selectOption('new');
    await page.getByLabel('新课程名称').fill('E2E 上传新建课程');

    // 选一个（假的）mp4：只需扩展名合法、内容非空
    await page.locator('input[type=file][accept="video/*"]').setInputFiles({
      name: 'e2e 上传测试.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('e2e-fake-mp4-content-0123456789'),
    });
    await expect(page.getByText('e2e 上传测试.mp4')).toBeVisible();

    await page.getByLabel('章节怎么定').selectOption('custom');
    await page.getByLabel('统一章节名').fill('第一章 上传测试');
    await page.getByRole('button', { name: /开始上传/ }).click();

    // 上传成功后汇总区出现「成功 1」
    await expect(page.locator('.upload-list__summary')).toContainText('成功 1');
    // 关闭上传弹窗（弹窗头部还有个「×」也叫关闭，这里限定在底部按钮区）
    await page.locator('.modal-footer').getByRole('button', { name: '关闭' }).click();

    // 新建的课程出现在课程管理里，点进去能看到刚上传的课时与章节
    await page.getByRole('tab', { name: /^课程/ }).click();
    // 课程管理默认列表视图：用课程链接定位（不再依赖"平铺卡片"这种展示细节）
    const link = page.getByRole('link', { name: 'E2E 上传新建课程' });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByText('e2e 上传测试')).toBeVisible();
    await expect(page.getByText('第一章 上传测试').first()).toBeVisible();
  });

  test('题库导入导出：Markdown / Word 按钮可用，导入 .md 后题目入库', async ({ page, request }) => {
    await seedViaApi(request, { suffix: ` 5` });
    // 用专属题库，避免与其它用例造的题库混淆
    const name = `E2E 格式题库 ${Date.now().toString(36)}`;
    const created = await request.post('/api/v1/banks', { data: { name } });
    expect(created.ok()).toBeTruthy();
    const bankId = ((await created.json()) as { id: number }).id;

    await loginViaUi(page);
    await page.goto('/admin/banks');
    await page.getByText(name).first().click();
    await expect(page.locator('.bank-head__name', { hasText: name })).toBeVisible();

    // 主操作常驻（导入/新建），导出类收进「导出 / 更多」下拉（界面升级：不再 8 个按钮并排）
    // 注意：空题库时 EmptyState 里也有一个"新建题目"，所以这里限定在详情面板头部断言
    const panelActions = page.locator('.question-panel .mc-card__header');
    await expect(panelActions.getByRole('button', { name: '新建题目' })).toBeVisible();
    await expect(panelActions.getByRole('button', { name: /导入题目|导入中/ })).toBeVisible();
    // 模板下载也收进了「导出 / 更多」菜单（界面上不再有两颗常驻按钮）
    await panelActions.getByRole('button', { name: /导出 \/ 更多/ }).click();
    await expect(page.getByRole('menuitem', { name: '下载 CSV 模板' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '下载 Markdown 模板' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '导出 CSV' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '导出 Markdown' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '导出 Word（含答案）' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Word 试卷（不含答案）' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '清理重复题' })).toBeVisible();
    // 键盘可达：Esc 关闭菜单，菜单项从 DOM 移除
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: '导出 CSV' })).toHaveCount(0);

    // 用 Markdown 导入一道题（走 UI 上传路径）
    const md = ['### 1. 单选题', 'E2E 导入的题目？', 'A. 甲', 'B. 乙', '答案：B', '解析：因为乙对'].join('\n');
    await page.locator('input[type=file][accept*=".md"]').setInputFiles({
      name: 'e2e-题目.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(md, 'utf8'),
    });

    // 导入结果弹窗 → 题目出现在列表里
    await expect(page.getByText('成功导入 1 题')).toBeVisible();
    await page.getByRole('button', { name: '知道了' }).click();
    await expect(page.getByText('E2E 导入的题目？')).toBeVisible();

    // 导出走下载接口：Markdown 文本与 Word 二进制都校验一遍
    const exportRes = await request.get(`/api/v1/banks/${bankId}/export.md`);
    expect(exportRes.ok()).toBeTruthy();
    expect(await exportRes.text()).toContain('E2E 导入的题目？');

    const docxRes = await request.get(`/api/v1/banks/${bankId}/export.docx`);
    expect(docxRes.ok()).toBeTruthy();
    expect((await docxRes.body()).subarray(0, 2).toString('utf8')).toBe('PK');
  });

  /**
   * 难度划分（本轮新增能力）：内容特征先验 → 三档/五级 → 人工标注优先。
   * 覆盖「有下拉框但题目难度一直没被划分」的修复：
   *  1. 未评估的题经「重算难度」后有分数与星级；
   *  2. 老师在下拉框里手动选难度会记为人工标注，之后的自动重算不会覆盖它。
   */
  test('题库难度：重算难度（先预览后应用）+ 人工标注不被覆盖', async ({ page, request }) => {
    const login = await request.post('/api/v1/auth/login', { data: ADMIN });
    expect(login.ok()).toBeTruthy();
    const name = `E2E 难度题库 ${Date.now().toString(36)}`;
    // 建题库时带上书册：新建题目会继承它，难度模型据此判断学段基准
    const bankRes = await request.post('/api/v1/banks', {
      data: { name, subject: '数学', book: '七年级上册（新）', kind: 'paper' },
    });
    expect(bankRes.ok()).toBeTruthy();
    const bankId = ((await bankRes.json()) as { id: number }).id;
    for (const q of [
      { type: 'fill', stem: '计算 $2+3=$____。', answer: '5' },
      {
        type: 'fill',
        stem: '观察下列各数的规律：$1,3,6,10,15,\\cdots$，第 $n$ 个数是____，并说明理由。',
        answer: 'n(n+1)/2',
      },
    ]) {
      const created = await request.post(`/api/v1/banks/${bankId}/questions`, { data: { bankId, ...q } });
      expect(created.ok(), `造题失败：${await created.text()}`).toBeTruthy();
    }

    await loginViaUi(page);
    await page.goto('/admin/banks');
    await page.getByText(name).first().click();
    await expect(page.locator('.bank-head__name', { hasText: name })).toBeVisible();

    // 还没评估过 → 显示「难度 未评估」（原来这是星级徽标，已改成可读文字）
    const firstDiff = page.locator('.item, tbody tr').filter({ hasText: '计算' }).first().locator('.diff-text');
    await expect(firstDiff).toBeVisible();
    await expect(page.locator('.diff-text').first()).toContainText('未评估');

    // 打开体检 → 难度划分面板 → 重算难度（先看预览）
    await page.getByRole('button', { name: '题库体检' }).click();
    await expect(page.getByText('难度划分')).toBeVisible();
    await page.getByRole('button', { name: '重算难度' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByText(/将评估 2 道题/)).toBeVisible();
    await expect(modal.getByText(/五级口径/)).toBeVisible();
    await modal.getByRole('button', { name: '确认重算' }).click();
    await expect(page.getByText(/已重算 \d+ 道题的难度/)).toBeVisible();
    // 体检现在是**弹窗**（原来是在页面中间插入一整块，会顶得内容上下跳）：
    // 重算完先关掉，才能操作后面的题目列表
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // 重算后有了评分；规律题应当比口算题更难
    // 等表格刷新完成再取值：确认重算后 toast 先出来，列表是异步重载的
    await expect(page.locator('.diff-text').first()).toHaveAttribute('title', /\/100/);
    await expect(page.locator('.diff-text').first()).not.toContainText('未评估');
    // 评分现在显示在「难度 中等 · 56」里，来源收进 title（悬停可见）
    await expect(page.locator('.diff-text').first()).toHaveAttribute('title', /模型/);
    const texts = await page.locator('.diff-text').allInnerTexts();
    expect(texts.length).toBeGreaterThanOrEqual(2);
    const nums = texts.map((s) => Number(s.match(/·\s*(\d+)/)?.[1] ?? '0'));
    expect(Math.max(...nums)).toBeGreaterThan(Math.min(...nums));

    // 老师手动指定难度 → 记人工标注
    const row = page.locator('tbody tr', { hasText: '计算' }).first();
    await row.getByRole('button', { name: '编辑' }).click();
    const editModal = page.getByRole('dialog');
    await editModal.locator('select.mc-select').last().selectOption('hard');
    await editModal.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('题目已保存')).toBeVisible();
    await expect(row.locator('.diff-text')).toHaveAttribute('title', /人工/);

    // 再重算一次：人工标注的题保持「较难」，且被统计为跳过
    await page.getByRole('button', { name: '题库体检' }).click();
    await page.getByRole('button', { name: '重算难度' }).click();
    await expect(page.getByRole('dialog').getByText(/保留人工标注 1 道/)).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: '确认重算' }).click();
    await expect(row.locator('.diff-text')).toContainText('较难');
  });

  test('管理端各页面可打开且无运行时错误', async ({ page, request }) => {
    await seedViaApi(request, { suffix: ` 6` });
    await loginViaUi(page);

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const routes = [
      '/admin/courses',
      '/admin/banks',
      '/admin/exams',
      '/admin/stats',
      '/admin/users',
      '/admin/settings',
      '/wrong-book',
      '/me',
    ];
    for (const route of routes) {
      await page.goto(route);
      // 每个页面都应有可见的主内容（不是空白页 / 错误页）
      await expect(page.locator('#mc-main'), `${route} 应渲染主内容`).toBeVisible();
      await expect(page.locator('#mc-main')).not.toBeEmpty();
    }

    expect(errors, `管理端页面不应抛异常：${errors.join(' | ')}`).toEqual([]);
  });

  test('主题切换与深色模式持久化', async ({ page }) => {
    await loginViaUi(page);
    const html = page.locator('html');
    const initial = await html.getAttribute('data-theme');

    await page.getByRole('button', { name: /切换到.*主题/ }).click();
    const toggled = await html.getAttribute('data-theme');
    expect(toggled).not.toBe(initial);

    await page.reload();
    await expect(html).toHaveAttribute('data-theme', toggled ?? 'light');
  });

  test('未登录访问受保护页面会跳转登录页，且登录后可回到原地址', async ({ page }) => {
    await page.goto('/wrong-book');
    await expect(page).toHaveURL(/\/login\?redirect=/);

    await page.getByLabel('账号').fill('admin');
    await page.getByLabel('密码').fill('admin123');
    await page.getByRole('button', { name: /^登录$/ }).click();
    await expect(page).toHaveURL(/\/wrong-book/);
  });

  /**
   * 课程 → 课时 的完整工作流（用户核心诉求）：
   * 课程管理默认平铺展示 → 点课程进入它的课时管理 → 绑定视频文件夹 → 扫描导入 →
   * 拖拽调整顺序（顺序落库）→ 列表/平铺视图切换并持久化。
   */
  test('课程管理：平铺/列表切换 + 课程内绑定文件夹扫描导入 + 课时拖拽排序', async ({ page, request }) => {
    // 高一点的视口：拖拽排序不需要滚动页面，行为更稳定
    await page.setViewportSize({ width: 1440, height: 1100 });
    // 每次运行一个独立的父目录，媒体目录只登记这个父目录、课程只绑定其中的子目录，
    // 这样临时目录里的其它残留文件不会混进扫描结果
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-e2e-work-'));
    const courseFolder = '课程资料';
    const mediaDir = path.join(workDir, courseFolder);
    try {
      for (const [chapter, files] of [
        ['第一章 基础', ['01 a.mp4', '02 b.mp4']],
        ['第二章 进阶', ['03 c.mp4']],
      ] as [string, string[]][]) {
        fs.mkdirSync(path.join(mediaDir, chapter), { recursive: true });
        for (const f of files) fs.writeFileSync(path.join(mediaDir, chapter, f), Buffer.from('e2e-fake-mp4'));
      }

      const login = await request.post('/api/v1/auth/login', { data: ADMIN });
      expect(login.ok()).toBeTruthy();
      const rootRes = await request.post('/api/v1/media-roots', {
        data: { name: 'E2E 视频库', path: workDir },
      });
      expect(rootRes.ok(), `创建媒体目录失败：${await rootRes.text()}`).toBeTruthy();
      const rootId = ((await rootRes.json()) as { root: { id: string } }).root.id;

      const courseRes = await request.post('/api/v1/courses', {
        data: { name: 'E2E 文件夹课程', description: '课程文件夹扫描', published: true },
      });
      expect(courseRes.ok()).toBeTruthy();
      const courseId = ((await courseRes.json()) as { id: number }).id;

      await loginViaUi(page);
      await page.goto('/admin/courses');

      // 1. 默认**列表**视图（结构规范：列表先于卡片网格）：表里能看到课程与文件夹状态
      await expect(page.locator('table.mc-table')).toBeVisible();
      const row = page.getByRole('row', { name: /E2E 文件夹课程/ });
      // 表格视图里的文件夹列是简写（未绑定 / 目录名）
      await expect(row).toContainText('未绑定');

      // 2. 点课程名链接 → 进入该课程的课时管理
      // （卡片整体不再可点：整卡 role="button" 里嵌链接和按钮会命中 axe nested-interactive）
      await row.getByRole('link', { name: 'E2E 文件夹课程' }).click();
      await expect(page).toHaveURL(new RegExp(`/admin/courses/${courseId}$`));
      await expect(page.getByRole('heading', { name: 'E2E 文件夹课程' })).toBeVisible();

      // 3. 绑定课程文件夹（媒体目录下的「课程资料」子目录）
      await page.getByRole('button', { name: '选择文件夹' }).click();
      await page.getByLabel('媒体目录').selectOption(rootId);
      await page.getByLabel('子文件夹').fill(courseFolder);
      await page.getByRole('button', { name: '保存并扫描' }).click();
      await expect(page.getByText('课程文件夹已绑定')).toBeVisible();

      // 4. 扫描导入：先看预览再确认（工具栏那个按钮；空状态里还有一个同名按钮）
      await page.locator('.toolbar').getByRole('button', { name: '扫描文件夹' }).click();
      await expect(page.getByText('将新增课时')).toBeVisible();
      await page.getByRole('button', { name: /导入 3 个课时/ }).click();
      await expect(page.getByText(/扫描完成：新增 3 个课时/)).toBeVisible();

      // 子文件夹成为章节，视频成为课时
      await expect(page.locator('.lesson')).toHaveCount(3);
      await expect(page.locator('.chapter__name')).toHaveText(['第一章 基础', '第二章 进阶']);

      // 5. 再扫一次：没有新视频，不重复导入（课程文件夹卡片上的「扫描更新」）
      await page.locator('.folder').getByRole('button', { name: '扫描更新' }).click();
      await expect(page.getByText('将新增课时')).toBeVisible();
      await expect(page.locator('.scan-summary__item', { hasText: '将新增课时' })).toContainText('0');
      await page.getByRole('button', { name: '确认扫描' }).click();
      await expect(page.getByText('扫描完成：没有新视频')).toBeVisible();
      await expect(page.locator('.lesson')).toHaveCount(3);

      // 6. 拖拽排序：把第 1 条拖到最后，并用接口确认顺序已落库
      const lessons = page.locator('.lesson');
      await expect(lessons.first()).toContainText('01 a');
      await lessons.first().locator('.lesson__handle').dragTo(lessons.nth(2));
      await expect(lessons.nth(2)).toContainText('01 a');
      const detail = await request.get(`/api/v1/courses/${courseId}/manage`);
      const ordered = ((await detail.json()) as { lessons: { title: string }[] }).lessons.map((l) => l.title);
      expect(ordered[2]).toBe('01 a');

      // 7. 回课程管理：列表视图显示绑定状态；切平铺后刷新仍记住（localStorage 持久化）
      await page.goto('/admin/courses');
      await expect(page.getByRole('row', { name: /E2E 文件夹课程/ })).toContainText('E2E 视频库');
      await page.getByRole('button', { name: '平铺展示' }).click();
      await expect(page.locator('.grid .card', { hasText: 'E2E 文件夹课程' })).toBeVisible();
      await page.reload();
      await expect(page.locator('.grid .card', { hasText: 'E2E 文件夹课程' })).toBeVisible();
      await page.getByRole('button', { name: '列表展示' }).click();
      await expect(page.locator('table.mc-table')).toBeVisible();
    } finally {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* 临时目录清理失败不影响测试结论 */
      }
    }
  });

  /**
   * 「同题不同答案」核对：造一组同题干不同答案的题 → 页面能列出来 → 选定答案整组统一 → 待核对清零。
   * 这条链路覆盖了「771 组冲突题要不要都能处理」的验收点。
   */
  test('冲突题核对：列出同题不同答案 → 选定答案整组统一', async ({ page, request }) => {
    const login = await request.post('/api/v1/auth/login', { data: ADMIN });
    expect(login.ok()).toBeTruthy();
    const bankRes = await request.post('/api/v1/banks', { data: { name: 'E2E 冲突题库' } });
    expect(bankRes.ok()).toBeTruthy();
    const bankId = ((await bankRes.json()) as { id: number }).id;

    const stem = 'E2E 冲突题：1 米 = ____ 厘米';
    for (const answer of ['100', '10']) {
      const q = await request.post(`/api/v1/banks/${bankId}/questions`, {
        data: { bankId, type: 'fill', stem, answer },
      });
      expect(q.ok(), `造题失败：${await q.text()}`).toBeTruthy();
    }
    // 真机上 38% 的冲突题答案是**不带 $ 的裸 LaTeX**（如 \frac{3}{9}|\frac{1}{3}），
    // 直接插值出来就是「像 md 源码」的样子 —— 这里造一组这样的答案守住渲染
    const latexStem = 'E2E 公式答案冲突：化简 ____ =';
    for (const answer of ['\\frac{3}{9}|\\frac{1}{3}', '\\frac{1}{3}']) {
      const q = await request.post(`/api/v1/banks/${bankId}/questions`, {
        data: { bankId, type: 'fill', stem: latexStem, answer },
      });
      expect(q.ok(), `造题失败：${await q.text()}`).toBeTruthy();
    }

    await loginViaUi(page);
    await page.goto('/admin/question-conflicts');
    await expect(page.locator('#mc-main').getByRole('heading', { name: '同题不同答案核对' })).toBeVisible();

    // 列表页不隐式扫全库（冷缓存时全库分组要几分钟，会把整站卡住）：先提示台账还没建立
    await expect(page.locator('.stale')).toContainText('台账还没建立');
    await expect(page.locator('.item')).toHaveCount(0);

    // 点「重新扫描全库」才扫，并回报耗时
    await page.getByRole('button', { name: '重新扫描全库' }).click();
    await expect(page.getByText(/扫描完成：台账 \d+ 组/)).toBeVisible();

    // 列表里能看到这组（题干 + 两个答案的票数）
    const item = page.locator('.item', { hasText: 'E2E 冲突题' });
    await expect(item).toBeVisible();
    await expect(item).toContainText('答案「100」');
    await expect(item).toContainText('答案「10」');

    // 裸 LaTeX 答案要渲染成公式、多种写法用「或」分开，而不是显示 \frac{3}{9}|\frac{1}{3} 源码
    const latexItem = page.locator('.item', { hasText: 'E2E 公式答案冲突' });
    await expect(latexItem).toBeVisible();
    await expect(latexItem.locator('.katex').first()).toBeVisible();
    await expect(latexItem.locator('.ans__or').first()).toBeVisible();
    await expect(latexItem).not.toContainText('\\frac');

    // 打开核对弹窗：组内两道题的现有答案都能看到
    await item.getByRole('button', { name: '核对' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByText('组内 2 道题，题干与选项一致。选定答案后整组统一。')).toBeVisible();
    await expect(modal.locator('tbody tr')).toHaveCount(2);

    // 点答案即选定 → 整组统一
    await modal.locator('.pick__answers .answer-pick', { hasText: '100' }).click();
    await expect(modal.locator('.mc-input')).toHaveValue('100');
    await modal.getByRole('button', { name: /统一为选定答案/ }).click();
    await expect(page.getByText(/已统一为「100」，共更新 2 道题/)).toBeVisible();

    // 待核对清零，题库里的两道题答案一致（题库里还有造出来的公式答案那组，按题干过滤）
    await expect(page.locator('.item', { hasText: 'E2E 冲突题' })).toHaveCount(0);
    const questions = await request.get(`/api/v1/banks/${bankId}/questions`);
    const list = ((await questions.json()) as { questions: { stem: string; answer: string }[] }).questions;
    const resolved = list.filter((q) => q.stem === stem);
    expect(resolved).toHaveLength(2);
    expect(resolved.every((q) => q.answer === '100')).toBe(true);

    // 「已核对」页签里能看到这条核对记录（台账保留核对历史）
    await page.getByRole('button', { name: /已核对/ }).click();
    await expect(page.locator('.item', { hasText: 'E2E 冲突题' })).toBeVisible();
  });
});
