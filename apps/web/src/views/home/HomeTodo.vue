<script setup lang="ts">
/**
 * 首页 · 今日待办：错题待复习 + 已开始但未学完的课程。
 * 两个数字都来自真实接口；都为 0 时合并成一句空态，不硬凑待办。
 */
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import SectionHead from '@/components/SectionHead.vue';

const props = defineProps<{ wrongPending: number; practiceCount: number }>();

const empty = computed(() => props.wrongPending === 0 && props.practiceCount === 0);
</script>

<template>
  <section class="todo" aria-label="今日待办">
    <SectionHead title="今日待办" icon="check-circle">
      <template #meta>{{ empty ? '已清空' : '按优先级处理' }}</template>
    </SectionHead>

    <p v-if="empty" class="todo__empty">
      <span class="todo__empty-icon"><Icon name="check-circle" :size="20" /></span>
      <span>
        <strong class="todo__empty-title">今天没有待办</strong>
        <span class="todo__empty-hint">错题都已复习，也没有未完成的课程。</span>
      </span>
    </p>

    <div v-else class="todo__grid">
      <article class="todo__card todo__card--terra">
        <span class="todo__bar" aria-hidden="true" />
        <span class="todo__icon todo__icon--warning"><Icon name="wrong" :size="18" /></span>
        <span class="todo__main">
          <span class="todo__label">错题待复习</span>
          <span class="todo__value"
            ><strong class="mc-num">{{ wrongPending }}</strong> 题</span
          >
          <span class="todo__hint">来自错题本</span>
        </span>
        <RouterLink v-if="wrongPending > 0" class="todo__action" to="/wrong-book">
          去复习
          <Icon name="chevron-right" :size="14" />
        </RouterLink>
        <span v-else class="todo__hint">已清空</span>
      </article>

      <article class="todo__card todo__card--primary">
        <span class="todo__bar" aria-hidden="true" />
        <span class="todo__icon todo__icon--primary"><Icon name="pen-line" :size="18" /></span>
        <span class="todo__main">
          <span class="todo__label">未完成练习</span>
          <span class="todo__value"
            ><strong class="mc-num">{{ practiceCount }}</strong> 门课程</span
          >
          <span class="todo__hint">已开始但还没学完</span>
        </span>
        <RouterLink v-if="practiceCount > 0" class="todo__action" to="/my-courses">
          去练习
          <Icon name="chevron-right" :size="14" />
        </RouterLink>
        <span v-else class="todo__hint">已清空</span>
      </article>
    </div>
  </section>
</template>

<style scoped>
.todo__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--mc-space-4);
}

.todo__card {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  overflow: hidden;
  padding: var(--mc-space-4);
  padding-left: var(--mc-space-5);
  border: 1px solid var(--todo-border, var(--mc-border));
  border-radius: var(--mc-radius-md);
  background: var(--todo-bg, var(--mc-bg-elevated));
}

/* 本轮唯一允许的侧边色条：4px 优先级条，只用于「今日待办」两行，表示提醒级别 */
.todo__bar {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 4px;
  background: var(--todo-bar, var(--mc-border));
}

.todo__card--terra {
  --todo-bar: var(--mc-terra);
  --todo-bg: var(--mc-terra-soft);
  --todo-border: var(--mc-terra-border);
}

.todo__card--primary {
  --todo-bar: var(--mc-primary);
  --todo-bg: var(--mc-primary-soft);
  --todo-border: var(--mc-primary-border);
}

.todo__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: var(--mc-radius);
}

.todo__icon--warning {
  background: var(--mc-warning-soft);
  color: var(--mc-warning-fg);
}

.todo__icon--primary {
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
}

/* 卡片本身是浅色块：图标块回到白底，避免软底叠软底 */
.todo__card .todo__icon {
  background: var(--mc-bg-elevated);
  color: var(--todo-bar);
}

.todo__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--mc-space-1);
  min-width: 0;
}

.todo__label {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
}

.todo__value {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-secondary);
}

.todo__value strong {
  margin-right: var(--mc-space-1);
  font-size: var(--mc-text-2xl);
  line-height: var(--mc-leading-display);
  color: var(--mc-terra-strong);
}

.todo__hint {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.todo__action {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  min-height: 32px;
  flex: none;
  color: var(--mc-primary-fg);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-medium);
}

.todo__action:hover {
  text-decoration: underline;
}

.todo__empty {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  margin: 0;
  padding: var(--mc-space-5);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-md);
  background: var(--mc-bg-elevated);
}

.todo__empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: var(--mc-radius-pill);
  background: var(--mc-success-soft);
  color: var(--mc-success-fg);
}

.todo__empty-title {
  display: block;
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
}

.todo__empty-hint {
  display: block;
  margin-top: var(--mc-space-1);
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

@media (max-width: 900px) {
  .todo__grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 1023px) {
  .todo__action {
    min-height: var(--mc-touch-target-mobile);
  }
}
</style>
