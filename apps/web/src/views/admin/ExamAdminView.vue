<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import PageHeader from '@/components/PageHeader.vue';
import Toolbar from '@/components/Toolbar.vue';
import Icon from '@/components/Icon.vue';
import AppModal from '@/components/AppModal.vue';
import EmptyState from '@/components/EmptyState.vue';
import StatCard from '@/components/StatCard.vue';
import type { Course, Exam } from '@/api/types';

interface CourseListResponse {
  courses: Course[];
}

interface CourseExamsResponse {
  course: { id: number; name: string };
  exams: Exam[];
}

interface ScoreRow {
  user_id: number;
  username: string;
  display_name: string;
  score: number;
  total: number;
  passed: 0 | 1;
  used_seconds: number;
  created_at: number;
}

interface ScoreSummary {
  attempts: number;
  passed: number;
  pass_rate: number;
  avg: number;
  best: number;
  worst: number;
  avg_seconds: number;
}

interface ScoresResponse {
  exam: Exam;
  rows: ScoreRow[];
  summary: ScoreSummary;
}

interface OkIdResponse {
  ok: boolean;
  id: number;
}

interface OkResponse {
  ok: boolean;
}

const route = useRoute();
const router = useRouter();
const toast = useToastStore();

/* ---------------- 课程与考试列表 ---------------- */
const courses = ref<Course[]>([]);
const courseId = ref<number | ''>('');
const exams = ref<Exam[]>([]);
const examsLoading = ref(false);
/** 请求序号：慢盘上丢弃「迟到的旧响应」，避免旧课程/旧考试的响应覆盖当前选择 */
let examsSeq = 0;
const selectedExamId = ref<number | null>(null);

const selectedExam = computed(() => exams.value.find((e) => e.id === selectedExamId.value) ?? null);

async function loadCourses(): Promise<void> {
  try {
    const res = await api.get<CourseListResponse>('/courses');
    courses.value = res.courses;
    const fromQuery = Number.parseInt(String(route.query.exam ?? ''), 10);
    if (Number.isNaN(fromQuery) && courseId.value === '' && res.courses.length > 0) {
      const first = res.courses[0];
      if (first) courseId.value = first.id;
    }
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

async function loadExams(): Promise<void> {
  if (courseId.value === '') {
    exams.value = [];
    selectedExamId.value = null;
    return;
  }
  // 慢盘上（NAS 机械盘，一次读库要几秒）快速切课程时，先发的请求可能后回：
  // 例：默认课程 A 的考试列表还在路上，用户已经切到课程 B，A 的响应回来把 B 覆盖掉，
  // 界面跳回 A 的考试、连左栏题池都跟着变（真机复现，2026-09）。
  // 用序号 + 课程号双重判断，迟到的响应直接丢弃。
  const seq = ++examsSeq;
  const wanted = String(courseId.value);
  examsLoading.value = true;
  try {
    const res = await api.get<CourseExamsResponse>(`/courses/${wanted}/exams`);
    if (seq !== examsSeq || String(courseId.value) !== wanted) return;
    exams.value = res.exams;
    const stillThere = exams.value.some((e) => e.id === selectedExamId.value);
    if (!stillThere) selectedExamId.value = exams.value[0]?.id ?? null;
    if (selectedExamId.value !== null) await loadActivePanel();
    else clearPanels();
  } catch (e) {
    if (seq !== examsSeq || String(courseId.value) !== wanted) return;
    toast.error(errorMessage(e));
    exams.value = [];
    selectedExamId.value = null;
    clearPanels();
  } finally {
    if (seq === examsSeq) examsLoading.value = false;
  }
}

function clearPanels(): void {
  scores.value = null;
}

async function selectExam(exam: Exam): Promise<void> {
  if (selectedExamId.value === exam.id) return;
  selectedExamId.value = exam.id;
  await loadActivePanel();
}

/** 选中考试后加载成绩单（组卷已挪到独立页面 /admin/exams/:id/compose） */
async function loadActivePanel(): Promise<void> {
  if (selectedExamId.value === null) return;
  await loadScores();
}

/** 深链 ?exam=<id>：逐门课程查找该考试并选中 */
async function applyDeepLink(): Promise<void> {
  const wanted = Number.parseInt(String(route.query.exam ?? ''), 10);
  if (Number.isNaN(wanted) || courses.value.length === 0) return;
  for (const course of courses.value) {
    try {
      const res = await api.get<CourseExamsResponse>(`/courses/${course.id}/exams`);
      if (res.exams.some((e) => e.id === wanted)) {
        courseId.value = course.id;
        exams.value = res.exams;
        selectedExamId.value = wanted;
        await loadScores();
        return;
      }
    } catch {
      // 单门课程失败不影响继续查找
    }
  }
  toast.warning('未找到指定的考试，可能已被删除');
}

/* ---------------- 考试表单 ---------------- */
const examFormOpen = ref(false);
const examSaving = ref(false);
const examEditingId = ref<number | null>(null);
const examForm = reactive({
  title: '',
  description: '',
  durationMinutes: 60,
  passScore: 60,
  status: 'draft',
});

function openCreateExam(): void {
  if (courseId.value === '') {
    toast.warning('请先选择课程');
    return;
  }
  examEditingId.value = null;
  examForm.title = '';
  examForm.description = '';
  examForm.durationMinutes = 60;
  examForm.passScore = 60;
  examForm.status = 'draft';
  examFormOpen.value = true;
}

function openEditExam(exam: Exam): void {
  examEditingId.value = exam.id;
  examForm.title = exam.title;
  examForm.description = exam.description;
  examForm.durationMinutes = exam.duration_minutes;
  examForm.passScore = exam.pass_score;
  examForm.status = exam.status;
  examFormOpen.value = true;
}

async function saveExam(): Promise<void> {
  const title = examForm.title.trim();
  if (courseId.value === '') {
    toast.warning('请先选择课程');
    return;
  }
  if (!title) {
    toast.warning('请填写考试标题');
    return;
  }
  const payload = {
    courseId: Number(courseId.value),
    title,
    description: examForm.description.trim(),
    durationMinutes: Number(examForm.durationMinutes) || 60,
    passScore: Number(examForm.passScore) || 0,
    status: examForm.status,
  };
  examSaving.value = true;
  try {
    if (examEditingId.value === null) {
      const res = await api.post<OkIdResponse>('/exams', payload);
      toast.success(`考试「${title}」已创建，接下来请组卷`);
      examFormOpen.value = false;
      selectedExamId.value = res.id;
      await loadExams();
      await loadScores();
    } else {
      await api.put<OkResponse>(`/exams/${examEditingId.value}`, payload);
      toast.success(`考试「${title}」已保存`);
      examFormOpen.value = false;
      await loadExams();
    }
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    examSaving.value = false;
  }
}

async function togglePublish(exam: Exam): Promise<void> {
  const next: Exam['status'] = exam.status === 'published' ? 'draft' : 'published';
  const action = next === 'published' ? '发布' : '撤下';
  if (
    !window.confirm(
      `确定${action}考试「${exam.title}」吗？${next === 'published' ? '发布后学员即可在课程中看到并参加考试。' : '撤下后学员将无法再进入该考试。'}`,
    )
  ) {
    return;
  }
  try {
    await api.put<OkResponse>(`/exams/${exam.id}`, {
      courseId: exam.course_id,
      title: exam.title,
      description: exam.description,
      durationMinutes: exam.duration_minutes,
      passScore: exam.pass_score,
      status: next,
    });
    toast.success(`考试「${exam.title}」已${action}`);
    await loadExams();
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

async function removeExam(exam: Exam): Promise<void> {
  if (
    !window.confirm(
      `确定删除考试「${exam.title}」吗？试卷组卷与 ${exam.attempt_count ?? 0} 份作答成绩会一并删除，且不可恢复。`,
    )
  ) {
    return;
  }
  try {
    await api.del<OkResponse>(`/exams/${exam.id}`);
    toast.success(`考试「${exam.title}」已删除`);
    if (selectedExamId.value === exam.id) {
      selectedExamId.value = null;
      clearPanels();
    }
    await loadExams();
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

/* ---------------- 看题 / 预览整卷 / 打印 ---------------- */
/** 打印 / 整卷预览选项 */
const printOpen = ref(false);
const printOptions = reactive({
  size: 'A4',
  orientation: 'portrait',
  columns: 1,
  answers: false,
  sheet: false,
  seal: false,
  scoreBox: true,
});

function paperUrl(print = false): string {
  const exam = selectedExam.value;
  if (!exam) return '';
  const params = new URLSearchParams({
    size: printOptions.size,
    orientation: printOptions.orientation,
    columns: String(printOptions.columns),
    answers: printOptions.answers ? '1' : '0',
    sheet: printOptions.sheet ? '1' : '0',
    seal: printOptions.seal ? '1' : '0',
    scoreBox: printOptions.scoreBox ? '1' : '0',
  });
  if (print) params.set('print', '1');
  return `/api/v1/exams/${exam.id}/paper.html?${params.toString()}`;
}

/** 列表页直接用默认版式打开某场考试的试卷（预览 / 打印） */
function openPaperFor(exam: Exam, options?: { print?: boolean; answers?: boolean }): void {
  const params = new URLSearchParams({
    size: 'A4',
    orientation: 'portrait',
    columns: '1',
    answers: options?.answers ? '1' : '0',
    sheet: '0',
    seal: '0',
    scoreBox: '1',
  });
  if (options?.print) params.set('print', '1');
  window.open(`/api/v1/exams/${exam.id}/paper.html?${params.toString()}`, '_blank', 'noopener');
}

/** 打印：新窗口打开服务端渲染的试卷并自动弹打印对话框（可另存为 PDF） */
function openPrint(): void {
  if (!selectedExam.value) return;
  printOpen.value = false;
  window.open(paperUrl(true), '_blank', 'noopener');
}

/** 整卷预览：同版式嵌在弹窗里（所见即所印）；从打印选项进来时先关掉选项弹窗，避免叠两层 */
const previewOpen = ref(false);
const previewSrc = ref('');
function openPaperPreview(): void {
  if (!selectedExam.value) return;
  printOpen.value = false;
  previewSrc.value = paperUrl(false);
  previewOpen.value = true;
}

/** 分值显示：保留 1 位小数（避免浮点尾巴 50.099999999999994） */
function fmtScore(value: number | undefined | null): string {
  const n = Number(value ?? 0);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

function formatTime(unixSeconds: number): string {
  if (!unixSeconds) return '—';
  return new Date(unixSeconds * 1000).toLocaleString('zh-CN');
}

/* ---------------- 成绩单 ---------------- */
const scores = ref<ScoresResponse | null>(null);
const scoresLoading = ref(false);

async function loadScores(): Promise<void> {
  if (selectedExamId.value === null) return;
  scoresLoading.value = true;
  try {
    scores.value = await api.get<ScoresResponse>(`/exams/${selectedExamId.value}/scores`);
  } catch (e) {
    toast.error(errorMessage(e));
    scores.value = null;
  } finally {
    scoresLoading.value = false;
  }
}

async function exportScores(): Promise<void> {
  const exam = selectedExam.value;
  if (!exam) return;
  try {
    await api.download(`/exams/${exam.id}/scores.csv`);
    toast.success(`「${exam.title}」成绩单已开始下载`);
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

/** 切换面板：统一由 activeTab 的侦听器加载数据，避免重复请求 */
/** 打开独立的组卷页面（三步向导） */
function openCompose(exam: Exam): void {
  void router.push(`/admin/exams/${exam.id}/compose`);
}

watch(courseId, () => {
  selectedExamId.value = null;
  clearPanels();
  void loadExams();
});

watch(
  () => route.query.exam,
  () => {
    if (courses.value.length > 0) void applyDeepLink();
  },
);

onMounted(async () => {
  await loadCourses();
  if (route.query.exam !== undefined) await applyDeepLink();
  else await loadExams();
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
        <button class="mc-btn mc-btn--sm" type="button" :disabled="examsLoading" @click="loadExams">
          <Icon name="refresh" :size="15" />
          刷新
        </button>
        <button
          class="mc-btn mc-btn--primary mc-btn--sm"
          type="button"
          :disabled="courseId === ''"
          @click="openCreateExam"
        >
          <Icon name="plus" :size="15" />
          新建考试
        </button>
      </template>
    </PageHeader>

    <Toolbar>
      <template #left>
        <label class="mc-row toolbar__pick">
          <span class="mc-label">课程</span>
          <select v-model="courseId" class="mc-select" aria-label="选择课程">
            <option value="">请选择课程</option>
            <option v-for="c in courses" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>
      </template>
      <template #right>
        <span class="mc-muted toolbar__count">共 {{ exams.length }} 场考试</span>
      </template>
    </Toolbar>

    <section class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">考试列表</span>
        <span class="mc-muted">点选一场考试即可组卷或查看成绩单</span>
      </div>

      <div v-if="examsLoading && exams.length === 0" class="loading">
        <div v-for="i in 4" :key="i" class="mc-skeleton loading__row" />
      </div>

      <EmptyState
        v-else-if="courseId === ''"
        icon="pen-line"
        title="请先选择课程"
        description="考试挂靠在课程之下，选择课程后即可查看与管理该课程的考试。"
      />

      <EmptyState
        v-else-if="exams.length === 0"
        icon="exam"
        title="该课程还没有考试"
        description="创建考试后可以手工选题、随机抽题或按题型配额自动组卷。"
        action-text="新建考试"
        @action="openCreateExam"
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
              v-for="exam in exams"
              :key="exam.id"
              :class="{ 'row--active': exam.id === selectedExamId }"
              @click="selectExam(exam)"
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
                    @click="openCompose(exam)"
                  >
                    组卷
                  </button>
                  <button class="mc-btn mc-btn--sm" type="button" @click="openEditExam(exam)">编辑</button>
                  <button
                    class="mc-btn mc-btn--sm"
                    type="button"
                    title="按 A4 版式预览整卷（新窗口打开，可切换含答案/答题卡/密封线）"
                    @click="openPaperFor(exam, { print: false })"
                  >
                    预览试卷
                  </button>
                  <button
                    class="mc-btn mc-btn--sm"
                    type="button"
                    title="打开打印视图（新窗口自动弹打印对话框，可另存为 PDF）"
                    @click="openPaperFor(exam, { print: true })"
                  >
                    打印
                  </button>
                  <button class="mc-btn mc-btn--sm" type="button" @click="togglePublish(exam)">
                    {{ exam.status === 'published' ? '撤下' : '发布' }}
                  </button>
                  <button class="mc-btn mc-btn--sm mc-btn--danger" type="button" @click="removeExam(exam)">删除</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="selectedExam" class="mc-card">
      <div class="mc-card__header">
        <div class="mc-row mc-row--wrap">
          <span class="mc-card__title">{{ selectedExam.title }}</span>
          <span
            class="mc-badge"
            :class="selectedExam.status === 'published' ? 'mc-badge--success' : 'mc-badge--warning'"
          >
            {{ selectedExam.status === 'published' ? '已发布' : '草稿' }}
          </span>
        </div>
        <div class="mc-row">
          <button
            class="mc-btn mc-btn--primary mc-btn--sm"
            type="button"
            title="打开三步组卷页面"
            @click="selectedExam && openCompose(selectedExam)"
          >
            <Icon name="exam" :size="15" />
            进入组卷页面
          </button>
          <button
            class="mc-btn mc-btn--sm"
            type="button"
            :disabled="!selectedExam"
            @click="
              previewOpen = false;
              printOpen = true;
            "
          >
            打印 / 导出 PDF
          </button>
        </div>
      </div>

      <!-- 成绩单（组卷已挪到独立页面 /admin/exams/:id/compose） -->
      <div class="mc-card__body mc-col">
        <div v-if="scoresLoading && !scores" class="mc-skeleton loading__row" />

        <template v-else-if="scores">
          <!-- 用共享 StatCard（原来自己拼 .stat 结构，标签与数字会挤在一起显示成"0参考人数"） -->
          <div class="mc-grid mc-grid--stats">
            <StatCard label="参考人数" :value="scores.summary.attempts" unit="人" icon="users" tone="primary" />
            <StatCard label="及格人数" :value="scores.summary.passed" unit="人" icon="check" tone="success" />
            <StatCard
              label="及格率"
              :value="`${scores.summary.pass_rate}%`"
              icon="award"
              :tone="scores.summary.pass_rate >= 60 ? 'success' : 'warning'"
            />
            <StatCard label="平均分" :value="scores.summary.avg" icon="stats" />
            <StatCard label="最高分" :value="scores.summary.best" icon="trendingUp" />
            <StatCard label="最低分" :value="scores.summary.worst" icon="trending-down" />
            <StatCard label="平均用时" :value="formatSeconds(scores.summary.avg_seconds)" icon="clock" />
          </div>

          <div class="mc-row">
            <button class="mc-btn mc-btn--sm" type="button" :disabled="scoresLoading" @click="loadScores">刷新</button>
            <div class="mc-spacer" />
            <button
              class="mc-btn mc-btn--sm mc-btn--primary"
              type="button"
              :disabled="scores.rows.length === 0"
              @click="exportScores"
            >
              导出成绩单 CSV
            </button>
          </div>

          <EmptyState
            v-if="scores.rows.length === 0"
            icon="stats"
            title="还没有人参加考试"
            description="发布考试后，学员在课程详情页即可进入作答，交卷后成绩会出现在这里。"
          />

          <div v-else class="mc-table-wrap table-wrap">
            <table class="mc-table mc-table--compact">
              <thead>
                <tr>
                  <th>学号</th>
                  <th>姓名</th>
                  <th>得分</th>
                  <th>结果</th>
                  <th>用时</th>
                  <th>交卷时间</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in scores.rows" :key="row.user_id">
                  <td class="mc-mono">{{ row.username }}</td>
                  <td>{{ row.display_name || '—' }}</td>
                  <td>{{ fmtScore(row.score) }} / {{ fmtScore(row.total) }}</td>
                  <td>
                    <span class="mc-badge" :class="row.passed === 1 ? 'mc-badge--success' : 'mc-badge--danger'">
                      {{ row.passed === 1 ? '及格' : '不及格' }}
                    </span>
                  </td>
                  <td>{{ formatSeconds(row.used_seconds) }}</td>
                  <td class="mc-muted">{{ formatTime(row.created_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <EmptyState v-else icon="stats" title="暂时无法加载成绩单" description="请点击上方刷新重试。" />
      </div>
    </section>

    <AppModal
      :open="examFormOpen"
      :title="examEditingId === null ? '新建考试' : '编辑考试'"
      width="600px"
      @close="examFormOpen = false"
    >
      <div class="mc-col">
        <label class="mc-field">
          <span class="mc-label mc-label--required">考试标题</span>
          <input
            v-model="examForm.title"
            class="mc-input"
            type="text"
            maxlength="200"
            placeholder="例如：期末考试（第 1~4 章）"
          />
        </label>

        <label class="mc-field">
          <span class="mc-label">考试说明</span>
          <textarea
            v-model="examForm.description"
            class="mc-textarea"
            maxlength="4000"
            placeholder="告知学员考试范围、注意事项等"
          />
        </label>

        <div class="form-grid">
          <label class="mc-field">
            <span class="mc-label">限时（分钟）</span>
            <input v-model.number="examForm.durationMinutes" class="mc-input" type="number" min="1" max="600" />
          </label>

          <label class="mc-field">
            <span class="mc-label">及格线（%）</span>
            <input v-model.number="examForm.passScore" class="mc-input" type="number" min="0" max="100" />
          </label>
        </div>

        <label class="mc-field">
          <span class="mc-label">状态</span>
          <select v-model="examForm.status" class="mc-select">
            <option value="draft">草稿（学员不可见）</option>
            <option value="published">已发布（学员可参加）</option>
          </select>
          <span class="mc-hint">建议先保存为草稿，组卷完成后再发布。</span>
        </label>
      </div>

      <template #footer>
        <button class="mc-btn" type="button" @click="examFormOpen = false">取消</button>
        <button class="mc-btn mc-btn--primary" type="button" :disabled="examSaving" @click="saveExam">
          {{ examSaving ? '保存中…' : '保存' }}
        </button>
      </template>
    </AppModal>

    <!-- 换题：列出相似候选让老师挑（弹窗里也能随机换） -->

    <!-- 整卷预览：与打印同一套版式（所见即所印） -->
    <AppModal :open="previewOpen" title="预览整卷" width="min(1100px, 96vw)" @close="previewOpen = false">
      <div class="mc-col preview">
        <div class="mc-row mc-row--wrap preview__bar">
          <span class="mc-muted"
            >版式与服务端打印完全一致（{{ printOptions.size }} ·
            {{ printOptions.columns === 2 ? '双栏' : '单栏' }}）</span
          >
          <div class="mc-spacer" />
          <label class="mc-row preview__opt"
            ><input v-model="printOptions.answers" type="checkbox" @change="openPaperPreview" /><span
              >含答案</span
            ></label
          >
          <label class="mc-row preview__opt"
            ><input v-model="printOptions.sheet" type="checkbox" @change="openPaperPreview" /><span>答题卡</span></label
          >
          <label class="mc-row preview__opt"
            ><input v-model="printOptions.seal" type="checkbox" @change="openPaperPreview" /><span>密封线</span></label
          >
        </div>
        <iframe v-if="previewSrc" :src="previewSrc" class="preview__frame" title="试卷预览" />
      </div>
      <template #footer>
        <button class="mc-btn" type="button" @click="previewOpen = false">关闭</button>
        <button class="mc-btn mc-btn--primary" type="button" @click="openPrint">打印 / 导出 PDF</button>
      </template>
    </AppModal>

    <!-- 打印选项 -->
    <AppModal :open="printOpen" title="打印 / 导出 PDF" width="560px" @close="printOpen = false">
      <div class="mc-col print">
        <p class="mc-muted">
          用浏览器打印对话框即可出纸质卷，或选「另存为 PDF」导出文件（版式由服务端确定，A4/A3 与横竖版都按选项走）。
        </p>
        <div class="print__grid">
          <label class="mc-field">
            <span class="mc-label">纸张</span>
            <select v-model="printOptions.size" class="mc-select">
              <option value="A4">A4（210×297mm）</option>
              <option value="A3">A3（297×420mm）</option>
            </select>
          </label>
          <label class="mc-field">
            <span class="mc-label">方向</span>
            <select v-model="printOptions.orientation" class="mc-select">
              <option value="portrait">纵向</option>
              <option value="landscape">横向</option>
            </select>
          </label>
          <label class="mc-field">
            <span class="mc-label">分栏</span>
            <select v-model.number="printOptions.columns" class="mc-select">
              <option :value="1">单栏</option>
              <option :value="2">双栏（A3/横排常用）</option>
            </select>
          </label>
        </div>
        <div class="print__checks">
          <label class="mc-row print__check"
            ><input v-model="printOptions.answers" type="checkbox" /><span>附答案与解析（教师卷）</span></label
          >
          <label class="mc-row print__check"
            ><input v-model="printOptions.sheet" type="checkbox" /><span>附答题卡（独立一页，含涂卡格）</span></label
          >
          <label class="mc-row print__check"
            ><input v-model="printOptions.seal" type="checkbox" /><span>左侧密封线（学校/班级/姓名/考号）</span></label
          >
          <label class="mc-row print__check"
            ><input v-model="printOptions.scoreBox" type="checkbox" /><span>每题后标注分值</span></label
          >
        </div>
      </div>
      <template #footer>
        <button class="mc-btn" type="button" @click="openPaperPreview">先预览</button>
        <button class="mc-btn mc-btn--primary" type="button" @click="openPrint">打开打印视图</button>
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
/* ---- 组卷工作台：左挑题 / 中试卷 / 右试题篮 ---- */

/* 步骤条：替代原来的一大段说明文字（那一段占了近半屏，实际没人读第二遍） */

@media (max-width: 1200px) {
}

/* 标题吸顶：长列表滚动时"这一栏是什么、多少条"始终可见 */

.compose__field .mc-label {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.compose__filters .mc-input,
.compose__filters .mc-select {
  min-width: 0;
  font-size: var(--mc-text-sm);
}

.compose__scoreinput .mc-input {
  flex: 0 0 auto;
  width: 72px;
  min-width: 72px;
  text-align: center;
}

.difficulty-inline {
  color: var(--mc-warning-fg);
  font-size: var(--mc-text-xs);
  white-space: nowrap;
}

.basket__target .mc-input,
.basket__quotaitem .mc-input {
  flex: 0 0 auto;
  width: 64px;
  min-width: 64px;
  text-align: center;
  padding: 4px 4px;
  min-height: 30px;
}

.basket__check .mc-input {
  flex: 0 0 auto;
  width: 76px;
  min-width: 76px;
  text-align: center;
}
</style>
