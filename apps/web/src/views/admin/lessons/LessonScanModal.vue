<script setup lang="ts">
/* eslint-disable vue/no-mutating-props -- 扫描状态由 useLessonScan 持有，弹窗就地编辑 */
import AppModal from '@/components/AppModal.vue';
import type { useLessonScan } from '@/composables/use-lesson-scan';

/**
 * 扫描确认弹窗：先看 dryRun 预览（磁盘视频数 / 新增 / 跳过 / 收编 / 缺失清单），
 * 换章节策略会重新预览，确认后才真正导入并可顺手清理文件已消失的课时。
 */
defineProps<{ scan: ReturnType<typeof useLessonScan> }>();
</script>

<template>
  <AppModal :open="scan.scanModalOpen" title="扫描课程文件夹" width="660px" @close="scan.closeScan()">
    <div v-if="scan.scanPreview" class="mc-col">
      <label class="mc-field">
        <span class="mc-label">章节怎么定</span>
        <select v-model="scan.chapterMode" class="mc-select" aria-label="章节怎么定" @change="scan.previewScan()">
          <option value="first">按课程文件夹下的第一层目录（推荐）</option>
          <option value="full">按完整目录层级</option>
          <option value="none">不设章节（全部归入未分章）</option>
        </select>
        <span class="mc-hint">
          素材常见结构是「章 / 节 / 视频」，默认只取第一层当章节； 若你的目录只有一层章节，两种写法效果一样。
        </span>
      </label>

      <div class="scan-summary">
        <div class="scan-summary__item">
          <span class="scan-summary__num">{{ scan.scanPreview.onDisk }}</span>
          <span class="mc-muted">磁盘上的视频</span>
        </div>
        <div class="scan-summary__item">
          <span class="scan-summary__num scan-summary__num--primary">{{ scan.scanPreview.added }}</span>
          <span class="mc-muted">将新增课时</span>
        </div>
        <div class="scan-summary__item">
          <span class="scan-summary__num">{{ scan.scanPreview.skipped }}</span>
          <span class="mc-muted">已存在跳过</span>
        </div>
        <div v-if="scan.scanPreview.assigned > 0" class="scan-summary__item">
          <span class="scan-summary__num">{{ scan.scanPreview.assigned }}</span>
          <span class="mc-muted">收编到本课程</span>
        </div>
        <div v-if="scan.scanPreview.updated > 0" class="scan-summary__item">
          <span class="scan-summary__num">{{ scan.scanPreview.updated }}</span>
          <span class="mc-muted">章节名同步</span>
        </div>
      </div>

      <ul v-if="scan.scanPreview.folders > 0" class="mc-muted scan-folders">
        <li>共 {{ scan.scanPreview.folders }} 个文件夹被扫描（含课程文件夹自身），子文件夹名会成为章节名。</li>
      </ul>

      <div v-if="scan.scanPreview.missing.length > 0" class="scan-missing">
        <div class="scan-missing__head">
          <strong>{{ scan.scanPreview.missing.length }} 个课时的视频已不在磁盘上</strong>
        </div>
        <ul class="scan-missing__list">
          <li v-for="m in scan.scanPreview.missing.slice(0, 20)" :key="m.id">
            <span class="mc-mono mc-truncate">{{ m.videoPath }}</span>
            <span class="mc-badge" :class="m.source === 'folder' ? 'mc-badge--warning' : ''">
              {{ m.source === 'folder' ? '扫描导入' : '手工创建（不会自动删除）' }}
            </span>
          </li>
        </ul>
        <p v-if="scan.scanPreview.missing.length > 20" class="mc-muted">仅显示前 20 条…</p>
        <label v-if="scan.missingFolderLessons.length > 0" class="mc-checkbox">
          <input v-model="scan.removeMissing" type="checkbox" />
          同时清理 {{ scan.missingFolderLessons.length }} 个「扫描导入但文件已消失」的课时
        </label>
      </div>
    </div>

    <template #footer>
      <button class="mc-btn" type="button" @click="scan.closeScan()">取消</button>
      <button class="mc-btn mc-btn--primary" type="button" :disabled="scan.scanning" @click="scan.runScan()">
        {{ scan.scanning ? '扫描中…' : scan.scanPreview?.added ? `导入 ${scan.scanPreview.added} 个课时` : '确认扫描' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.scan-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: var(--mc-space-3);
}

.scan-summary__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  font-size: var(--mc-text-xs);
}

.scan-summary__num {
  font-size: var(--mc-text-2xl);
  font-weight: var(--mc-font-bold);
}

.scan-summary__num--primary {
  color: var(--mc-primary-fg);
}

.scan-folders {
  margin: 0;
  padding-left: 16px;
  font-size: var(--mc-text-xs);
}

.scan-missing {
  border: 1px solid var(--mc-warning);
  border-radius: var(--mc-radius);
  padding: var(--mc-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
}

.scan-missing__head {
  font-size: var(--mc-text-sm, 13px);
}

.scan-missing__list {
  margin: 0;
  padding-left: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow-y: auto;
  font-size: var(--mc-text-xs);
}

.scan-missing__list li {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  min-width: 0;
}
</style>
