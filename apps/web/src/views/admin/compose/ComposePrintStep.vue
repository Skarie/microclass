<script setup lang="ts">
/* eslint-disable vue/no-mutating-props -- 纸张/版式选项由 useExamPrint 持有，子组件就地编辑 */
import Icon from '@/components/Icon.vue';
import { fmtScore } from '@/composables/use-exam-compose';
import type { ExamCompose } from '@/composables/use-exam-compose';
import type { ExamPrint } from '@/composables/use-exam-print';

/**
 * 第④步「打印预览」：纸张 A3/A4、横竖版、单双栏、答案/答题卡/密封线，
 * 右侧 iframe 直接渲染 /paper.html，改版式即刷新。
 */
defineProps<{ compose: ExamCompose; print: ExamPrint; totalScore: number; estimatedMinutes: number }>();
const emit = defineEmits<{ back: [] }>();
</script>

<template>
  <section class="mc-card">
    <div class="mc-card__header">
      <span class="mc-card__title">
        ④ 打印预览（{{ compose.paper.length }} 题 · {{ fmtScore(totalScore) }} 分 · 预估 {{ estimatedMinutes }} 分钟）
      </span>
      <span class="mc-spacer" />
      <button class="mc-btn mc-btn--sm" type="button" @click="emit('back')">
        <Icon name="arrow-left" :size="15" />
        返回改卷子
      </button>
    </div>
    <div class="mc-card__body stp__print">
      <aside class="stp__printopts">
        <label class="stp__field">
          <span class="mc-label">纸张</span>
          <select v-model="print.printOptions.size" class="mc-select" aria-label="纸张" @change="print.refreshPreview">
            <option value="A4">A4（210×297mm）</option>
            <option value="A3">A3（297×420mm）</option>
          </select>
        </label>
        <label class="stp__field">
          <span class="mc-label">方向</span>
          <select
            v-model="print.printOptions.orientation"
            class="mc-select"
            aria-label="方向"
            @change="print.refreshPreview"
          >
            <option value="portrait">纵向</option>
            <option value="landscape">横向</option>
          </select>
        </label>
        <label class="stp__field">
          <span class="mc-label">分栏</span>
          <select
            v-model.number="print.printOptions.columns"
            class="mc-select"
            aria-label="分栏"
            @change="print.refreshPreview"
          >
            <option :value="1">单栏</option>
            <option :value="2">双栏</option>
          </select>
        </label>
        <label class="mc-checkbox">
          <input v-model="print.printOptions.answers" type="checkbox" @change="print.refreshPreview" />
          含答案与解析（教师版）
        </label>
        <label class="mc-checkbox">
          <input v-model="print.printOptions.sheet" type="checkbox" @change="print.refreshPreview" />
          附答题卡
        </label>
        <label class="mc-checkbox">
          <input v-model="print.printOptions.seal" type="checkbox" @change="print.refreshPreview" />
          密封线（装订线）
        </label>
        <button class="mc-btn mc-btn--primary" type="button" @click="print.openPrint">
          <Icon name="print" :size="15" />
          打印 / 导出 PDF
        </button>
        <button class="mc-btn mc-btn--sm" type="button" @click="print.openPaperWord">
          <Icon name="download" :size="15" />
          导出 Word
        </button>
        <p class="mc-hint">浏览器打印对话框里选「另存为 PDF」即可导出文件；纸张与方向按上面设置排版。</p>
      </aside>
      <iframe :src="print.previewSrc" class="stp__preview" title="试卷预览" />
    </div>
  </section>
</template>

<style scoped>
.stp__print {
  display: grid;
  grid-template-columns: minmax(240px, 300px) minmax(0, 1fr);
  gap: var(--mc-space-3);
  align-items: start;
}

@media (max-width: 1100px) {
  .stp__print {
    grid-template-columns: minmax(0, 1fr);
  }
}

.stp__printopts {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
}

.stp__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.stp__preview {
  width: 100%;
  height: 76vh;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
}
</style>
