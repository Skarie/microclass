<script setup lang="ts">
/**
 * 上传视频弹窗（课程内上传 / 课程管理里上传共用）。
 *
 * 与原「课时管理」的上传能力保持一致：
 *   - 拖拽文件或**整个文件夹**、点击「选择视频文件」/「选择整个文件夹」；
 *   - **上传到哪门课程**：不归类 / 导入到已有课程 / 新建课程；
 *   - 章节怎么定：按拖入的文件夹名自动分章 / 不设章节 / 统一章节名；
 *   - 队列顺序上传，逐个显示进度，失败可重试、可清理已完成。
 *
 * 队列、拖拽目录递归与进度都在 `useVideoUpload` 里，这里只管界面与目标解析。
 */
import { computed, ref, watch } from 'vue';
import { api } from '@/api/client';
import { useVideoUpload } from '@/composables/useVideoUpload';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import AppModal from '@/components/AppModal.vue';
import type { Course } from '@/api/types';

const props = defineProps<{
  open: boolean;
  /** 目标课程：传数字 = 课程内上传（课程锁定）；null = 可在弹窗里选「不归类 / 已有课程 / 新建课程」 */
  courseId: number | null;
  /** 锁定课程名（仅用于标题） */
  courseName?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  /** 有视频成功上传（父组件据此刷新列表） */
  (e: 'uploaded'): void;
  /** 上传时新建了课程（父组件据此刷新课程列表） */
  (e: 'course-created', id: number): void;
}>();

interface CourseListResponse {
  courses: Course[];
}

const toast = useToastStore();
const upload = useVideoUpload();
const { queue, uploading, done, failed, dropActive, chapters } = upload;

const locked = computed(() => typeof props.courseId === 'number' && props.courseId !== null);

const courses = ref<Course[]>([]);
const targetMode = ref<'none' | 'existing' | 'new'>('none');
const targetCourseId = ref<number | ''>('');
const newCourseName = ref('');

const chapterMode = ref<'auto' | 'none' | 'custom'>('auto');
const chapterName = ref('');

async function loadCourses(): Promise<void> {
  try {
    const res = await api.get<CourseListResponse>('/courses');
    courses.value = res.courses;
  } catch {
    courses.value = [];
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    upload.reset();
    chapterMode.value = 'auto';
    chapterName.value = '';
    targetMode.value = locked.value ? 'existing' : 'none';
    targetCourseId.value = locked.value ? (props.courseId as number) : '';
    newCourseName.value = '';
    if (!locked.value) void loadCourses();
  },
);

async function onDropZone(event: DragEvent): Promise<void> {
  if (event.dataTransfer) await upload.addFromDataTransfer(event.dataTransfer);
}

/** 解析目标课程：锁定课程 / 不归类 / 已有课程 / 现场新建 */
async function resolveCourseId(): Promise<number | null | undefined> {
  if (locked.value) return props.courseId;
  if (targetMode.value === 'none') return null;
  if (targetMode.value === 'existing') {
    if (targetCourseId.value === '') {
      toast.warning('请选择目标课程');
      return undefined;
    }
    return Number(targetCourseId.value);
  }
  const name = newCourseName.value.trim();
  if (!name) {
    toast.warning('请填写新课程名称');
    return undefined;
  }
  try {
    const created = await api.post<{ ok: boolean; id: number }>('/courses', { name, published: true });
    toast.success(`已新建课程「${name}」`);
    emit('course-created', created.id);
    return created.id;
  } catch (e) {
    toast.error(errorMessage(e));
    return undefined;
  }
}

async function start(): Promise<void> {
  const courseId = await resolveCourseId();
  if (courseId === undefined) return;
  const res = await upload.start({
    courseId,
    chapterMode: chapterMode.value,
    chapterName: chapterName.value,
  });
  // 上传完**不自动关闭**：留出「看失败原因 / 重试 / 清理已完成」的机会；
  // 只通知父组件刷新列表，关掉弹窗时父组件会再刷一次。
  if (res.done > 0) emit('uploaded');
}
</script>

<template>
  <AppModal
    :open="props.open"
    :title="locked ? `上传视频到「${props.courseName ?? '本课程'}」` : '上传视频'"
    width="760px"
    @close="emit('close')"
  >
    <div class="mc-col">
      <div v-if="!locked" class="form-grid">
        <label class="mc-field">
          <span class="mc-label">上传到哪门课程</span>
          <select v-model="targetMode" class="mc-select" aria-label="上传到哪门课程">
            <option value="none">不归类（之后批量改绑）</option>
            <option value="existing">导入到已有课程</option>
            <option value="new">新建课程</option>
          </select>
        </label>

        <label v-if="targetMode === 'existing'" class="mc-field">
          <span class="mc-label mc-label--required">目标课程</span>
          <select v-model="targetCourseId" class="mc-select" aria-label="目标课程">
            <option value="">请选择课程</option>
            <option v-for="c in courses" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>

        <label v-else-if="targetMode === 'new'" class="mc-field">
          <span class="mc-label mc-label--required">新课程名称</span>
          <input
            v-model.trim="newCourseName"
            class="mc-input"
            type="text"
            maxlength="120"
            placeholder="例如：Java 程序设计"
            aria-label="新课程名称"
          />
        </label>
      </div>

      <div
        class="dropzone"
        :class="{ 'is-active': dropActive }"
        @dragover.prevent="dropActive = true"
        @dragleave="dropActive = false"
        @drop.prevent="onDropZone"
      >
        <p class="dropzone__title">把视频或整个文件夹拖到这里</p>
        <p class="mc-muted dropzone__hint">
          支持 mp4 / webm / mov / mkv / avi / flv / ts / m4v；拖入（或选择）文件夹时，子文件夹名会自动成为章节
        </p>
        <div class="mc-row mc-row--wrap dropzone__actions">
          <label class="mc-btn mc-btn--sm mc-btn--primary">
            选择视频文件
            <input class="hidden-input" type="file" accept="video/*" multiple @change="upload.onPick" />
          </label>
          <label class="mc-btn mc-btn--sm">
            选择整个文件夹
            <!-- 选文件夹要 webkitdirectory；此处不设 accept，非视频文件由队列按扩展名过滤 -->
            <input class="hidden-input" type="file" webkitdirectory multiple @change="upload.onPick" />
          </label>
        </div>
      </div>

      <div class="form-grid">
        <label class="mc-field">
          <span class="mc-label">章节怎么定</span>
          <select v-model="chapterMode" class="mc-select" aria-label="章节怎么定">
            <option value="auto">按文件夹结构自动（推荐）</option>
            <option value="none">不设章节</option>
            <option value="custom">统一章节名</option>
          </select>
        </label>
        <label v-if="chapterMode === 'custom'" class="mc-field">
          <span class="mc-label">统一章节名</span>
          <input v-model.trim="chapterName" class="mc-input" type="text" maxlength="120" aria-label="统一章节名" />
        </label>
      </div>

      <p v-if="chapterMode === 'auto' && chapters.length > 0" class="mc-hint">识别到章节：{{ chapters.join('、') }}</p>

      <ul v-if="queue.length > 0" class="upload-list">
        <li v-for="item in queue" :key="item.key" class="upload-item">
          <span class="mc-truncate upload-item__name">{{ item.relPath }}</span>
          <span class="mc-muted upload-item__status">
            <template v-if="item.status === 'done'"><Icon name="check" :size="14" /> 完成</template>
            <template v-else-if="item.status === 'error'"><Icon name="close" :size="14" /> {{ item.message }}</template>
            <template v-else-if="item.status === 'uploading'">{{ item.progress }}%</template>
            <template v-else>待上传</template>
          </span>
        </li>
      </ul>

      <div v-if="queue.length > 0" class="upload-list__summary mc-muted">
        共 {{ queue.length }} 个 · 成功 {{ done }} · 失败 {{ failed }}
      </div>
    </div>

    <template #footer>
      <button class="mc-btn" type="button" @click="upload.clearFinished()">清除已完成</button>
      <button class="mc-btn" type="button" @click="emit('close')">关闭</button>
      <button class="mc-btn mc-btn--primary" type="button" :disabled="uploading" @click="start">
        {{ uploading ? '上传中…' : '开始上传' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-5);
  border: 2px dashed var(--mc-border);
  border-radius: var(--mc-radius);
  text-align: center;
}

.dropzone.is-active {
  border-color: var(--mc-primary);
  background: var(--mc-bg-sunken);
}

.dropzone__title {
  margin: 0;
  font-weight: var(--mc-font-semibold);
}

.dropzone__hint {
  margin: 0;
  font-size: var(--mc-text-xs);
}

.dropzone__actions {
  gap: var(--mc-space-2);
  margin-top: var(--mc-space-2);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--mc-space-4);
}

.upload-list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 260px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.upload-item {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  font-size: var(--mc-text-xs);
}

.upload-item__name {
  flex: 1;
  min-width: 0;
}

.upload-item__status {
  flex: none;
}

.upload-list__summary {
  font-size: var(--mc-text-xs);
}

.hidden-input {
  display: none;
}

@media (max-width: 900px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
