<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { askConfirm } from '@/composables/use-confirm';
import { useToastStore } from '@/stores/toast';
import AppModal from '@/components/AppModal.vue';
import KnowledgeForm from '@/components/lessons/KnowledgeForm.vue';
import KnowledgeList from '@/components/lessons/KnowledgeList.vue';
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
const exporting = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const form = reactive<{ title: string; kind: KnowledgeKind; content: string; url: string }>({
  title: '',
  kind: 'text',
  content: '',
  url: '',
});
const errors = reactive({ title: '', url: '' });

function resetForm(): void {
  editingId.value = null;
  form.title = '';
  form.kind = 'text';
  form.content = '';
  form.url = '';
  errors.title = '';
  errors.url = '';
}

/** 导出本课时的知识点（Markdown / Word） */
async function exportKnowledge(format: 'md' | 'docx'): Promise<void> {
  const lesson = props.lesson;
  if (!lesson) return;
  exporting.value = true;
  try {
    await api.download(`/lessons/${lesson.id}/knowledge.${format}`);
    toast.success(`已开始导出知识点（${format === 'md' ? 'Markdown' : 'Word'}）`);
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    exporting.value = false;
  }
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
  errors.title = '';
  errors.url = '';
}

async function saveKnowledge(): Promise<void> {
  const lesson = props.lesson;
  if (!lesson) return;
  const title = form.title.trim();
  const link = form.url.trim();
  errors.title = title ? '' : '请填写知识点标题';
  errors.url = form.kind === 'link' && !/^https?:\/\//i.test(link) ? '链接需以 http:// 或 https:// 开头' : '';
  if (errors.title || errors.url) return;

  const body =
    form.kind === 'link' ? { title, kind: 'link', url: link } : { title, kind: form.kind, content: form.content };
  saving.value = true;
  try {
    if (editingId.value === null) {
      await api.post<OkIdResponse>(`/lessons/${lesson.id}/knowledge`, body);
      toast.success(`已添加知识点「${title}」`);
    } else {
      await api.put<OkResponse>(`/knowledge/${editingId.value}`, body);
      toast.success(`已保存知识点「${title}」`);
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
  const ok = await askConfirm({
    title: '删除知识点',
    message: `确定删除「${item.title}」吗？`,
    detail: '删除后学生将不再看到该内容，且不可恢复。',
    confirmText: '删除',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.del<OkResponse>(`/knowledge/${item.id}`);
    toast.success(`已删除知识点「${item.title}」`);
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
    toast.success(`已上传附件「${res.fileName}」`);
    await loadKnowledge();
    emit('changed');
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    saving.value = false;
  }
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
  <AppModal
    :open="props.open"
    :title="`知识点 · ${props.lesson?.title ?? ''}`"
    description="保存后，学生观看该课时时会在右侧看到对应内容。"
    width="720px"
    @close="emit('close')"
  >
    <KnowledgeForm
      v-model:title="form.title"
      v-model:kind="form.kind"
      v-model:content="form.content"
      v-model:url="form.url"
      :editing="editingId !== null"
      :saving="saving"
      :title-error="errors.title"
      :url-error="errors.url"
      @save="saveKnowledge"
      @reset="resetForm"
      @upload="pickKnowledgeFile"
    />

    <input
      ref="fileInput"
      class="hidden-input"
      type="file"
      aria-hidden="true"
      tabindex="-1"
      @change="onKnowledgeFilePicked"
    />

    <KnowledgeList :items="items" :loading="loading" @edit="editKnowledge" @remove="removeKnowledge" />

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
.hidden-input {
  display: none;
}
</style>
