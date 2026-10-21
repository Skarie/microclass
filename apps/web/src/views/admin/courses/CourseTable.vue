<script setup lang="ts">
import { RouterLink } from 'vue-router';
import DropdownMenu from '@/components/DropdownMenu.vue';
import { categoryName, folderLabel } from './course-admin-helpers';
import type { MenuItem } from '@/components/DropdownMenu.vue';
import type { Category, Course, MediaRoot } from '@/api/types';

/**
 * 课程列表视图（默认）：紧凑表格，文件夹列显示绑定状态简写。
 * 行内主操作是「管理课时」，编辑 / 封面 / 删除收进「⋯」。
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
  <div class="mc-table-wrap table-wrap">
    <table class="mc-table mc-table--compact">
      <thead>
        <tr>
          <th>课程</th>
          <th>分类</th>
          <th>课时数</th>
          <th>已学完</th>
          <th>视频文件夹</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="course in courses" :key="course.id">
          <td>
            <div class="course">
              <div class="course__cover">
                <img v-if="course.cover" :src="`/api/v1/course-cover/${course.id}`" :alt="course.name" loading="lazy" />
                <span v-else aria-hidden="true">{{ course.name.slice(0, 1) }}</span>
              </div>
              <div class="course__text">
                <RouterLink class="course__name" :to="{ name: 'admin-course-lessons', params: { id: course.id } }">
                  {{ course.name }}
                </RouterLink>
                <span class="mc-muted mc-clamp-2 course__desc">{{ course.description || '暂无课程简介' }}</span>
              </div>
            </div>
          </td>
          <td>{{ categoryName(course, categories) }}</td>
          <td>{{ course.total ?? 0 }}</td>
          <td>{{ course.finished ?? 0 }}</td>
          <td>
            <span v-if="course.folder_root_id" class="mc-muted folder-cell mc-truncate">
              {{ folderLabel(course, roots) }}
            </span>
            <span v-else class="mc-muted">未绑定</span>
          </td>
          <td>
            <span class="mc-badge" :class="course.published === 1 ? 'mc-badge--success' : 'mc-badge--warning'">
              {{ course.published === 1 ? '已发布' : '草稿' }}
            </span>
          </td>
          <td>
            <div class="row-actions">
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
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.table-wrap {
  max-height: 62vh;
  overflow: auto;
}

.folder-cell {
  display: inline-block;
  max-width: 220px;
  font-size: var(--mc-text-xs);
}

.course {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  min-width: 260px;
}

.course__cover {
  flex: none;
  width: 72px;
  aspect-ratio: 16 / 9;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-sunken);
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-bold);
  overflow: hidden;
}

.course__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.course__text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.course__name {
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
}

.course__name:hover {
  color: var(--mc-primary-fg);
}

.course__desc {
  font-size: var(--mc-text-xs);
  max-width: 420px;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
}
</style>
