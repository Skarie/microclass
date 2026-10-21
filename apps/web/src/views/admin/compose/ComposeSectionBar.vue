<script setup lang="ts">
/* eslint-disable vue/no-mutating-props -- 大题编辑行由 useExamPaperEdit.sections 持有，子组件就地编辑 */
import Icon from '@/components/Icon.vue';
import type { PaperSection } from '@/composables/use-exam-structure';

/** 一行大题编辑：名称 + 每题分值 +「应用到大题」/删除。 */
defineProps<{ section: PaperSection; index: number; busy: boolean }>();
const emit = defineEmits<{ apply: [score: number]; remove: [] }>();
</script>

<template>
  <div class="stp__sectionbar">
    <Icon name="list" :size="15" />
    <input
      v-model="section.name"
      class="mc-input stp__sectionname"
      placeholder="大题名称，如 一、单选题"
      :aria-label="`第 ${index + 1} 个大题名称`"
    />
    <label class="stp__field">
      <span class="mc-label">每题分值</span>
      <input
        v-model.number="section.score"
        class="mc-input stp__num"
        type="number"
        min="0"
        step="0.5"
        :aria-label="`第 ${index + 1} 个大题每题分值`"
      />
    </label>
    <button
      class="mc-btn mc-btn--ghost mc-btn--sm"
      type="button"
      :disabled="busy || !section.name"
      @click="emit('apply', Number(section.score) || 0)"
    >
      应用到大题
    </button>
    <button class="mc-btn mc-btn--danger-ghost mc-btn--sm" type="button" @click="emit('remove')">删除大题</button>
  </div>
</template>

<style scoped>
.stp__sectionbar {
  display: flex;
  align-items: flex-end;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
  padding: var(--mc-space-2) var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
}

.stp__sectionname {
  flex: 1;
  min-width: 160px;
}

.stp__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.stp__num {
  width: 76px;
}
</style>
