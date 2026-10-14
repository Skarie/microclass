<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import AppModal from '@/components/AppModal.vue';
import EmptyState from '@/components/EmptyState.vue';
import type { Course, Lesson, MediaRoot, VideoKind } from '@/api/types';

/**
 * 课时表单弹窗（新建 / 编辑）。
 *
 * 「课时管理」与「课程课时管理」共用：后者传入 lockedCourseId / lockedCourseName，
 * 表单里不再显示课程下拉，改成只读文字，保存时固定挂到该课程。
 */

interface OkIdResponse {
  ok: boolean;
  id: number;
}

interface OkResponse {
  ok: boolean;
}

interface BrowseResponse {
  path: string;
  dirs: string[];
  files: { name: string; size: number }[];
}

const VIDEO_EXT_RE = /\.(mp4|webm|mov|mkv|avi|flv|ts|m4v)$/i;

const props = defineProps<{
  open: boolean;
  /** 锁定的目标课程（课程课时管理页用）：非空时表单不显示课程选择，固定挂到该课程 */
  lockedCourseId?: number | null;
  /** 锁定课程的显示名（只读展示用） */
  lockedCourseName?: string;
  /** 传入课时 = 编辑模式；null/undefined = 新建 */
  lesson?: Lesson | null;
  /** 新建时写库的默认 sort（一般传当前课时数） */
  defaultSort?: number;
  /** 可选的媒体目录列表（由父组件加载） */
  roots: MediaRoot[];
  /** 可选的课程列表（未锁定课程时的下拉选项，由父组件加载） */
  courses?: Course[];
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'saved', payload: { id: number; created: boolean; title: string }): void;
}>();

const toast = useToastStore();

const courseOptions = computed(() => props.courses ?? []);
/** 锁定课程 id（null = 未锁定，正常显示课程下拉） */
const lockedCourseId = computed(() => (typeof props.lockedCourseId === 'number' ? props.lockedCourseId : null));
const lockedCourseLabel = computed(() => {
  const id = lockedCourseId.value;
  if (id === null) return '';
  return props.lockedCourseName || courseOptions.value.find((c) => c.id === id)?.name || `课程 #${id}`;
});
const isEdit = computed(() => (props.lesson ?? null) !== null);

const saving = ref(false);
const form = reactive<{
  title: string;
  description: string;
  videoKind: VideoKind;
  mediaRoot: string;
  videoPath: string;
  groupName: string;
  sort: number;
  courseId: number | '';
}>({
  title: '',
  description: '',
  videoKind: 'local',
  mediaRoot: '',
  videoPath: '',
  groupName: '',
  sort: 0,
  courseId: '',
});

const browseOpen = ref(false);
const browseRel = ref('');
const browseData = ref<BrowseResponse | null>(null);
const browseLoading = ref(false);

const browseVideos = computed(() => (browseData.value?.files ?? []).filter((f) => VIDEO_EXT_RE.test(f.name)));

/** 打开时（重新）初始化表单：编辑用课时数据，新建用空白 + 默认排序 */
function initForm(): void {
  browseOpen.value = false;
  browseData.value = null;
  browseRel.value = '';
  const lesson = props.lesson ?? null;
  const locked = lockedCourseId.value;
  if (lesson) {
    form.title = lesson.title;
    form.description = lesson.description;
    form.videoKind = lesson.video_kind;
    form.mediaRoot = lesson.media_root;
    form.videoPath = lesson.video_path;
    form.groupName = lesson.group_name;
    form.sort = lesson.sort;
    form.courseId = locked ?? (lesson.course_id === null ? '' : lesson.course_id);
    return;
  }
  form.title = '';
  form.description = '';
  form.videoKind = 'local';
  form.mediaRoot = props.roots[0]?.id ?? '';
  form.videoPath = '';
  form.groupName = '';
  form.sort = props.defaultSort ?? 0;
  form.courseId = locked ?? '';
}

watch(
  () => props.open,
  (open) => {
    if (open) initForm();
  },
);

/**
 * 外部视频地址归一化（前端只做即时提示与就地整理，后端会再归一化一次，以其结果为准）：
 * 平台给的通常是整段 `<iframe src="//player.bilibili.com/…">`，取出 src 并补全协议。
 */
function extractExternalUrl(raw: string): { url: string; fromIframe: boolean } {
  let value = raw.trim();
  let fromIframe = false;
  const iframe = /<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i.exec(value);
  if (iframe?.[1]) {
    value = iframe[1].trim();
    fromIframe = true;
  }
  if (value.startsWith('//')) value = `https:${value}`;
  return { url: value, fromIframe };
}

/** 输入框失焦时就地整理成最终地址，避免老师粘了一大段代码看不出到底存了什么 */
function normalizeExternal(): void {
  if (form.videoKind === 'local') return;
  const { url, fromIframe } = extractExternalUrl(form.videoPath);
  if (!url) return;
  if (url !== form.videoPath.trim() || fromIframe) form.videoPath = url;
}

/** 粘贴的是嵌入代码时，提示一下实际会保存的地址 */
const urlFromIframe = computed(() => {
  if (form.videoKind === 'local') return '';
  const { url, fromIframe } = extractExternalUrl(form.videoPath);
  return fromIframe && /^https?:\/\//i.test(url) ? url : '';
});

async function saveLesson(): Promise<void> {
  const title = form.title.trim();
  // 外部视频：允许直接粘贴嵌入代码，保存前先取出真正的地址
  const videoPath = form.videoKind === 'local' ? form.videoPath.trim() : extractExternalUrl(form.videoPath).url;
  if (!title) {
    toast.warning('请填写课时标题');
    return;
  }
  if (!videoPath) {
    toast.warning(form.videoKind === 'local' ? '请选择本地视频文件' : '请填写视频链接');
    return;
  }
  if (form.videoKind === 'local' && !form.mediaRoot) {
    toast.warning('请先选择媒体目录');
    return;
  }
  if (form.videoKind !== 'local' && !/^https?:\/\//i.test(videoPath)) {
    toast.warning('嵌入 / 直链地址必须以 http(s):// 开头', '可以直接粘贴平台的整段 <iframe> 嵌入代码');
    return;
  }

  const locked = lockedCourseId.value;
  const payload: {
    title: string;
    description: string;
    videoKind: VideoKind;
    videoPath: string;
    groupName: string;
    sort: number;
    courseId: number | null;
    mediaRoot?: string;
  } = {
    title,
    description: form.description.trim(),
    videoKind: form.videoKind,
    videoPath,
    groupName: form.groupName.trim(),
    sort: Number(form.sort) || 0,
    courseId: locked !== null ? locked : form.courseId === '' ? null : Number(form.courseId),
  };
  if (form.videoKind === 'local') payload.mediaRoot = form.mediaRoot;

  const lesson = props.lesson ?? null;
  saving.value = true;
  try {
    if (lesson === null) {
      const res = await api.post<OkIdResponse>('/lessons', payload);
      toast.success(`课时「${title}」已创建`);
      emit('saved', { id: res.id, created: true, title });
    } else {
      await api.put<OkResponse>(`/lessons/${lesson.id}`, payload);
      toast.success(`课时「${title}」已保存`);
      emit('saved', { id: lesson.id, created: false, title });
    }
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    saving.value = false;
  }
}

/* ---------------- 目录浏览（选择本地视频） ---------------- */
async function loadBrowse(rel = browseRel.value): Promise<void> {
  if (!form.mediaRoot) {
    toast.warning('请先选择媒体目录');
    return;
  }
  browseLoading.value = true;
  try {
    const res = await api.get<BrowseResponse>(`/media-roots/${form.mediaRoot}/browse`, rel ? { path: rel } : undefined);
    browseData.value = res;
    browseRel.value = res.path;
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    browseLoading.value = false;
  }
}

async function toggleBrowse(): Promise<void> {
  if (browseOpen.value) {
    browseOpen.value = false;
    return;
  }
  browseOpen.value = true;
  await loadBrowse('');
}

function browseEnter(dir: string): void {
  void loadBrowse(browseRel.value ? `${browseRel.value}/${dir}` : dir);
}

function browseUp(): void {
  void loadBrowse(parentPath(browseRel.value));
}

function pickVideo(name: string): void {
  form.videoPath = browseRel.value ? `${browseRel.value}/${name}` : name;
  if (!form.title.trim()) form.title = name.replace(/\.[^.]+$/, '');
  browseOpen.value = false;
  toast.success(`已选择视频：${name}`);
}

function parentPath(rel: string): string {
  const parts = rel.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function formatSize(size: number): string {
  if (size >= 1024 * 1024 * 1024) return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

// 换媒体目录后，之前浏览的目录树就失效了
watch(
  () => form.mediaRoot,
  () => {
    browseData.value = null;
    browseRel.value = '';
    browseOpen.value = false;
  },
);
</script>

<template>
  <AppModal :open="props.open" :title="isEdit ? '编辑课时' : '新建课时'" width="680px" @close="emit('close')">
    <div class="mc-col">
      <label class="mc-field">
        <span class="mc-label mc-label--required">课时标题</span>
        <input
          v-model="form.title"
          class="mc-input"
          type="text"
          maxlength="200"
          placeholder="例如：第 01 讲 变量与数据类型"
        />
      </label>

      <label class="mc-field">
        <span class="mc-label">课时简介</span>
        <textarea
          v-model="form.description"
          class="mc-textarea"
          maxlength="2000"
          placeholder="这节课要讲什么、学生需要提前准备什么"
        />
      </label>

      <div class="form-grid">
        <label class="mc-field">
          <span class="mc-label mc-label--required">视频来源</span>
          <select v-model="form.videoKind" class="mc-select">
            <option value="local">本地视频（服务器文件夹）</option>
            <option value="embed">嵌入播放（iframe）</option>
            <option value="url">外部直链（mp4 等）</option>
          </select>
        </label>

        <label class="mc-field">
          <span class="mc-label">所属章节</span>
          <input v-model="form.groupName" class="mc-input" type="text" maxlength="120" placeholder="留空表示未分章" />
        </label>
      </div>

      <template v-if="form.videoKind === 'local'">
        <label class="mc-field">
          <span class="mc-label mc-label--required">媒体目录</span>
          <select v-model="form.mediaRoot" class="mc-select">
            <option value="">请选择媒体目录</option>
            <option v-for="root in props.roots" :key="root.id" :value="root.id">
              {{ root.name }}（{{ root.path }}）
            </option>
          </select>
        </label>

        <div class="mc-row mc-row--wrap">
          <input
            v-model="form.videoPath"
            class="mc-input browse__path"
            type="text"
            placeholder="相对路径，例如 第01章/01.mp4"
          />
          <button class="mc-btn mc-btn--sm" type="button" @click="toggleBrowse">
            {{ browseOpen ? '收起目录' : '浏览目录' }}
          </button>
        </div>

        <div v-if="browseOpen" class="browse mc-col">
          <div class="mc-row mc-row--wrap">
            <span class="mc-muted mc-mono">/{{ browseRel }}</span>
            <div class="mc-spacer" />
            <button class="mc-btn mc-btn--sm" type="button" :disabled="browseRel === ''" @click="browseUp">
              上一级
            </button>
            <button class="mc-btn mc-btn--sm" type="button" :disabled="browseLoading" @click="loadBrowse()">
              刷新
            </button>
          </div>

          <div v-if="browseLoading" class="mc-skeleton loading__row" />

          <template v-else>
            <div v-if="(browseData?.dirs.length ?? 0) > 0" class="dir-list">
              <button
                v-for="dir in browseData?.dirs ?? []"
                :key="dir"
                class="mc-btn mc-btn--sm dir-list__item"
                type="button"
                @click="browseEnter(dir)"
              >
                <Icon name="folder" :size="14" /> {{ dir }}
              </button>
            </div>

            <EmptyState
              v-if="browseVideos.length === 0"
              icon="video"
              title="当前目录没有可用的视频文件"
              description="支持 mp4 / webm / mov / mkv / avi / flv / ts / m4v，可进入子文件夹继续查找。"
            />

            <ul v-else class="file-list">
              <li v-for="file in browseVideos" :key="file.name" class="file-item">
                <span class="mc-truncate">{{ file.name }}</span>
                <span class="mc-muted file-item__size">{{ formatSize(file.size) }}</span>
                <button class="mc-btn mc-btn--sm mc-btn--primary" type="button" @click="pickVideo(file.name)">
                  选择
                </button>
              </li>
            </ul>
          </template>
        </div>
      </template>

      <label v-else class="mc-field">
        <span class="mc-label mc-label--required">
          {{ form.videoKind === 'embed' ? '嵌入地址（iframe src）' : '视频直链地址' }}
        </span>
        <input
          v-model="form.videoPath"
          class="mc-input"
          type="text"
          placeholder="https://… 或直接粘贴平台给的 <iframe> 代码"
          @blur="normalizeExternal"
        />
        <span v-if="urlFromIframe" class="mc-hint">
          已从嵌入代码里取出地址：<span class="mc-mono">{{ urlFromIframe }}</span>
        </span>
        <span v-else class="mc-hint">
          {{
            form.videoKind === 'embed'
              ? '平台的「分享 → 嵌入代码」整段粘贴即可，保存时自动取出 src；地址必须是 http(s)://（//开头会自动补 https:）'
              : '视频文件直链（mp4/webm 等）必须以 http(s):// 开头；HLS（m3u8）在 Chrome/Edge 里无法直接播放'
          }}
        </span>
      </label>

      <div class="form-grid">
        <div class="mc-field">
          <span class="mc-label">所属课程</span>
          <!-- 课程课时管理页：课程是锁定的，只读展示 -->
          <span v-if="lockedCourseId !== null" class="mc-input course-locked">{{ lockedCourseLabel }}</span>
          <select v-else v-model="form.courseId" class="mc-select">
            <option value="">不归类</option>
            <option v-for="c in courseOptions" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>

        <label class="mc-field">
          <span class="mc-label">排序</span>
          <input v-model.number="form.sort" class="mc-input" type="number" min="0" />
        </label>
      </div>
    </div>

    <template #footer>
      <button class="mc-btn" type="button" @click="emit('close')">取消</button>
      <button class="mc-btn mc-btn--primary" type="button" :disabled="saving" @click="saveLesson">
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--mc-space-4);
}

/* 锁定课程的只读展示：外观接近输入框，但不可编辑 */
.course-locked {
  display: flex;
  align-items: center;
  color: var(--mc-text-secondary);
  background: var(--mc-bg-sunken);
}

.browse__path {
  flex: 1;
  min-width: 240px;
}

.browse {
  padding: var(--mc-space-3);
  border: 1px dashed var(--mc-border-strong);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
}

.dir-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mc-space-2);
}

.dir-list__item {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  max-height: 240px;
  overflow-y: auto;
}

.file-item {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-elevated);
  font-size: var(--mc-text-sm);
}

.file-item__size {
  font-size: var(--mc-text-xs);
  flex: none;
}

.loading__row {
  height: 48px;
}

@media (max-width: 900px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
