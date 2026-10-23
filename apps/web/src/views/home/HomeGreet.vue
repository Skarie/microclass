<script setup lang="ts">
/**
 * 首页 · 问候区：一句能读懂的现状（有几门在学、最近在学哪门、完成多少课时）。
 * 数据由父页面传入，这里只负责文案与排版。
 */
import { RouterLink } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import Icon from '@/components/Icon.vue';
import type { Course } from '@/api/types';

defineProps<{ learning: Course[] }>();

const auth = useAuthStore();
</script>

<template>
  <header class="home__greet">
    <div>
      <p class="home__eyebrow">
        <Icon name="sparkles" :size="15" />
        微课堂 · 数据看板
      </p>
      <h1 class="home__title">你好，{{ auth.user?.display_name || auth.user?.username || '同学' }}</h1>
      <p class="home__sub">
        <template v-if="learning.length > 0">
          有 <strong class="mc-num">{{ learning.length }}</strong> 门课正在进行，最近在学
          <strong>{{ learning[0]?.name }}</strong
          >（已完成 {{ learning[0]?.finished ?? 0 }}/{{ learning[0]?.total ?? 0 }} 课时）。
        </template>
        <template v-else> 还没有在学课程 —— 去课程大厅挑一门开始吧。 </template>
      </p>
    </div>
    <RouterLink class="mc-btn mc-btn--primary" :to="{ name: 'hall' }">
      <Icon name="hall" :size="15" />
      去课程大厅
    </RouterLink>
  </header>
</template>

<style scoped>
.home__greet {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--mc-space-4);
}

.home__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-2);
  margin: 0 0 var(--mc-space-1);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-medium);
  letter-spacing: 0.06em;
  color: var(--mc-primary-fg);
}

.home__title {
  margin: 0;
  font-size: var(--mc-text-2xl);
  font-weight: var(--mc-font-bold);
  line-height: var(--mc-leading-display);
  letter-spacing: var(--mc-tracking-tight);
  color: var(--mc-text);
}

.home__sub {
  margin: var(--mc-space-1) 0 0;
  max-width: 68ch;
  font-size: var(--mc-text-sm);
  color: var(--mc-text-secondary);
}
</style>
