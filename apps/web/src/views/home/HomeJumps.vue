<script setup lang="ts">
/**
 * 首页 · 快捷跳转：学习入口（所有人）+ 教学管理入口（仅管理面板）。
 * 跳转表是纯静态配置，放在本组件内；是否显示管理入口由父页面按面板状态传入。
 * 图标统一中性底，hover 才出现主色，不用「每卡一色」表达分类。
 */
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import SectionHead from '@/components/SectionHead.vue';
import type { IconName } from '@/components/icons';

defineProps<{ isAdmin: boolean }>();

interface Jump {
  to: string;
  label: string;
  icon: IconName;
  hint: string;
}

const learnJumps: Jump[] = [
  { to: '/hall', label: '课程大厅', icon: 'hall', hint: '浏览全部课程' },
  { to: '/my-courses', label: '我的课程', icon: 'courses', hint: '在学 · 收藏 · 已学完' },
  { to: '/wrong-book', label: '错题本', icon: 'wrong', hint: '复习错题' },
  { to: '/me', label: '个人中心', icon: 'user', hint: '学习记录与设置' },
];

const manageJumps: Jump[] = [
  { to: '/admin/overview', label: '总览', icon: 'grid', hint: '平台待办与体检' },
  { to: '/admin/courses', label: '课程管理', icon: 'courses', hint: '课程 · 章节 · 课时' },
  { to: '/admin/banks', label: '题库管理', icon: 'bank', hint: '题库与题目' },
  { to: '/admin/exams', label: '考试管理', icon: 'exam', hint: '组卷与成绩' },
  { to: '/admin/stats', label: '学习统计', icon: 'stats', hint: '课时观看情况' },
  { to: '/admin/analytics', label: '学情分析', icon: 'chartPie', hint: '正确率与覆盖' },
  { to: '/admin/users', label: '学员与账号', icon: 'users', hint: '成员与权限' },
  { to: '/admin/settings', label: '系统设置', icon: 'settings', hint: '存储与安全' },
];
</script>

<template>
  <section class="jumps" aria-label="快捷跳转">
    <SectionHead title="快捷跳转" />
    <nav class="jumps__grid">
      <RouterLink v-for="j in learnJumps" :key="j.to" class="jumps__item" :to="j.to">
        <span class="jumps__icon"><Icon :name="j.icon" :size="18" /></span>
        <span class="jumps__text">
          <span class="jumps__label">{{ j.label }}</span>
          <span class="jumps__hint2">{{ j.hint }}</span>
        </span>
      </RouterLink>
    </nav>

    <template v-if="isAdmin">
      <div class="jumps__sub">
        <SectionHead title="教学管理">
          <template #meta>管理员可见</template>
        </SectionHead>
      </div>
      <nav class="jumps__grid">
        <RouterLink v-for="j in manageJumps" :key="j.to" class="jumps__item" :to="j.to">
          <span class="jumps__icon"><Icon :name="j.icon" :size="18" /></span>
          <span class="jumps__text">
            <span class="jumps__label">{{ j.label }}</span>
            <span class="jumps__hint2">{{ j.hint }}</span>
          </span>
        </RouterLink>
      </nav>
    </template>
  </section>
</template>

<style scoped>
.jumps__sub {
  margin-top: var(--mc-space-8);
}

.jumps__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
  gap: var(--mc-space-4);
}

.jumps__item {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3) var(--mc-space-4);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-md);
  background: var(--mc-bg-elevated);
  transition: var(--mc-transition-all);
}

@media (hover: hover) and (pointer: fine) {
  .jumps__item:hover {
    border-color: var(--mc-primary-border);
  }

  .jumps__item:hover .jumps__icon {
    background: var(--mc-primary-soft);
    color: var(--mc-primary-fg);
  }
}

.jumps__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--mc-radius-xs);
  background: var(--mc-bg-sunken);
  color: var(--mc-text-secondary);
  flex: none;
  transition:
    color var(--mc-transition),
    background-color var(--mc-transition);
}

.jumps__text {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  min-width: 0;
}

.jumps__label {
  font-size: var(--mc-text-base);
  font-weight: var(--mc-font-medium);
  color: var(--mc-text);
}

.jumps__hint2 {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
