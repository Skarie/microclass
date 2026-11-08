<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import { QUIZ_TYPE_LABEL } from '@/utils/quiz';
import type { QuestionType } from '@/api/types';

/** 错题本筛选：掌握状态（服务端）、题型与关键词（本地）；附收录统计与刷新入口 */
defineProps<{
  includeMastered: boolean;
  keyword: string;
  type: '' | QuestionType;
  loading: boolean;
  total: number;
  pending: number;
  mastered: number;
  matched: number;
}>();

const emit = defineEmits<{
  'update:includeMastered': [value: boolean];
  'update:keyword': [value: string];
  'update:type': [value: '' | QuestionType];
  refresh: [];
}>();

function onStateChange(event: Event): void {
  emit('update:includeMastered', (event.target as HTMLSelectElement).value === '1');
}

function onTypeChange(event: Event): void {
  emit('update:type', (event.target as HTMLSelectElement).value as '' | QuestionType);
}

function onKeyword(event: Event): void {
  emit('update:keyword', (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="wbf mc-card">
    <div class="mc-row mc-row--wrap wbf__row">
      <label class="mc-field wbf__field" for="wb-filter-state">
        <span class="mc-label">掌握状态</span>
        <select id="wb-filter-state" class="mc-select" :value="includeMastered ? '1' : '0'" @change="onStateChange">
          <option value="0">只看未掌握</option>
          <option value="1">全部（含已掌握）</option>
        </select>
      </label>

      <label class="mc-field wbf__field" for="wb-filter-type">
        <span class="mc-label">题型</span>
        <select id="wb-filter-type" class="mc-select" :value="type" @change="onTypeChange">
          <option value="">全部题型</option>
          <option v-for="(label, value) in QUIZ_TYPE_LABEL" :key="value" :value="value">{{ label }}</option>
        </select>
      </label>

      <label class="mc-field wbf__field wbf__field--grow" for="wb-filter-keyword">
        <span class="mc-label">题干关键词</span>
        <input
          id="wb-filter-keyword"
          class="mc-input"
          type="search"
          :value="keyword"
          placeholder="输入关键词搜索题干…"
          @input="onKeyword"
        />
      </label>

      <button class="mc-btn mc-btn--sm wbf__refresh" type="button" :disabled="loading" @click="emit('refresh')">
        <Icon name="refresh" :size="16" />
        {{ loading ? '刷新中…' : '刷新列表' }}
      </button>
    </div>

    <p class="mc-hint wbf__meta">
      收录 {{ total }} 题 · 未掌握 {{ pending }} · 已掌握 {{ mastered }} · 当前筛选命中 {{ matched }} 题
    </p>
  </div>
</template>

<style scoped>
.wbf {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3) var(--mc-space-4);
  border-radius: var(--mc-radius-xs);
  box-shadow: var(--mc-shadow-xs);
}

.wbf__row {
  align-items: flex-end;
  gap: var(--mc-space-3);
}

.wbf__field {
  min-width: 160px;
}

.wbf__field--grow {
  flex: 1;
  min-width: 240px;
}

.wbf__refresh {
  margin-bottom: var(--mc-space-1);
}

.wbf__meta {
  margin: 0;
}
</style>
