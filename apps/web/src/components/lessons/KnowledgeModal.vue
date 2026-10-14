<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import AppModal from '@/components/AppModal.vue';
import EmptyState from '@/components/EmptyState.vue';
import type { Knowledge, KnowledgeKind, Lesson } from '@/api/types';

/**
 * 知识点弹窗：某个课时的文本 / 外链 / 附件知识点的增删改。
 *
 * 「课时管理」与「课程课时管理」共用，父组件只需要传入要管理的课时，
 * 增删改后通过 changed 事件通知父组件（列表刷新或提示由父组件决定）。
 */

interface LessonDetailResponse {
  lesson: Lesson;
  knowledge: Knowledge[];
}

interface OkIdResponse {
  ok: boolean;
  id: number;
}

interface OkResponse {
  ok: boolean;
}

interface KnowledgeFileResponse {
  ok: boolean;
  id: number;
  fileName: string;
}

const exporting = ref(false);

/** 导出本课时的知识点（Markdown / Word） */
async function exportKnowledge(format: 'md' | 'docx'): Promise<void> {
  const lesson = props.lesson;
  if (!lesson) return;
  exporting.value = true;
  try {
    await api.download(`/lessons/${lesson.id}/knowledge.${format}`);
    toast.success('知识点已开始下载');
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    exporting.value = false;
  }
}

const props = defineProps<{
  open: boolean;
  /** 要管理知识点的课时；null 时不加载 */
  lesson: Lesson | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  /** 知识点增删改后触发，父组件可用它刷新列表或提示 */
  (e: 'changed'): void;
}>();

const toast = useToastStore();

const items = ref<Knowledge[]>([]);
const loading = ref(false);
const editingId = ref<number | null>(null);
const saving = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const form = reactive({
  title: '',
  kind: 'text',
  content: '',
  url: '',
});

function resetForm(): void {
  editingId.value = null;
  form.title = '';
  form.kind = 'text';
  form.content = '';
  form.url = '';
}

async function loadKnowledge(): Promise<void> {
  const lesson = props.lesson;
  if (!lesson) return;
  loading.value = true;
  try {
    const res = await api.get<LessonDetailResponse>(`/lessons/${lesson.id}`);
    items.value = res.knowledge;
  } catch (e) {
    toast.error(errorMessage(e));
    items.value = [];
  } finally {
    loading.value = false;
  }
}

function editKnowledge(item: Knowledge): void {
  editingId.value = item.id;
  form.title = item.title;
  form.kind = item.kind;
  form.content = item.content;
  form.url = item.url;
}

async function saveKnowledge(): Promise<void> {
  const lesson = props.lesson;
  if (!lesson) return;
  const title = form.title.trim();
  if (!title) {
    toast.warning('请填写知识点标题');
    return;
  }
  if (form.kind === 'link' && !/^https?:\/\//i.test(form.url.trim())) {
    toast.warning('链接必须以 http(s):// 开头');
    return;
  }
  const body =
    form.kind === 'link'
      ? { title, kind: 'link', url: form.url.trim() }
      : { title, kind: form.kind, content: form.content };
  saving.value = true;
  try {
    if (editingId.value === null) {
      await api.post<OkIdResponse>(`/lessons/${lesson.id}/knowledge`, body);
      toast.success('知识点已添加');
    } else {
      await api.put<OkResponse>(`/knowledge/${editingId.value}`, body);
      toast.success('知识点已保存');
    }
    resetForm();
    await loadKnowledge();
    emit('changed');
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    saving.value = false;
  }
}

async function removeKnowledge(item: Knowledge): Promise<void> {
  if (!window.confirm(`确定删除知识点「${item.title}」吗？删除后学生将不再看到该内容。`)) return;
  try {
    await api.del<OkResponse>(`/knowledge/${item.id}`);
    toast.success('知识点已删除');
    if (editingId.value === item.id) resetForm();
    await loadKnowledge();
    emit('changed');
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

function pickKnowledgeFile(): void {
  fileInput.value?.click();
}

async function onKnowledgeFilePicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  const lesson = props.lesson;
  if (!file || !lesson) return;
  const fd = new FormData();
  fd.append('file', file);
  saving.value = true;
  try {
    const res = await api.upload<KnowledgeFileResponse>(`/lessons/${lesson.id}/knowledge/file`, fd);
    toast.success(`附件「${res.fileName}」已上传`);
    await loadKnowledge();
    emit('changed');
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    saving.value = false;
  }
}

function knowledgeKindLabel(kind: KnowledgeKind): string {
  if (kind === 'file') return '附件';
  if (kind === 'link') return '外链';
  return '文本';
}

// 打开弹窗（或切换课时）时重新拉取该课时的知识点
watch([() => props.open, () => props.lesson?.id ?? null], ([open]) => {
  if (!open) return;
  items.value = [];
  resetForm();
  void loadKnowledge();
});
</script>

<template>
  <AppModal :open="props.open" :title="`知识点 · ${props.lesson?.title ?? ''}`" width="720px" @close="emit('close')">
    <div class="mc-col">
      <div class="kn-form mc-col">
        <div class="mc-row mc-row--wrap">
          <input
            v-model="form.title"
            class="mc-input kn-form__title"
            type="text"
            maxlength="200"
            placeholder="知识点标题"
          />
          <select v-model="form.kind" class="mc-select kn-form__kind" :disabled="editingId !== null">
            <option value="text">文本</option>
            <option value="link">外链</option>
            <option value="file" disabled>附件</option>
          </select>
          <button class="mc-btn mc-btn--sm" type="button" :disabled="saving" @click="pickKnowledgeFile">
            上传附件
          </button>
          <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" :disabled="saving" @click="saveKnowledge">
            {{ editingId === null ? '添加' : '保存修改' }}
          </button>
          <button v-if="editingId !== null" class="mc-btn mc-btn--sm" type="button" @click="resetForm">取消编辑</button>
        </div>

        <input
          v-model="form.url"
          class="mc-input"
          type="url"
          placeholder="外链地址，须以 http(s):// 开头"
          v-if="form.kind === 'link'"
        />
        <textarea
          v-else
          v-model="form.content"
          class="mc-textarea"
          placeholder="正文内容（支持多行，学生观看视频时会在右侧看到）"
        />

        <span class="mc-hint">附件方式：点击「上传附件」选择课件 / 讲义 / 图片，上传后自动成为文件类知识点。</span>
      </div>

      <input
        ref="fileInput"
        class="hidden-input"
        type="file"
        aria-hidden="true"
        tabindex="-1"
        @change="onKnowledgeFilePicked"
      />

      <div v-if="loading" class="mc-skeleton loading__row" />

      <EmptyState
        v-else-if="items.length === 0"
        icon="copy"
        title="该课时还没有知识点"
        description="可以添加文本讲义、外部链接，或直接上传课件附件。"
      />

      <ul v-else class="kn-list">
        <li v-for="item in items" :key="item.id" class="kn-item">
          <div class="kn-item__main">
            <div class="mc-row mc-row--wrap">
              <span
                class="mc-badge"
                :class="item.kind === 'file' ? 'mc-badge--primary' : item.kind === 'link' ? 'mc-badge--success' : ''"
              >
                {{ knowledgeKindLabel(item.kind) }}
              </span>
              <strong>{{ item.title }}</strong>
            </div>
            <span v-if="item.kind === 'text'" class="mc-muted mc-clamp-2 kn-item__preview">{{
              item.content || '（空）'
            }}</span>
            <span v-else-if="item.kind === 'link'" class="mc-muted mc-truncate kn-item__preview">{{ item.url }}</span>
            <span v-else class="mc-muted mc-truncate kn-item__preview">附件：{{ item.file_name }}</span>
          </div>
          <div class="row-actions">
            <a
              v-if="item.kind === 'file'"
              class="mc-btn mc-btn--sm"
              :href="`/api/v1/knowledge/${item.id}/file`"
              target="_blank"
              rel="noopener"
            >
              下载
            </a>
            <a
              v-else-if="item.kind === 'link'"
              class="mc-btn mc-btn--sm"
              :href="item.url"
              target="_blank"
              rel="noopener"
              >打开</a
            >
            <button class="mc-btn mc-btn--sm" type="button" @click="editKnowledge(item)">编辑</button>
            <button class="mc-btn mc-btn--sm mc-btn--danger" type="button" @click="removeKnowledge(item)">删除</button>
          </div>
        </li>
      </ul>
    </div>

    <template #footer>
      <button
        class="mc-btn"
        type="button"
        :disabled="!props.lesson || exporting"
        title="把本课时的知识点导出为 Markdown（可贴进笔记软件）"
        @click="exportKnowledge('md')"
      >
        导出 MD
      </button>
      <button
        class="mc-btn"
        type="button"
        :disabled="!props.lesson || exporting"
        title="把本课时的知识点导出为 Word（可打印/分发）"
        @click="exportKnowledge('docx')"
      >
        导出 Word
      </button>
      <button class="mc-btn mc-btn--primary" type="button" @click="emit('close')">关闭</button>
    </template>
  </AppModal>
</template>

<style scoped>
.kn-form {
  padding: var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
}

.kn-form__title {
  flex: 1;
  min-width: 200px;
}

.kn-form__kind {
  width: 110px;
}

.kn-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  max-height: 320px;
  overflow-y: auto;
}

.kn-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
}

.kn-item__main {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  min-width: 0;
  flex: 1;
}

.kn-item__preview {
  font-size: var(--mc-text-xs);
}

.hidden-input {
  display: none;
}

.loading__row {
  height: 48px;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
}
</style>
