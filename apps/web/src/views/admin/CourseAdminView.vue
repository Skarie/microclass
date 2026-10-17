<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import DropdownMenu from '@/components/DropdownMenu.vue';
import { RouterLink, useRouter } from 'vue-router';
import { api } from '@/api/client';
import { errorMessage, useAsync } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import PageHeader from '@/components/PageHeader.vue';
import AppModal from '@/components/AppModal.vue';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import LessonFormModal from '@/components/lessons/LessonFormModal.vue';
import KnowledgeModal from '@/components/lessons/KnowledgeModal.vue';
import LessonPickerTable from '@/components/lessons/LessonPickerTable.vue';
import VideoUploadModal from '@/components/lessons/VideoUploadModal.vue';
import type { Category, Course, Lesson, MediaRoot } from '@/api/types';

/**
 * 课程管理（取代原「课时管理」），四个选项卡：
 *   1. **课程**：平铺（默认）/ 列表，点课程进入它的课时管理（绑定文件夹 + 扫描 + 拖拽排序）；
 *   2. **全部课时**：跨课程检索（按课程筛选 + 关键词搜标题/章节/路径），可勾选改绑或删除；
 *   3. **未归类课时**：没有归属的课时，勾选后批量改绑到课程；
 *   4. **媒体目录**：登记宿主机文件夹（课程文件夹只能从这些目录里选）。
 *
 * 上传视频在「课程内」与「全部/未归类课时」里都能做，共用 `VideoUploadModal`。
 */
interface CourseListResponse {
  courses: Course[];
  categories: Category[];
  orphans: { total: number; finished: number; quiz: number };
}

interface LessonListResponse {
  lessons: Lesson[];
}

interface MediaRootsResponse {
  mediaRoots: MediaRoot[];
}

interface FsBrowseResponse {
  path: string;
  parent: string | null;
  roots: string[];
  dirs: string[];
}

interface OkIdResponse {
  ok: boolean;
  id: number;
}

interface OkResponse {
  ok: boolean;
}

interface CoverResponse {
  ok: boolean;
  cover: string;
}

type ViewMode = 'grid' | 'list';
type Tab = 'courses' | 'lessons' | 'orphans' | 'roots';
type AssignScope = 'all' | 'orphans';

const VIEW_KEY = 'mc.courseView';

const router = useRouter();
const toast = useToastStore();
const { data, loading, run } = useAsync<CourseListResponse>(() => api.get<CourseListResponse>('/courses'));

const tab = ref<Tab>('courses');
const keyword = ref('');
const categoryFilter = ref<number | ''>('');
const view = ref<ViewMode>(readView());
const roots = ref<MediaRoot[]>([]);

function readView(): ViewMode {
  try {
    // 列表优先（结构规范：列表先于卡片网格，一屏能看到更多课程）
    return window.localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

function setView(next: ViewMode): void {
  view.value = next;
  try {
    window.localStorage.setItem(VIEW_KEY, next);
  } catch {
    /* 隐私模式下写不了 localStorage，忽略即可 */
  }
}

const courses = computed(() => data.value?.courses ?? []);
const categories = computed(() => data.value?.categories ?? []);
const orphans = computed(() => data.value?.orphans ?? { total: 0, finished: 0, quiz: 0 });

const filtered = computed(() =>
  courses.value.filter((c) => {
    if (categoryFilter.value !== '' && c.category_id !== categoryFilter.value) return false;
    const kw = keyword.value.trim().toLowerCase();
    if (!kw) return true;
    return `${c.name} ${c.description} ${c.category_name ?? ''}`.toLowerCase().includes(kw);
  }),
);

const publishedCount = computed(() => courses.value.filter((c) => c.published === 1).length);
const boundCount = computed(() => courses.value.filter((c) => c.folder_root_id).length);

/* ---------------- 课程表单 ---------------- */
const formOpen = ref(false);
const saving = ref(false);
const editingId = ref<number | null>(null);
const form = reactive<{
  name: string;
  description: string;
  categoryId: number | '';
  sort: number;
  published: boolean;
}>({
  name: '',
  description: '',
  categoryId: '',
  sort: 0,
  published: true,
});

const catOpen = ref(false);
const catBusy = ref(false);
const newCategoryName = ref('');

const coverInput = ref<HTMLInputElement | null>(null);
const coverTargetId = ref<number | null>(null);
const uploadingCover = ref(false);

/* ---------------- 全部课时 ---------------- */
const allLessons = ref<Lesson[]>([]);
const allLoading = ref(false);
const allSelectedIds = ref<number[]>([]);
const lessonCourseFilter = ref<number | '' | 'orphan'>('');
const lessonKeyword = ref('');

const filteredLessons = computed(() => {
  const kw = lessonKeyword.value.trim().toLowerCase();
  return allLessons.value.filter((l) => {
    if (lessonCourseFilter.value === 'orphan') {
      if (l.course_id !== null) return false;
    } else if (lessonCourseFilter.value !== '' && l.course_id !== lessonCourseFilter.value) {
      return false;
    }
    if (!kw) return true;
    return `${l.title} ${l.group_name} ${l.video_path}`.toLowerCase().includes(kw);
  });
});

const emptyChapterCount = computed(() => allLessons.value.filter((l) => l.group_name === '').length);

/* ---------------- 未归类课时 ---------------- */
const orphanLessons = ref<Lesson[]>([]);
const orphanLoading = ref(false);
const orphanSelectedIds = ref<number[]>([]);

/* ---------------- 批量改绑 / 课时弹窗 ---------------- */
const assignOpen = ref(false);
const assigning = ref(false);
const assignScope = ref<AssignScope>('orphans');
const assignForm = reactive<{ courseId: number | '' | 'orphan'; groupName: string }>({ courseId: '', groupName: '' });

const lessonFormOpen = ref(false);
const editingLesson = ref<Lesson | null>(null);
const knOpen = ref(false);
const knLesson = ref<Lesson | null>(null);
const uploadOpen = ref(false);

/** 当前批量操作作用的课时 id */
const assignIds = computed(() => (assignScope.value === 'all' ? allSelectedIds.value : orphanSelectedIds.value));

/* ---------------- 媒体目录 ---------------- */
const rootsLoading = ref(false);
const addRootOpen = ref(false);
const newRootName = ref('');
const newRootPath = ref('');
const rootSaving = ref(false);

const fsPath = ref('');
const fsData = ref<FsBrowseResponse | null>(null);
const fsLoading = ref(false);
const fsPickerOpen = ref(false);

async function loadRoots(): Promise<void> {
  rootsLoading.value = true;
  try {
    const res = await api.get<MediaRootsResponse>('/media-roots');
    roots.value = res.mediaRoots;
  } catch (e) {
    toast.error(errorMessage(e));
    roots.value = [];
  } finally {
    rootsLoading.value = false;
  }
}

async function loadAllLessons(): Promise<void> {
  allLoading.value = true;
  try {
    const res = await api.get<LessonListResponse>('/lessons');
    allLessons.value = res.lessons;
    allSelectedIds.value = allSelectedIds.value.filter((id) => res.lessons.some((l) => l.id === id));
  } catch (e) {
    toast.error(errorMessage(e));
    allLessons.value = [];
  } finally {
    allLoading.value = false;
  }
}

async function loadOrphans(): Promise<void> {
  orphanLoading.value = true;
  try {
    const res = await api.get<LessonListResponse>('/lessons', { course: 'orphan' });
    orphanLessons.value = res.lessons;
    orphanSelectedIds.value = orphanSelectedIds.value.filter((id) => res.lessons.some((l) => l.id === id));
  } catch (e) {
    toast.error(errorMessage(e));
    orphanLessons.value = [];
  } finally {
    orphanLoading.value = false;
  }
}

async function refreshAll(): Promise<void> {
  await run();
  await Promise.all([loadRoots(), loadAllLessons(), loadOrphans()]);
}

onMounted(() => {
  void refreshAll();
});

watch(tab, (next) => {
  if (next === 'lessons') void loadAllLessons();
  if (next === 'orphans') void loadOrphans();
  if (next === 'roots') void loadRoots();
});

function categoryName(course: Course): string {
  if (course.category_name) return course.category_name;
  if (course.category_id === null) return '未分类';
  return categories.value.find((c) => c.id === course.category_id)?.name ?? '未分类';
}

/** 课程文件夹的展示文案（未绑定返回空串） */
function folderLabel(course: Course): string {
  if (!course.folder_root_id) return '';
  const root = roots.value.find((r) => r.id === course.folder_root_id);
  const base = root?.name ?? course.folder_root_id;
  const sub = course.folder_path ?? '';
  return sub ? `${base} / ${sub}` : base;
}

/**
 * 课程行的「⋯」菜单。次要操作（编辑 / 封面 / 删除）不再常显：
 * 53 门课 × 4 个按钮会把页面堆满，而且删除按钮常驻容易误点。
 */
const courseMenuItems = computed(() => [
  { key: 'edit', label: '编辑课程', icon: 'edit' as const },
  { key: 'cover', label: '上传封面', icon: 'image' as const, disabled: uploadingCover.value },
  { key: 'delete', label: '删除课程', icon: 'trash' as const, danger: true },
]);

function onCourseMenu(course: Course, key: string): void {
  if (key === 'edit') openEdit(course);
  else if (key === 'cover') pickCover(course);
  else if (key === 'delete') void removeCourse(course);
}

function openManage(course: Course): void {
  void router.push({ name: 'admin-course-lessons', params: { id: course.id } });
}

/* ---------------- 课程增删改 ---------------- */
function openCreate(): void {
  editingId.value = null;
  form.name = '';
  form.description = '';
  form.categoryId = '';
  form.sort = courses.value.length;
  form.published = true;
  formOpen.value = true;
}

function openEdit(course: Course): void {
  editingId.value = course.id;
  form.name = course.name;
  form.description = course.description;
  form.categoryId = course.category_id === null ? '' : course.category_id;
  form.sort = course.sort;
  form.published = course.published === 1;
  formOpen.value = true;
}

async function save(): Promise<void> {
  const name = form.name.trim();
  if (!name) {
    toast.warning('请填写课程名称');
    return;
  }
  const payload = {
    name,
    description: form.description.trim(),
    published: form.published,
    categoryId: form.categoryId === '' ? null : Number(form.categoryId),
    sort: Number(form.sort) || 0,
  };
  saving.value = true;
  try {
    if (editingId.value === null) {
      const created = await api.post<OkIdResponse>('/courses', payload);
      toast.success(`课程「${name}」已创建`, '接下来进入课程，选一个视频文件夹并扫描即可导入课时');
      formOpen.value = false;
      await run();
      // 新建后直接进入该课程的课时管理，省掉「再找一遍」这一步
      void router.push({ name: 'admin-course-lessons', params: { id: created.id } });
      return;
    }
    await api.put<OkResponse>(`/courses/${editingId.value}`, payload);
    toast.success(`课程「${name}」已保存`);
    formOpen.value = false;
    await run();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    saving.value = false;
  }
}

async function removeCourse(course: Course): Promise<void> {
  if (
    !window.confirm(
      `确定删除课程「${course.name}」吗？该课程下的 ${course.total ?? 0} 个课时会变成「未归类课时」（可在课程管理的未归类列表里重新改绑），此操作不可恢复。`,
    )
  )
    return;
  try {
    await api.del<OkResponse>(`/courses/${course.id}`);
    toast.success(`课程「${course.name}」已删除`);
    await refreshAll();
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

function pickCover(course: Course): void {
  coverTargetId.value = course.id;
  coverInput.value?.click();
}

async function onCoverPicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  const id = coverTargetId.value;
  coverTargetId.value = null;
  if (!file || id === null) return;
  const fd = new FormData();
  fd.append('file', file);
  uploadingCover.value = true;
  try {
    await api.upload<CoverResponse>(`/courses/${id}/cover`, fd);
    toast.success('封面已更新');
    await run();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    uploadingCover.value = false;
  }
}

async function addCategory(): Promise<void> {
  const name = newCategoryName.value.trim();
  if (!name) {
    toast.warning('请填写分类名称');
    return;
  }
  catBusy.value = true;
  try {
    await api.post<OkIdResponse>('/categories', { name });
    newCategoryName.value = '';
    toast.success(`分类「${name}」已创建`);
    await run();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    catBusy.value = false;
  }
}

async function removeCategory(category: Category): Promise<void> {
  if (!window.confirm(`确定删除分类「${category.name}」吗？该分类下的课程会变成未分类。`)) return;
  catBusy.value = true;
  try {
    await api.del<OkResponse>(`/categories/${category.id}`);
    toast.success(`分类「${category.name}」已删除`);
    await run();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    catBusy.value = false;
  }
}

/* ---------------- 勾选与批量操作 ---------------- */
function toggleIn(list: number[], id: number): number[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function toggleAllLesson(id: number): void {
  allSelectedIds.value = toggleIn(allSelectedIds.value, id);
}

function toggleAllLessonsAll(): void {
  const ids = filteredLessons.value.map((l) => l.id);
  allSelectedIds.value = allSelectedIds.value.length === ids.length ? [] : ids;
}

function toggleOrphan(id: number): void {
  orphanSelectedIds.value = toggleIn(orphanSelectedIds.value, id);
}

function toggleAllOrphans(): void {
  const ids = orphanLessons.value.map((l) => l.id);
  orphanSelectedIds.value = orphanSelectedIds.value.length === ids.length ? [] : ids;
}

function clearSelection(scope: AssignScope): void {
  if (scope === 'all') allSelectedIds.value = [];
  else orphanSelectedIds.value = [];
}

function openAssign(scope: AssignScope): void {
  const ids = scope === 'all' ? allSelectedIds.value : orphanSelectedIds.value;
  if (ids.length === 0) {
    toast.warning('请先勾选要改绑的课时');
    return;
  }
  assignScope.value = scope;
  assignForm.courseId = courses.value[0]?.id ?? '';
  assignForm.groupName = '';
  assignOpen.value = true;
}

async function runAssign(): Promise<void> {
  if (assignForm.courseId === '') {
    toast.warning('请选择目标课程');
    return;
  }
  assigning.value = true;
  try {
    const movingOut = assignForm.courseId === 'orphan';
    const target = movingOut ? null : Number(assignForm.courseId);
    const groupName = assignForm.groupName.trim();
    const res = await api.post<{ ok: true; updated: number }>('/lessons/batch-assign', {
      lessonIds: assignIds.value,
      courseId: target,
      ...(groupName ? { groupName } : {}),
    });
    const courseName = movingOut ? '未归类' : (courses.value.find((c) => c.id === target)?.name ?? `课程 #${target}`);
    toast.success(
      `已把 ${res.updated} 个课时改绑到「${courseName}」`,
      groupName ? `章节统一为「${groupName}」` : '章节保持原样',
    );
    assignOpen.value = false;
    clearSelection(assignScope.value);
    await refreshAll();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    assigning.value = false;
  }
}

function openLessonCreate(): void {
  editingLesson.value = null;
  lessonFormOpen.value = true;
}

function openLessonEdit(lesson: Lesson): void {
  editingLesson.value = lesson;
  lessonFormOpen.value = true;
}

function openLessonKnowledge(lesson: Lesson): void {
  knLesson.value = lesson;
  knOpen.value = true;
}

async function onLessonSaved(): Promise<void> {
  lessonFormOpen.value = false;
  await refreshAll();
}

async function removeLesson(lesson: Lesson): Promise<void> {
  if (!window.confirm(`确定删除课时「${lesson.title}」吗？该课时的进度、练习记录与知识点会一并移除。`)) return;
  try {
    await api.del<OkResponse>(`/lessons/${lesson.id}`);
    toast.success(`课时「${lesson.title}」已删除`);
    await refreshAll();
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

async function removeSelected(scope: AssignScope): Promise<void> {
  const ids = [...(scope === 'all' ? allSelectedIds.value : orphanSelectedIds.value)];
  if (ids.length === 0) {
    toast.warning('请先勾选要删除的课时');
    return;
  }
  if (!window.confirm(`确定删除选中的 ${ids.length} 个课时吗？进度与练习记录会一并移除，不可恢复。`)) return;
  try {
    for (const id of ids) await api.del<OkResponse>(`/lessons/${id}`);
    toast.success(`已删除 ${ids.length} 个课时`);
    clearSelection(scope);
    await refreshAll();
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

async function onUploaded(): Promise<void> {
  await refreshAll();
}

/** 关闭上传弹窗时再刷一次（上传过程中已经刷过一次，这里兜底） */
async function closeUpload(): Promise<void> {
  uploadOpen.value = false;
  await refreshAll();
}

/* ---------------- 媒体目录：增删与服务器目录选择 ---------------- */
function openAddRoot(): void {
  newRootName.value = '';
  newRootPath.value = '';
  addRootOpen.value = true;
  void loadFs('');
}

async function addRoot(): Promise<void> {
  const name = newRootName.value.trim();
  const path = newRootPath.value.trim();
  if (!name) {
    toast.warning('请填写显示名称');
    return;
  }
  if (!path) {
    toast.warning('请用「浏览目录」选择服务器上的文件夹');
    return;
  }
  rootSaving.value = true;
  try {
    await api.post<OkResponse>('/media-roots', { name, path });
    toast.success(`媒体目录「${name}」已添加`, '接下来可在课程里把它（或其子目录）绑定为「课程文件夹」');
    addRootOpen.value = false;
    await refreshAll();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    rootSaving.value = false;
  }
}

async function removeRoot(root: MediaRoot): Promise<void> {
  const used = root.lessons ?? 0;
  if (root.internal) {
    toast.warning('这是系统内置目录（站内上传的视频存这里），不能移除');
    return;
  }
  if (
    !window.confirm(
      `确定移除媒体目录「${root.name}」吗？路径 ${root.path}${used > 0 ? `（当前有 ${used} 个课时在使用，需先改绑或删除）` : ''}`,
    )
  )
    return;
  try {
    await api.del<OkResponse>(`/media-roots/${root.id}`);
    toast.success(`媒体目录「${root.name}」已移除`);
    await refreshAll();
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

async function loadFs(path: string): Promise<void> {
  fsLoading.value = true;
  try {
    const res = await api.get<FsBrowseResponse>('/fs/browse', path ? { path } : undefined);
    fsData.value = res;
    fsPath.value = res.path;
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    fsLoading.value = false;
  }
}

function openFsPicker(): void {
  fsPickerOpen.value = true;
  void loadFs(newRootPath.value.trim());
}

function joinPath(base: string, name: string): string {
  if (!base) return name;
  const sep = base.includes('\\') ? '\\' : '/';
  return base.endsWith(sep) ? `${base}${name}` : `${base}${sep}${name}`;
}

function fsEnter(dir: string): void {
  void loadFs(joinPath(fsData.value?.path ?? '', dir));
}

function fsUp(): void {
  void loadFs(fsData.value?.parent ?? '');
}

function fsPick(): void {
  newRootPath.value = fsData.value?.path ?? '';
  fsPickerOpen.value = false;
}
</script>

<template>
  <section class="page mc-col">
    <PageHeader
      title="课程管理"
      description="维护课程、章节与课时；绑定宿主机视频文件夹后可批量扫描导入，支持拖拽排序。"
      icon="courses"
      :breadcrumb="[{ label: '首页', to: '/' }, { label: '教学管理' }, { label: '课程管理' }]"
    >
      <template #actions>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="loading" @click="refreshAll()">
          <Icon name="refresh" :size="15" />
          刷新
        </button>
        <button class="mc-btn mc-btn--sm" type="button" @click="catOpen = true">
          <Icon name="list" :size="15" />
          分类管理
        </button>
        <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click="openCreate">
          <Icon name="plus" :size="15" />
          新建课程
        </button>
      </template>
    </PageHeader>

    <div class="toolbar mc-card">
      <div class="mc-row mc-row--wrap tabs" role="tablist" aria-label="课程管理分区">
        <button
          class="tab"
          :class="{ 'is-active': tab === 'courses' }"
          type="button"
          role="tab"
          :aria-selected="tab === 'courses'"
          @click="tab = 'courses'"
        >
          课程 <span class="tab__count">{{ courses.length }}</span>
        </button>
        <button
          class="tab"
          :class="{ 'is-active': tab === 'lessons' }"
          type="button"
          role="tab"
          :aria-selected="tab === 'lessons'"
          @click="tab = 'lessons'"
        >
          全部课时 <span v-if="allLessons.length > 0" class="tab__count">{{ allLessons.length }}</span>
        </button>
        <button
          class="tab"
          :class="{ 'is-active': tab === 'orphans' }"
          type="button"
          role="tab"
          :aria-selected="tab === 'orphans'"
          @click="tab = 'orphans'"
        >
          未归类课时 <span class="tab__count">{{ orphans.total }}</span>
        </button>
        <button
          class="tab"
          :class="{ 'is-active': tab === 'roots' }"
          type="button"
          role="tab"
          :aria-selected="tab === 'roots'"
          @click="tab = 'roots'"
        >
          媒体目录 <span class="tab__count">{{ roots.length }}</span>
        </button>
      </div>

      <div v-if="tab === 'courses'" class="mc-row mc-row--wrap toolbar__row">
        <input
          v-model.trim="keyword"
          class="mc-input toolbar__search"
          type="search"
          placeholder="搜索课程名称、简介或分类"
          aria-label="搜索课程"
        />
        <select v-model="categoryFilter" class="mc-select toolbar__select" aria-label="按分类筛选">
          <option value="">全部分类</option>
          <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <span class="mc-muted toolbar__count">
          共 {{ courses.length }} 门 · 已发布 {{ publishedCount }} · 已绑定文件夹 {{ boundCount }} · 未归类课时
          {{ orphans.total }}
        </span>
        <div class="mc-spacer" />
        <div class="view-switch" role="group" aria-label="课程展示方式">
          <button
            class="view-switch__btn"
            :class="{ 'is-active': view === 'grid' }"
            type="button"
            aria-label="平铺展示"
            :aria-pressed="view === 'grid'"
            @click="setView('grid')"
          >
            ▦ 平铺
          </button>
          <button
            class="view-switch__btn"
            :class="{ 'is-active': view === 'list' }"
            type="button"
            aria-label="列表展示"
            :aria-pressed="view === 'list'"
            @click="setView('list')"
          >
            <Icon name="list" :size="15" />
            列表
          </button>
        </div>
      </div>

      <div v-else-if="tab === 'lessons'" class="mc-row mc-row--wrap toolbar__row">
        <input
          v-model.trim="lessonKeyword"
          class="mc-input toolbar__search"
          type="search"
          placeholder="搜索课时标题、章节或视频路径"
          aria-label="搜索课时"
        />
        <select v-model="lessonCourseFilter" class="mc-select toolbar__select" aria-label="按课程筛选课时">
          <option value="">全部课程</option>
          <option value="orphan">未归类</option>
          <option v-for="c in courses" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <span class="mc-muted toolbar__count">
          共 {{ allLessons.length }} 个课时 · 空章节 {{ emptyChapterCount }} 个 · 当前筛选
          {{ filteredLessons.length }} 个
        </span>
        <div class="mc-spacer" />
        <button class="mc-btn mc-btn--sm" type="button" :disabled="allLoading" @click="loadAllLessons()">刷新</button>
        <button class="mc-btn mc-btn--sm" type="button" @click="uploadOpen = true">
          <Icon name="upload" :size="15" /> 上传视频
        </button>
        <button class="mc-btn mc-btn--sm" type="button" @click="openLessonCreate">新建课时</button>
      </div>

      <div v-else-if="tab === 'orphans'" class="mc-row mc-row--wrap toolbar__row">
        <span class="mc-muted toolbar__count">
          这些课时没有归属（上传时没选课程、或课程被删除）。勾选后可批量改绑到课程，也可以直接删除。
        </span>
        <div class="mc-spacer" />
        <button class="mc-btn mc-btn--sm" type="button" :disabled="orphanLoading" @click="loadOrphans()">刷新</button>
        <button class="mc-btn mc-btn--sm" type="button" @click="uploadOpen = true">
          <Icon name="upload" :size="15" /> 上传视频（不归类）
        </button>
        <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click="openLessonCreate">新建课时</button>
      </div>

      <div v-else class="mc-row mc-row--wrap toolbar__row">
        <span class="mc-muted toolbar__count">
          媒体目录 = 服务器上允许被读取的视频文件夹（Docker / FPK
          需先把宿主机目录挂载进容器）。课程的「课程文件夹」只能从这些目录里选。
        </span>
        <div class="mc-spacer" />
        <button class="mc-btn mc-btn--sm" type="button" :disabled="rootsLoading" @click="loadRoots()">刷新</button>
        <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click="openAddRoot">添加媒体目录</button>
      </div>
    </div>

    <!-- ===== 课程 ===== -->
    <section v-if="tab === 'courses'" class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">课程列表</span>
        <span class="mc-muted">{{ filtered.length }} / {{ courses.length }} 门 · 点击课程卡片进入它的课时管理</span>
      </div>

      <div v-if="loading && courses.length === 0" class="loading">
        <div v-for="i in 5" :key="i" class="mc-skeleton loading__row" />
      </div>

      <EmptyState
        v-else-if="filtered.length === 0"
        icon="courses"
        title="没有匹配的课程"
        description="换个关键词或清空分类筛选；也可以点击下方按钮直接新建一门课程。"
        action-text="新建课程"
        @action="openCreate"
      />

      <div v-else-if="view === 'grid'" class="grid">
        <!--
          注意：卡片**不能**整体做成 role="button" —— 里面还有课程名链接和多个操作按钮，
          会命中 axe 的 nested-interactive（交互控件嵌套）。这里改为普通容器：
          标题是链接、操作用按钮，键盘用户走 Tab 即可到达，不需要"整卡可聚焦"。
        -->
        <article v-for="course in filtered" :key="course.id" class="card" @click="openManage(course)">
          <div class="card__cover">
            <img v-if="course.cover" :src="`/api/v1/course-cover/${course.id}`" :alt="course.name" loading="lazy" />
            <span v-else class="card__initial" aria-hidden="true"><Icon name="graduation" :size="26" /></span>
            <span class="mc-badge card__status" :class="course.published === 1 ? '' : 'mc-badge--warning'">
              {{ course.published === 1 ? '已发布' : '草稿' }}
            </span>
          </div>

          <div class="card__body">
            <RouterLink
              class="card__name"
              :to="{ name: 'admin-course-lessons', params: { id: course.id } }"
              @click.stop
            >
              {{ course.name }}
            </RouterLink>
            <p class="mc-muted mc-clamp-2 card__desc">{{ course.description || '暂无课程简介' }}</p>
            <div class="card__meta mc-muted">
              <span>{{ categoryName(course) }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ course.total ?? 0 }} 课时</span>
              <span aria-hidden="true">·</span>
              <span>已学完 {{ course.finished ?? 0 }}</span>
            </div>
            <div class="card__folder" :class="{ 'is-empty': !course.folder_root_id }">
              <Icon name="folder" :size="14" aria-hidden="true" />
              <span class="mc-truncate">{{ folderLabel(course) || '未绑定视频文件夹' }}</span>
            </div>
          </div>

          <div class="card__actions">
            <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click.stop="openManage(course)">
              管理课时
            </button>
            <!-- 次要操作收进「⋯」：53 门课 × 4 个常显按钮 = 212 个按钮，界面太吵也容易误点删除 -->
            <DropdownMenu
              :items="courseMenuItems"
              label=""
              icon="more"
              :show-caret="false"
              aria-label="课程操作（编辑 / 封面 / 删除）"
              variant="ghost"
              @click.stop
              @select="(key) => onCourseMenu(course, key)"
            />
          </div>
        </article>
      </div>

      <div v-else class="mc-table-wrap table-wrap">
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
            <tr v-for="course in filtered" :key="course.id">
              <td>
                <div class="course">
                  <div class="course__cover">
                    <img
                      v-if="course.cover"
                      :src="`/api/v1/course-cover/${course.id}`"
                      :alt="course.name"
                      loading="lazy"
                    />
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
              <td>{{ categoryName(course) }}</td>
              <td>{{ course.total ?? 0 }}</td>
              <td>{{ course.finished ?? 0 }}</td>
              <td>
                <span v-if="course.folder_root_id" class="mc-muted folder-cell mc-truncate">
                  {{ folderLabel(course) }}
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
                  <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click.stop="openManage(course)">
                    管理课时
                  </button>
                  <DropdownMenu
                    :items="courseMenuItems"
                    label=""
                    icon="more"
                    :show-caret="false"
                    aria-label="课程操作（编辑 / 封面 / 删除）"
                    variant="ghost"
                    @click.stop
                    @select="(key) => onCourseMenu(course, key)"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ===== 全部课时 ===== -->
    <section v-else-if="tab === 'lessons'" class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">全部课时（{{ filteredLessons.length }}）</span>
        <span class="mc-muted">跨课程检索：查空章节、查某个文件夹下的课时，或批量改绑/删除</span>
      </div>

      <div v-if="allSelectedIds.length > 0" class="batch-bar mc-row mc-row--wrap">
        <span class="batch-bar__count">已选 {{ allSelectedIds.length }} 个课时</span>
        <div class="mc-spacer" />
        <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click="openAssign('all')">
          批量改绑到课程…
        </button>
        <button class="mc-btn mc-btn--danger mc-btn--sm" type="button" @click="removeSelected('all')">删除选中</button>
        <button class="mc-btn mc-btn--sm" type="button" @click="clearSelection('all')">取消选择</button>
      </div>

      <div v-if="allLoading && allLessons.length === 0" class="loading">
        <div v-for="i in 5" :key="i" class="mc-skeleton loading__row" />
      </div>

      <EmptyState
        v-else-if="filteredLessons.length === 0"
        icon="folder"
        title="没有匹配的课时"
        description="换个关键词或把课程筛选改成「全部课程」；也可以在课程里绑定文件夹扫描导入。"
      />

      <LessonPickerTable
        v-else
        :lessons="filteredLessons"
        :courses="courses"
        :roots="roots"
        :selected="allSelectedIds"
        show-course
        @toggle="toggleAllLesson"
        @toggle-all="toggleAllLessonsAll"
        @edit="openLessonEdit"
        @knowledge="openLessonKnowledge"
        @remove="removeLesson"
      />
    </section>

    <!-- ===== 未归类课时 ===== -->
    <section v-else-if="tab === 'orphans'" class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">未归类课时（{{ orphanLessons.length }}）</span>
        <span class="mc-muted">勾选后可批量改绑到某门课程，也能顺手把章节统一</span>
      </div>

      <div v-if="orphanSelectedIds.length > 0" class="batch-bar mc-row mc-row--wrap">
        <span class="batch-bar__count">已选 {{ orphanSelectedIds.length }} 个课时</span>
        <div class="mc-spacer" />
        <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click="openAssign('orphans')">
          批量改绑到课程…
        </button>
        <button class="mc-btn mc-btn--danger mc-btn--sm" type="button" @click="removeSelected('orphans')">
          删除选中
        </button>
        <button class="mc-btn mc-btn--sm" type="button" @click="clearSelection('orphans')">取消选择</button>
      </div>

      <div v-if="orphanLoading && orphanLessons.length === 0" class="loading">
        <div v-for="i in 4" :key="i" class="mc-skeleton loading__row" />
      </div>

      <EmptyState
        v-else-if="orphanLessons.length === 0"
        icon="folder"
        title="没有未归类课时"
        description="所有课时都归属到课程了。新上传的视频如果没选课程，会先出现在这里。"
        action-text="上传视频"
        @action="uploadOpen = true"
      />

      <LessonPickerTable
        v-else
        :lessons="orphanLessons"
        :courses="courses"
        :roots="roots"
        :selected="orphanSelectedIds"
        @toggle="toggleOrphan"
        @toggle-all="toggleAllOrphans"
        @edit="openLessonEdit"
        @knowledge="openLessonKnowledge"
        @remove="removeLesson"
      />
    </section>

    <!-- ===== 媒体目录 ===== -->
    <section v-else class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">媒体目录（{{ roots.length }}）</span>
        <span class="mc-muted">只登记路径、不复制视频；播放时按 HTTP Range 直接读原文件</span>
      </div>

      <div v-if="rootsLoading && roots.length === 0" class="loading">
        <div v-for="i in 3" :key="i" class="mc-skeleton loading__row" />
      </div>

      <EmptyState
        v-else-if="roots.length === 0"
        icon="folder"
        title="还没有媒体目录"
        description="添加一个服务器上的视频文件夹后，课程才能把它绑定为「课程文件夹」并扫描导入课时。"
        action-text="添加媒体目录"
        @action="openAddRoot"
      />

      <ul v-else class="root-list">
        <li v-for="root in roots" :key="root.id" class="root-item">
          <div class="root-item__info">
            <div class="mc-row mc-row--wrap root-item__title">
              <strong>{{ root.name }}</strong>
              <span v-if="root.internal" class="mc-badge">内置</span>
              <span v-if="root.available === false" class="mc-badge mc-badge--danger">不可访问</span>
              <span v-else class="mc-badge mc-badge--success">可用</span>
              <span class="mc-muted root-item__lessons">{{ root.lessons ?? 0 }} 个课时在用</span>
            </div>
            <span class="mc-muted mc-mono mc-truncate root-item__path">{{ root.path }}</span>
          </div>
          <div class="row-actions">
            <button
              v-if="!root.internal"
              class="mc-btn mc-btn--danger mc-btn--sm"
              type="button"
              @click="removeRoot(root)"
            >
              移除
            </button>
          </div>
        </li>
      </ul>
    </section>

    <input
      ref="coverInput"
      class="hidden-input"
      type="file"
      accept="image/*"
      aria-hidden="true"
      tabindex="-1"
      @change="onCoverPicked"
    />

    <!-- 新建 / 编辑课程 -->
    <AppModal :open="formOpen" :title="editingId === null ? '新建课程' : '编辑课程'" @close="formOpen = false">
      <div class="mc-col">
        <label class="mc-field">
          <span class="mc-label mc-label--required">课程名称</span>
          <input
            v-model="form.name"
            class="mc-input"
            type="text"
            maxlength="120"
            placeholder="例如：Java 程序设计基础"
          />
        </label>

        <label class="mc-field">
          <span class="mc-label">课程简介</span>
          <textarea
            v-model="form.description"
            class="mc-textarea"
            maxlength="2000"
            placeholder="一句话说明课程内容与适合人群"
          />
        </label>

        <div class="form-grid">
          <label class="mc-field">
            <span class="mc-label">所属分类</span>
            <select v-model="form.categoryId" class="mc-select">
              <option value="">未分类</option>
              <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </label>

          <label class="mc-field">
            <span class="mc-label">排序</span>
            <input v-model.number="form.sort" class="mc-input" type="number" min="0" />
          </label>
        </div>

        <label class="mc-checkbox">
          <input v-model="form.published" type="checkbox" />
          立即发布（不勾选则保存为草稿，仅教师可见）
        </label>

        <p v-if="editingId === null" class="mc-hint">
          创建后会直接进入该课程的课时管理，在那里选择视频文件夹并点「扫描」即可导入课时。
        </p>
      </div>

      <template #footer>
        <button class="mc-btn" type="button" @click="formOpen = false">取消</button>
        <button class="mc-btn mc-btn--primary" type="button" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : editingId === null ? '创建并进入课程' : '保存' }}
        </button>
      </template>
    </AppModal>

    <!-- 批量改绑 -->
    <AppModal :open="assignOpen" title="批量改绑到课程" width="560px" @close="assignOpen = false">
      <div class="mc-col">
        <p class="mc-hint">已选 {{ assignIds.length }} 个课时。改绑只改归属，课时、进度、刷题记录都跟随保留。</p>

        <label class="mc-field">
          <span class="mc-label mc-label--required">目标课程</span>
          <select v-model="assignForm.courseId" class="mc-select" aria-label="目标课程">
            <option value="">请选择课程</option>
            <option v-if="assignScope === 'all'" value="orphan">移出课程（回到未归类）</option>
            <option v-for="c in courses" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>

        <label class="mc-field">
          <span class="mc-label">统一章节名（可选）</span>
          <input
            v-model.trim="assignForm.groupName"
            class="mc-input"
            type="text"
            maxlength="120"
            placeholder="留空则保留各自原章节，例如：第一章 Java 基础"
          />
          <span class="mc-hint">填写后这些课时的章节会统一改成该名称。</span>
        </label>
      </div>

      <template #footer>
        <button class="mc-btn" type="button" @click="assignOpen = false">取消</button>
        <button class="mc-btn mc-btn--primary" type="button" :disabled="assigning" @click="runAssign">
          {{ assigning ? '处理中…' : '确认改绑' }}
        </button>
      </template>
    </AppModal>

    <!-- 分类管理 -->
    <AppModal :open="catOpen" title="分类管理" width="520px" @close="catOpen = false">
      <div class="mc-col">
        <div class="mc-row mc-row--wrap">
          <input
            v-model.trim="newCategoryName"
            class="mc-input cat__input"
            type="text"
            maxlength="40"
            placeholder="新分类名称"
            @keyup.enter="addCategory"
          />
          <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" :disabled="catBusy" @click="addCategory">
            添加
          </button>
        </div>

        <p class="mc-hint">
          分类用于课程大厅的筛选。删除分类不会删除课程，只会把课程改为「未分类」（当前共
          {{ orphans.total }} 个未归类课时）。
        </p>

        <EmptyState
          v-if="categories.length === 0"
          icon="list"
          title="还没有分类"
          description="在上方输入名称即可创建第一个分类。"
        />

        <ul v-else class="cat__list">
          <li v-for="c in categories" :key="c.id" class="cat__item">
            <span class="cat__name">{{ c.name }}</span>
            <div class="mc-spacer" />
            <span class="mc-muted cat__count">{{ courses.filter((x) => x.category_id === c.id).length }} 门课程</span>
            <button
              class="mc-btn mc-btn--sm mc-btn--danger"
              type="button"
              :disabled="catBusy"
              @click="removeCategory(c)"
            >
              删除
            </button>
          </li>
        </ul>
      </div>

      <template #footer>
        <button class="mc-btn" type="button" @click="catOpen = false">关闭</button>
      </template>
    </AppModal>

    <!-- 添加媒体目录 -->
    <AppModal :open="addRootOpen" title="添加媒体目录" width="640px" @close="addRootOpen = false">
      <div class="mc-col">
        <label class="mc-field">
          <span class="mc-label mc-label--required">显示名称</span>
          <input v-model="newRootName" class="mc-input" type="text" maxlength="60" placeholder="例如：计算机基础视频" />
        </label>

        <label class="mc-field">
          <span class="mc-label mc-label--required">服务器文件夹路径</span>
          <div class="mc-row">
            <input v-model="newRootPath" class="mc-input" type="text" readonly placeholder="点击右侧按钮选择目录" />
            <button class="mc-btn mc-btn--sm" type="button" @click="openFsPicker">浏览目录</button>
          </div>
          <span class="mc-hint">
            Docker / FPK 部署时请先确认该文件夹已挂载进容器（见 docs/deploy.md）；容器以非 root
            运行，还需保证它有读权限。
          </span>
        </label>
      </div>

      <template #footer>
        <button class="mc-btn" type="button" @click="addRootOpen = false">取消</button>
        <button class="mc-btn mc-btn--primary" type="button" :disabled="rootSaving" @click="addRoot">
          {{ rootSaving ? '添加中…' : '添加' }}
        </button>
      </template>
    </AppModal>

    <!-- 服务器目录选择器 -->
    <AppModal :open="fsPickerOpen" title="选择服务器文件夹" width="620px" @close="fsPickerOpen = false">
      <div class="mc-col">
        <div class="mc-row mc-row--wrap">
          <span class="mc-muted mc-mono mc-truncate fs__path">{{ fsData?.path || '（选择磁盘）' }}</span>
          <div class="mc-spacer" />
          <button class="mc-btn mc-btn--sm" type="button" :disabled="!fsData?.parent" @click="fsUp">上一级</button>
          <button class="mc-btn mc-btn--sm" type="button" :disabled="fsLoading" @click="loadFs(fsPath)">刷新</button>
        </div>

        <div v-if="fsLoading" class="mc-skeleton loading__row" />

        <ul v-else-if="(fsData?.dirs.length ?? 0) > 0" class="fs__list">
          <li v-for="dir in fsData?.dirs ?? []" :key="dir">
            <button class="fs__dir" type="button" @click="fsEnter(dir)">
              <Icon name="folder" :size="14" /> {{ dir }}
            </button>
          </li>
        </ul>

        <p v-else class="mc-muted">该目录下没有子文件夹，可以直接选当前目录。</p>
      </div>

      <template #footer>
        <button class="mc-btn" type="button" @click="fsPickerOpen = false">取消</button>
        <button class="mc-btn mc-btn--primary" type="button" :disabled="!fsData?.path" @click="fsPick">
          选择当前目录
        </button>
      </template>
    </AppModal>

    <LessonFormModal
      :open="lessonFormOpen"
      :lesson="editingLesson"
      :roots="roots"
      :courses="courses"
      :default-sort="tab === 'orphans' ? orphanLessons.length : allLessons.length"
      @close="lessonFormOpen = false"
      @saved="onLessonSaved"
    />

    <KnowledgeModal :open="knOpen" :lesson="knLesson" @close="knOpen = false" @changed="refreshAll" />

    <VideoUploadModal :open="uploadOpen" :course-id="null" @close="closeUpload" @uploaded="onUploaded" />
  </section>
</template>

<style scoped>
.page {
  gap: var(--mc-space-5);
}

.toolbar {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  padding: var(--mc-space-4) var(--mc-space-5);
}

.tabs {
  gap: var(--mc-space-2);
  border-bottom: 1px solid var(--mc-border);
  padding-bottom: var(--mc-space-2);
}

.tab {
  min-height: 32px;
  border: 0;
  background: transparent;
  color: var(--mc-text-muted);
  font-size: var(--mc-text-sm, 13px);
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius-sm);
  cursor: pointer;
}

.tab:hover {
  background: var(--mc-bg-sunken);
}

.tab.is-active {
  background: var(--mc-primary);
  color: var(--mc-text-inverse);
  font-weight: var(--mc-font-semibold);
}

.tab__count {
  opacity: 0.8;
  font-size: var(--mc-text-xs);
}

.toolbar__row {
  align-items: center;
}

.toolbar__search {
  width: 240px;
}

.toolbar__select {
  width: 170px;
}

.toolbar__count {
  font-size: var(--mc-text-xs);
}

.view-switch {
  display: inline-flex;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  overflow: hidden;
}

.view-switch__btn {
  border: 0;
  background: var(--mc-bg);
  color: var(--mc-text-muted);
  font-size: var(--mc-text-xs);
  padding: var(--mc-space-2) var(--mc-space-3);
  cursor: pointer;
}

.view-switch__btn + .view-switch__btn {
  border-left: 1px solid var(--mc-border);
}

.view-switch__btn.is-active {
  background: var(--mc-primary);
  color: var(--mc-text-inverse);
}

/* ---------- 平铺 ---------- */
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
  transition:
    box-shadow 0.15s ease,
    border-color 0.15s ease,
    transform 0.15s ease;
}

.card:hover,
.card:focus-visible {
  border-color: var(--mc-primary);
  box-shadow: var(--mc-elev-hover);
  transform: translateY(-2px);
  outline: none;
}

/* 封面不再用 16:9（太高，一屏只看 8 门课）：固定高度，一屏能看 12 门以上 */
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
  /* 小字用前景色令牌：--mc-warning 直接做文字只有 3.74:1 */
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

/* ---------- 表格 ---------- */
.table-wrap {
  max-height: 62vh;
  overflow: auto;
}

.batch-bar {
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-2) var(--mc-space-5);
  background: var(--mc-bg-sunken);
  border-bottom: 1px solid var(--mc-border);
}

.batch-bar__count {
  font-size: var(--mc-text-sm, 13px);
  font-weight: var(--mc-font-semibold);
}

.folder-cell {
  display: inline-block;
  max-width: 220px;
  font-size: var(--mc-text-xs);
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

/* ---------- 媒体目录 ---------- */
.root-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.root-item {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3) var(--mc-space-5);
  border-bottom: 1px solid var(--mc-border);
  flex-wrap: wrap;
}

.root-item__info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.root-item__title {
  align-items: center;
  gap: var(--mc-space-2);
}

.root-item__lessons,
.root-item__path {
  font-size: var(--mc-text-xs);
}

.fs__path {
  max-width: 380px;
}

.fs__list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 320px;
  overflow-y: auto;
}

.fs__dir {
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius-sm);
  cursor: pointer;
  color: var(--mc-text);
}

.fs__dir:hover {
  background: var(--mc-bg-sunken);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 120px;
  gap: var(--mc-space-4);
}

.hidden-input {
  display: none;
}

.cat__input {
  flex: 1;
  min-width: 200px;
}

.cat__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  max-height: 320px;
  overflow-y: auto;
}

.cat__item {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-2) var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
}

.cat__name {
  font-weight: var(--mc-font-medium);
}

.cat__count {
  font-size: var(--mc-text-xs);
}

@media (max-width: 900px) {
  .toolbar__search,
  .toolbar__select {
    width: 100%;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }

  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
