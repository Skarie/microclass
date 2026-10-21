<script setup lang="ts">
/**
 * 课程讲义卡片：把整门课的知识点导出成 Markdown / Word。
 * 导出请求与提示文案在 use-course-lesson-actions，这里只负责展示与触发。
 */
defineProps<{ exporting: boolean }>();

const emit = defineEmits<{
  (e: 'export-knowledge', format: 'md' | 'docx'): void;
}>();
</script>

<template>
  <section class="mc-card">
    <div class="mc-card__header">
      <span class="mc-card__title">课程讲义（知识点导出）</span>
      <span class="mc-muted">按「章节 → 课时」组织，含文本知识点正文、链接与附件名；图片请在各自课时里管理</span>
    </div>
    <div class="mc-card__body knowledge">
      <div class="knowledge__text mc-muted">
        把本课程所有课时的知识点导出成一份讲义：<strong>Markdown</strong> 便于贴进笔记软件或进版本库，
        <strong>Word</strong> 便于打印、发给学生或交给教研组继续改。
      </div>
      <div class="mc-spacer" />
      <div class="mc-row mc-row--wrap">
        <button class="mc-btn mc-btn--sm" type="button" :disabled="exporting" @click="emit('export-knowledge', 'md')">
          导出讲义 Markdown
        </button>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="exporting" @click="emit('export-knowledge', 'docx')">
          导出讲义 Word
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.knowledge {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  flex-wrap: wrap;
}

.knowledge__text {
  font-size: var(--mc-text-sm, 13px);
  max-width: 720px;
}
</style>
