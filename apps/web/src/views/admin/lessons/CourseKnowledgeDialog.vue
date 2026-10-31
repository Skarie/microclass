<script setup lang="ts">
import { reactive, watch } from 'vue';
import AppModal from '@/components/AppModal.vue';
import { useToastStore } from '@/stores/toast';
import type { Knowledge, KnowledgePayload } from '@/api/knowledge';

/**
 * 课程级知识点的新增 / 编辑弹窗。
 *
 * 校验与课时级知识点一致：标题必填；外链必须以 http(s):// 开头。
 * 请求与列表刷新在 use-course-knowledge，这里只负责表单与校验。
 */
const props = defineProps<{
  open: boolean;
  /** 正在编辑的课程知识点；null 表示新增 */
  item: Knowledge | null;
  saving: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'submit', payload: KnowledgePayload): void;
}>();

const toast = useToastStore();
const form = reactive({
  title: '',
  kind: 'text',
  content: '',
  url: '',
});

watch([() => props.open, () => props.item?.id ?? null], ([open]) => {
  if (!open) return;
  const item = props.item;
  form.title = item?.title ?? '';
  form.kind = item?.kind === 'link' ? 'link' : 'text';
  form.content = item?.content ?? '';
  form.url = item?.url ?? '';
});

function submit(): void {
  const title = form.title.trim();
  if (!title) {
    toast.warning('请填写知识点标题');
    return;
  }
  if (form.kind === 'link' && !/^https?:\/\//i.test(form.url.trim())) {
    toast.warning('链接必须以 http(s):// 开头');
    return;
  }
  emit(
    'submit',
    form.kind === 'link'
      ? { title, kind: 'link', url: form.url.trim() }
      : { title, kind: 'text', content: form.content },
  );
}
</script>

<template>
  <AppModal
    :open="props.open"
    :title="props.item ? '编辑课程知识点' : '新增课程知识点'"
    width="640px"
    @close="emit('close')"
  >
    <div class="kn-form mc-col">
      <div class="mc-row mc-row--wrap">
        <input
          v-model="form.title"
          class="mc-input kn-form__title"
          type="text"
          maxlength="200"
          placeholder="知识点标题"
        />
        <select v-model="form.kind" class="mc-select kn-form__kind" :disabled="props.item !== null">
          <option value="text">文本</option>
          <option value="link">外链</option>
        </select>
      </div>

      <textarea
        v-if="form.kind === 'text'"
        v-model="form.content"
        class="mc-textarea"
        placeholder="正文内容（支持多行，学生观看本课程任意课时时都会看到）"
      />
      <input v-else v-model="form.url" class="mc-input" type="url" placeholder="外链地址，须以 http(s):// 开头" />

      <span class="mc-hint">课程知识点属于整门课，适合放课程目标、学习方法、通用讲义等共享内容。</span>
    </div>

    <template #footer>
      <button class="mc-btn" type="button" :disabled="props.saving" @click="emit('close')">取消</button>
      <button class="mc-btn mc-btn--primary" type="button" :disabled="props.saving" @click="submit">
        {{ props.item ? '保存修改' : '添加' }}
      </button>
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
</style>
