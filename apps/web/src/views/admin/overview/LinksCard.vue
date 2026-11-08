<script setup lang="ts">
/**
 * 总览 · 常用入口：六个后台模块的快捷入口（管理员多一个账号入口）。
 * 图标统一中性底，hover 才出现主色；模块分类靠文字，不靠每卡一色。
 */
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import type { IconName } from '@/components/icons';

defineProps<{ isAdmin: boolean }>();

const links: {
  to: string;
  label: string;
  hint: string;
  icon: IconName;
  adminOnly?: boolean;
}[] = [
  { to: '/admin/courses', label: '课程与课时', hint: '建课、上传视频、归类', icon: 'courses' },
  { to: '/admin/banks', label: '题库管理', hint: '导入导出、体检、难度', icon: 'bank' },
  { to: '/admin/exams', label: '考试与组卷', hint: '挑题排卷、成绩单', icon: 'exam' },
  { to: '/admin/stats', label: '学习统计', hint: '观看时长与练习成绩', icon: 'stats' },
  { to: '/admin/question-conflicts', label: '冲突题核对', hint: '同题不同答案', icon: 'conflict' },
  {
    to: '/admin/users',
    label: '学员与账号',
    hint: '建号、改角色、审计',
    icon: 'users',
    adminOnly: true,
  },
];
</script>

<template>
  <section class="mc-card">
    <div class="mc-card__header">
      <span class="mc-card__title">常用入口</span>
    </div>
    <div class="mc-card__body links">
      <RouterLink v-for="link in links" v-show="!link.adminOnly || isAdmin" :key="link.to" class="link" :to="link.to">
        <span class="link__icon"><Icon :name="link.icon" :size="18" /></span>
        <span class="link__label">{{ link.label }}</span>
        <em>{{ link.hint }}</em>
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.links {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--mc-space-4);
}

.link {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  grid-template-rows: auto auto;
  column-gap: var(--mc-space-3);
  row-gap: var(--mc-space-1);
  align-items: center;
  padding: var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-md);
  color: var(--mc-text);
  transition: var(--mc-transition-all);
}

@media (hover: hover) and (pointer: fine) {
  .link:hover {
    border-color: var(--mc-primary-border);
  }

  .link:hover .link__icon {
    background: var(--mc-primary-soft);
    color: var(--mc-primary-fg);
  }
}

.link__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  grid-row: 1 / span 2;
  width: 34px;
  height: 34px;
  border-radius: var(--mc-radius-xs);
  background: var(--mc-bg-sunken);
  color: var(--mc-text-secondary);
  transition:
    color var(--mc-transition),
    background-color var(--mc-transition);
}

.link__label {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-medium);
}

.link em {
  font-style: normal;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}
</style>
