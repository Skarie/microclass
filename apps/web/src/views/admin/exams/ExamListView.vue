<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue';
import type { Exam } from '@/api/types';
import type { useExamAdminList } from '@/composables/use-exam-admin-list';
import type { useExamAdminForm } from '@/composables/use-exam-admin-form';
import type { useExamAdminPaper } from '@/composables/use-exam-admin-paper';

/**
 * 考试列表卡片：加载骨架 / 未选课程 / 该课程无考试 / 考试表格。
 * 点行选中考试，行内动作分别交给列表、表单、试卷三个 composable。
 */
defineProps<{
  list: ReturnType<typeof useExamAdminList>;
  form: ReturnType<typeof useExamAdminForm>;
  paper: ReturnType<typeof useExamAdminPaper>;
}>();

const emit = defineEmits<{ compose: [exam: Exam] }>();
</script>

<template>
  <section class="mc-card">
    <div class="mc-card__header">
      <span class="mc-card__title">考试列表</span>
      <span class="mc-muted">点选一场考试即可组卷或查看成绩单</span>
    </div>

    <div v-if="list.examsLoading && list.exams.length === 0" class="loading">
      <div v-for="i in 4" :key="i" class="mc-skeleton loading__row" />
    </div>

    <EmptyState
      v-else-if="list.courseId === ''"
      icon="pen-line"
      title="请先选择课程"
      description="考试挂靠在课程之下，选择课程后即可查看与管理该课程的考试。"
    />

    <EmptyState
      v-else-if="list.exams.length === 0"
      icon="exam"
      title="该课程还没有考试"
      description="创建考试后可以手工选题、随机抽题或按题型配额自动组卷。"
      action-text="新建考试"
      @action="form.openCreateExam"
    />

    <div v-else class="mc-table-wrap table-wrap">
      <table class="mc-table mc-table--compact">
        <thead>
          <tr>
            <th>考试标题</th>
            <th>状态</th>
            <th>题量</th>
            <th>参考人数</th>
            <th>限时</th>
            <th>及格线</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="exam in list.exams"
            :key="exam.id"
            :class="{ 'row--active': exam.id === list.selectedExamId }"
            @click="list.selectExam(exam)"
          >
            <td>
              <div class="exam__text">
                <strong>{{ exam.title }}</strong>
                <span class="mc-muted mc-truncate exam__desc">{{ exam.description || '暂无考试说明' }}</span>
              </div>
            </td>
            <td>
              <span class="mc-badge" :class="exam.status === 'published' ? 'mc-badge--success' : 'mc-badge--warning'">
                {{ exam.status === 'published' ? '已发布' : '草稿' }}
              </span>
            </td>
            <td>{{ exam.qcount ?? exam.question_count ?? 0 }}</td>
            <td>{{ exam.attempt_count ?? 0 }}</td>
            <td>{{ exam.duration_minutes }} 分钟</td>
            <td>{{ exam.pass_score }}%</td>
            <td>
              <div class="row-actions" @click.stop>
                <button
                  class="mc-btn mc-btn--primary mc-btn--sm"
                  type="button"
                  title="三步组卷：定范围 → 挑题 → 排卷导出"
                  @click="emit('compose', exam)"
                >
                  组卷
                </button>
                <button class="mc-btn mc-btn--sm" type="button" @click="form.openEditExam(exam)">编辑</button>
                <button
                  class="mc-btn mc-btn--sm"
                  type="button"
                  title="按 A4 版式预览整卷（新窗口打开，可切换含答案/答题卡/密封线）"
                  @click="paper.openPaperFor(exam, { print: false })"
                >
                  预览试卷
                </button>
                <button
                  class="mc-btn mc-btn--sm"
                  type="button"
                  title="打开打印视图（新窗口自动弹打印对话框，可另存为 PDF）"
                  @click="paper.openPaperFor(exam, { print: true })"
                >
                  打印
                </button>
                <button class="mc-btn mc-btn--sm" type="button" @click="form.togglePublish(exam)">
                  {{ exam.status === 'published' ? '撤下' : '发布' }}
                </button>
                <button class="mc-btn mc-btn--sm mc-btn--danger" type="button" @click="form.removeExam(exam)">
                  删除
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
