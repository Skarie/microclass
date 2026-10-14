<script setup lang="ts">
/**
 * 工具栏：筛选/操作条（左筛选、右动作），窄屏自动换行。
 * 类名保留 `.toolbar`，兼容既有 E2E 用例的 locator。
 */
</script>

<template>
  <div class="toolbar mc-card">
    <div class="toolbar__left">
      <slot name="left" />
      <slot />
    </div>
    <div v-if="$slots.right" class="toolbar__right">
      <slot name="right" />
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mc-space-3);
  flex-wrap: wrap;
  padding: var(--mc-space-3) var(--mc-space-4);
  margin-bottom: var(--mc-section-gap);
}

.toolbar__left,
.toolbar__right {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
  min-width: 0;
}

.toolbar__right {
  margin-left: auto;
}
</style>
