<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import ComposeRandomPanel from './ComposeRandomPanel.vue';
import ComposePickPanel from './ComposePickPanel.vue';
import ComposeParallelPanel from './ComposeParallelPanel.vue';
import type { ExamCompose } from '@/composables/use-exam-compose';
import type { ExamParallel } from '@/composables/use-exam-parallel';
import type { ExamRandom } from '@/composables/use-exam-random';
import type { ExamRange } from '@/composables/use-exam-range';

/**
 * 第②步「怎么组卷」：随机组卷 / 自己挑题 / 平行组卷三张方式卡。
 * 三种方式各自的表单与动作在对应子组件里，这里只排出三栏与底部导航。
 */
defineProps<{ range: ExamRange; compose: ExamCompose; random: ExamRandom; parallel: ExamParallel }>();
const emit = defineEmits<{
  pick: [];
  next: [];
  back: [];
  openParallel: [];
}>();
</script>

<template>
  <section class="mc-card">
    <div class="mc-card__header">
      <span class="mc-card__title">② 怎么组卷</span>
      <span class="mc-spacer" />
      <span class="mc-muted">范围：{{ range.rangeSummary }}（{{ range.facets?.total ?? 0 }} 题）</span>
    </div>
    <div class="mc-card__body">
      <div class="stp__modes">
        <ComposeRandomPanel :random="random" :busy="compose.busy" />
        <ComposePickPanel @pick="emit('pick')" />
        <ComposeParallelPanel :paper-count="compose.paper.length" @open="emit('openParallel')" />
      </div>
      <div class="stp__row">
        <button class="mc-btn mc-btn--sm" type="button" @click="emit('back')">
          <Icon name="arrow-left" :size="15" />
          返回选范围
        </button>
        <span class="mc-spacer" />
        <button class="mc-btn mc-btn--sm" type="button" :disabled="compose.paper.length === 0" @click="emit('next')">
          下一步：看卷子（{{ compose.paper.length }} 题）
          <Icon name="arrow-right" :size="15" />
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.stp__modes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: var(--mc-space-3);
}

.stp__row {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
  padding-top: var(--mc-space-2);
}
</style>
