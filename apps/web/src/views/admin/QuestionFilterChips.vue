<script setup lang="ts">
import Icon from '@/components/Icon.vue';

/**
 * 收起状态下的「已启用次级条件」一行 chips：一个条件一枚，点 × 清掉该条件。
 *
 * 只在「更多筛选」收起时出现 —— 展开时条件本身就在面板里，再列一遍是重复。
 * 每枚 chip 的文案自带分类前缀（章节：/ 标签：/ 题组：…），不靠颜色区分类型。
 */
defineProps<{ chips: { key: string; label: string }[] }>();
const emit = defineEmits<{ remove: [key: string] }>();
</script>

<template>
  <div class="filter-chips" role="group" aria-label="已启用的更多筛选条件">
    <span v-for="chip in chips" :key="chip.key" class="filter-chip">
      <span class="filter-chip__label">{{ chip.label }}</span>
      <button
        class="filter-chip__remove"
        type="button"
        :aria-label="`清除筛选条件：${chip.label}`"
        @click="emit('remove', chip.key)"
      >
        <Icon name="close" :size="12" />
      </button>
    </span>
  </div>
</template>

<style scoped>
.filter-chips {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mc-space-1);
  max-width: 100%;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  max-width: 100%;
  padding: var(--mc-space-1) var(--mc-space-2);
  border: 1px solid var(--mc-primary-border);
  border-radius: var(--mc-radius-pill);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading-snug);
}

.filter-chip__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filter-chip__remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--mc-radius-pill);
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.filter-chip__remove:hover {
  background: var(--mc-bg-elevated);
}

.filter-chip__remove:focus-visible {
  outline: 2px solid var(--mc-primary);
  outline-offset: 1px;
}

@media (max-width: 900px) {
  .filter-chip__remove {
    width: var(--mc-touch-target-mobile);
    height: var(--mc-touch-target-mobile);
  }

  /* × 自己撑到 44px 后，chip 右侧不再叠一层内边距，整枚 chip 仍是一行 44px */
  .filter-chip {
    min-height: var(--mc-touch-target-mobile);
    padding-right: 0;
  }
}
</style>
