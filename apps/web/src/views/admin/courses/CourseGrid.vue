<script setup lang="ts">
import { RouterLink } from 'vue-router';
import DropdownMenu from '@/components/DropdownMenu.vue';
import Icon from '@/components/Icon.vue';
import { categoryName, folderLabel } from './course-admin-helpers';
import type { MenuItem } from '@/components/DropdownMenu.vue';
import type { Category, Course, MediaRoot } from '@/api/types';

/**
 * 课程平铺网格。卡片整卡不设 role="button"（内部有链接与按钮，
 * 会命中 axe 的 nested-interactive），标题是链接、操作是按钮。
 */
defineProps<{
  courses: Course[];
  categories: Category[];
  roots: MediaRoot[];
  menuItems: MenuItem[];
}>();

const emit = defineEmits<{
  (e: 'manage', course: Course): void;
  (e: 'edit', course: Course): void;
  (e: 'cover', course: Course): void;
  (e: 'delete', course: Course): void;
}>();

function onMenu(course: Course, key: string): void {
  if (key === 'edit') emit('edit', course);
  else if (key === 'cover') emit('cover', course);
  else if (key === 'delete') emit('delete', course);
}
</script>

<template>
  <div class="grid">
    <article v-for="course in courses" :key="course.id" class="card" @click="emit('manage', course)">
      <div class="card__cover">
        <img v-if="course.cover" :src="`/api/v1/course-cover/${course.id}`" :alt="course.name" loading="lazy" />
        <span v-else class="card__initial" aria-hidden="true"><Icon name="graduation" :size="26" /></span>
        <span class="mc-badge card__status" :class="course.published === 1 ? '' : 'mc-badge--warning'">
          {{ course.published === 1 ? '已发布' : '草稿' }}
        </span>
      </div>

      <div class="card__body">
        <RouterLink class="card__name" :to="{ name: 'admin-course-lessons', params: { id: course.id } }" @click.stop>
          {{ course.name }}
        </RouterLink>
        <p class="mc-muted mc-clamp-2 card__desc">{{ course.description || '暂无课程简介' }}</p>
        <div class="card__meta mc-muted">
          <span>{{ categoryName(course, categories) }}</span>
          <span aria-hidden="true">·</span>
          <span>{{ course.total ?? 0 }} 课时</span>
          <span aria-hidden="true">·</span>
          <span>已学完 {{ course.finished ?? 0 }}</span>
        </div>
        <div class="card__folder" :class="{ 'is-empty': !course.folder_root_id }">
          <Icon name="folder" :size="14" aria-hidden="true" />
          <span class="mc-truncate">{{ folderLabel(course, roots) || '未绑定视频文件夹' }}</span>
        </div>
      </div>

      <div class="card__actions">
        <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click.stop="emit('manage', course)">
          管理课时
        </button>
        <DropdownMenu
          :items="menuItems"
          label=""
          icon="more"
          :show-caret="false"
          aria-label="课程操作（编辑 / 封面 / 删除）"
          variant="ghost"
          @click.stop
          @select="(key) => onMenu(course, key)"
        />
      </div>
    </article>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(268px, 1fr));
  gap: var(--mc-space-4);
  padding: var(--mc-space-4) var(--mc-space-5) var(--mc-space-5);
}

.card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-elevated, var(--mc-bg));
  overflow: hidden;
  cursor: pointer;
  transition: var(--mc-transition-all);
}

.card:hover,
.card:focus-visible {
  border-color: var(--mc-primary);
  box-shadow: var(--mc-shadow-xs);
  transform: translateY(var(--mc-hover-lift));
  outline: none;
}

.card__cover {
  position: relative;
  aspect-ratio: auto;
  height: 132px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--mc-bg-sunken);
}

.card__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.card__initial {
  font-size: var(--mc-text-2xl);
  font-weight: var(--mc-font-bold);
  color: var(--mc-primary-fg);
}
.card__status {
  position: absolute;
  top: var(--mc-space-2);
  right: var(--mc-space-2);
}
.card__body {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding: var(--mc-space-3) var(--mc-space-4);
  min-width: 0;
  flex: 1;
}

.card__name {
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
  font-size: var(--mc-text-md, 15px);
}

.card__name:hover {
  color: var(--mc-primary-fg);
}

.card__desc {
  font-size: var(--mc-text-xs);
  min-height: 2.6em;
  margin: 0;
}

.card__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--mc-text-xs);
  flex-wrap: wrap;
}

.card__folder {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
  background: var(--mc-bg-sunken);
  border-radius: var(--mc-radius-sm);
  padding: 4px 8px;
  min-width: 0;
}

.card__folder.is-empty {
  color: var(--mc-warning-fg);
}

.card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mc-space-2);
  padding: var(--mc-space-3) var(--mc-space-4);
  border-top: 1px solid var(--mc-border);
  cursor: default;
}

@media (max-width: 900px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
