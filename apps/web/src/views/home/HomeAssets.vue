<script setup lang="ts">
/**
 * 首页 · 学习资产：在学 / 已学完 / 收藏 / 错题收录，四个真实计数。
 */
defineProps<{
  learningCount: number;
  finishedCount: number;
  favoriteCount: number;
  wrongTotal: number;
}>();
</script>

<template>
  <section class="assets" aria-label="学习资产">
    <article class="assets__item">
      <span class="assets__num mc-num">{{ learningCount }}</span>
      <span class="assets__label">在学课程</span>
    </article>
    <article class="assets__item">
      <span class="assets__num mc-num">{{ finishedCount }}</span>
      <span class="assets__label">已学完课程</span>
    </article>
    <article class="assets__item">
      <span class="assets__num mc-num">{{ favoriteCount }}</span>
      <span class="assets__label">收藏课程</span>
    </article>
    <article class="assets__item">
      <span class="assets__num mc-num">{{ wrongTotal }}</span>
      <span class="assets__label">错题收录</span>
    </article>
  </section>
</template>

<style scoped>
.assets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--mc-space-4);
}

.assets__item {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  padding: var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-lg);
  background: var(--mc-bg-elevated);
}

.assets__num {
  font-size: var(--mc-text-xl);
  font-weight: var(--mc-font-bold);
  color: var(--mc-text);
}

.assets__label {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}
</style>
