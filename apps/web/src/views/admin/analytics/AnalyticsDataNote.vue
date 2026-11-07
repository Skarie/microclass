<script setup lang="ts">
import Icon from '@/components/Icon.vue';

/**
 * 数据规模说明：永远显示；样本少（作答 < 30 条）时换成警示色，
 * 避免机构拿一份几乎没数据的报表去做教学决策。
 */
defineProps<{ graded: number; note: string }>();
</script>

<template>
  <div class="ana__note" :class="{ 'ana__note--warn': graded < 30 }">
    <Icon :name="graded < 30 ? 'alert' : 'info'" :size="16" />
    <span>{{ note }}</span>
  </div>
</template>

<style scoped>
.ana__note {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-2) var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
  color: var(--mc-text-muted);
  font-size: var(--mc-text-sm);
}

.ana__note--warn {
  background: var(--mc-terra-soft);
  border-color: var(--mc-terra-border);
  color: var(--mc-terra-fg);
}
</style>
