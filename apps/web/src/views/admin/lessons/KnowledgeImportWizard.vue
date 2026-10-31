<script setup lang="ts">
import { ref } from 'vue';
import AppModal from '@/components/AppModal.vue';
import KnowledgeImportPreview from './KnowledgeImportPreview.vue';
import type { useKnowledgeImport } from '@/composables/use-knowledge-import';

/**
 * 批量导入向导：选择 .zip / .md → 自动 dryRun 预览 → 确认后正式导入。
 * 文件选择后立刻跑一次 dryRun；「确认导入」用同一批 File 再上传一次，不重新选文件。
 * 请求、进度与错误状态在 use-knowledge-import。
 */
const props = defineProps<{ importer: ReturnType<typeof useKnowledgeImport> }>();

const fileInput = ref<HTMLInputElement | null>(null);

function pick(): void {
  if (props.importer.busy) return;
  fileInput.value?.click();
}
</script>

<template>
  <AppModal :open="importer.open" title="批量导入知识点" width="880px" @close="importer.close()">
    <div class="wizard mc-col">
      <ol class="steps">
        <li class="step" :class="{ 'step--active': !importer.preview }">
          <span class="step__no">1</span>
          <span>选择文件</span>
        </li>
        <li class="step" :class="{ 'step--active': importer.preview !== null }">
          <span class="step__no">2</span>
          <span>预览并确认</span>
        </li>
      </ol>

      <div class="file-pick">
        <input
          ref="fileInput"
          class="hidden-input"
          type="file"
          accept=".zip,.md"
          multiple
          aria-hidden="true"
          tabindex="-1"
          @change="importer.onFilePicked"
        />
        <button class="mc-btn" type="button" :disabled="importer.busy" @click="pick">选择文件</button>
        <span v-if="importer.fileNames" class="mc-muted file-pick__names">已选：{{ importer.fileNames }}</span>
        <span v-else class="mc-muted file-pick__names">
          支持 .zip（内含「章节/序号 标题.md」与 images/）或多个 .md 文件
        </span>
      </div>

      <div v-if="importer.busy" class="progress-block">
        <div class="mc-progress">
          <div class="mc-progress__bar" :style="{ width: `${importer.percent}%` }" />
        </div>
        <span class="mc-muted progress-block__text">{{ importer.busyText }}</span>
      </div>

      <p v-if="importer.error" class="mc-error-text">{{ importer.error }}</p>

      <KnowledgeImportPreview v-if="importer.preview" :result="importer.preview" />

      <p v-if="importer.preview && importer.preview.items.length === 0" class="mc-hint">
        没有可导入的知识点：{{ importer.preview.skipped }} 个课时已存在同名知识点，{{ importer.preview.unmatched }}
        个文件未匹配到课时。
      </p>

      <p v-if="!importer.preview && !importer.busy" class="mc-hint">
        选择文件后会先做一次解析预览，不会写入数据；确认后才真正导入。已存在同名知识点的课时会自动跳过。
      </p>
    </div>

    <template #footer>
      <button class="mc-btn" type="button" :disabled="importer.busy" @click="importer.close()">取消</button>
      <button class="mc-btn" type="button" :disabled="importer.busy" @click="pick">
        {{ importer.preview ? '重新选择' : '选择文件' }}
      </button>
      <button class="mc-btn mc-btn--primary" type="button" :disabled="!importer.canImport" @click="importer.confirm()">
        {{ importer.busy && importer.preview ? '导入中…' : '确认导入' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.wizard {
  gap: var(--mc-space-4);
}

.steps {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.step {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  color: var(--mc-text-muted);
  font-size: var(--mc-text-sm);
}

.step + .step::before {
  content: '→';
  color: var(--mc-text-muted);
  margin-right: var(--mc-space-2);
}

.step--active {
  color: var(--mc-text);
  font-weight: var(--mc-font-medium);
}

.step__no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--mc-radius-pill);
  border: 1px solid var(--mc-border-strong);
  font-size: var(--mc-text-xs);
}

.step--active .step__no {
  background: var(--mc-primary-soft);
  border-color: var(--mc-primary-border);
  color: var(--mc-primary-fg);
}

.file-pick {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  flex-wrap: wrap;
  padding: var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
}

.file-pick__names {
  font-size: var(--mc-text-xs);
  word-break: break-all;
}

.hidden-input {
  display: none;
}

.progress-block {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
}

.progress-block__text {
  font-size: var(--mc-text-xs);
}
</style>
