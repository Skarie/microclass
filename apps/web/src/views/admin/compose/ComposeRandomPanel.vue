<script setup lang="ts">
/* eslint-disable vue/no-mutating-props -- 配额/分值/配比由 useExamRandom 持有，子组件就地编辑 */
import Icon from '@/components/Icon.vue';
import { LEVEL_LABEL, QUOTA_TYPES, typeLabel } from '@/composables/use-exam-compose';
import type { ExamRandom } from '@/composables/use-exam-random';

/** 随机组卷：按题型填数量与每题分值，可选难度配比，提交后在第③步看结果。 */
defineProps<{ random: ExamRandom; busy: boolean }>();
</script>

<template>
  <div class="stp__mode">
    <div class="stp__modehead">
      <Icon name="sparkles" :size="18" />
      <strong>随机组卷</strong>
      <em>在所选范围里，按题型数量随机抽题</em>
    </div>
    <table class="mc-table mc-table--compact stp__quota">
      <thead>
        <tr>
          <th>题型</th>
          <th>数量</th>
          <th>每题分值</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="t in QUOTA_TYPES" :key="t">
          <td>{{ typeLabel(t) }}</td>
          <td>
            <input
              v-model.number="random.quotaForm[t]"
              class="mc-input stp__num"
              type="number"
              min="0"
              max="100"
              :aria-label="`${typeLabel(t)}数量`"
            />
          </td>
          <td>
            <input
              v-model.number="random.scoreForm[t]"
              class="mc-input stp__num"
              type="number"
              min="0"
              step="0.5"
              :aria-label="`${typeLabel(t)}每题分值`"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <label class="mc-checkbox">
      <input v-model="random.useRatio" type="checkbox" />
      再限制难度配比
    </label>
    <div v-if="random.useRatio" class="stp__ratio">
      <label v-for="l in ['easy', 'medium', 'hard'] as const" :key="l" class="stp__ratioitem">
        <span class="mc-muted">{{ LEVEL_LABEL[l] }}（%）</span>
        <input v-model.number="random.targetRatio[l]" class="mc-input stp__num" type="number" min="0" max="100" />
      </label>
    </div>
    <button class="mc-btn mc-btn--primary" type="button" :disabled="busy" @click="random.runRandomCompose">
      <Icon name="sparkles" :size="16" />
      按范围随机生成试卷
    </button>
  </div>
</template>

<style scoped>
.stp__mode {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding: var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-elevated);
}

.stp__modehead {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.stp__modehead em {
  font-style: normal;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
  flex-basis: 100%;
}

.stp__quota th,
.stp__quota td {
  font-size: var(--mc-text-sm);
}

.stp__num {
  width: 76px;
}

.stp__ratio {
  display: flex;
  gap: var(--mc-space-2);
}

.stp__ratioitem {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
