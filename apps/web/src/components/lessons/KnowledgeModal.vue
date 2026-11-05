<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import AppModal from '@/components/AppModal.vue';
import KnowledgeList from '@/components/lessons/KnowledgeList.vue';
import type { Knowledge, Lesson } from '@/api/types';

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
        <div class="kn-form__row">
          <input
            v-model="form.title"
            class="mc-input kn-form__title"
            type="text"
            maxlength="200"
            placeholder="知识点标题，例如：正数和负数的概念"
          />
          <select v-model="form.kind" class="mc-select kn-form__kind" :disabled="editingId !== null">
            <option value="text">文本</option>
            <option value="link">外链</option>
            <option value="file" disabled>附件</option>
          </select>
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

        <div class="kn-form__actions">
          <span class="mc-hint">支持文本 / 外链 / 附件；附件可直接上传课件、讲义或图片。</span>
          <div class="kn-form__btns">
            <button class="mc-btn mc-btn--sm" type="button" :disabled="saving" @click="pickKnowledgeFile">
              上传附件
            </button>
            <button
              v-if="editingId !== null"
              class="mc-btn mc-btn--sm"
              type="button"
              :disabled="saving"
              @click="resetForm"
            >
              取消
            </button>
            <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" :disabled="saving" @click="saveKnowledge">
              {{ editingId === null ? '添加知识点' : '保存修改' }}
            </button>
          </div>
        </div>
      </div>

      <input
        ref="fileInput"
        class="hidden-input"
        type="file"
        aria-hidden="true"
        tabindex="-1"
        @change="onKnowledgeFilePicked"
      />

      <KnowledgeList :items="items" :loading="loading" @edit="editKnowledge" @remove="removeKnowledge" />
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
  padding-bottom: var(--mc-space-4);
  border-bottom: 1px solid var(--mc-border);
}

.kn-form__row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mc-space-2);
}

.kn-form__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--mc-space-2);
}

.kn-form__btns {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
}

.kn-form__title {
  flex: 1;
  min-width: 200px;
}

.kn-form__kind {
  width: 110px;
}

.hidden-input {
  display: none;
}

.loading__row {
  height: 48px;
}
</style>
