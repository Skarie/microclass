<script setup lang="ts">
/**
 * 课时勾选表：课程管理的「全部课时」「未归类课时」两个选项卡共用，
 * 只负责展示与勾选，批量动作（改绑/删除）由父页面提供。
 */
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import type { Course, Lesson, MediaRoot, VideoKind } from '@/api/types';

const props = defineProps<{
  lessons: Lesson[];
  courses: Course[];
  roots: MediaRoot[];
  selected: number[];
  /** 是否显示「所属课程」列（「全部课时」需要，「未归类课时」不用） */
  showCourse?: boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle', id: number): void;
  (e: 'toggle-all'): void;
  (e: 'edit', lesson: Lesson): void;
  (e: 'knowledge', lesson: Lesson): void;
  (e: 'remove', lesson: Lesson): void;
}>();

const allSelected = computed(() => props.lessons.length > 0 && props.selected.length === props.lessons.length);
const someSelected = computed(() => props.selected.length > 0 && !allSelected.value);

function isSelected(id: number): boolean {
  return props.selected.includes(id);
}

function videoKindLabel(kind: VideoKind): string {
  if (kind === 'local') return '本地视频';
  if (kind === 'embed') return '嵌入播放';
  return '外部直链';
}

function sourceLabel(lesson: Lesson): string {
  if (lesson.video_kind !== 'local') return lesson.video_path;
  const root = props.roots.find((r) => r.id === lesson.media_root);
  return `${root?.name ?? lesson.media_root} · ${lesson.video_path}`;
}

function courseLabel(lesson: Lesson): string {
  if (lesson.course_id === null) return '未归类';
  return props.courses.find((c) => c.id === lesson.course_id)?.name ?? `课程 #${lesson.course_id}`;
}

/** 秒 → 时:分:秒（无时长显示 —） */
function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '—';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
</script>

<template>
  <div class="mc-table-wrap table-wrap" tabindex="0" role="region" aria-label="数据表（可用方向键横向滚动）">
    <table class="mc-table">
      <thead>
        <tr>
          <th class="col-check">
            <input
              type="checkbox"
              aria-label="全选课时"
              :checked="allSelected"
              :indeterminate="someSelected"
              @change="emit('toggle-all')"
            />
          </th>
          <th>课时</th>
          <th v-if="props.showCourse">所属课程</th>
          <th>章节</th>
          <th>来源</th>
          <th>时长</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="lesson in props.lessons" :key="lesson.id">
          <td class="col-check">
            <input
              type="checkbox"
              :aria-label="`选择课时 ${lesson.title}`"
              :checked="isSelected(lesson.id)"
              @change="emit('toggle', lesson.id)"
            />
          </td>
          <td>
            <div class="lesson__cell">
              <div class="lesson__cover">
                <img
                  v-if="lesson.cover_path"
                  :src="`/api/v1/lesson-covers/${lesson.id}`"
                  :alt="lesson.title"
                  loading="lazy"
                />
                <Icon v-else name="video" :size="16" />
              </div>
              <div class="lesson__text">
                <span class="lesson__title">{{ lesson.title }}</span>
                <span class="mc-muted mc-truncate lesson__path">{{ sourceLabel(lesson) }}</span>
              </div>
            </div>
          </td>
          <td v-if="props.showCourse">
            <RouterLink
              v-if="lesson.course_id !== null"
              class="course-link"
              :to="{ name: 'admin-course-lessons', params: { id: lesson.course_id } }"
            >
              {{ courseLabel(lesson) }}
            </RouterLink>
            <span v-else class="mc-muted">未归类</span>
          </td>
          <td>{{ lesson.group_name || '—' }}</td>
          <td>
            <span class="mc-badge">{{ videoKindLabel(lesson.video_kind) }}</span>
          </td>
          <td>{{ formatDuration(lesson.duration) }}</td>
          <td>
            <div class="row-actions">
              <button class="mc-btn mc-btn--sm" type="button" @click="emit('knowledge', lesson)">知识点</button>
              <button class="mc-btn mc-btn--sm" type="button" @click="emit('edit', lesson)">编辑</button>
              <RouterLink
                v-if="lesson.course_id !== null"
                class="mc-btn mc-btn--sm"
                :to="{ name: 'admin-course-lessons', params: { id: lesson.course_id } }"
              >
                课程内管理
              </RouterLink>
              <button class="mc-btn mc-btn--danger mc-btn--sm" type="button" @click="emit('remove', lesson)">
                删除
              </button>
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

.col-check {
  width: 44px;
  text-align: center;
}

.lesson__cell {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  min-width: 260px;
}

.lesson__cover {
  flex: none;
  width: 64px;
  aspect-ratio: 16 / 9;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-sunken);
  color: var(--mc-primary-fg);
  overflow: hidden;
}

.lesson__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.lesson__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.lesson__title {
  font-weight: 600;
  color: var(--mc-text);
}

.lesson__path {
  font-size: var(--mc-text-xs);
  max-width: 340px;
}

.course-link {
  color: var(--mc-text);
  font-size: var(--mc-text-sm, 13px);
}

.course-link:hover {
  color: var(--mc-primary-fg);
}

.row-actions {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
}
</style>
