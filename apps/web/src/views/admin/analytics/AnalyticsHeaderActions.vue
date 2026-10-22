<script setup lang="ts">
import Icon from '@/components/Icon.vue';

/**
 * 页头动作：刷新 + 讲评清单 + 高频错题 CSV。
 * 动作本身在 use-analytics 里（URL 参数与下载行为不变），这里只把点击转成事件。
 */
defineProps<{ loading: boolean }>();
const emit = defineEmits<{ refresh: []; export: ['review.md' | 'wrong-questions.csv'] }>();
</script>

<template>
  <button class="mc-btn mc-btn--sm" type="button" :disabled="loading" @click="emit('refresh')">
    <Icon name="refresh" :size="15" />
    刷新
  </button>
  <button class="mc-btn mc-btn--sm" type="button" @click="emit('export', 'review.md')">
    <Icon name="download" :size="15" />
    讲评清单
  </button>
  <button class="mc-btn mc-btn--sm" type="button" @click="emit('export', 'wrong-questions.csv')">
    <Icon name="download" :size="15" />
    高频错题 CSV
  </button>
</template>
