<script setup lang="ts">
import { onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import Toolbar from '@/components/Toolbar.vue';
import Icon from '@/components/Icon.vue';
import ExamListView from './exams/ExamListView.vue';
import ExamScoresPanel from './exams/ExamScoresPanel.vue';
import ExamFormModal from './exams/ExamFormModal.vue';
import ExamPaperDialogs from './exams/ExamPaperDialogs.vue';
import { useExamAdminList, type ExamAdminListHooks } from '@/composables/use-exam-admin-list';
import { useExamAdminScores } from '@/composables/use-exam-admin-scores';
import { useExamAdminForm } from '@/composables/use-exam-admin-form';
import { useExamAdminPaper } from '@/composables/use-exam-admin-paper';
import type { Exam } from '@/api/types';

/**
 * 考试管理（页面只做编排）：
 * 课程 / 考试列表与深链在 useExamAdminList，成绩单在 useExamAdminScores，
 * 表单与发布 / 删除在 useExamAdminForm，试卷预览 / 打印在 useExamAdminPaper；
 * 界面按区块拆到 ./exams/*（列表、成绩面板、表单弹窗、试卷弹窗）。
 */
const route = useRoute();
const router = useRouter();

// hooks 先声明后填：列表在加载/选中后要触发成绩单加载，而成绩单又依赖列表的选中项
const listHooks: ExamAdminListHooks = {};
const list = useExamAdminList(listHooks);
const scores = useExamAdminScores({
  getSelectedExamId: () => list.selectedExamId,
  getSelectedExam: () => list.selectedExam,
});
const form = useExamAdminForm({ list, scores });
const paper = useExamAdminPaper({ getSelectedExam: () => list.selectedExam });

listHooks.loadActivePanel = scores.loadScores;
listHooks.clearPanels = scores.clearScores;

/** 打开独立的组卷页面（三步向导） */
function openCompose(exam: Exam): void {
  void router.push(`/admin/exams/${exam.id}/compose`);
}

watch(
  () => list.courseId,
  () => {
    list.selectedExamId = null;
    scores.clearScores();
    void list.loadExams();
  },
);

watch(
  () => route.query.exam,
  () => {
    if (list.courses.length > 0) void list.applyDeepLink();
  },
);

onMounted(async () => {
  await list.loadCourses();
  if (route.query.exam !== undefined) await list.applyDeepLink();
  else await list.loadExams();
});
</script>

<template>
  <section class="page mc-col">
    <PageHeader
      title="考试管理"
      description="按课程管理考试：手工挑题或按题型配额自动组卷、设置大题分值、导出 Word/PDF 与成绩单。"
      icon="exam"
      :breadcrumb="[{ label: '首页', to: '/' }, { label: '教学管理' }, { label: '考试管理' }]"
    >
      <template #actions>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="list.examsLoading" @click="list.loadExams">
          <Icon name="refresh" :size="16" />
          刷新
        </button>
        <button
          class="mc-btn mc-btn--primary mc-btn--sm"
          type="button"
          :disabled="list.courseId === ''"
          @click="form.openCreateExam"
        >
          <Icon name="plus" :size="16" />
          新建考试
        </button>
      </template>
    </PageHeader>

    <Toolbar>
      <template #left>
        <label class="mc-row toolbar__pick">
          <span class="mc-label">课程</span>
          <select v-model="list.courseId" class="mc-select" aria-label="选择课程">
            <option value="">请选择课程</option>
            <option v-for="c in list.courses" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>
      </template>
      <template #right>
        <span class="mc-muted toolbar__count">共 {{ list.exams.length }} 场考试</span>
      </template>
    </Toolbar>

    <ExamListView :list="list" :form="form" :paper="paper" @compose="openCompose" />

    <ExamScoresPanel
      v-if="list.selectedExam"
      :exam="list.selectedExam"
      :sheet="scores.scores"
      :loading="scores.scoresLoading"
      @compose="openCompose"
      @refresh="scores.loadScores"
      @export="scores.exportScores"
      @print="paper.openPrintOptions"
    />

    <ExamFormModal :form="form" />

    <ExamPaperDialogs :paper="paper" />
  </section>
</template>
