<script setup lang="ts">
/**
 * 首页 · 快捷跳转：学习入口（所有人）+ 教学管理入口（仅管理面板）。
 * 跳转表是纯静态配置，放在本组件内；是否显示管理入口由父页面按面板状态传入。
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
  tone: 'primary' | 'indigo' | 'terra' | 'neutral';
}

const learnJumps: Jump[] = [
  { to: '/hall', label: '课程大厅', icon: 'hall', hint: '浏览全部课程', tone: 'primary' },
  { to: '/my-courses', label: '我的课程', icon: 'courses', hint: '在学 · 收藏 · 已学完', tone: 'primary' },
  { to: '/wrong-book', label: '错题本', icon: 'wrong', hint: '复习错题', tone: 'terra' },
  { to: '/me', label: '个人中心', icon: 'user', hint: '学习记录与设置', tone: 'neutral' },
];

const manageJumps: Jump[] = [
  { to: '/admin/overview', label: '总览', icon: 'grid', hint: '平台待办与体检', tone: 'neutral' },
  { to: '/admin/courses', label: '课程管理', icon: 'courses', hint: '课程 · 章节 · 课时', tone: 'primary' },
  { to: '/admin/banks', label: '题库管理', icon: 'bank', hint: '题库与题目', tone: 'indigo' },
  { to: '/admin/exams', label: '考试管理', icon: 'exam', hint: '组卷与成绩', tone: 'primary' },
  { to: '/admin/stats', label: '学习统计', icon: 'stats', hint: '课时观看情况', tone: 'indigo' },
  { to: '/admin/analytics', label: '学情分析', icon: 'chartPie', hint: '正确率与覆盖', tone: 'indigo' },
  { to: '/admin/users', label: '学员与账号', icon: 'users', hint: '成员与权限', tone: 'neutral' },
  { to: '/admin/settings', label: '系统设置', icon: 'settings', hint: '存储与安全', tone: 'neutral' },
];
</script>

<template>
  <section class="jumps" aria-label="快捷跳转">
    <SectionHead title="快捷跳转" icon="sparkles">
      <template #meta>常用功能一站直达</template>
    </SectionHead>
    <nav class="jumps__grid">
      <RouterLink v-for="j in learnJumps" :key="j.to" class="jumps__item" :class="`jumps__item--${j.tone}`" :to="j.to">
        <span class="jumps__icon"><Icon :name="j.icon" :size="18" /></span>
        <span class="jumps__text">
          <span class="jumps__label">{{ j.label }}</span>
          <span class="jumps__hint2">{{ j.hint }}</span>
        </span>
      </RouterLink>
    </nav>

    <template v-if="isAdmin">
      <div class="jumps__sub">
        <SectionHead title="教学管理" icon="shield">
          <template #meta>管理员可见</template>
        </SectionHead>
      </div>
      <nav class="jumps__grid">
        <RouterLink
          v-for="j in manageJumps"
          :key="j.to"
          class="jumps__item"
          :class="`jumps__item--${j.tone}`"
          :to="j.to"
        >
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

.jumps__item--primary {
  --jump-tone: var(--mc-primary);
  --jump-soft: var(--mc-primary-soft);
  --jump-fg: var(--mc-primary-fg);
}

.jumps__item--indigo {
  --jump-tone: var(--mc-indigo);
  --jump-soft: var(--mc-indigo-soft);
  --jump-fg: var(--mc-indigo-fg);
}

.jumps__item--terra {
  --jump-tone: var(--mc-terra);
  --jump-soft: var(--mc-terra-soft);
  --jump-fg: var(--mc-terra-fg);
}

.jumps__item--neutral {
  --jump-tone: var(--mc-neutral-strong);
  --jump-soft: var(--mc-bg-sunken);
  --jump-fg: var(--mc-text-secondary);
}

@media (hover: hover) and (pointer: fine) {
  .jumps__item:hover {
    border-color: var(--jump-tone);
    background: var(--jump-soft);
    transform: translateY(var(--mc-hover-lift));
  }
}

.jumps__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--mc-radius-xs);
  background: var(--jump-soft);
  color: var(--jump-fg);
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
