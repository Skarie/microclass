<script setup lang="ts">
import { RouterLink } from 'vue-router';
import EmptyState from '@/components/EmptyState.vue';

/** 取卷失败：重试（loading 时禁用）与返回大厅。 */
defineProps<{ loading: boolean }>();
const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <section class="mc-card loadfail">
    <EmptyState icon="exam" title="无法加载试卷" description="考试可能已被删除或尚未发布。" />
    <div class="mc-row loadfail__actions">
      <button class="mc-btn mc-btn--primary" type="button" :disabled="loading" @click="emit('retry')">
        {{ loading ? '重试中…' : '重试' }}
      </button>
      <RouterLink class="mc-btn" :to="{ name: 'hall' }">返回课程大厅</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.loadfail {
  padding: var(--mc-space-4);
}

.loadfail__actions {
  justify-content: center;
  padding-bottom: var(--mc-space-4);
}
</style>
