<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import type { WrongItem } from '@/api/types';

/** 错题本题下操作：看解析、标记/取消掌握、错题重练、移出错题本（接口与确认在 use-wrong-book） */
defineProps<{ item: WrongItem; revealed: boolean; mastered: boolean; busy: boolean }>();

const emit = defineEmits<{
  reveal: [];
  master: [];
  practice: [];
  remove: [];
}>();

function formatTime(ms: number): string {
  return new Date(ms * 1000).toLocaleString('zh-CN');
}
</script>

<template>
  <section class="wba mc-card">
    <div class="wba__meta">
      <span class="mc-badge mc-badge--danger">累计答错 {{ item.wrong_count }} 次</span>
      <span class="mc-muted wba__time">最近答错：{{ formatTime(item.last_at) }}</span>
      <span v-if="item.lesson_id === null" class="mc-muted">该题未关联课时，无法错题重练</span>
    </div>

    <div class="mc-row mc-row--wrap wba__actions">
      <button class="mc-btn mc-btn--sm" type="button" :aria-expanded="revealed" @click="emit('reveal')">
        <Icon name="eye" :size="15" />
        {{ revealed ? '收起解析' : '查看答案与解析' }}
      </button>
      <button class="mc-btn mc-btn--sm" type="button" :disabled="busy" @click="emit('master')">
        {{ mastered ? '取消掌握' : '标记已掌握' }}
      </button>
      <button
        v-if="item.lesson_id !== null"
        class="mc-btn mc-btn--sm mc-btn--primary"
        type="button"
        :disabled="busy"
        @click="emit('practice')"
      >
        错题重练
      </button>
      <span class="mc-spacer" />
      <button class="mc-btn mc-btn--sm mc-btn--danger" type="button" :disabled="busy" @click="emit('remove')">
        移出错题本
      </button>
    </div>
  </section>
</template>

<style scoped>
.wba {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3) var(--mc-space-4);
  border-radius: var(--mc-radius-xs);
  box-shadow: var(--mc-shadow-xs);
}

.wba__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mc-space-2) var(--mc-space-3);
  font-size: var(--mc-text-xs);
}

.wba__actions {
  gap: var(--mc-space-2);
}
</style>
