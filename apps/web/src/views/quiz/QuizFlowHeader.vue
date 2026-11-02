<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';
import Icon from '@/components/Icon.vue';

/**
 * 单题流固定题头：返回、标题/徽标、第 n / N 题与已答（已看）数、进度条、交卷。
 * 课后练习、在线考试、错题本共用；标题与倒计时等差异走 badges / actions 插槽。
 */
const props = withDefaults(
  defineProps<{
    backTo: RouteLocationRaw;
    backLabel: string;
    title: string;
    index: number;
    total: number;
    answered: number;
    answeredLabel?: string;
    /** 进度百分比；默认按「第 n 题 / 总题数」计算 */
    percent?: number | null;
    progressLabel?: string;
    showSubmit?: boolean;
    submitting?: boolean;
    submitDisabled?: boolean;
    submitLabel?: string;
  }>(),
  {
    answeredLabel: '已答',
    percent: null,
    progressLabel: '答题进度',
    showSubmit: false,
    submitting: false,
    submitDisabled: false,
    submitLabel: '交卷',
  },
);

const emit = defineEmits<{ submit: [] }>();

const percentValue = computed(() =>
  props.percent !== null ? props.percent : props.total > 0 ? Math.round((props.index / props.total) * 100) : 0,
);
</script>

<template>
  <header class="qhead">
    <div class="qhead__row">
      <RouterLink class="mc-btn mc-btn--sm qhead__back" :to="backTo">
        <Icon name="arrow-left" :size="15" />
        {{ backLabel }}
      </RouterLink>

      <div class="qhead__titles">
        <h1 class="qhead__title">{{ title }}</h1>
        <slot name="badges" />
      </div>

      <div v-if="total > 0" class="qhead__stats">
        <span class="qhead__stat">第 {{ index }} / {{ total }} 题</span>
        <span class="qhead__stat">{{ answeredLabel }} {{ answered }}</span>
      </div>

      <button
        v-if="showSubmit"
        class="mc-btn mc-btn--primary qhead__submit"
        type="button"
        :disabled="submitting || submitDisabled"
        @click="emit('submit')"
      >
        {{ submitting ? '提交中…' : submitLabel }}
      </button>

      <slot name="actions" />
    </div>

    <div
      class="qhead__bar"
      role="progressbar"
      :aria-label="progressLabel"
      :aria-valuenow="percentValue"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <span class="qhead__bar-fill" :style="{ width: `${percentValue}%` }" />
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
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
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
