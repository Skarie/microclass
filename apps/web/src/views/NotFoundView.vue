<script setup lang="ts">
/** 404 页面：路由未匹配时的兜底视图（公开访问，不在 AppShell 内） */
import { RouterLink } from 'vue-router';
import EmptyState from '@/components/EmptyState.vue';
</script>

<template>
  <main class="nf">
    <div class="mc-card nf__card">
      <EmptyState
        icon="search"
        title="404 · 页面不存在"
        description="你访问的地址可能已被删除、改名，或链接输入有误。"
      />
      <div class="mc-row mc-row--wrap nf__actions">
        <RouterLink class="mc-btn mc-btn--primary" :to="{ name: 'hall' }">返回课程大厅</RouterLink>
        <RouterLink class="mc-btn" :to="{ name: 'me' }">个人中心</RouterLink>
      </div>
    </div>
  </main>
</template>

<style scoped>
.nf {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: var(--mc-space-8) var(--mc-space-4);
  background: var(--mc-bg);
}

.nf__card {
  width: 100%;
  max-width: 520px;
  padding: var(--mc-space-6);
  text-align: center;
}

.nf__actions {
  justify-content: center;
  padding-bottom: var(--mc-space-4);
}
</style>
