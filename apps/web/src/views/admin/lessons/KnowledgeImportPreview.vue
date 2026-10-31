<script setup lang="ts">
import { computed } from 'vue';
import type { KnowledgeImportResult } from '@/api/knowledge';

/**
 * 批量导入预览：汇总数字 + 前 20 行匹配结果 + 未匹配清单。
 * 纯展示组件，dryRun 与正式导入共用（正式导入直接复用预览结果）。
 */
const props = defineProps<{ result: KnowledgeImportResult }>();

const MAX_ROWS = 20;
const shown = computed(() => props.result.items.slice(0, MAX_ROWS));
const hidden = computed(() => Math.max(0, props.result.items.length - shown.value.length));
/** 真正会写入的课时数：已存在同名知识点而跳过的课时不在 items 里 */
const importable = computed(() => props.result.items.length);

function reasonLabel(reason: string): string {
  if (reason === 'no-lesson') return '找不到对应课时';
  if (reason === 'multiple-lessons' || reason === 'ambiguous') return '匹配到多个课时';
  return reason || '未匹配';
}
</script>

<template>
  <div class="import-preview mc-col">
    <div class="summary">
      <div class="summary__item">
        <span class="mc-muted summary__label">将导入</span>
        <strong class="mc-num summary__value">{{ importable }}</strong>
        <span class="mc-muted">个课时</span>
      </div>
      <div class="summary__item">
        <span class="mc-muted summary__label">未匹配</span>
        <strong class="mc-num summary__value">{{ result.unmatched }}</strong>
        <span class="mc-muted">个</span>
      </div>
      <div class="summary__item">
        <span class="mc-muted summary__label">跳过</span>
        <strong class="mc-num summary__value">{{ result.skipped }}</strong>
        <span class="mc-muted">个</span>
      </div>
      <div class="summary__item">
        <span class="mc-muted summary__label">缺图</span>
        <strong class="mc-num summary__value">{{ result.missingImages }}</strong>
        <span class="mc-muted">张</span>
      </div>
    </div>

    <section v-if="result.items.length > 0" class="block">
      <div class="mc-row block__head">
        <span class="block__title">匹配结果</span>
        <span class="mc-muted">按课时导入，正文里的图片会一并托管</span>
      </div>
      <div class="mc-table-wrap">
        <table class="mc-table">
          <thead>
            <tr>
              <th scope="col">课时标题</th>
              <th scope="col">章节</th>
              <th scope="col" class="col-num">字数</th>
              <th scope="col" class="col-num">图片数</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in shown" :key="`${item.lessonId}-${item.title}`">
              <td>
                <div class="cell-title">{{ item.lessonTitle }}</div>
                <div class="mc-muted cell-sub">{{ item.title }}</div>
              </td>
              <td>{{ item.chapter || '未分章' }}</td>
              <td class="col-num mc-num">{{ item.chars }}</td>
              <td class="col-num mc-num">{{ item.images }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <span v-if="hidden > 0" class="mc-muted block__more">
        仅显示前 {{ MAX_ROWS }} 行，还有 {{ hidden }} 行未展示（不影响导入结果）
      </span>
    </section>

    <section v-if="result.unmatchedItems.length > 0" class="block">
      <div class="mc-row block__head">
        <span class="block__title">未匹配</span>
        <span class="mc-muted">这些文件不会导入，可检查课时标题后重试</span>
      </div>
      <ul class="unmatched">
        <li v-for="(item, i) in result.unmatchedItems" :key="`${item.title}-${i}`" class="unmatched__item">
          <span class="unmatched__title">{{ item.title }}</span>
          <span class="mc-muted unmatched__chapter">{{ item.chapter || '未分章' }}</span>
          <span class="mc-badge mc-badge--warning">{{ reasonLabel(item.reason) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.import-preview {
  gap: var(--mc-space-4);
}

.summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: var(--mc-space-3);
}

.summary__item {
  display: flex;
  align-items: baseline;
  gap: var(--mc-space-2);
  padding: var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
}

.summary__label {
  font-size: var(--mc-text-xs);
}

.summary__value {
  font-size: var(--mc-text-lg);
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
}

.block__head {
  justify-content: space-between;
}

.block__head .mc-muted {
  font-size: var(--mc-text-xs);
}

.block__title {
  font-weight: var(--mc-font-semibold);
}

.block__more {
  font-size: var(--mc-text-xs);
}

.col-num {
  width: 80px;
  text-align: right;
}

.cell-title {
  font-size: var(--mc-text-sm);
}

.cell-sub {
  font-size: var(--mc-text-xs);
}

.unmatched {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
}

.unmatched__item {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
  padding: var(--mc-space-2) var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
}

.unmatched__title {
  font-size: var(--mc-text-sm);
}

.unmatched__chapter {
  font-size: var(--mc-text-xs);
}
</style>
