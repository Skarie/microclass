<script setup lang="ts">
/* eslint-disable vue/no-mutating-props -- 设置表单由 useExamSettings 持有，子组件就地编辑 */
import type { ExamSettings } from '@/composables/use-exam-settings';

/** 卷面底部的考试设置折叠区：名称、类型（固定/时段）、限时、及格线、作答次数、乱序、公布答案。 */
defineProps<{ setup: ExamSettings }>();
</script>

<template>
  <details class="stp__settings">
    <summary>考试设置（时长、及格线、作答次数、乱序、是否公布答案）</summary>
    <div class="stp__settingsbody">
      <label class="stp__field stp__field--wide">
        <span class="mc-label">试卷名称</span>
        <input v-model="setup.settings.title" class="mc-input" aria-label="试卷名称" />
      </label>
      <label class="stp__field">
        <span class="mc-label">试卷类型</span>
        <select v-model="setup.settings.paperType" class="mc-select" aria-label="试卷类型">
          <option value="fixed">固定试卷</option>
          <option value="window">时段试卷</option>
        </select>
      </label>
      <template v-if="setup.settings.paperType === 'window'">
        <label class="stp__field">
          <span class="mc-label">开始时间</span>
          <input v-model="setup.settings.startAt" class="mc-input" type="datetime-local" aria-label="开始时间" />
        </label>
        <label class="stp__field">
          <span class="mc-label">结束时间</span>
          <input v-model="setup.settings.endAt" class="mc-input" type="datetime-local" aria-label="结束时间" />
        </label>
      </template>
      <label class="stp__field">
        <span class="mc-label">限时（分钟）</span>
        <input
          v-model.number="setup.settings.durationMinutes"
          class="mc-input"
          type="number"
          min="1"
          max="600"
          aria-label="限时（分钟）"
        />
      </label>
      <label class="stp__field">
        <span class="mc-label">及格线（%）</span>
        <input
          v-model.number="setup.settings.passScore"
          class="mc-input"
          type="number"
          min="0"
          max="100"
          aria-label="及格线（%）"
        />
      </label>
      <label class="stp__field">
        <span class="mc-label">允许作答次数（0 = 不限）</span>
        <input
          v-model.number="setup.settings.attemptLimit"
          class="mc-input"
          type="number"
          min="0"
          max="99"
          aria-label="允许作答次数（0 = 不限）"
        />
      </label>
      <label class="mc-checkbox">
        <input v-model="setup.settings.shuffleQuestions" type="checkbox" />
        题目顺序随机
      </label>
      <label class="mc-checkbox">
        <input v-model="setup.settings.showAnswers" type="checkbox" />
        交卷后公布答案解析
      </label>
      <button
        class="mc-btn mc-btn--primary mc-btn--sm"
        type="button"
        :disabled="setup.settingsSaving"
        @click="setup.saveSettings"
      >
        {{ setup.settingsSaving ? '保存中…' : '保存考试设置' }}
      </button>
    </div>
  </details>
</template>

<style scoped>
.stp__settings {
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  padding: var(--mc-space-2) var(--mc-space-3);
}

.stp__settings summary {
  cursor: pointer;
  font-weight: var(--mc-font-medium);
}

.stp__settingsbody {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--mc-space-2);
  align-items: end;
  padding-top: var(--mc-space-2);
}

.stp__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.stp__field--wide {
  grid-column: 1 / -1;
}
</style>
