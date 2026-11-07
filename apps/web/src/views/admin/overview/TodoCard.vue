<script setup lang="ts">
/**
 * 总览 · 「需要处理」卡片：把数据问题做成可点待办。
 */
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import Tag from '@/components/Tag.vue';
import type { IconName } from '@/components/icons';

export interface OverviewTodo {
  key: string;
  label: string;
  count: number;
  hint: string;
  to: string;
  icon: IconName;
  tone: string;
}

defineProps<{
  todos: OverviewTodo[];
  loading: boolean;
  healthError: string;
  healthLoading: boolean;
  cachedText: string;
}>();
</script>

<template>
  <section class="mc-card">
    <div class="mc-card__header">
      <span class="mc-row todo__title">
        <Icon name="alert" :size="16" />
        <span class="mc-card__title">需要处理</span>
      </span>
      <Tag v-if="todos.length === 0" tone="success" size="sm" icon="check">暂无待办</Tag>
      <div class="mc-spacer" />
      <span v-if="cachedText" class="mc-muted">
        体检缓存时间 {{ cachedText }}
        <template v-if="healthLoading">（更新中…）</template>
      </span>
    </div>

    <div class="mc-card__body">
      <p v-if="healthError" class="mc-error-text">体检数据加载失败：{{ healthError }}</p>

      <p v-if="loading" class="mc-skeleton todo__loading" />

      <div v-else-if="todos.length === 0" class="todo__clear">
        <Icon name="check-circle" :size="26" />
        <div>
          <div class="todo__clear-title">当前没有待处理的数据问题</div>
          <p class="mc-muted">冲突题已核对完、难度已标注、解析都有文字、课时都归好类。</p>
        </div>
      </div>

      <ul v-else class="todo__list">
        <li v-for="todo in todos" :key="todo.key" class="todo__item">
          <span class="todo__icon" :class="`todo__icon--${todo.tone}`">
            <Icon :name="todo.icon" :size="18" />
          </span>
          <span class="todo__body">
            <span class="todo__label">{{ todo.label }}</span>
            <span class="mc-muted todo__hint">{{ todo.hint }}</span>
          </span>
          <span class="todo__count">{{ todo.count }}</span>
          <RouterLink class="mc-btn mc-btn--soft mc-btn--sm" :to="todo.to">
            去处理
            <Icon name="arrow-right" :size="14" />
          </RouterLink>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.todo__title {
  align-items: center;
  gap: var(--mc-space-2);
}

.todo__loading {
  height: 48px;
}

.todo__list {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.todo__item {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-elevated);
}

.todo__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: var(--mc-radius-xs);
  flex: none;
  background: var(--mc-bg-sunken);
  color: var(--mc-text-secondary);
}

.todo__icon--danger {
  background: var(--mc-danger-soft);
  color: var(--mc-danger-fg);
}

.todo__icon--warning {
  background: var(--mc-warning-soft);
  color: var(--mc-warning-fg);
}

.todo__icon--info {
  background: var(--mc-info-soft);
  color: var(--mc-info-fg);
}

.todo__icon--primary {
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
}

.todo__body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.todo__label {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-medium);
  color: var(--mc-text);
}

.todo__hint {
  font-size: var(--mc-text-xs);
}

.todo__count {
  font-size: var(--mc-text-2xl);
  font-weight: var(--mc-font-semibold);
  font-variant-numeric: tabular-nums;
  /* 待办 / 异常数字：统一赭色（提醒语义域） */
  color: var(--mc-terra-strong);
  min-width: 3ch;
  text-align: right;
}

.todo__clear {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-4);
  border-radius: var(--mc-radius);
  background: var(--mc-success-soft);
  color: var(--mc-success-fg);
}

.todo__clear-title {
  font-weight: var(--mc-font-semibold);
}

.todo__clear p {
  margin: 4px 0 0;
}

@media (max-width: 640px) {
  .todo__item {
    flex-wrap: wrap;
  }

  .todo__body {
    flex: 1 1 60%;
  }

  .todo__count {
    margin-left: auto;
  }
}
</style>
