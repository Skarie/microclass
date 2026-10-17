import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { usePanelStore } from '@/stores/panel';
import { useToastStore } from '@/stores/toast';

/**
 * 懒加载视图（带一次自动重试）。
 * 为什么需要：前端按路由分包，发版后旧的 chunk 哈希失效、或网络抖动时，
 * 动态 import 会失败；不重试就是**整页白屏**，用户不知道发生了什么。
 */
function lazyView<T>(loader: () => Promise<T>): () => Promise<T> {
  return async () => {
    try {
      return await loader();
    } catch (err) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      try {
        return await loader();
      } catch {
        throw err;
      }
    }
  };
}

/**
 * 路由与信息架构（对齐超星学习通 / 中国大学 MOOC）：
 * 学生学习流：课程大厅 → 课程详情（章节 → 课时）→ 观看页（视频 + 知识点 + 笔记 + 刷题）
 *             训练流：错题本 / 刷题记录 / 我的考试
 * 管理流：课程 · 课时 · 题库 · 考试 · 学员 · 统计 · 设置
 */
const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: (to, _from, saved) => saved ?? (to.hash ? { el: to.hash, behavior: 'smooth' } : { top: 0 }),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: lazyView(() => import('@/views/LoginView.vue')),
      meta: { public: true, title: '登录' },
    },
    {
      path: '/',
      component: lazyView(() => import('@/layouts/AppShell.vue')),
      children: [
        {
          path: '',
          name: 'home',
          component: lazyView(() => import('@/views/HomeView.vue')),
          meta: { title: '首页' },
        },
        {
          // 课程从首页拆出来独立成页（首页只放数据看板与快捷跳转）
          path: 'hall',
          name: 'hall',
          component: lazyView(() => import('@/views/CourseHallView.vue')),
          meta: { title: '课程大厅' },
        },
        {
          path: 'my-courses',
          name: 'my-courses',
          component: lazyView(() => import('@/views/MyCoursesView.vue')),
          meta: { title: '我的课程' },
        },
        {
          path: 'courses/:id',
          name: 'course',
          component: lazyView(() => import('@/views/CourseDetailView.vue')),
          meta: { title: '课程详情' },
        },
        {
          path: 'lessons/:id/watch',
          name: 'watch',
          component: lazyView(() => import('@/views/WatchView.vue')),
          meta: { title: '学习' },
        },
        {
          path: 'lessons/:id/quiz',
          name: 'quiz',
          component: lazyView(() => import('@/views/QuizView.vue')),
          meta: { title: '课后练习' },
        },
        {
          path: 'wrong-book',
          name: 'wrong-book',
          component: lazyView(() => import('@/views/WrongBookView.vue')),
          meta: { title: '错题本' },
        },
        {
          path: 'me',
          name: 'me',
          component: lazyView(() => import('@/views/ProfileView.vue')),
          meta: { title: '个人中心' },
        },
        {
          path: 'exams/:id/take',
          name: 'exam-take',
          component: lazyView(() => import('@/views/ExamTakeView.vue')),
          meta: { title: '在线考试' },
        },
        {
          path: 'exams/:id/result',
          name: 'exam-result',
          component: lazyView(() => import('@/views/ExamResultView.vue')),
          meta: { title: '考试成绩' },
        },
        {
          // 教师/管理员的落地页：关键数据 + 待办
          path: 'admin/overview',
          name: 'admin-overview',
          component: lazyView(() => import('@/views/admin/OverviewView.vue')),
          meta: { title: '总览', requiresTeacher: true },
        },
        {
          path: 'admin/courses',
          name: 'admin-courses',
          component: lazyView(() => import('@/views/admin/CourseAdminView.vue')),
          meta: { title: '课程管理', requiresTeacher: true },
        },
        {
          path: 'admin/courses/:id',
          name: 'admin-course-lessons',
          component: lazyView(() => import('@/views/admin/CourseLessonAdminView.vue')),
          meta: { title: '课程课时管理', requiresTeacher: true },
        },
        // 旧「课时管理」页面已并入课程管理：老书签/老链接直接跳过去，不再 404
        { path: 'admin/lessons', redirect: { name: 'admin-courses' } },
        {
          path: 'admin/banks',
          name: 'admin-banks',
          component: lazyView(() => import('@/views/admin/BankAdminView.vue')),
          meta: { title: '题库管理', requiresTeacher: true },
        },
        {
          path: 'admin/exams',
          name: 'admin-exams',
          component: lazyView(() => import('@/views/admin/ExamAdminView.vue')),
          meta: { title: '考试管理', requiresTeacher: true },
        },
        {
          // 组卷是独立页面（三步向导）：原先挤在考试管理页的 tab 里，
          // 列表 + 三栏各自滚动（四层滚动），挑题区也只有 396px。
          path: 'admin/exams/:id/compose',
          name: 'admin-exam-compose',
          component: lazyView(() => import('@/views/admin/ExamComposeView.vue')),
          meta: { title: '组卷', requiresTeacher: true },
        },
        {
          path: 'admin/question-conflicts',
          name: 'admin-question-conflicts',
          component: lazyView(() => import('@/views/admin/QuestionConflictView.vue')),
          meta: { title: '同题不同答案核对', requiresTeacher: true },
        },
        {
          path: 'admin/stats',
          name: 'admin-stats',
          component: lazyView(() => import('@/views/admin/StatsView.vue')),
          meta: { title: '学习统计', requiresTeacher: true },
        },
        {
          path: 'admin/analytics',
          name: 'admin-analytics',
          component: lazyView(() => import('@/views/admin/AnalyticsView.vue')),
          meta: { title: '学情分析', requiresTeacher: true },
        },
        {
          path: 'admin/users',
          name: 'admin-users',
          component: lazyView(() => import('@/views/admin/UserAdminView.vue')),
          meta: { title: '学员与账号', requiresAdmin: true },
        },
        {
          path: 'admin/settings',
          name: 'admin-settings',
          component: lazyView(() => import('@/views/admin/SettingsView.vue')),
          meta: { title: '系统设置', requiresAdmin: true },
        },
        {
          // 设计系统/组件规范：给团队看"标准长什么样"，同时作为视觉回归的稳定靶子
          // （不依赖业务数据，所以截图对比不会因为数据变化而误报）
          path: 'admin/design',
          name: 'admin-design',
          component: lazyView(() => import('@/views/admin/DesignSystemView.vue')),
          meta: { title: '设计系统', requiresAdmin: true },
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: lazyView(() => import('@/views/NotFoundView.vue')),
      meta: { public: true },
    },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  const toast = useToastStore();
  if (!auth.loaded) {
    try {
      await auth.fetchMeta();
    } catch {
      // 元信息接口不可用时按未登录处理，登录页仍可尝试登录
    }
  }
  if (to.meta.public) return true;
  if (!auth.isLoggedIn) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (to.meta.requiresAdmin && !auth.isAdmin) {
    toast.error('没有权限访问该页面');
    return { name: 'home' };
  }
  // 双面板：处于学员视图时不进管理页（管理员本人也一样）
  if (to.path.startsWith('/admin')) {
    const panel = usePanelStore();
    if (auth.isTeacher && !panel.isAdminPanel.value) {
      toast.info('已切换到教学管理面板');
      panel.setMode('admin');
    }
  }
  if (to.meta.requiresTeacher && !auth.isTeacher) {
    toast.error('需要教师或管理员权限');
    return { name: 'hall' };
  }
  return true;
});

router.afterEach((to) => {
  const title = (to.meta.title as string | undefined) ?? '';
  document.title = title ? `${title} · 微课堂` : '微课堂';
});

// 会话过期时统一跳登录
window.addEventListener('microclass:unauthorized', () => {
  const auth = useAuthStore();
  auth.clear();
  if (router.currentRoute.value.name !== 'login') {
    void router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } });
  }
});

export default router;
