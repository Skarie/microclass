<script setup lang="ts">
/**
 * 总览 · 常用入口：六个后台模块的快捷入口（管理员多一个账号入口）。
 */
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import type { IconName } from '@/components/icons';

defineProps<{ isAdmin: boolean }>();

const links: { to: string; label: string; hint: string; icon: IconName; adminOnly?: boolean }[] = [
  { to: '/admin/courses', label: '课程与课时', hint: '建课、上传视频、归类', icon: 'courses' },
  { to: '/admin/banks', label: '题库管理', hint: '导入导出、体检、难度', icon: 'bank' },
  { to: '/admin/exams', label: '考试与组卷', hint: '挑题排卷、成绩单', icon: 'exam' },
  { to: '/admin/stats', label: '学习统计', hint: '观看时长与练习成绩', icon: 'stats' },
  { to: '/admin/question-conflicts', label: '冲突题核对', hint: '同题不同答案', icon: 'conflict' },
  { to: '/admin/users', label: '学员与账号', hint: '建号、改角色、审计', icon: 'users', adminOnly: true },
];
</script>

<template>
  <section class="mc-card">
    <div class="mc-card__header">
      <span class="mc-row links__title">
        <Icon name="courses" :size="16" />
        <span class="mc-card__title">常用入口</span>
      </span>
    </div>
    <div class="mc-card__body links">
      <RouterLink v-for="link in links" v-show="!link.adminOnly || isAdmin" :key="link.to" class="link" :to="link.to">
        <Icon :name="link.icon" :size="18" />
        <span>{{ link.label }}</span>
        <em>{{ link.hint }}</em>
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.links__title {
  align-items: center;
  gap: var(--mc-space-2);
}

.links {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--mc-space-4);
}

.link {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-md);
  color: var(--mc-text);
  transition:
    border-color var(--mc-transition),
    box-shadow var(--mc-transition),
    transform var(--mc-transition);
}

@media (hover: hover) and (pointer: fine) {
  .link:hover {
    border-color: var(--mc-primary);
    box-shadow: var(--mc-shadow-xs);
    transform: translateY(var(--mc-hover-lift));
  }
}

.link span {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-medium);
}

.link em {
  font-style: normal;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}
</style>
