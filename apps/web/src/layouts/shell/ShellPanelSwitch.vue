<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import Icon from '@/components/Icon.vue';
import { usePanelStore } from '@/stores/panel';

/**
 * 双面板切换：教学管理 / 学员视图（默认教学管理）。
 * 切换面板时把路由落到对应首页；窄屏（≤900px）隐藏，由抽屉承担主导航。
 */
const panel = usePanelStore();
const route = useRoute();
const router = useRouter();

function switchPanel(next: 'admin' | 'student'): void {
  panel.setMode(next);
  if (next === 'student' && route.path.startsWith('/admin')) {
    void router.push({ name: 'home' });
  }
  if (next === 'admin' && !route.path.startsWith('/admin')) {
    void router.push({ name: 'admin-overview' });
  }
}
</script>

<template>
  <div class="panel-switch" role="group" aria-label="切换面板">
    <button
      class="panel-switch__btn"
      :class="{ 'panel-switch__btn--on': panel.isAdminPanel.value }"
      type="button"
      :aria-pressed="panel.isAdminPanel.value"
      @click="switchPanel('admin')"
    >
      <Icon name="grid" :size="14" />
      教学管理
    </button>
    <button
      class="panel-switch__btn"
      :class="{ 'panel-switch__btn--on': !panel.isAdminPanel.value }"
      type="button"
      :aria-pressed="!panel.isAdminPanel.value"
      @click="switchPanel('student')"
    >
      <Icon name="user" :size="14" />
      学员视图
    </button>
  </div>
</template>

<style scoped>
.panel-switch {
  display: flex;
  gap: var(--mc-space-1);
  padding: var(--mc-space-1);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
}

.panel-switch__btn {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  padding: var(--mc-space-1) var(--mc-space-2);
  border: 0;
  border-radius: var(--mc-radius-sm);
  background: transparent;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-secondary);
  cursor: pointer;
  transition: var(--mc-transition-colors);
  white-space: nowrap;
}

.panel-switch__btn--on {
  background: var(--mc-bg-elevated);
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-semibold);
  box-shadow: var(--mc-shadow-sm);
}

@media (max-width: 900px) {
  .panel-switch {
    display: none;
  }
}
</style>
