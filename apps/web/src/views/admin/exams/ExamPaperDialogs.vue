<script setup lang="ts">
/* eslint-disable vue/no-mutating-props -- 打印选项由 useExamAdminPaper 持有，弹窗就地编辑（与 ComposeSettingsPanel 一致） */
import AppModal from '@/components/AppModal.vue';
import type { useExamAdminPaper } from '@/composables/use-exam-admin-paper';

/**
 * 试卷相关的两个弹窗：整卷预览（所见即所印）与打印 / 导出 PDF 选项。
 * 选项与 URL 拼装都在 useExamAdminPaper，组件只负责表单。
 */
defineProps<{ paper: ReturnType<typeof useExamAdminPaper> }>();
</script>

<template>
  <!-- 整卷预览：与打印同一套版式（所见即所印） -->
  <AppModal :open="paper.previewOpen" title="预览整卷" width="min(1100px, 96vw)" @close="paper.previewOpen = false">
    <div class="mc-col preview">
      <div class="mc-row mc-row--wrap preview__bar">
        <span class="mc-muted"
          >版式与服务端打印完全一致（{{ paper.printOptions.size }} ·
          {{ paper.printOptions.columns === 2 ? '双栏' : '单栏' }}）</span
        >
        <div class="mc-spacer" />
        <label class="mc-row preview__opt"
          ><input v-model="paper.printOptions.answers" type="checkbox" @change="paper.openPaperPreview" /><span
            >含答案</span
          ></label
        >
        <label class="mc-row preview__opt"
          ><input v-model="paper.printOptions.sheet" type="checkbox" @change="paper.openPaperPreview" /><span
            >答题卡</span
          ></label
        >
        <label class="mc-row preview__opt"
          ><input v-model="paper.printOptions.seal" type="checkbox" @change="paper.openPaperPreview" /><span
            >密封线</span
          ></label
        >
      </div>
      <iframe v-if="paper.previewSrc" :src="paper.previewSrc" class="preview__frame" title="试卷预览" />
    </div>
    <template #footer>
      <button class="mc-btn" type="button" @click="paper.previewOpen = false">关闭</button>
      <button class="mc-btn mc-btn--primary" type="button" @click="paper.openPrint">打印 / 导出 PDF</button>
    </template>
  </AppModal>

  <!-- 打印选项 -->
  <AppModal :open="paper.printOpen" title="打印 / 导出 PDF" width="560px" @close="paper.printOpen = false">
    <div class="mc-col print">
      <p class="mc-muted">
        用浏览器打印对话框即可出纸质卷，或选「另存为 PDF」导出文件（版式由服务端确定，A4/A3 与横竖版都按选项走）。
      </p>
      <div class="print__grid">
        <label class="mc-field">
          <span class="mc-label">纸张</span>
          <select v-model="paper.printOptions.size" class="mc-select">
            <option value="A4">A4（210×297mm）</option>
            <option value="A3">A3（297×420mm）</option>
          </select>
        </label>
        <label class="mc-field">
          <span class="mc-label">方向</span>
          <select v-model="paper.printOptions.orientation" class="mc-select">
            <option value="portrait">纵向</option>
            <option value="landscape">横向</option>
          </select>
        </label>
        <label class="mc-field">
          <span class="mc-label">分栏</span>
          <select v-model.number="paper.printOptions.columns" class="mc-select">
            <option :value="1">单栏</option>
            <option :value="2">双栏（A3/横排常用）</option>
          </select>
        </label>
      </div>
      <div class="print__checks">
        <label class="mc-row print__check"
          ><input v-model="paper.printOptions.answers" type="checkbox" /><span>附答案与解析（教师卷）</span></label
        >
        <label class="mc-row print__check"
          ><input v-model="paper.printOptions.sheet" type="checkbox" /><span
            >附答题卡（独立一页，含涂卡格）</span
          ></label
        >
        <label class="mc-row print__check"
          ><input v-model="paper.printOptions.seal" type="checkbox" /><span
            >左侧密封线（学校/班级/姓名/考号）</span
          ></label
        >
        <label class="mc-row print__check"
          ><input v-model="paper.printOptions.scoreBox" type="checkbox" /><span>每题后标注分值</span></label
        >
      </div>
    </div>
    <template #footer>
      <button class="mc-btn" type="button" @click="paper.openPaperPreview">先预览</button>
      <button class="mc-btn mc-btn--primary" type="button" @click="paper.openPrint">打开打印视图</button>
    </template>
  </AppModal>
</template>
