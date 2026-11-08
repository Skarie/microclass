<script setup lang="ts">
import Icon from '@/components/Icon.vue';

/** 自己挑题入口：进入整页三区选题（QuestionPickerPanel）。 */
const emit = defineEmits<{ pick: [] }>();
</script>

<template>
  <div class="stp__mode">
    <div class="stp__modehead">
      <Icon name="list" :size="18" />
      <strong>自己挑题</strong>
      <em>打开题库，左侧还是这个范围，自己勾选或整批加入</em>
    </div>
    <p class="mc-muted stp__modetip">
      弹窗里支持：按章节 / 知识点筛、题型与难度筛选、关键词、易错题优先、全选筛选结果；右侧能看到已选与合计分值。
    </p>
    <button class="mc-btn mc-btn--soft" type="button" @click="emit('pick')">
      <Icon name="plus" :size="16" />
      打开题库挑题
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

.stp__modetip {
  margin: 0;
  font-size: var(--mc-text-xs);
}
</style>
