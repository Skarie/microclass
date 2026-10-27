<script setup lang="ts">
import AppModal from '@/components/AppModal.vue';
import type { BackfillSectionsResult } from './bankTypes';

/**
 * 批量回填章节：先 dryRun 预览（将补 / 跳过 + 前 10 条样例），确认后再写库。
 * 只补 section 为空的题库，已有章节不会被覆盖。
 */
defineProps<{
  open: boolean;
  busy: boolean;
  preview: BackfillSectionsResult | null;
}>();
const emit = defineEmits<{ close: []; confirm: [] }>();
</script>

<template>
  <AppModal :open="open" title="批量回填章节" width="640px" @close="emit('close')">
    <div class="mc-col backfill">
      <p class="backfill__lead">
        只处理<strong>章节为空</strong>的题库：优先继承关联课时的章节，其次从题库名
        <code> · </code> 的第一段解析。不会覆盖已有章节。
      </p>

      <div v-if="busy && !preview" class="backfill__loading">
        <div class="mc-skeleton backfill__skeleton" />
        <span class="mc-muted">正在统计可回填的题库…</span>
      </div>

      <template v-else-if="preview">
        <div class="backfill__stats">
          <span class="mc-badge mc-badge--primary">将补 {{ preview.filled }} 条</span>
          <span class="mc-badge mc-badge--warning">跳过 {{ preview.skipped }} 条</span>
          <span class="mc-muted">预览模式，确认后才会写入</span>
        </div>

        <div v-if="preview.samples.length > 0" class="backfill__block">
          <div class="backfill__title">前 {{ preview.samples.length }} 条将补成</div>
          <ul class="backfill__list">
            <li v-for="sample in preview.samples" :key="sample.id" class="backfill__row">
              <span class="mc-truncate" :title="sample.name">{{ sample.name }}</span>
              <span class="backfill__arrow" aria-hidden="true">→</span>
              <span class="mc-badge mc-badge--success">{{ sample.section }}</span>
            </li>
          </ul>
        </div>

        <details v-if="preview.skippedSamples.length > 0" class="backfill__details">
          <summary>查看跳过的样例（{{ preview.skippedSamples.length }} 条）</summary>
          <ul class="backfill__list">
            <li v-for="sample in preview.skippedSamples" :key="sample.id" class="backfill__row mc-muted">
              <span class="mc-truncate" :title="sample.name">{{ sample.name }}</span>
              <span class="mc-hint">名称里没有可识别的章节</span>
            </li>
          </ul>
        </details>

        <p v-if="preview.filled === 0" class="mc-hint">这批题库暂时没有可自动识别的章节，可以手动编辑题库补充。</p>
      </template>

      <p v-else class="mc-hint">暂时没有拿到预览结果，请关闭后重试。</p>
    </div>

    <template #footer>
      <button class="mc-btn" type="button" :disabled="busy" @click="emit('close')">取消</button>
      <button
        class="mc-btn mc-btn--primary"
        type="button"
        :disabled="busy || !preview || preview.filled === 0"
        @click="emit('confirm')"
      >
        {{ busy ? '处理中…' : `确认回填${preview ? ` ${preview.filled} 条` : ''}` }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.backfill {
  gap: var(--mc-space-3);
}

.backfill__lead {
  margin: 0;
  font-size: var(--mc-text-sm);
  color: var(--mc-text-secondary);
}

.backfill__lead code {
  font-family: var(--mc-font-mono);
  font-size: var(--mc-text-xs);
}

.backfill__loading {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
}

.backfill__skeleton {
  width: 120px;
  height: 20px;
}

.backfill__stats {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--mc-space-2);
}

.backfill__block {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
}

.backfill__title {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-medium);
}

.backfill__list {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.backfill__row {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  min-height: 28px;
  font-size: var(--mc-text-sm);
}

.backfill__row > .mc-truncate {
  flex: 1;
  min-width: 0;
}

.backfill__arrow {
  flex: none;
  color: var(--mc-text-muted);
}

.backfill__details {
  font-size: var(--mc-text-sm);
}

.backfill__details summary {
  cursor: pointer;
  color: var(--mc-text-secondary);
}

.backfill__details .backfill__list {
  margin-top: var(--mc-space-2);
}

@media (max-width: 560px) {
  /* 窄屏一行放不下「长题库名 → 章节」，名称独占一行、章节落到下一行 */
  .backfill__row {
    flex-wrap: wrap;
  }

  .backfill__row > .mc-truncate {
    flex-basis: 100%;
  }

  .backfill__arrow {
    display: none;
  }
}
</style>
