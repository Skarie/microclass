<script setup lang="ts">
/* eslint-disable vue/no-mutating-props -- 平行卷表单由 useExamParallel 持有，子组件就地编辑 */
import AppModal from '@/components/AppModal.vue';
import type { ExamCompose } from '@/composables/use-exam-compose';
import type { ExamParallel } from '@/composables/use-exam-parallel';

/** 平行组卷弹窗：新卷名称（留空自动命名）+ 抽题范围。 */
defineProps<{ compose: ExamCompose; parallel: ExamParallel }>();
</script>

<template>
  <AppModal
    :open="parallel.parallelOpen"
    title="平行组卷（A/B 卷）"
    width="620px"
    @close="parallel.parallelOpen = false"
  >
    <div class="mc-col">
      <p class="mc-muted">
        按当前试卷逐题配一道<strong>同题型、同难度档、知识点尽量相同</strong>的另一道题，生成一场新考试；
        分值、大题、结构与考试设置都会沿用。新卷是<strong>草稿</strong>。
      </p>
      <label class="stp__field stp__field--wide">
        <span class="mc-label">新试卷名称（留空自动命名）</span>
        <input
          v-model="parallel.parallelForm.title"
          class="mc-input"
          :placeholder="`${compose.exam?.title ?? ''}（平行卷）`"
        />
      </label>
      <label class="stp__field">
        <span class="mc-label">抽题范围</span>
        <select v-model="parallel.parallelForm.scope" class="mc-select">
          <option value="course">本课程（推荐）</option>
          <option value="all">全库所有题</option>
        </select>
      </label>
    </div>
    <template #footer>
      <button class="mc-btn mc-btn--sm" type="button" @click="parallel.parallelOpen = false">取消</button>
      <button
        class="mc-btn mc-btn--primary mc-btn--sm"
        type="button"
        :disabled="parallel.parallelBusy"
        @click="parallel.runParallel"
      >
        {{ parallel.parallelBusy ? '生成中…' : '生成平行卷' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.stp__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.stp__field--wide {
  grid-column: 1 / -1;
}
</style>
