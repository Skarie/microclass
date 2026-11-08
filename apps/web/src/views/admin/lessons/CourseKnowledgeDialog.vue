<script setup lang="ts">
import { reactive, watch } from 'vue';
import AppModal from '@/components/AppModal.vue';
import type { KnowledgeKind } from '@/api/types';
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

const form = reactive<{ title: string; kind: KnowledgeKind; content: string; url: string }>({
  title: '',
  kind: 'text',
  content: '',
  url: '',
});
const errors = reactive({ title: '', url: '' });

watch([() => props.open, () => props.item?.id ?? null], ([open]) => {
  if (!open) return;
  const item = props.item;
  form.title = item?.title ?? '';
  form.kind = item?.kind === 'link' ? 'link' : 'text';
  form.content = item?.content ?? '';
  form.url = item?.url ?? '';
  errors.title = '';
  errors.url = '';
});

function submit(): void {
  const title = form.title.trim();
  errors.title = title ? '' : '请填写知识点标题';
  errors.url =
    form.kind === 'link' && !/^https?:\/\//i.test(form.url.trim()) ? '链接需以 http:// 或 https:// 开头' : '';
  if (errors.title || errors.url) return;
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
    description="课程知识点属于整门课，学生观看本课程任意课时时都会看到。"
    width="640px"
    @close="emit('close')"
  >
    <div class="kn-form">
      <div class="kn-form__row">
        <label class="kn-form__field">
          <span class="mc-label">标题</span>
          <input
            v-model="form.title"
            class="mc-input"
            type="text"
            maxlength="200"
            placeholder="例如：本课程的三个学习目标"
            :aria-invalid="Boolean(errors.title)"
            :aria-describedby="errors.title ? 'course-kn-title-error' : undefined"
          />
          <span v-if="errors.title" id="course-kn-title-error" class="kn-form__error" role="alert">
            {{ errors.title }}
          </span>
        </label>
        <label class="kn-form__field kn-form__field--kind">
          <span class="mc-label">类型</span>
          <select v-model="form.kind" class="mc-select" :disabled="props.item !== null">
            <option value="text">文本</option>
            <option value="link">外链</option>
          </select>
        </label>
      </div>

      <label v-if="form.kind === 'text'" class="kn-form__field">
        <span class="mc-label">正文</span>
        <textarea v-model="form.content" class="mc-textarea" placeholder="支持多行，学生观看本课程任意课时时都会看到" />
      </label>
      <template v-else>
        <label class="kn-form__field">
          <span class="mc-label">链接地址</span>
          <input
            v-model="form.url"
            class="mc-input"
            type="url"
            placeholder="须以 http(s):// 开头"
            :aria-invalid="Boolean(errors.url)"
            :aria-describedby="errors.url ? 'course-kn-url-error' : undefined"
          />
          <span v-if="errors.url" id="course-kn-url-error" class="kn-form__error" role="alert">
            {{ errors.url }}
          </span>
        </label>
      </template>

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
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
}

.kn-form__error {
  display: block;
  margin: 0;
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading);
  color: var(--mc-danger-fg);
}

.kn-form__row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--mc-space-2);
}

.kn-form__field {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--mc-space-1);
  min-width: 200px;
}

.kn-form__field--kind {
  flex: 0 0 110px;
  min-width: 110px;
}

.kn-form__error {
  display: block;
  margin: 0;
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading);
  color: var(--mc-danger-fg);
}
</style>
