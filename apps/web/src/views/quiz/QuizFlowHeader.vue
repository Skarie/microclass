<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';
import Icon from '@/components/Icon.vue';

/**
 * 泛雅式单题流题头：白色细条，不做通栏大卡片。
 * 左侧「← 返回」+ 标题；右侧徽标（考试倒计时等）、已答 n/N、细进度条、错题本筛选与交卷。
 * 课后练习、在线考试、错题本共用；差异只走 badges / actions 插槽。
 */
const props = withDefaults(
  defineProps<{
    backTo: RouteLocationRaw;
    backLabel: string;
    title: string;
    total: number;
    answered: number;
    answeredLabel?: string;
    /** 进度百分比；默认按「已答 / 总题数」计算 */
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
  props.percent !== null ? props.percent : props.total > 0 ? Math.round((props.answered / props.total) * 100) : 0,
);
</script>

<template>
  <header class="qhead">
    <div class="qhead__row">
      <RouterLink class="qhead__back" :to="backTo" :aria-label="backLabel" :title="backLabel">
        <Icon name="arrow-left" :size="16" />
        <span class="qhead__back-text">{{ backLabel }}</span>
      </RouterLink>

      <h1 class="qhead__title">{{ title }}</h1>

      <div class="qhead__tools">
        <slot name="badges" />

        <span v-if="total > 0" class="qhead__stat">{{ answeredLabel }} {{ answered }}/{{ total }}</span>

        <div
          v-if="total > 0"
          class="qhead__bar"
          role="progressbar"
          :aria-label="progressLabel"
          :aria-valuenow="percentValue"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <span class="qhead__bar-fill" :style="{ transform: `scaleX(${percentValue / 100})` }" />
        </div>

        <slot name="actions" />
      </div>

      <button
        v-if="showSubmit"
        class="mc-btn mc-btn--primary mc-btn--sm qhead__submit"
        type="button"
        :disabled="submitting || submitDisabled"
        @click="emit('submit')"
      >
        {{ submitting ? '提交中…' : submitLabel }}
      </button>
    </div>
  </header>
</template>

<style scoped>
.qhead {
  position: sticky;
  top: var(--mc-topbar-height);
  z-index: var(--mc-z-sticky);
  width: 100%;
  /* 与 .quiz__body 同一宽度：题头左右边线必须和下面的题卡、答题卡对齐 */
  max-width: 1100px;
  border-radius: var(--mc-radius-xs);
  margin: 0 auto;
  padding: var(--mc-space-2) var(--mc-space-4);
  border-top: 1px solid var(--mc-border);
  border-bottom: 1px solid var(--mc-border);
  background: var(--mc-bg-elevated);
}
.qhead__row {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  min-width: 0;
}
.qhead__back {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--mc-space-1);
  height: 32px;
  padding: 0 var(--mc-space-2);
  border: 0;
  border-radius: var(--mc-radius-xs);
  background: transparent;
  color: var(--mc-text-secondary);
  font-size: var(--mc-text-xs);
  text-decoration: none;
  white-space: nowrap;
}
.qhead__back:hover {
  background: var(--mc-bg-hover);
  color: var(--mc-text);
}
.qhead__back:focus-visible {
  outline: 2px solid var(--mc-primary);
  outline-offset: 1px;
}
.qhead__title {
  flex: 1;
  overflow: hidden;
  color: var(--mc-text);
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-semibold);
  line-height: var(--mc-leading-snug);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qhead__tools {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--mc-space-2) var(--mc-space-3);
}
.qhead__stat {
  color: var(--mc-text-muted);
  font-size: var(--mc-text-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.qhead__bar {
  width: 120px;
  height: 6px;
  overflow: hidden;
  border-radius: var(--mc-radius-pill);
  background: var(--mc-bg-sunken);
}
.qhead__bar-fill {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: var(--mc-radius-pill);
  background: var(--mc-primary);
  min-width: 6px;
  transform-origin: left center;
  transition: transform var(--mc-transition);
}
.qhead__submit {
  flex: none;
}
@media (max-width: 1023px) {
  .qhead {
    padding: var(--mc-space-2) var(--mc-space-3);
  }
  .qhead__row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: var(--mc-space-2) var(--mc-space-3);
  }
  .qhead__back-text {
    display: none;
  }
  .qhead__title {
    font-size: var(--mc-quiz-font-size);
  }
  .qhead__tools {
    grid-column: 1 / -1;
    justify-content: flex-start;
    width: 100%;
  }
  .qhead__bar {
    width: 64px;
  }
  .qhead__submit {
    grid-column: 3;
    grid-row: 1;
    justify-self: end;
    min-height: 28px;
  }
}
</style>
