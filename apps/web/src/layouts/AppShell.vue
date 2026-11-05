<script setup lang="ts">
/**
 * 应用外壳：只做编排，不再持有导航/菜单/页脚的界面细节。
 *
 * 结构（对标中国大学 MOOC 的顶部横向导航）：
 *   ShellTopbar（品牌 / 一级导航 / 等级 / 主题 / 双面板切换 / 菜单）
 *   --> 窄屏 ShellDrawer（一级导航 + 可折叠的教学管理）
 *   --> 内容区（max-width 1200）
 *   --> ShellFooter
 * 数据与交互在 composables/use-shell-nav.ts、use-shell-menus.ts；
 * 各区块的行内样式随组件搬迁（scoped CSS 不作用于子组件内部）。
 */
import { onMounted, ref } from 'vue';
import { RouterView } from 'vue-router';
import { api } from '@/api/client';
import type { Summary } from '@/api/types';
import ShellTopbar from './shell/ShellTopbar.vue';
import ShellDrawer from './shell/ShellDrawer.vue';
import ShellFooter from './shell/ShellFooter.vue';

const summary = ref<Summary | null>(null);
const mobileNavOpen = ref(false);
/* 抽屉里的"教学管理"默认收起：移动端 9 项太长，先给一级导航让位 */
const manageOpen = ref(false);

onMounted(async () => {
  try {
    summary.value = await api.get<Summary>('/me/summary');
  } catch {
    summary.value = null;
  }
});
</script>

<template>
  <div class="shell">
    <a class="skip-link" href="#mc-main">跳到主要内容</a>

    <ShellTopbar
      :summary="summary"
      :mobile-open="mobileNavOpen"
      @toggle-drawer="mobileNavOpen = !mobileNavOpen"
      @dismiss-drawer="mobileNavOpen = false"
    />

    <!-- 窄屏抽屉：一级导航 + 教学管理（可折叠） -->
    <ShellDrawer
      v-if="mobileNavOpen"
      :manage-open="manageOpen"
      @close="mobileNavOpen = false"
      @toggle-manage="manageOpen = !manageOpen"
    />

    <main id="mc-main" class="content">
      <RouterView v-slot="{ Component }">
        <component :is="Component" @refresh-summary="summary = null" />
      </RouterView>
    </main>

    <ShellFooter />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  background: transparent;
}

/* 跳转链接：平时视觉隐藏，键盘聚焦时才出现（无障碍要求） */
.skip-link {
  position: absolute;
  top: var(--mc-space-2);
  left: var(--mc-space-2);
  z-index: var(--mc-z-toast);
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-elevated);
  color: var(--mc-text);
  box-shadow: var(--mc-shadow-sm);
  transform: translateY(-200%);
}

.skip-link:focus {
  transform: translateY(0);
}

/* ---------- 内容区（留白收紧）---------- */
.content {
  flex: 1;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: var(--mc-space-5) var(--mc-space-5) var(--mc-space-10);
}

@media (max-width: 900px) {
  .content {
    padding: var(--mc-space-4) var(--mc-space-4) var(--mc-space-8);
  }
}
</style>
