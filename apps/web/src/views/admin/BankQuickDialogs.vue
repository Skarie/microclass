<script setup lang="ts">
/* eslint-disable vue/no-mutating-props */
// 考试表单由父组件持有，这里的 v-model 只改嵌套字段
/**
 * 题库页两个操作弹窗（从 BankAdminView 抽出）：
 * 「清理重复题」预览与合并、「整卷试卷 → 建考试」。
 * 表单与请求状态由父组件持有，这里只渲染并触发事件。
 */
import AppModal from '@/components/AppModal.vue';
import RichText from '@/components/RichText.vue';
import type { DedupeResult } from './bankTypes';

interface CourseOption {
  id: number;
  name: string;
}

interface ExamForm {
  courseId: number | '';
  title: string;
  durationMinutes: number;
  passScore: number;
  publish: boolean;
}

defineProps<{
  dedupeOpen: boolean;
  dedupe: DedupeResult | null;
  dedupeBusy: boolean;
  examOpen: boolean;
  examSaving: boolean;
  examForm: ExamForm;
  courses: CourseOption[];
  bankName: string;
  bankQuestionCount: number;
}>();

const emit = defineEmits<{
  'close-dedupe': [];
  'apply-dedupe': [];
  'close-exam': [];
  'create-exam': [];
}>();
</script>

<template>
  <AppModal :open="dedupeOpen" title="清理重复题" width="640px" @close="emit('close-dedupe')">
    <div v-if="dedupe" class="mc-col">
      <p>
        题库里发现 <strong>{{ dedupe.groups }}</strong> 组重复题，可合并
        <strong>{{ dedupe.removable }}</strong> 道（每组保留最早的一条）。
      </p>
      <p class="mc-muted">
        判定标准：题干与选项完全相同、<strong>答案也一致</strong>。同一题干但答案不同的题不会被自动删除，
        请在「题库体检」里单独核对。
      </p>
      <ul v-if="dedupe.samples.length > 0" class="dedupe-samples">
        <li v-for="(s, i) in dedupe.samples" :key="i">
          <RichText class="stem__text" :text="s.stem" />
          <span class="mc-muted">×{{ s.count }}</span>
        </li>
      </ul>
    </div>
    <template #footer>
      <button class="mc-btn" type="button" @click="emit('close-dedupe')">取消</button>
      <button class="mc-btn mc-btn--primary" type="button" :disabled="dedupeBusy" @click="emit('apply-dedupe')">
        {{ dedupeBusy ? '合并中…' : '合并重复题' }}
      </button>
    </template>
  </AppModal>

  <AppModal :open="examOpen" title="用这份试卷建考试" width="560px" @close="emit('close-exam')">
    <div class="mc-col">
      <p class="mc-muted">把题库「{{ bankName }}」的 {{ bankQuestionCount }} 道题按顺序生成一场考试。</p>
      <label class="mc-field">
        <span class="mc-label mc-label--required">挂到哪门课程</span>
        <select v-model="examForm.courseId" class="mc-select">
          <option value="">请选择课程</option>
          <option v-for="c in courses" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </label>
      <label class="mc-field">
        <span class="mc-label">考试名称</span>
        <input v-model="examForm.title" class="mc-input" type="text" maxlength="100" />
      </label>
      <div class="form-grid">
        <label class="mc-field">
          <span class="mc-label">时长（分钟）</span>
          <input v-model.number="examForm.durationMinutes" class="mc-input" type="number" min="1" max="600" />
        </label>
        <label class="mc-field">
          <span class="mc-label">及格分</span>
          <input v-model.number="examForm.passScore" class="mc-input" type="number" min="0" max="100" />
        </label>
      </div>
      <label class="mc-row check">
        <input v-model="examForm.publish" type="checkbox" />
        <span>立即发布（学生能看到）</span>
      </label>
    </div>
    <template #footer>
      <button class="mc-btn" type="button" @click="emit('close-exam')">取消</button>
      <button class="mc-btn mc-btn--primary" type="button" :disabled="examSaving" @click="emit('create-exam')">
        {{ examSaving ? '生成中…' : '生成考试' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.dedupe-samples {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  margin: 0;
  padding-left: var(--mc-space-4);
  font-size: var(--mc-font-sm);
}

.dedupe-samples li {
  display: flex;
  align-items: baseline;
  gap: var(--mc-space-2);
}
</style>
