<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import Tag from '@/components/Tag.vue';

/** 固定题头：返回课时、标题、第 n / N 题、已答数、交卷 */
const props = defineProps<{
  lessonId: number;
  title: string;
  index: number;
  total: number;
  answered: number;
  unlocked: boolean;
  submitting: boolean;
  randomMode: boolean;
}>();

const emit = defineEmits<{ submit: [] }>();

const percent = computed(() => (props.total > 0 ? Math.round((props.index / props.total) * 100) : 0));
</script>

<template>
  <header class="qhead">
    <div class="qhead__row">
      <RouterLink class="mc-btn mc-btn--sm qhead__back" :to="{ name: 'watch', params: { id: lessonId } }">
        <Icon name="arrow-left" :size="15" />
        返回课时
      </RouterLink>

      <div class="qhead__titles">
        <h1 class="qhead__title">课后练习 · {{ title }}</h1>
        <Tag v-if="randomMode" tone="primary" size="sm" icon="sparkles">随机抽题</Tag>
      </div>

      <div class="qhead__stats">
        <span class="qhead__stat">第 {{ index }} / {{ total }} 题</span>
        <span class="qhead__stat">已答 {{ answered }}</span>
      </div>

      <button
        class="mc-btn mc-btn--primary qhead__submit"
        type="button"
        :disabled="submitting || !unlocked"
        @click="emit('submit')"
      >
        {{ submitting ? '提交中…' : '交卷' }}
      </button>
    </div>

    <div
      class="qhead__bar"
      role="progressbar"
      aria-label="练习进度"
      :aria-valuenow="percent"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <span class="qhead__bar-fill" :style="{ width: `${percent}%` }" />
    </div>
  </header>
</template>

<style scoped>
.qhead {
  position: sticky;
  top: var(--mc-topbar-height);
  z-index: var(--mc-z-sticky);
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding: var(--mc-space-3) var(--mc-space-4);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-lg);
  background: var(--mc-bg-elevated);
  box-shadow: var(--mc-shadow-sm);
}

.qhead__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mc-space-3);
}

.qhead__titles {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mc-space-2);
  min-width: 0;
}

.qhead__title {
  overflow: hidden;
  color: var(--mc-text);
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-semibold);
  line-height: var(--mc-leading-tight);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qhead__stats {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
}

.qhead__stat {
  color: var(--mc-text-secondary);
  font-size: var(--mc-text-sm);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.qhead__bar {
  height: 4px;
  overflow: hidden;
  border-radius: var(--mc-radius-pill);
  background: var(--mc-bg-sunken);
}

.qhead__bar-fill {
  display: block;
  height: 100%;
  border-radius: var(--mc-radius-pill);
  background: var(--mc-primary);
  transition: width var(--mc-transition);
}

@media (max-width: 1023px) {
  .qhead {
    gap: var(--mc-space-1);
    padding: var(--mc-space-2) var(--mc-space-3);
  }

  .qhead__title {
    font-size: var(--mc-text-sm);
  }

  .qhead__stats {
    order: 3;
    width: 100%;
    justify-content: space-between;
  }

  .qhead__submit {
    display: none;
  }
}
</style>
