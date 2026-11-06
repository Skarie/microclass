<script setup lang="ts">
/**
 * 首页 · 学习看板
 *
 * 结构：
 *   ① 问候
 *   ② 继续学习 hero：最近在学的一门课 + 全页唯一橙色 CTA
 *   ③ 我的学习：学习时长、已完成课时、完成练习、错题待复习、等级进度
 *   ④ 今日待办：错题待复习 + 未完成练习（都为 0 时显示空态）
 *   ⑤ 我的课程：横向卡列（最多 5 门）
 *   ⑥ 学习资产：在学 / 已学完 / 收藏 / 错题收录
 *   ⑦ 快捷跳转：学习入口 + 教学管理入口（管理员）
 *
 * 取数与派生指标在 composables/use-home-dashboard.ts；
 * 所有数字来自 /me/summary、/me/wrong-questions、/courses。
 */
import { onMounted } from 'vue';
import HomeGreet from './home/HomeGreet.vue';
import HomeHero from './home/HomeHero.vue';
import HomeBoard from './home/HomeBoard.vue';
import HomeTodo from './home/HomeTodo.vue';
import HomeCourseRail from './home/HomeCourseRail.vue';
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

    <!-- ② 继续学习 -->
    <HomeHero :course="heroCourse" :progress="heroCourse ? progressOf(heroCourse) : 0" />

    <!-- ③ 我的学习 -->
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

    <!-- ④ 今日待办 -->
    <HomeTodo :wrong-pending="wrongPending" :practice-count="practiceCount" />

    <!-- ⑤ 我的课程 -->
    <HomeCourseRail :courses="myCourses" :progress-of="progressOf" />

    <!-- ⑥ 学习资产 -->
    <section class="home__block">
      <SectionHead title="学习资产" icon="folder" />
      <HomeAssets
        :learning-count="learning.length"
        :finished-count="finishedCourses.length"
        :favorite-count="favoriteCourses.length"
        :wrong-total="wrong?.total ?? 0"
      />
    </section>

    <!-- ⑦ 快捷跳转 -->
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
</style>
