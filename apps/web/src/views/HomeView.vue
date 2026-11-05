<script setup lang="ts">
/**
 * 首页 · 数据看板（课程已迁到独立的「课程大厅」页）
 *
 * 结构：
 *   ① 问候 + 一句话现状（今天/总体一句能读懂的话）
 *   ② 我的学习看板：学习时长、已完成课时、完成练习、错题待复习、等级进度
 *   ③ 学习资产：在学 / 已学完 / 收藏 + 总课时完成率（真实数据）
 *   ④ 最近在学：前 3 门，直接继续
 *   ⑤ 快捷跳转：学习入口 + 教学管理入口（管理员）
 *
 * 页面只做编排：
 *   - 取数与派生指标在 composables/use-home-dashboard.ts；
 *   - 五个区块在 ./home/*，各自带走自己的 scoped 样式；
 *   - 所有数字仍来自真实接口：/me/summary、/me/wrong-questions、/courses。
 */
import { onMounted } from 'vue';
import HomeGreet from './home/HomeGreet.vue';
import HomeBoard from './home/HomeBoard.vue';
import HomeAssets from './home/HomeAssets.vue';
import HomeRecent from './home/HomeRecent.vue';
import HomeJumps from './home/HomeJumps.vue';
import SectionHead from '@/components/SectionHead.vue';
import { useHomeDashboard } from '@/composables/use-home-dashboard';
import { usePanelStore } from '@/stores/panel';

const {
  summary,
  wrong,
  learning,
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

    <!-- ② 我的学习看板 -->
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

    <!-- ③ 学习资产 -->
    <section class="home__block">
      <SectionHead title="学习资产" icon="folder" />
      <HomeAssets
        :learning-count="learning.length"
        :finished-count="finishedCourses.length"
        :favorite-count="favoriteCourses.length"
        :wrong-total="wrong?.total ?? 0"
      />
    </section>

    <!-- ④ 最近在学 -->
    <section v-if="learning.length > 0" class="home__block">
      <SectionHead title="最近在学" icon="play" action-text="全部课程" action-to="/my-courses" />
      <HomeRecent :courses="learning" :progress-of="progressOf" />
    </section>

    <!-- ⑤ 快捷跳转 -->
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
