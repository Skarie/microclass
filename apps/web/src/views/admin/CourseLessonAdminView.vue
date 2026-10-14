<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { api } from '@/api/client';
import { errorMessage, useAsync } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import Icon from '@/components/Icon.vue';
import Tag from '@/components/Tag.vue';
import PageHeader from '@/components/PageHeader.vue';
import AppModal from '@/components/AppModal.vue';
import EmptyState from '@/components/EmptyState.vue';
import LessonFormModal from '@/components/lessons/LessonFormModal.vue';
import KnowledgeModal from '@/components/lessons/KnowledgeModal.vue';
import VideoUploadModal from '@/components/lessons/VideoUploadModal.vue';
import type { CourseManageResponse, CourseScanResult, Lesson, MediaRoot } from '@/api/types';

/**
 * 课程课时管理（课程内操作课时）：
 *   1. 课程绑定一个视频文件夹（课程文件夹）；
 *   2. 点「扫描」把文件夹里的视频导入成课时（子文件夹 = 章节），以后加了新课再扫一次即可；
 *   3. 课时列表支持拖拽排序，顺序按课程保存（老师手工排好的顺序不会被扫描打乱）。
 */
interface MediaRootsResponse {
  mediaRoots: MediaRoot[];
}

interface BrowseResponse {
  path: string;
  dirs: string[];
  files: { name: string; size: number }[];
}

interface OkResponse {
  ok: boolean;
}

const route = useRoute();
const toast = useToastStore();

const courseId = computed(() => Number(route.params.id));

const { data, loading, run } = useAsync<CourseManageResponse>(
  () => api.get<CourseManageResponse>(`/courses/${courseId.value}/manage`),
  { immediate: false },
);

const roots = ref<MediaRoot[]>([]);
const course = computed(() => data.value?.course ?? null);
const folder = computed(() => data.value?.folder ?? null);
const lessons = ref<Lesson[]>([]);

// 本地保存课时顺序：拖拽后立即改本地数组，再提交给后端（失败则回滚）
const order = ref<number[]>([]);
const dragging = ref<number | null>(null);
const dragOver = ref<number | null>(null);
const savingOrder = ref(false);

const rows = computed(() =>
  lessons.value.map((lesson, index) => ({
    lesson,
    index,
    showChapter: index === 0 || lessons.value[index - 1]?.group_name !== lesson.group_name,
  })),
);

const chapterCount = computed(() => new Set(lessons.value.map((l) => l.group_name).filter(Boolean)).size);

async function load(): Promise<void> {
  await run();
  lessons.value = [...(data.value?.lessons ?? [])];
  order.value = lessons.value.map((l) => l.id);
}

async function loadRoots(): Promise<void> {
  try {
    const res = await api.get<MediaRootsResponse>('/media-roots');
    roots.value = res.mediaRoots;
  } catch {
    roots.value = [];
  }
}

onMounted(() => {
  void load();
  void loadRoots();
});

/* ---------------- 课程文件夹：绑定 / 更换 / 解绑 ---------------- */

const bindOpen = ref(false);
const bindRootId = ref('');
const bindPath = ref('');
const binding = ref(false);

const pickerOpen = ref(false);
const pickerPath = ref('');
const pickerDirs = ref<string[]>([]);
const pickerLoading = ref(false);

function openBind(): void {
  bindRootId.value = folder.value?.rootId ?? roots.value[0]?.id ?? '';
  bindPath.value = folder.value?.path ?? '';
  bindOpen.value = true;
  pickerOpen.value = false;
}

async function loadPicker(path: string): Promise<void> {
  if (!bindRootId.value) {
    toast.warning('请先选择媒体目录');
    return;
  }
  pickerLoading.value = true;
  try {
    const res = await api.get<BrowseResponse>(`/media-roots/${bindRootId.value}/browse`, path ? { path } : undefined);
    pickerPath.value = res.path;
    pickerDirs.value = res.dirs;
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    pickerLoading.value = false;
  }
}

function openPicker(): void {
  pickerOpen.value = true;
  void loadPicker(bindPath.value);
}

function pickerEnter(dir: string): void {
  void loadPicker(pickerPath.value ? `${pickerPath.value}/${dir}` : dir);
}

function pickerUp(): void {
  const parts = pickerPath.value.split('/').filter(Boolean);
  parts.pop();
  void loadPicker(parts.join('/'));
}

function pickerPick(): void {
  bindPath.value = pickerPath.value;
  pickerOpen.value = false;
}

async function saveBind(): Promise<void> {
  if (!bindRootId.value) {
    toast.warning('请选择媒体目录');
    return;
  }
  binding.value = true;
  try {
    await api.put<{ ok: boolean }>(`/courses/${courseId.value}/folder`, {
      rootId: bindRootId.value,
      path: bindPath.value.trim(),
    });
    toast.success('课程文件夹已绑定', '点「扫描」即可把该文件夹里的视频导入为课时');
    bindOpen.value = false;
    await load();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    binding.value = false;
  }
}

async function unbind(): Promise<void> {
  if (!window.confirm('解绑后本课程不再与该文件夹联动，已导入的课时会保留。确定解绑吗？')) return;
  try {
    await api.put<{ ok: boolean }>(`/courses/${courseId.value}/folder`, { rootId: null });
    toast.success('已解绑课程文件夹');
    await load();
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

/* ---------------- 扫描导入 / 扫描更新 ---------------- */

const scanModalOpen = ref(false);
const scanning = ref(false);
const scanPreview = ref<CourseScanResult | null>(null);
const removeMissing = ref(false);
/** 章节怎么定：第一层目录（默认）/ 完整目录路径 / 不设章节 */
const chapterMode = ref<'first' | 'full' | 'none'>('first');

const missingFolderLessons = computed(() => (scanPreview.value?.missing ?? []).filter((m) => m.source === 'folder'));

async function openScan(): Promise<void> {
  if (!folder.value) {
    toast.warning('请先绑定课程文件夹', '绑定后点「扫描」即可导入该文件夹里的视频');
    openBind();
    return;
  }
  scanning.value = true;
  try {
    scanPreview.value = await api.post<CourseScanResult>(`/courses/${courseId.value}/scan`, {
      dryRun: true,
      chapterMode: chapterMode.value,
    });
    removeMissing.value = false;
    scanModalOpen.value = true;
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    scanning.value = false;
  }
}

/** 换章节策略后重新预览（预览里的数字/章节会跟着变） */
async function previewScan(): Promise<void> {
  scanning.value = true;
  try {
    scanPreview.value = await api.post<CourseScanResult>(`/courses/${courseId.value}/scan`, {
      dryRun: true,
      chapterMode: chapterMode.value,
    });
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    scanning.value = false;
  }
}

async function runScan(): Promise<void> {
  scanning.value = true;
  try {
    const res = await api.post<CourseScanResult>(`/courses/${courseId.value}/scan`, {
      removeMissing: removeMissing.value,
      chapterMode: chapterMode.value,
    });
    const extra: string[] = [];
    if (res.assigned > 0) extra.push(`收编 ${res.assigned} 个已有课时`);
    if (res.removed > 0) extra.push(`清理 ${res.removed} 个文件已消失的课时`);
    if (res.skipped > 0) extra.push(`跳过 ${res.skipped} 个已存在`);
    toast.success(
      res.added > 0 ? `扫描完成：新增 ${res.added} 个课时` : '扫描完成：没有新视频',
      extra.join(' · ') || '课时顺序与内容保持原样',
    );
    scanModalOpen.value = false;
    await load();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    scanning.value = false;
  }
}

/* ---------------- 拖拽排序 ---------------- */

function onDragStart(index: number, event: DragEvent): void {
  dragging.value = index;
  dragOver.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  }
}

function onDragOver(index: number, event: DragEvent): void {
  if (dragging.value === null) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dragOver.value = index;
}

function onDragEnd(): void {
  dragging.value = null;
  dragOver.value = null;
}

async function onDrop(index: number): Promise<void> {
  const from = dragging.value;
  dragging.value = null;
  dragOver.value = null;
  if (from === null || from === index) return;
  await moveTo(from, index);
}

/** 把第 from 个课时移动到第 to 个位置（↑/↓ 按钮与拖拽共用） */
async function moveTo(from: number, to: number): Promise<void> {
  if (to < 0 || to >= lessons.value.length || from === to) return;
  const next = [...lessons.value];
  const [moved] = next.splice(from, 1);
  if (!moved) return;
  next.splice(to, 0, moved);
  const previous = lessons.value;
  lessons.value = next;
  savingOrder.value = true;
  try {
    await api.put<OkResponse>(`/courses/${courseId.value}/lessons/order`, { ids: next.map((l) => l.id) });
  } catch (e) {
    lessons.value = previous;
    toast.error(errorMessage(e));
  } finally {
    savingOrder.value = false;
  }
}

/* ---------------- 课时增删改 ---------------- */

const formOpen = ref(false);
const editingLesson = ref<Lesson | null>(null);
const knOpen = ref(false);
const knLesson = ref<Lesson | null>(null);

function openCreate(): void {
  editingLesson.value = null;
  formOpen.value = true;
}

function openEdit(lesson: Lesson): void {
  editingLesson.value = lesson;
  formOpen.value = true;
}

function openKnowledge(lesson: Lesson): void {
  knLesson.value = lesson;
  knOpen.value = true;
}

async function onSaved(): Promise<void> {
  formOpen.value = false;
  await load();
}

async function removeLesson(lesson: Lesson): Promise<void> {
  if (!window.confirm(`确定删除课时「${lesson.title}」吗？该课时的进度、练习记录与知识点会一并移除，且不可恢复。`))
    return;
  try {
    await api.del<OkResponse>(`/lessons/${lesson.id}`);
    toast.success(`课时「${lesson.title}」已删除`);
    await load();
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

/* ---------------- 上传视频（弹窗已抽成 VideoUploadModal） ---------------- */

const uploadOpen = ref(false);

async function onUploaded(): Promise<void> {
  await load();
}

/** 关闭上传弹窗时再刷一次 */
async function closeUpload(): Promise<void> {
  uploadOpen.value = false;
  await load();
}

/* ---------------- 知识点讲义导出（整门课程） ---------------- */

const exporting = ref(false);

async function exportKnowledge(format: 'md' | 'docx'): Promise<void> {
  exporting.value = true;
  try {
    await api.download(`/courses/${courseId.value}/knowledge.${format}`);
    toast.success('课程讲义已开始下载', '按「章节 → 课时」组织，含文本/链接/附件名');
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    exporting.value = false;
  }
}

/* ---------------- 抽取时长/封面（ffprobe + ffmpeg） ---------------- */

const probing = ref(false);
const probeProgress = ref('');

async function probePending(): Promise<void> {
  probing.value = true;
  probeProgress.value = '';
  let probed = 0;
  let failed = 0;
  try {
    for (let round = 0; round < 50; round += 1) {
      const res = await api.post<{ probed: number; failed: number; remaining: number; available: boolean }>(
        '/lessons/probe-pending',
      );
      if (!res.available) {
        toast.warning('运行环境里没有 ffprobe，无法抽取视频时长/封面', '可在镜像或宿主机安装 ffmpeg 后重试');
        break;
      }
      probed += res.probed;
      failed += res.failed;
      if (res.probed === 0 && res.failed === 0) break;
      probeProgress.value = `已处理 ${probed} 个，失败 ${failed} 个…`;
      if (res.remaining === 0) break;
    }
    if (probed > 0 || failed > 0) {
      toast.success(`已抽取 ${probed} 个视频的时长与封面`, failed > 0 ? `${failed} 个文件无法解析（已跳过）` : '');
      await load();
    }
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    probing.value = false;
    probeProgress.value = '';
  }
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

/** 秒级时间戳 → 本地时间文案 */
function formatTime(seconds: number | null): string {
  if (!seconds) return '从未扫描';
  return new Date(seconds * 1000).toLocaleString('zh-CN', { hour12: false });
}
</script>

<template>
  <section class="page mc-col">
    <PageHeader
      :title="course?.name ?? '课程'"
      description="管理本课程的章节与课时：上传视频、绑定媒体目录批量导入、拖拽排序、维护知识点。"
      icon="video"
      :breadcrumb="[
        { label: '首页', to: '/' },
        { label: '课程管理', to: '/admin/courses' },
        { label: course?.name ?? '课时管理' },
      ]"
    >
      <template #actions>
        <RouterLink class="mc-btn mc-btn--sm" :to="{ name: 'admin-courses' }">
          <Icon name="arrow-left" :size="15" />
          课程管理
        </RouterLink>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="loading" @click="load()">
          <Icon name="refresh" :size="15" />
          刷新
        </button>
      </template>
      <template #meta>
        <Tag v-if="course" :tone="course.published === 1 ? 'success' : 'warning'" icon="check">
          {{ course.published === 1 ? '已发布' : '草稿' }}
        </Tag>
        <Tag icon="video">{{ lessons.length }} 课时</Tag>
        <Tag icon="list">{{ chapterCount }} 章节</Tag>
        <Tag icon="check-circle">已学完 {{ course?.finished ?? 0 }}</Tag>
        <Tag icon="folder">{{ course?.category_name || '未分类' }}</Tag>
      </template>
    </PageHeader>

    <!-- 课时相关动作条（课程信息已上移到页头，这里不再重复） -->
    <div class="toolbar mc-card">
      <div class="mc-row mc-row--wrap toolbar__top">
        <div class="mc-spacer" />
        <button class="mc-btn mc-btn--sm" type="button" :disabled="loading" @click="load()">刷新</button>
        <button
          class="mc-btn mc-btn--sm"
          type="button"
          :disabled="probing || lessons.length === 0"
          :title="lessons.length === 0 ? '还没有课时' : '为还没有元数据的视频抽取时长与封面'"
          @click="probePending"
        >
          {{ probing ? probeProgress || '抽取中…' : '抽取时长/封面' }}
        </button>
        <button class="mc-btn mc-btn--sm" type="button" @click="uploadOpen = true">
          <Icon name="upload" :size="15" /> 上传视频
        </button>
        <button class="mc-btn mc-btn--sm" type="button" @click="openCreate">新建课时</button>
        <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" :disabled="scanning" @click="openScan">
          {{ scanning ? '扫描中…' : '扫描文件夹' }}
        </button>
      </div>
    </div>

    <!-- 课程文件夹 -->
    <section class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">课程文件夹</span>
        <span class="mc-muted">子文件夹将成为章节；以后往文件夹里加视频，点一次「扫描文件夹」即可</span>
      </div>

      <div class="mc-card__body folder">
        <template v-if="folder">
          <div class="folder__info">
            <div class="folder__path mc-mono">
              <Icon name="folder" :size="14" />
              {{ folder.rootName }}<template v-if="folder.path"> / {{ folder.path }}</template>
            </div>
            <div class="mc-row mc-row--wrap folder__meta">
              <span class="mc-badge" :class="folder.available ? 'mc-badge--success' : 'mc-badge--danger'">
                {{ folder.available ? '目录可访问' : '目录不可访问' }}
              </span>
              <span class="mc-muted">上次扫描：{{ formatTime(folder.lastScanAt) }}</span>
            </div>
          </div>
          <div class="mc-spacer" />
          <div class="mc-row mc-row--wrap">
            <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" :disabled="scanning" @click="openScan">
              扫描更新
            </button>
            <button class="mc-btn mc-btn--sm" type="button" @click="openBind">更换文件夹</button>
            <button class="mc-btn mc-btn--sm mc-btn--danger" type="button" @click="unbind">解绑</button>
          </div>
        </template>

        <template v-else>
          <div class="folder__empty mc-muted">
            还没有绑定视频文件夹。绑定后「扫描」即可把这个文件夹（含子文件夹）里的视频一次性导入成课时。
          </div>
          <div class="mc-spacer" />
          <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click="openBind">选择文件夹</button>
        </template>
      </div>
    </section>

    <!-- 课程讲义：把整门课的知识点导出成 Markdown / Word -->
    <section class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">课程讲义（知识点导出）</span>
        <span class="mc-muted">按「章节 → 课时」组织，含文本知识点正文、链接与附件名；图片请在各自课时里管理</span>
      </div>
      <div class="mc-card__body knowledge">
        <div class="knowledge__text mc-muted">
          把本课程所有课时的知识点导出成一份讲义：<strong>Markdown</strong> 便于贴进笔记软件或进版本库，
          <strong>Word</strong> 便于打印、发给学生或交给教研组继续改。
        </div>
        <div class="mc-spacer" />
        <div class="mc-row mc-row--wrap">
          <button class="mc-btn mc-btn--sm" type="button" :disabled="exporting" @click="exportKnowledge('md')">
            导出讲义 Markdown
          </button>
          <button class="mc-btn mc-btn--sm" type="button" :disabled="exporting" @click="exportKnowledge('docx')">
            导出讲义 Word
          </button>
        </div>
      </div>
    </section>

    <!-- 课时列表（可拖拽排序） -->
    <section class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">课时（{{ lessons.length }}）</span>
        <span class="mc-muted">
          拖拽左侧手柄或使用 ↑↓ 调整顺序
          <template v-if="savingOrder"> · 保存中…</template>
        </span>
      </div>

      <div v-if="loading && lessons.length === 0" class="loading">
        <div v-for="i in 5" :key="i" class="mc-skeleton loading__row" />
      </div>

      <div v-else-if="lessons.length === 0" class="empty-wrap">
        <EmptyState
          icon="video"
          title="这门课程还没有课时"
          description="推荐做法：绑定课程的视频文件夹后点「扫描文件夹」批量导入；也可以直接上传视频或新建单个课时。"
          action-text="扫描文件夹"
          @action="openScan"
        />
        <div class="mc-row empty-extra">
          <button class="mc-btn mc-btn--sm" type="button" @click="uploadOpen = true">上传视频</button>
          <button class="mc-btn mc-btn--sm" type="button" @click="openCreate">新建课时</button>
        </div>
      </div>

      <ul v-else class="lesson-list" role="list">
        <template v-for="row in rows" :key="row.lesson.id">
          <li v-if="row.showChapter" class="chapter">
            <span class="chapter__name">{{ row.lesson.group_name || '未分章' }}</span>
            <span class="mc-muted chapter__count">
              {{ lessons.filter((l) => l.group_name === row.lesson.group_name).length }} 课时
            </span>
          </li>
          <li
            class="lesson"
            :class="{
              'is-dragging': dragging === row.index,
              'is-over': dragOver === row.index && dragging !== null && dragging !== row.index,
            }"
            :draggable="true"
            @dragstart="onDragStart(row.index, $event)"
            @dragover="onDragOver(row.index, $event)"
            @dragend="onDragEnd"
            @drop.prevent="onDrop(row.index)"
          >
            <span class="lesson__handle" aria-hidden="true" title="拖拽调整顺序">⠿</span>
            <span class="lesson__index mc-mono">{{ row.index + 1 }}</span>

            <div class="lesson__cover">
              <img
                v-if="row.lesson.cover_path"
                :src="`/api/v1/lesson-covers/${row.lesson.id}`"
                :alt="row.lesson.title"
                loading="lazy"
              />
              <Icon v-else name="video" :size="16" />
            </div>

            <div class="lesson__text">
              <div class="lesson__title-row">
                <RouterLink
                  class="lesson__title"
                  :to="{ name: 'watch', params: { id: row.lesson.id } }"
                  :title="row.lesson.title"
                >
                  {{ row.lesson.title }}
                </RouterLink>
                <span v-if="row.lesson.source === 'manual'" class="mc-badge lesson__badge">手工</span>
              </div>
              <span class="mc-muted mc-truncate lesson__path">{{ row.lesson.video_path }}</span>
            </div>

            <span class="mc-muted lesson__duration">{{ formatDuration(row.lesson.duration) }}</span>

            <div class="lesson__actions">
              <button
                class="mc-btn mc-btn--sm"
                type="button"
                title="上移"
                :disabled="row.index === 0"
                @click="moveTo(row.index, row.index - 1)"
              >
                ↑
              </button>
              <button
                class="mc-btn mc-btn--sm"
                type="button"
                title="下移"
                :disabled="row.index === lessons.length - 1"
                @click="moveTo(row.index, row.index + 1)"
              >
                ↓
              </button>
              <button class="mc-btn mc-btn--sm" type="button" @click="openKnowledge(row.lesson)">知识点</button>
              <button class="mc-btn mc-btn--sm" type="button" @click="openEdit(row.lesson)">编辑</button>
              <button class="mc-btn mc-btn--sm mc-btn--danger" type="button" @click="removeLesson(row.lesson)">
                删除
              </button>
            </div>
          </li>
        </template>
      </ul>
    </section>

    <!-- 绑定/更换文件夹 -->
    <AppModal :open="bindOpen" title="选择课程文件夹" width="620px" @close="bindOpen = false">
      <div class="mc-col">
        <label class="mc-field">
          <span class="mc-label mc-label--required">媒体目录</span>
          <select v-model="bindRootId" class="mc-select" aria-label="媒体目录">
            <option v-for="r in roots" :key="r.id" :value="r.id" :disabled="r.available === false">
              {{ r.name }}（{{ r.path }}）{{ r.available === false ? '· 不可访问' : '' }}
            </option>
          </select>
        </label>

        <label class="mc-field">
          <span class="mc-label">子文件夹（可留空 = 用整个目录）</span>
          <div class="mc-row bind__path">
            <input
              v-model.trim="bindPath"
              class="mc-input"
              type="text"
              placeholder="例如：Java 程序设计"
              aria-label="子文件夹"
            />
            <button class="mc-btn mc-btn--sm" type="button" @click="openPicker">浏览…</button>
          </div>
        </label>

        <p class="mc-hint">
          一个文件夹只能绑定一门课程；文件夹里的子文件夹会变成章节。绑定不会立刻导入课时，点「扫描」才会。
        </p>

        <p v-if="roots.length === 0" class="mc-hint hint--warn">
          还没有可用的媒体目录。请先在「课时管理 → 媒体目录」里添加宿主机文件夹（Docker 版需先挂载进容器）。
        </p>
      </div>

      <template #footer>
        <button class="mc-btn" type="button" @click="bindOpen = false">取消</button>
        <button
          class="mc-btn mc-btn--primary"
          type="button"
          :disabled="binding || roots.length === 0"
          @click="saveBind"
        >
          {{ binding ? '保存中…' : '保存并扫描' }}
        </button>
      </template>
    </AppModal>

    <!-- 文件夹选择器 -->
    <AppModal :open="pickerOpen" title="选择文件夹" width="560px" @close="pickerOpen = false">
      <div class="mc-col">
        <div class="mc-row mc-mono picker__path">
          <button class="mc-btn mc-btn--sm" type="button" :disabled="pickerPath === ''" @click="pickerUp">
            ↑ 上一级
          </button>
          <span class="mc-truncate">/{{ pickerPath }}</span>
        </div>
        <div v-if="pickerLoading" class="mc-muted">加载中…</div>
        <ul v-else-if="pickerDirs.length > 0" class="picker__list">
          <li v-for="dir in pickerDirs" :key="dir">
            <button class="picker__dir" type="button" @click="pickerEnter(dir)">
              <Icon name="folder" :size="14" /> {{ dir }}
            </button>
          </li>
        </ul>
        <p v-else class="mc-muted">该目录下没有子文件夹，可以直接选当前目录。</p>
      </div>
      <template #footer>
        <button class="mc-btn" type="button" @click="pickerOpen = false">取消</button>
        <button class="mc-btn mc-btn--primary" type="button" @click="pickerPick">选择当前目录</button>
      </template>
    </AppModal>

    <!-- 扫描确认 -->
    <AppModal :open="scanModalOpen" title="扫描课程文件夹" width="660px" @close="scanModalOpen = false">
      <div v-if="scanPreview" class="mc-col">
        <label class="mc-field">
          <span class="mc-label">章节怎么定</span>
          <select v-model="chapterMode" class="mc-select" aria-label="章节怎么定" @change="previewScan">
            <option value="first">按课程文件夹下的第一层目录（推荐）</option>
            <option value="full">按完整目录层级</option>
            <option value="none">不设章节（全部归入未分章）</option>
          </select>
          <span class="mc-hint">
            素材常见结构是「章 / 节 / 视频」，默认只取第一层当章节； 若你的目录只有一层章节，两种写法效果一样。
          </span>
        </label>

        <div class="scan-summary">
          <div class="scan-summary__item">
            <span class="scan-summary__num">{{ scanPreview.onDisk }}</span>
            <span class="mc-muted">磁盘上的视频</span>
          </div>
          <div class="scan-summary__item">
            <span class="scan-summary__num scan-summary__num--primary">{{ scanPreview.added }}</span>
            <span class="mc-muted">将新增课时</span>
          </div>
          <div class="scan-summary__item">
            <span class="scan-summary__num">{{ scanPreview.skipped }}</span>
            <span class="mc-muted">已存在跳过</span>
          </div>
          <div v-if="scanPreview.assigned > 0" class="scan-summary__item">
            <span class="scan-summary__num">{{ scanPreview.assigned }}</span>
            <span class="mc-muted">收编到本课程</span>
          </div>
          <div v-if="scanPreview.updated > 0" class="scan-summary__item">
            <span class="scan-summary__num">{{ scanPreview.updated }}</span>
            <span class="mc-muted">章节名同步</span>
          </div>
        </div>

        <ul v-if="scanPreview.folders > 0" class="mc-muted scan-folders">
          <li>共 {{ scanPreview.folders }} 个文件夹被扫描（含课程文件夹自身），子文件夹名会成为章节名。</li>
        </ul>

        <div v-if="scanPreview.missing.length > 0" class="scan-missing">
          <div class="scan-missing__head">
            <strong>{{ scanPreview.missing.length }} 个课时的视频已不在磁盘上</strong>
          </div>
          <ul class="scan-missing__list">
            <li v-for="m in scanPreview.missing.slice(0, 20)" :key="m.id">
              <span class="mc-mono mc-truncate">{{ m.videoPath }}</span>
              <span class="mc-badge" :class="m.source === 'folder' ? 'mc-badge--warning' : ''">
                {{ m.source === 'folder' ? '扫描导入' : '手工创建（不会自动删除）' }}
              </span>
            </li>
          </ul>
          <p v-if="scanPreview.missing.length > 20" class="mc-muted">仅显示前 20 条…</p>
          <label v-if="missingFolderLessons.length > 0" class="mc-checkbox">
            <input v-model="removeMissing" type="checkbox" />
            同时清理 {{ missingFolderLessons.length }} 个「扫描导入但文件已消失」的课时
          </label>
        </div>
      </div>

      <template #footer>
        <button class="mc-btn" type="button" @click="scanModalOpen = false">取消</button>
        <button class="mc-btn mc-btn--primary" type="button" :disabled="scanning" @click="runScan">
          {{ scanning ? '扫描中…' : scanPreview?.added ? `导入 ${scanPreview.added} 个课时` : '确认扫描' }}
        </button>
      </template>
    </AppModal>

    <!-- 上传视频（弹窗组件，与课程管理的「未归类课时」共用同一套上传逻辑） -->
    <VideoUploadModal
      :open="uploadOpen"
      :course-id="courseId"
      :course-name="course?.name"
      @close="closeUpload"
      @uploaded="onUploaded"
    />

    <LessonFormModal
      :open="formOpen"
      :locked-course-id="courseId"
      :locked-course-name="course?.name"
      :lesson="editingLesson"
      :roots="roots"
      :default-sort="lessons.length"
      @close="formOpen = false"
      @saved="onSaved"
    />

    <KnowledgeModal :open="knOpen" :lesson="knLesson" @close="knOpen = false" />
  </section>
</template>

<style scoped>
.page {
  gap: var(--mc-space-5);
}

.toolbar {
  padding: var(--mc-space-4) var(--mc-space-5);
}

.toolbar__top {
  align-items: center;
}

.toolbar__title {
  margin: 0;
  font-size: var(--mc-text-lg, 18px);
  font-weight: 700;
}

.toolbar__count {
  font-size: var(--mc-text-xs);
}

/* ---------- 课程文件夹 ---------- */
.folder {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  flex-wrap: wrap;
}

.folder__info {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  min-width: 0;
}

.folder__path {
  font-weight: 600;
  word-break: break-all;
}

.folder__meta {
  align-items: center;
  gap: var(--mc-space-3);
  font-size: var(--mc-text-xs);
}

.folder__empty {
  font-size: var(--mc-text-sm, 13px);
}

/* ---------- 课程讲义 ---------- */
.knowledge {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  flex-wrap: wrap;
}

.knowledge__text {
  font-size: var(--mc-text-sm, 13px);
  max-width: 720px;
}

/* ---------- 课时列表 ---------- */
.lesson-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.chapter {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-2) var(--mc-space-5);
  background: var(--mc-bg-sunken);
  border-top: 1px solid var(--mc-border);
  border-bottom: 1px solid var(--mc-border);
}

.chapter__name {
  font-weight: 600;
  font-size: var(--mc-text-sm, 13px);
}

.chapter__count {
  font-size: var(--mc-text-xs);
}

.lesson {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3) var(--mc-space-5);
  border-bottom: 1px solid var(--mc-border);
  background: var(--mc-bg);
}

.lesson.is-dragging {
  opacity: 0.45;
}

.lesson.is-over {
  box-shadow: inset 0 2px 0 var(--mc-primary);
}

.lesson__handle {
  cursor: grab;
  color: var(--mc-text-muted);
  user-select: none;
  font-size: 16px;
  line-height: 1;
}

.lesson__index {
  width: 28px;
  text-align: right;
  color: var(--mc-text-muted);
  font-size: var(--mc-text-xs);
}

.lesson__cover {
  flex: none;
  width: 76px;
  aspect-ratio: 16 / 9;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-sunken);
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
  flex: 1;
}

.lesson__title-row {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  min-width: 0;
}

.lesson__title {
  font-weight: 600;
  color: var(--mc-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lesson__title:hover {
  color: var(--mc-primary-fg);
}

.lesson__badge {
  font-size: 11px;
}

.lesson__path {
  font-size: var(--mc-text-xs);
  max-width: 520px;
}

.lesson__duration {
  font-size: var(--mc-text-xs);
  width: 64px;
  text-align: right;
}

.lesson__actions {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
}

/* ---------- 其它 ---------- */
.bind__path {
  gap: var(--mc-space-2);
}

.bind__path .mc-input {
  flex: 1;
}

.hint--warn {
  color: var(--mc-warning-fg);
}

.picker__path {
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-2);
  background: var(--mc-bg-sunken);
  border-radius: var(--mc-radius-sm);
  min-width: 0;
}

.picker__list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 320px;
  overflow-y: auto;
}

.picker__dir {
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius-sm);
  cursor: pointer;
  color: var(--mc-text);
}

.picker__dir:hover {
  background: var(--mc-bg-sunken);
}

.scan-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: var(--mc-space-3);
}

.scan-summary__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  font-size: var(--mc-text-xs);
}

.scan-summary__num {
  font-size: 22px;
  font-weight: 700;
}

.scan-summary__num--primary {
  color: var(--mc-primary-fg);
}

.scan-folders {
  margin: 0;
  padding-left: 18px;
  font-size: var(--mc-text-xs);
}

.scan-missing {
  border: 1px solid var(--mc-warning);
  border-radius: var(--mc-radius);
  padding: var(--mc-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
}

.scan-missing__head {
  font-size: var(--mc-text-sm, 13px);
}

.scan-missing__list {
  margin: 0;
  padding-left: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow-y: auto;
  font-size: var(--mc-text-xs);
}

.scan-missing__list li {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  min-width: 0;
}

.loading {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  padding: var(--mc-space-5);
}

.loading__row {
  height: 52px;
}

.empty-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--mc-space-3);
  padding-bottom: var(--mc-space-5);
}

.empty-extra {
  gap: var(--mc-space-2);
}

@media (max-width: 900px) {
  .lesson {
    flex-wrap: wrap;
  }

  .lesson__path {
    max-width: 100%;
  }
}
</style>
