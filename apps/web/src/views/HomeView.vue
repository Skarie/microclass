<script setup lang="ts">
/**
 * 首页 · 学习看板
 *
 * 结构：
 *   ① 问候
 *   ② 公告：登录可读，最多 2 条（无公告不渲染）
 *   ③ 继续学习 hero：最近在学的一门课 + 全页唯一橙色 CTA
 *   ④ 我的学习：学习时长、已完成课时、完成练习、错题待复习、等级进度
 *   ⑤ 今日待办 + 学习日历：桌面两列（≤1100 单列）
 *   ⑥ 我的课程：横向卡列（最多 5 门）
 *   ⑦ 推荐课程：3 张（同类优先、新上线其次，无可推荐不渲染）
 *   ⑧ 学习资产：在学 / 已学完 / 收藏 / 错题收录
 *   ⑨ 快捷跳转：学习入口 + 教学管理入口（管理员）
 *
 * 取数与派生指标在 composables/use-home-dashboard.ts；
 * 所有数字来自 /me/summary、/me/wrong-questions、/courses、/announcements、/me/activity。
 */
import { onMounted } from 'vue';
import HomeGreet from './home/HomeGreet.vue';
import HomeAnnouncements from './home/HomeAnnouncements.vue';
import HomeHero from './home/HomeHero.vue';
import HomeBoard from './home/HomeBoard.vue';
import HomeTodo from './home/HomeTodo.vue';
import HomeCalendar from './home/HomeCalendar.vue';
import HomeCourseRail from './home/HomeCourseRail.vue';
import HomeRecommend from './home/HomeRecommend.vue';
import HomeAssets from './home/HomeAssets.vue';
import HomeJumps from './home/HomeJumps.vue';
import SectionHead from '@/components/SectionHead.vue';
import { useHomeDashboard } from '@/composables/use-home-dashboard';
import { usePanelStore } from '@/stores/panel';

const {
  summary,
  wrong,
  learning,
  heroCourse,
  myCourses,
  recommended,
  wrongPending,
  practiceCount,
  learningDone,
  learningTotal,
  learningPercent,
  finishedCourses,
  favoriteCourses,
  metrics,
  levelHint,
  progressOf,
  load,
} = useHomeDashboard();
const panel = usePanelStore();

onMounted(() => void load());
</script>

<template>
  <section class="home">
    <!-- ① 问候 -->
    <HomeGreet :learning="learning" />

    <!-- ② 公告（无公告时模块自身不渲染） -->
    <HomeAnnouncements />

    <!-- ③ 继续学习 -->
    <HomeHero :course="heroCourse" :progress="heroCourse ? progressOf(heroCourse) : 0" />

    <!-- ④ 我的学习 -->
    <section class="home__block">
      <SectionHead title="我的学习" icon="chartBar" />
      <HomeBoard
        :metrics="metrics"
        :level="summary?.level ?? '—'"
        :level-hint="levelHint"
        :learning-done="learningDone"
        :learning-total="learningTotal"
        :learning-percent="learningPercent"
        :learning-count="learning.length"
      />
    </section>

    <!-- ⑤ 今日待办 + 学习日历：桌面并排，≤1100 单列 -->
    <div class="home__pair">
      <HomeTodo :wrong-pending="wrongPending" :practice-count="practiceCount" />
      <HomeCalendar />
    </div>

    <!-- ⑥ 我的课程 -->
    <HomeCourseRail :courses="myCourses" :progress-of="progressOf" />

    <!-- ⑦ 推荐课程（没有可推荐课程时模块自身不渲染） -->
    <HomeRecommend :items="recommended" />

    <!-- ⑧ 学习资产 -->
    <section class="home__block">
      <SectionHead title="学习资产" icon="folder" />
      <HomeAssets
        :learning-count="learning.length"
        :finished-count="finishedCourses.length"
        :favorite-count="favoriteCourses.length"
        :wrong-total="wrong?.total ?? 0"
      />
    </section>

    <!-- ⑨ 快捷跳转 -->
    <HomeJumps :is-admin="panel.isAdminPanel.value" />
  </section>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-8);
}

.home__block {
  display: flex;
  flex-direction: column;
}

/* 待办偏窄、日历偏宽：日历是 7 列网格，给它更多横向空间 */
.home__pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
  align-items: start;
  gap: var(--mc-space-6);
}

@media (max-width: 1100px) {
  .home__pair {
    grid-template-columns: 1fr;
    gap: var(--mc-space-8);
  }
}
</style>
