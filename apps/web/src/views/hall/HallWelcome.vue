<script setup lang="ts">
/**
 * 课程大厅 · 欢迎条：一句真实状态 + 两个入口（继续上次 / 浏览全部）。
 * 浅主色底，高度约 72px；不使用渐变。
 */
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import type { HallCatalog } from '@/composables/use-hall-catalog';

const props = defineProps<{ catalog: HallCatalog }>();

const course = computed(() => props.catalog.continueCourse);
const continueTo = computed(() =>
  course.value ? { name: 'course', params: { id: course.value.id } } : { name: 'hall', hash: '#hall-list' },
);
</script>

<template>
  <section class="welcome" aria-label="课程大厅引导">
    <span class="welcome__icon" aria-hidden="true"><Icon name="hall" :size="20" /></span>

    <div class="welcome__text">
      <p v-if="course" class="welcome__line">
        上次在学 <strong>{{ course.name }}</strong
        >，已完成 {{ course.finished ?? 0 }}/{{ course.total ?? 0 }} 课时。
      </p>
      <p v-else class="welcome__line">还没有在学的课程，从下面挑一门开始；学完第一节课后会自动出现在首页。</p>
      <p class="welcome__hint">
        共 <strong class="mc-num">{{ catalog.courses.length }}</strong> 门课程，按分类整理；也可以直接搜索课程名或简介。
      </p>
    </div>

    <div class="welcome__actions">
      <RouterLink class="welcome__cta" :to="continueTo">
        <Icon name="play" :size="14" />
        {{ course ? '继续上次学习' : '开始第一门课' }}
      </RouterLink>
      <RouterLink class="welcome__browse" :to="{ name: 'hall', hash: '#hall-list' }" @click="catalog.resetFilters()">
        浏览全部课程
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.welcome {
  display: flex;
  align-items: center;
  gap: var(--mc-space-4);
  min-height: 72px;
  padding: var(--mc-space-4) var(--mc-space-5);
  border: 1px solid var(--mc-primary-border);
  border-radius: var(--mc-radius-md);
  background: var(--mc-primary-soft);
}

.welcome__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex: none;
  border: 1px solid var(--mc-primary-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-elevated);
  color: var(--mc-primary-fg);
}

.welcome__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--mc-space-1);
  min-width: 0;
}

.welcome__line {
  margin: 0;
  font-size: var(--mc-text-sm);
  color: var(--mc-text);
}

.welcome__line strong {
  font-weight: var(--mc-font-semibold);
}

.welcome__hint {
  margin: 0;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-secondary);
}

.welcome__actions {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex: none;
}

.welcome__cta,
.welcome__browse {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  min-height: 32px;
  padding: 0 var(--mc-space-3);
  border-radius: var(--mc-radius);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-medium);
  white-space: nowrap;
}

.welcome__cta {
  border: 1px solid var(--mc-primary);
  background: var(--mc-primary);
  color: var(--mc-text-inverse);
}

.welcome__cta:hover {
  border-color: var(--mc-primary-hover);
  background: var(--mc-primary-hover);
}

.welcome__browse {
  border: 1px solid var(--mc-border);
  background: var(--mc-bg-elevated);
  color: var(--mc-text-secondary);
}

.welcome__browse:hover {
  border-color: var(--mc-primary-border);
  color: var(--mc-primary-fg);
}

.welcome__cta:focus-visible,
.welcome__browse:focus-visible {
  outline: none;
  box-shadow: var(--mc-focus-ring);
}

@media (max-width: 900px) {
  .welcome {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .welcome__actions {
    width: 100%;
    padding-left: var(--mc-space-10);
  }
}

@media (max-width: 1023px) {
  .welcome__cta,
  .welcome__browse {
    min-height: var(--mc-touch-target-mobile);
  }
}
</style>
