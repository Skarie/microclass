<script setup lang="ts">
/**
 * 知识点编辑表单：标题 / 类型 / 正文或外链 + 行内校验。
 * 从 KnowledgeModal 抽出，让弹窗只负责数据加载与增删改。
 */
import type { KnowledgeKind } from '@/api/types';

const title = defineModel<string>('title', { required: true });
const kind = defineModel<KnowledgeKind>('kind', { required: true });
const content = defineModel<string>('content', { required: true });
const url = defineModel<string>('url', { required: true });

defineProps<{
  editing: boolean;
  saving: boolean;
  titleError?: string;
  urlError?: string;
}>();

const emit = defineEmits<{ save: []; reset: []; upload: [] }>();
</script>

<template>
  <div class="kn-form">
    <div class="kn-form__row">
      <label class="kn-form__field">
        <span class="mc-label">标题</span>
        <input
          v-model="title"
          class="mc-input"
          type="text"
          maxlength="200"
          placeholder="例如：正数和负数的概念"
          :aria-invalid="Boolean(titleError)"
          :aria-describedby="titleError ? 'kn-title-error' : undefined"
        />
        <span v-if="titleError" id="kn-title-error" class="kn-form__error" role="alert">{{ titleError }}</span>
      </label>
      <label class="kn-form__field kn-form__field--kind">
        <span class="mc-label">类型</span>
        <select v-model="kind" class="mc-select" :disabled="editing">
          <option value="text">文本</option>
          <option value="link">外链</option>
          <option value="file" disabled>附件</option>
        </select>
      </label>
    </div>

    <template v-if="kind === 'link'">
      <label class="kn-form__field">
        <span class="mc-label">链接地址</span>
        <input
          v-model="url"
          class="mc-input"
          type="url"
          placeholder="须以 http(s):// 开头"
          :aria-invalid="Boolean(urlError)"
          :aria-describedby="urlError ? 'kn-url-error' : undefined"
        />
        <span v-if="urlError" id="kn-url-error" class="kn-form__error" role="alert">{{ urlError }}</span>
      </label>
    </template>
    <label v-else class="kn-form__field">
      <span class="mc-label">正文</span>
      <textarea v-model="content" class="mc-textarea" placeholder="支持多行，学生观看视频时会在右侧看到" />
    </label>

    <div class="kn-form__actions">
      <span class="mc-hint">支持文本 / 外链 / 附件；附件可直接上传课件、讲义或图片。</span>
      <div class="kn-form__btns">
        <button class="mc-btn mc-btn--sm" type="button" :disabled="saving" @click="emit('upload')">上传附件</button>
        <button v-if="editing" class="mc-btn mc-btn--sm" type="button" :disabled="saving" @click="emit('reset')">
          取消
        </button>
        <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" :disabled="saving" @click="emit('save')">
          {{ editing ? '保存修改' : '添加知识点' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kn-form {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding-bottom: var(--mc-space-4);
  border-bottom: 1px solid var(--mc-border);
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

.kn-form__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--mc-space-2);
  margin-top: var(--mc-space-2);
}

.kn-form__btns {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
}
</style>
