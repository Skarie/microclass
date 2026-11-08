<script setup lang="ts">
import Icon from '@/components/Icon.vue';

/** 平行组卷入口：试卷为空时按钮禁用（提示先加题）。 */
defineProps<{ paperCount: number }>();
const emit = defineEmits<{ open: [] }>();
</script>

<template>
  <div class="stp__mode">
    <div class="stp__modehead">
      <Icon name="copy" :size="18" />
      <strong>平行组卷（A/B 卷）</strong>
      <em>按当前试卷逐题配"同题型、同难度、同考点"的另一套</em>
    </div>
    <button class="mc-btn mc-btn--soft" type="button" :disabled="paperCount === 0" @click="emit('open')">
      <Icon name="copy" :size="16" />
      {{ paperCount === 0 ? '试卷为空，先加题' : '生成平行卷' }}
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
</style>
