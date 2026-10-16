<script setup lang="ts">
/**
 * 组卷页 = 老师嘴里的四步（按需求原话设计）：
 *   ① 选范围：按章节 / 知识点圈定（支持跨章节、跨册、多个知识点；也能切全库）
 *   ② 选组卷方式：**随机组卷**（填题型数量 + 每题分值，在所选范围里抽）
 *                或 **自己挑题**（打开题库，左侧还是这个范围，自己勾选 / 全选筛选结果）
 *                已有卷子时还能一键生成**平行卷（A/B 卷）**
 *   ③ 看卷子：题干、选项都能看到，能展开看答案解析，能**换一题**、改分值、调顺序、删除
 *   ④ 打印预览：纸张 A3 / A4、横竖版、单双栏、含答案解析 / 答题卡 / 密封线，内嵌预览后打印或导出
 *
 * 与开源系统（学之思 `exam/paper/edit.vue`）的关系：结构同源（表单 + 大题 + 弹窗选题），
 * 但把"先圈范围"放在第一步 —— 这是老师组卷时最先想清楚的事。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import PageHeader from '@/components/PageHeader.vue';
import Icon from '@/components/Icon.vue';
import Tag from '@/components/Tag.vue';
import RichText from '@/components/RichText.vue';
import AppModal from '@/components/AppModal.vue';
import EmptyState from '@/components/EmptyState.vue';
import RangeTree from '@/components/compose/RangeTree.vue';
import QuestionPickerPanel from '@/components/compose/QuestionPickerPanel.vue';
import BlueprintComposeModal from '@/components/BlueprintComposeModal.vue';
import ReplaceQuestionModal from '@/components/ReplaceQuestionModal.vue';
import type { FacetBook, FacetPoint } from '@/components/compose/types';

interface Exam {
  id: number;
  course_id: number;
  title: string;
  duration_minutes: number;
  pass_score: number;
  total_score: number;
  status: 'draft' | 'published';
  structure?: string;
  start_at?: number;
  end_at?: number;
  attempt_limit?: number;
  shuffle_questions?: number;
  show_answers?: number;
}
interface PaperQuestion {
  id: number;
  type: string;
  stem: string;
  options: string[];
  answer: string;
  analysis: string;
  score: number;
  section: string;
}
interface Blueprint {
  stats: { questions: number; estimatedMinutes: number; byType: { type: string; count: number; score: number }[] };
  target: {
    ratio: Partial<Record<'easy' | 'medium' | 'hard', number>>;
    actual: Partial<Record<'easy' | 'medium' | 'hard', number>>;
  };
  suggestions: string[];
}

const TYPE_LABEL: Record<string, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  fill: '填空题',
  short: '简答题',
};
const LEVEL_LABEL: Record<'easy' | 'medium' | 'hard', string> = { easy: '基础', medium: '中档', hard: '较难' };
const QUOTA_TYPES = ['single', 'multiple', 'judge', 'fill', 'short'] as const;
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const STEPS = [
  { n: 1, label: '选范围', hint: '章节 / 知识点' },
  { n: 2, label: '选组卷方式', hint: '随机 / 自己挑' },
  { n: 3, label: '看卷子', hint: '可换题、改分值' },
  { n: 4, label: '打印预览', hint: 'A3 / A4' },
];

const route = useRoute();
const router = useRouter();
const toast = useToastStore();
/**
 * 考试 id 用 ref + 监听路由参数：同一路由只换 :id 时 Vue 会复用组件，
 * 若在 setup 里算成常量，跳到另一场考试（如生成平行卷后）页面仍显示旧数据。
 */
const examId = ref(Number(route.params.id));

const loading = ref(true);
const busy = ref(false);
const step = ref(1);
/**
 * 跳转到另一场考试后的落点：默认回第①步；
 * 但"刚生成平行卷"时老师要看的是新卷内容，所以由发起方标记落在第③步
 * （用标记而不是事后改 step —— 路由 watch 是异步的，事后改会被它覆盖）。
 */
const landOnPaper = ref(false);
const exam = ref<Exam | null>(null);
const paper = ref<PaperQuestion[]>([]);
const blueprint = ref<Blueprint | null>(null);

/* ---------------- ① 范围 ---------------- */
const scope = ref<'course' | 'all'>('course');
const selected = ref<{ books: string[]; chapters: string[]; points: string[] }>({
  books: [],
  chapters: [],
  points: [],
});
const facets = ref<{ total: number; books: FacetBook[] } | null>(null);
const pointsByChapter = ref<Record<string, FacetPoint[]>>({});
const loadingPoints = ref<string | null>(null);
const rangeLoading = ref(false);

/* ---------------- ② 组卷方式 ---------------- */
const quotaForm = reactive<Record<string, number>>({ single: 0, multiple: 0, judge: 0, fill: 0, short: 0 });
const scoreForm = reactive<Record<string, number>>({ single: 5, multiple: 5, judge: 2, fill: 2, short: 6 });
const targetRatio = reactive({ easy: 30, medium: 50, hard: 20 });
const useRatio = ref(false);
/** 是否处于"自己挑题"整页视图（第②步的子视图，不占新的步骤号） */
const picking = ref(false);
const blueprintOpen = ref(false);
const parallelOpen = ref(false);
const parallelBusy = ref(false);
const parallelForm = reactive({ title: '', scope: 'course' });

/* ---------------- ③ 看卷子 ---------------- */
const sections = ref<{ name: string; type: string; score: number; description: string }[]>([]);
const expanded = ref<number[]>([]);
const viewQuestion = ref<PaperQuestion | null>(null);
const replaceOpen = ref(false);
const replaceQuestionId = ref<number | null>(null);

/* ---------------- ④ 打印预览 ---------------- */
/** 纸张与版式：与 `/paper.html` 的查询参数一一对应（A3/A4、横竖、单双栏） */
const printOptions = reactive({
  size: 'A4',
  orientation: 'portrait',
  columns: 1,
  answers: false,
  sheet: false,
  seal: true,
});
/** 改版式时给 iframe 换一个 cache-busting 参数，强制重载 */
const previewNonce = ref(0);

/* ---------------- 考试设置 ---------------- */
const settings = reactive({
  title: '',
  durationMinutes: 60,
  passScore: 60,
  attemptLimit: 0,
  shuffleQuestions: false,
  showAnswers: true,
  paperType: 'fixed',
  startAt: '',
  endAt: '',
});
const settingsSaving = ref(false);

const typeLabel = (type: string): string => TYPE_LABEL[type] ?? type;
const fmtScore = (v: number | undefined | null): string => {
  const n = Number(v ?? 0);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
};

function filterPayload(): Record<string, string | string[]> {
  return {
    ...(scope.value === 'all' ? { scope: 'all' } : {}),
    ...(selected.value.books.length > 0 ? { books: selected.value.books } : {}),
    ...(selected.value.chapters.length > 0 ? { chapters: selected.value.chapters } : {}),
    ...(selected.value.points.length > 0 ? { points: selected.value.points } : {}),
  };
}

async function loadFacets(): Promise<void> {
  rangeLoading.value = true;
  try {
    facets.value = await api.get<{ total: number; books: FacetBook[] }>(
      `/exams/${examId.value}/facets`,
      filterPayload(),
    );
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    rangeLoading.value = false;
  }
}

async function loadPointsOfChapter(chapter: string): Promise<void> {
  loadingPoints.value = chapter;
  try {
    const res = await api.get<{ points: FacetPoint[] }>(`/exams/${examId.value}/points`, {
      ...filterPayload(),
      chapters: [chapter],
      limit: 200,
    });
    pointsByChapter.value = { ...pointsByChapter.value, [chapter]: res.points };
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    loadingPoints.value = null;
  }
}

async function searchPoints(keyword: string): Promise<void> {
  if (keyword === '') return;
  try {
    const res = await api.get<{ points: FacetPoint[] }>(`/exams/${examId.value}/points`, {
      ...filterPayload(),
      pointKeyword: keyword,
      limit: 200,
    });
    const grouped: Record<string, FacetPoint[]> = {};
    for (const p of res.points) {
      const key = p.chapter || '（未标注章节）';
      grouped[key] = [...(grouped[key] ?? []), p];
    }
    pointsByChapter.value = { ...pointsByChapter.value, ...grouped };
    if (res.points.length === 0) toast.info('没有匹配的知识点');
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

const rangeSummary = computed(() => {
  const parts: string[] = [];
  if (selected.value.books.length > 0) parts.push(`${selected.value.books.length} 个册次`);
  if (selected.value.chapters.length > 0) parts.push(`${selected.value.chapters.length} 个章节`);
  if (selected.value.points.length > 0) parts.push(`${selected.value.points.length} 个知识点`);
  return parts.length === 0 ? '全部范围（本课程所有题）' : parts.join(' + ');
});

/* ---------------- 加载 ---------------- */
function toStamp(local: string): number {
  if (!local) return 0;
  const t = new Date(local).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}
function toLocal(stamp: number | undefined): string {
  if (!stamp) return '';
  const d = new Date(stamp * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function loadExam(): Promise<void> {
  const res = await api.get<{ exam: Exam }>(`/exams/${examId.value}`);
  const e = res.exam;
  exam.value = e;
  settings.title = e.title;
  settings.durationMinutes = Number(e.duration_minutes ?? 60);
  settings.passScore = Number(e.pass_score ?? 60);
  settings.attemptLimit = Number(e.attempt_limit ?? 0);
  settings.shuffleQuestions = Number(e.shuffle_questions ?? 0) === 1;
  settings.showAnswers = Number(e.show_answers ?? 1) === 1;
  settings.startAt = toLocal(Number(e.start_at ?? 0));
  settings.endAt = toLocal(Number(e.end_at ?? 0));
  settings.paperType = Number(e.end_at ?? 0) > 0 ? 'window' : 'fixed';
  if (typeof e.structure === 'string' && e.structure !== '') {
    try {
      const parsed = JSON.parse(e.structure) as {
        name?: string;
        type?: string;
        score?: number;
        description?: string;
      }[];
      sections.value = parsed.map((s) => ({
        name: String(s.name ?? ''),
        type: String(s.type ?? ''),
        score: Number(s.score) || 0,
        description: String(s.description ?? ''),
      }));
    } catch {
      sections.value = [];
    }
  }
}

async function loadPaper(): Promise<void> {
  const res = await api.get<{ questions: PaperQuestion[] }>(`/exams/${examId.value}/paper`);
  paper.value = res.questions ?? [];
  blueprint.value = await api.get<Blueprint>(`/exams/${examId.value}/blueprint`);
}

async function loadAll(): Promise<void> {
  loading.value = true;
  try {
    await loadExam();
    await loadPaper();
    await loadFacets();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}

/* ---------------- ② 随机组卷 ---------------- */
async function runRandomCompose(): Promise<void> {
  const quota = Object.fromEntries(Object.entries(quotaForm).filter(([, n]) => Number(n) > 0));
  if (Object.keys(quota).length === 0) {
    toast.warning('请至少填一种题型的数量');
    return;
  }
  busy.value = true;
  try {
    const sum = targetRatio.easy + targetRatio.medium + targetRatio.hard;
    const scores = Object.fromEntries(
      Object.entries(scoreForm).filter(([t, n]) => Number(quota[t]) > 0 && Number(n) > 0),
    );
    const res = await api.post<{ added: number; shortfall: number }>(`/exams/${examId.value}/compose`, {
      quota,
      scores,
      replaceExisting: true,
      scope: scope.value,
      ...(selected.value.books.length > 0 ? { books: selected.value.books } : {}),
      ...(selected.value.chapters.length > 0 ? { chapters: selected.value.chapters } : {}),
      ...(selected.value.points.length > 0 ? { points: selected.value.points } : {}),
      ...(useRatio.value && sum > 0
        ? { ratio: { easy: targetRatio.easy / sum, medium: targetRatio.medium / sum, hard: targetRatio.hard / sum } }
        : {}),
    });
    if (res.shortfall > 0) toast.warning(`按范围抽到 ${res.added} 题，缺口 ${res.shortfall} 题（范围内题量不够）`);
    else toast.success(`已按范围随机生成 ${res.added} 题`);
    await Promise.all([loadPaper(), loadExam()]);
    step.value = 3;
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    busy.value = false;
  }
}

/* ---------------- ③ 卷面 ---------------- */
const groups = computed(() => {
  const map = new Map<string, PaperQuestion[]>();
  for (const q of paper.value) {
    const key = q.section || '未分组';
    map.set(key, [...(map.get(key) ?? []), q]);
  }
  return [...map.entries()].map(([name, questions]) => ({
    name,
    questions,
    score: questions.reduce((s, q) => s + (Number(q.score) || 0), 0),
  }));
});

const totalScore = computed(() => paper.value.reduce((s, q) => s + (Number(q.score) || 0), 0));
const estimatedMinutes = computed(() => blueprint.value?.stats.estimatedMinutes ?? 0);
const qIndex = (id: number): number => paper.value.findIndex((p) => p.id === id) + 1;
const isOpen = (id: number): boolean => expanded.value.includes(id);
function toggle(id: number): void {
  expanded.value = isOpen(id) ? expanded.value.filter((x) => x !== id) : [...expanded.value, id];
}

const difficultyCheck = computed(() =>
  (['easy', 'medium', 'hard'] as const).map((level) => {
    const actual = Math.round((blueprint.value?.target.actual[level] ?? 0) * 100);
    const target = Math.round((blueprint.value?.target.ratio[level] ?? 0) * 100);
    return { level, actual, target, off: Math.abs(actual - target) };
  }),
);

async function setScore(q: PaperQuestion, score: number): Promise<void> {
  try {
    await api.put(`/exams/${examId.value}/questions/${q.id}`, { score });
    await loadPaper();
  } catch (e) {
    toast.error(errorMessage(e));
  }
}
/** 逐题改"所属大题"（老师常把某题从一组挪到另一组） */
async function setSection(q: PaperQuestion, section: string): Promise<void> {
  try {
    await api.put(`/exams/${examId.value}/questions/${q.id}`, { section });
    await loadPaper();
  } catch (e) {
    toast.error(errorMessage(e));
  }
}
async function removeQuestion(q: PaperQuestion): Promise<void> {
  try {
    await api.del(`/exams/${examId.value}/questions/${q.id}`);
    await Promise.all([loadPaper(), loadExam()]);
  } catch (e) {
    toast.error(errorMessage(e));
  }
}
/** 清空试卷（把题从这场考试移出，题目本身不删） */
async function clearPaper(): Promise<void> {
  if (paper.value.length === 0) return;
  if (!window.confirm(`确定把试卷里的 ${paper.value.length} 道题全部移出吗？（题目本身不会删除）`)) return;
  busy.value = true;
  try {
    for (const q of paper.value) await api.del(`/exams/${examId.value}/questions/${q.id}`);
    toast.success('试卷已清空');
    await Promise.all([loadPaper(), loadExam()]);
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    busy.value = false;
  }
}

async function removeById(id: number): Promise<void> {
  const q = paper.value.find((p) => p.id === id);
  if (q) await removeQuestion(q);
}
async function move(index: number, delta: number): Promise<void> {
  const target = index + delta;
  if (target < 0 || target >= paper.value.length) return;
  const ids = paper.value.map((q) => q.id);
  const a = ids[index];
  const b = ids[target];
  if (a === undefined || b === undefined) return;
  ids[index] = b;
  ids[target] = a;
  try {
    await api.post(`/exams/${examId.value}/questions/order`, { questionIds: ids });
    await loadPaper();
  } catch (e) {
    toast.error(errorMessage(e));
  }
}
/** 一键把某个大题下所有题设为同一分值 */
async function setSectionScore(name: string, score: number): Promise<void> {
  const list = paper.value.filter((q) => (q.section || '未分组') === name);
  if (list.length === 0) return;
  busy.value = true;
  try {
    for (const q of list) await api.put(`/exams/${examId.value}/questions/${q.id}`, { score });
    toast.success(`已把「${name}」的 ${list.length} 道题设为 ${fmtScore(score)} 分`);
    await loadPaper();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    busy.value = false;
  }
}
async function saveStructure(): Promise<void> {
  busy.value = true;
  try {
    const sum = targetRatio.easy + targetRatio.medium + targetRatio.hard;
    await api.put(`/exams/${examId.value}/structure`, {
      structure: sections.value.filter((s) => s.name.trim() !== ''),
      ...(sum > 0
        ? {
            difficultyTarget: {
              easy: targetRatio.easy / sum,
              medium: targetRatio.medium / sum,
              hard: targetRatio.hard / sum,
            },
          }
        : {}),
      applyScores: true,
    });
    toast.success('试卷结构已保存');
    await loadPaper();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    busy.value = false;
  }
}
function fillSectionsByType(): void {
  const byType = blueprint.value?.stats.byType ?? [];
  sections.value = byType
    .filter((t) => t.count > 0)
    .map((t, i) => ({
      name: `${CN_NUM[i] ?? String(i + 1)}、${typeLabel(t.type)}`,
      type: t.type,
      score: t.count > 0 ? Math.round((t.score / t.count) * 10) / 10 : 0,
      description: '',
    }));
  toast.info('已按题型生成大题骨架，可改名称与每题分值后保存');
}

/* ---------------- 平行卷 ---------------- */
async function runParallel(): Promise<void> {
  parallelBusy.value = true;
  try {
    const res = await api.post<{
      examId: number;
      title: string;
      matched: number;
      requested: number;
      shortfall: number;
    }>(`/exams/${examId.value}/parallel`, {
      ...(parallelForm.title.trim() !== '' ? { title: parallelForm.title.trim() } : {}),
      scope: parallelForm.scope,
    });
    if (res.shortfall > 0)
      toast.warning(`平行卷已生成：配到 ${res.matched}/${res.requested} 题，缺口 ${res.shortfall} 题`);
    else toast.success(`平行卷已生成（${res.matched} 题）：${res.title}`);
    parallelOpen.value = false;
    landOnPaper.value = true;
    await router.push(`/admin/exams/${res.examId}/compose`);
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    parallelBusy.value = false;
  }
}

/* ---------------- 考试设置 ---------------- */
async function saveSettings(): Promise<void> {
  settingsSaving.value = true;
  try {
    await api.put(`/exams/${examId.value}`, {
      courseId: exam.value?.course_id ?? 0,
      title: settings.title.trim(),
      durationMinutes: settings.durationMinutes,
      passScore: settings.passScore,
      status: exam.value?.status ?? 'draft',
      startAt: settings.paperType === 'window' ? toStamp(settings.startAt) : 0,
      endAt: settings.paperType === 'window' ? toStamp(settings.endAt) : 0,
      attemptLimit: settings.attemptLimit,
      shuffleQuestions: settings.shuffleQuestions,
      showAnswers: settings.showAnswers,
    });
    toast.success('考试设置已保存');
    await loadExam();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    settingsSaving.value = false;
  }
}

/* ---------------- ④ 打印预览 ---------------- */
function paperUrl(withPrint = false): string {
  const params = new URLSearchParams({
    size: printOptions.size,
    orientation: printOptions.orientation,
    columns: String(printOptions.columns),
    answers: printOptions.answers ? '1' : '0',
    sheet: printOptions.sheet ? '1' : '0',
    seal: printOptions.seal ? '1' : '0',
  });
  if (withPrint) params.set('print', '1');
  return `/api/v1/exams/${examId.value}/paper.html?${params.toString()}`;
}
const previewSrc = computed(() => `${paperUrl(false)}&_=${previewNonce.value}`);
function refreshPreview(): void {
  previewNonce.value += 1;
}
function openPrint(): void {
  window.open(paperUrl(true), '_blank');
}
function openPaperWord(): void {
  window.open(`/api/v1/exams/${examId.value}/paper.docx?answers=${printOptions.answers ? '1' : '0'}`, '_blank');
}

onMounted(loadAll);

watch(
  () => route.params.id,
  async (id) => {
    const next = Number(id);
    if (!Number.isFinite(next) || next === examId.value) return;
    examId.value = next;
    step.value = landOnPaper.value ? 3 : 1;
    landOnPaper.value = false;
    selected.value = { books: [], chapters: [], points: [] };
    await loadAll();
  },
);
</script>

<template>
  <section class="page mc-col">
    <PageHeader :title="`组卷：${exam?.title ?? '加载中…'}`" icon="exam">
      <template #actions>
        <button class="mc-btn mc-btn--sm" type="button" @click="router.push('/admin/exams')">
          <Icon name="arrow-left" :size="15" />
          返回考试列表
        </button>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="paper.length === 0" @click="blueprintOpen = true">
          <Icon name="grid" :size="15" />
          按细目表配题
        </button>
        <button
          class="mc-btn mc-btn--primary mc-btn--sm"
          type="button"
          :disabled="paper.length === 0"
          @click="step = 4"
        >
          <Icon name="print" :size="15" />
          打印预览
        </button>
      </template>
    </PageHeader>

    <!-- 步骤条：老师的原话顺序 -->
    <nav class="stp" aria-label="组卷步骤">
      <button
        v-for="s in STEPS"
        :key="s.n"
        class="stp__item"
        :class="{ 'is-on': step === s.n }"
        type="button"
        @click="
          picking = false;
          step = s.n;
        "
      >
        <span class="stp__no">{{ s.n }}</span>
        <span class="stp__text">
          <strong>{{ s.label }}</strong>
          <em>{{ s.hint }}</em>
        </span>
      </button>
      <span class="mc-spacer" />
      <span class="stp__meta" :class="{ 'is-off': totalScore <= 0 }"
        >{{ paper.length }} 题 · {{ fmtScore(totalScore) }} 分</span
      >
    </nav>

    <div v-if="loading" class="mc-skeleton stp__loading" />

    <!-- ②b 自己挑题（整页三区：筛选 / 列表 / 已选篮） -->
    <QuestionPickerPanel
      v-if="!loading && picking"
      :exam-id="examId"
      :in-paper="paper.map((q) => q.id)"
      :paper="paper"
      :initial-selected="selected"
      :default-scope="scope"
      @added="loadPaper()"
      @remove="removeById"
      @clear="clearPaper"
      @next="
        picking = false;
        step = 3;
      "
      @back="picking = false"
    />

    <!-- ① 选范围 -->
    <section v-else-if="step === 1" class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">① 圈定出题范围</span>
        <span class="mc-spacer" />
        <label class="mc-row stp__scope">
          <span class="mc-label">范围</span>
          <select v-model="scope" class="mc-select" aria-label="抽题范围" @change="loadFacets">
            <option value="course">本课程</option>
            <option value="all">全库所有题（跨课程）</option>
          </select>
        </label>
      </div>
      <div class="mc-card__body mc-col">
        <p class="mc-hint">
          勾<strong>章节</strong>或<strong>知识点</strong>都可以，可跨章节、跨册、多选；不勾就是本课程全部题目。
          当前范围：<strong>{{ rangeSummary }}</strong>
        </p>
        <p v-if="(facets?.total ?? 0) === 0 && scope === 'course'" class="stp__emptyhint">
          <Icon name="alert" :size="15" />
          <span>本课程没有绑定题库的题目（导入的题常常只归到题库）。把右上角范围改成「全库所有题」就能按章节挑。</span>
        </p>
        <button
          v-if="(facets?.total ?? 0) === 0 && scope === 'course'"
          class="mc-btn mc-btn--soft mc-btn--sm"
          type="button"
          @click="
            scope = 'all';
            loadFacets();
          "
        >
          改成「全库所有题」
        </button>
        <RangeTree
          v-model:selected="selected"
          :books="facets?.books ?? []"
          :points-by-chapter="pointsByChapter"
          :loading-points="loadingPoints"
          @need-points="loadPointsOfChapter"
          @search-points="searchPoints"
          @update:selected="loadFacets"
        />
        <div class="stp__row">
          <span class="mc-muted">
            范围内共 <strong>{{ facets?.total ?? 0 }}</strong> 题可选（{{ rangeLoading ? '统计中…' : '已统计' }}）
          </span>
          <span class="mc-spacer" />
          <button class="mc-btn mc-btn--primary" type="button" @click="step = 2">
            下一步：选择组卷方式
            <Icon name="arrow-right" :size="15" />
          </button>
        </div>
      </div>
    </section>

    <!-- ② 选组卷方式 -->
    <section v-else-if="step === 2" class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">② 怎么组卷</span>
        <span class="mc-spacer" />
        <span class="mc-muted">范围：{{ rangeSummary }}（{{ facets?.total ?? 0 }} 题）</span>
      </div>
      <div class="mc-card__body">
        <div class="stp__modes">
          <!-- 随机组卷 -->
          <div class="stp__mode">
            <div class="stp__modehead">
              <Icon name="sparkles" :size="18" />
              <strong>随机组卷</strong>
              <em>在所选范围里，按题型数量随机抽题</em>
            </div>
            <table class="mc-table mc-table--compact stp__quota">
              <thead>
                <tr>
                  <th>题型</th>
                  <th>数量</th>
                  <th>每题分值</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="t in QUOTA_TYPES" :key="t">
                  <td>{{ typeLabel(t) }}</td>
                  <td>
                    <input
                      v-model.number="quotaForm[t]"
                      class="mc-input stp__num"
                      type="number"
                      min="0"
                      max="100"
                      :aria-label="`${typeLabel(t)}数量`"
                    />
                  </td>
                  <td>
                    <input
                      v-model.number="scoreForm[t]"
                      class="mc-input stp__num"
                      type="number"
                      min="0"
                      step="0.5"
                      :aria-label="`${typeLabel(t)}每题分值`"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
            <label class="mc-checkbox">
              <input v-model="useRatio" type="checkbox" />
              再限制难度配比
            </label>
            <div v-if="useRatio" class="stp__ratio">
              <label v-for="l in ['easy', 'medium', 'hard'] as const" :key="l" class="stp__ratioitem">
                <span class="mc-muted">{{ LEVEL_LABEL[l] }}（%）</span>
                <input v-model.number="targetRatio[l]" class="mc-input stp__num" type="number" min="0" max="100" />
              </label>
            </div>
            <button class="mc-btn mc-btn--primary" type="button" :disabled="busy" @click="runRandomCompose">
              <Icon name="sparkles" :size="15" />
              按范围随机生成试卷
            </button>
          </div>

          <!-- 自己挑题 -->
          <div class="stp__mode">
            <div class="stp__modehead">
              <Icon name="list" :size="18" />
              <strong>自己挑题</strong>
              <em>打开题库，左侧还是这个范围，自己勾选或整批加入</em>
            </div>
            <p class="mc-muted stp__modetip">
              弹窗里支持：按章节 /
              知识点筛、题型与难度筛选、关键词、易错题优先、全选筛选结果；右侧能看到已选与合计分值。
            </p>
            <button class="mc-btn mc-btn--soft" type="button" @click="picking = true">
              <Icon name="plus" :size="15" />
              打开题库挑题
            </button>
          </div>

          <!-- 平行卷 -->
          <div class="stp__mode">
            <div class="stp__modehead">
              <Icon name="copy" :size="18" />
              <strong>平行组卷（A/B 卷）</strong>
              <em>按当前试卷逐题配"同题型、同难度、同考点"的另一套</em>
            </div>
            <button
              class="mc-btn mc-btn--soft"
              type="button"
              :disabled="paper.length === 0"
              @click="parallelOpen = true"
            >
              <Icon name="copy" :size="15" />
              {{ paper.length === 0 ? '试卷为空，先加题' : '生成平行卷' }}
            </button>
          </div>
        </div>
        <div class="stp__row">
          <button class="mc-btn mc-btn--sm" type="button" @click="step = 1">
            <Icon name="arrow-left" :size="15" />
            返回选范围
          </button>
          <span class="mc-spacer" />
          <button class="mc-btn mc-btn--sm" type="button" :disabled="paper.length === 0" @click="step = 3">
            下一步：看卷子（{{ paper.length }} 题）
            <Icon name="arrow-right" :size="15" />
          </button>
        </div>
      </div>
    </section>

    <!-- ③ 看卷子 -->
    <section v-else-if="step === 3" class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">③ 卷子内容（{{ paper.length }} 题 · 合计 {{ fmtScore(totalScore) }} 分）</span>
        <span class="mc-spacer" />
        <button class="mc-btn mc-btn--soft mc-btn--sm" type="button" @click="picking = true">
          <Icon name="plus" :size="15" />
          再加题
        </button>
      </div>
      <div class="mc-card__body mc-col">
        <EmptyState
          v-if="paper.length === 0"
          icon="exam"
          title="还没有题"
          description="回上一步用「随机组卷」或「自己挑题」。"
        />

        <div v-for="(s, si) in sections" :key="`s-${si}`" class="stp__sectionbar">
          <Icon name="list" :size="15" />
          <input
            v-model="s.name"
            class="mc-input stp__sectionname"
            placeholder="大题名称，如 一、单选题"
            :aria-label="`第 ${si + 1} 个大题名称`"
          />
          <label class="stp__field">
            <span class="mc-label">每题分值</span>
            <input
              v-model.number="s.score"
              class="mc-input stp__num"
              type="number"
              min="0"
              step="0.5"
              :aria-label="`第 ${si + 1} 个大题每题分值`"
            />
          </label>
          <button
            class="mc-btn mc-btn--ghost mc-btn--sm"
            type="button"
            :disabled="busy || !s.name"
            @click="setSectionScore(s.name, Number(s.score) || 0)"
          >
            应用到大题
          </button>
          <button class="mc-btn mc-btn--danger-ghost mc-btn--sm" type="button" @click="sections.splice(si, 1)">
            删除大题
          </button>
        </div>

        <div v-for="g in groups" :key="g.name" class="stp__group">
          <div class="stp__grouphead">
            <Icon name="list" :size="15" />
            <span class="stp__groupname">{{ g.name }}</span>
            <span class="mc-muted">{{ g.questions.length }} 题 · {{ fmtScore(g.score) }} 分</span>
          </div>

          <article v-for="q in g.questions" :key="q.id" class="stp__q">
            <div class="stp__qtop">
              <span class="stp__qno">{{ qIndex(q.id) }}</span>
              <div class="stp__qbody">
                <RichText class="stp__qstem" :text="q.stem" />
                <ul v-if="q.options.length > 0" class="stp__opts">
                  <li v-for="(opt, oi) in q.options" :key="oi">
                    <span class="stp__optlabel">{{ String.fromCharCode(65 + oi) }}.</span>
                    <RichText inline :text="opt" />
                  </li>
                </ul>
                <div v-if="isOpen(q.id)" class="stp__answer">
                  <p><strong>答案：</strong>{{ q.answer || '（未录入）' }}</p>
                  <p v-if="q.analysis"><strong>解析：</strong><RichText inline :text="q.analysis" /></p>
                </div>
              </div>
            </div>
            <div class="stp__qbar">
              <Tag size="sm">{{ typeLabel(q.type) }}</Tag>
              <button class="mc-btn mc-btn--ghost mc-btn--sm" type="button" @click="toggle(q.id)">
                {{ isOpen(q.id) ? '收起答案' : '看答案与解析' }}
              </button>
              <label class="stp__field">
                <span class="mc-label">分值</span>
                <input
                  class="mc-input stp__num"
                  type="number"
                  min="0"
                  step="0.5"
                  :value="q.score"
                  :aria-label="`第 ${qIndex(q.id)} 题分值`"
                  @change="setScore(q, Number(($event.target as HTMLInputElement).value) || 0)"
                />
              </label>
              <label class="stp__field">
                <span class="mc-label">所属大题</span>
                <input
                  class="mc-input stp__sectioninput"
                  type="text"
                  :value="q.section"
                  placeholder="如 一、单选题"
                  :aria-label="`第 ${qIndex(q.id)} 题所属大题`"
                  @change="setSection(q, ($event.target as HTMLInputElement).value)"
                />
              </label>
              <span class="mc-spacer" />
              <button class="mc-btn mc-btn--ghost mc-btn--sm" type="button" @click="viewQuestion = q">放大看</button>
              <button
                class="mc-btn mc-btn--soft mc-btn--sm"
                type="button"
                @click="
                  replaceQuestionId = q.id;
                  replaceOpen = true;
                "
              >
                换一题
              </button>
              <button
                class="mc-btn mc-btn--ghost mc-btn--sm"
                type="button"
                :disabled="qIndex(q.id) === 1"
                @click="move(qIndex(q.id) - 1, -1)"
              >
                上移
              </button>
              <button
                class="mc-btn mc-btn--ghost mc-btn--sm"
                type="button"
                :disabled="qIndex(q.id) === paper.length"
                @click="move(qIndex(q.id) - 1, 1)"
              >
                下移
              </button>
              <button class="mc-btn mc-btn--danger-ghost mc-btn--sm" type="button" @click="removeQuestion(q)">
                删除
              </button>
            </div>
          </article>
        </div>

        <div v-if="paper.length > 0" class="stp__row">
          <button
            class="mc-btn mc-btn--sm"
            type="button"
            @click="sections.push({ name: '', type: '', score: 0, description: '' })"
          >
            <Icon name="plus" :size="15" />
            添加大题
          </button>
          <button class="mc-btn mc-btn--soft mc-btn--sm" type="button" @click="fillSectionsByType">
            <Icon name="sparkles" :size="15" />
            按题型自动生成大题
          </button>
          <button class="mc-btn mc-btn--sm" type="button" :disabled="busy" @click="saveStructure">
            保存结构并刷分值
          </button>
          <span class="mc-spacer" />
          <button class="mc-btn mc-btn--primary" type="button" @click="step = 4">
            下一步：打印预览
            <Icon name="arrow-right" :size="15" />
          </button>
        </div>

        <div class="stp__diff">
          <span class="mc-label">难度分布（实际 / 目标）</span>
          <div v-for="c in difficultyCheck" :key="c.level" class="stp__diffrow">
            <span>{{ LEVEL_LABEL[c.level] }}</span>
            <div class="stp__diffbar">
              <div class="stp__difffill" :style="{ width: `${Math.min(100, c.actual)}%` }" />
            </div>
            <span :class="{ 'is-off': c.off > 10 }">{{ c.actual }}% / {{ c.target }}%</span>
          </div>
        </div>

        <details class="stp__settings">
          <summary>考试设置（时长、及格线、作答次数、乱序、是否公布答案）</summary>
          <div class="stp__settingsbody">
            <label class="stp__field stp__field--wide">
              <span class="mc-label">试卷名称</span>
              <input v-model="settings.title" class="mc-input" aria-label="试卷名称" />
            </label>
            <label class="stp__field">
              <span class="mc-label">试卷类型</span>
              <select v-model="settings.paperType" class="mc-select" aria-label="试卷类型">
                <option value="fixed">固定试卷</option>
                <option value="window">时段试卷</option>
              </select>
            </label>
            <template v-if="settings.paperType === 'window'">
              <label class="stp__field">
                <span class="mc-label">开始时间</span>
                <input v-model="settings.startAt" class="mc-input" type="datetime-local" aria-label="开始时间" />
              </label>
              <label class="stp__field">
                <span class="mc-label">结束时间</span>
                <input v-model="settings.endAt" class="mc-input" type="datetime-local" aria-label="结束时间" />
              </label>
            </template>
            <label class="stp__field">
              <span class="mc-label">限时（分钟）</span>
              <input
                v-model.number="settings.durationMinutes"
                class="mc-input"
                type="number"
                min="1"
                max="600"
                aria-label="限时（分钟）"
              />
            </label>
            <label class="stp__field">
              <span class="mc-label">及格线（%）</span>
              <input
                v-model.number="settings.passScore"
                class="mc-input"
                type="number"
                min="0"
                max="100"
                aria-label="及格线（%）"
              />
            </label>
            <label class="stp__field">
              <span class="mc-label">允许作答次数（0 = 不限）</span>
              <input
                v-model.number="settings.attemptLimit"
                class="mc-input"
                type="number"
                min="0"
                max="99"
                aria-label="允许作答次数（0 = 不限）"
              />
            </label>
            <label class="mc-checkbox">
              <input v-model="settings.shuffleQuestions" type="checkbox" />
              题目顺序随机
            </label>
            <label class="mc-checkbox">
              <input v-model="settings.showAnswers" type="checkbox" />
              交卷后公布答案解析
            </label>
            <button
              class="mc-btn mc-btn--primary mc-btn--sm"
              type="button"
              :disabled="settingsSaving"
              @click="saveSettings"
            >
              {{ settingsSaving ? '保存中…' : '保存考试设置' }}
            </button>
          </div>
        </details>
      </div>
    </section>

    <!-- ④ 打印预览 -->
    <section v-else class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">
          ④ 打印预览（{{ paper.length }} 题 · {{ fmtScore(totalScore) }} 分 · 预估 {{ estimatedMinutes }} 分钟）
        </span>
        <span class="mc-spacer" />
        <button class="mc-btn mc-btn--sm" type="button" @click="step = 3">
          <Icon name="arrow-left" :size="15" />
          返回改卷子
        </button>
      </div>
      <div class="mc-card__body stp__print">
        <aside class="stp__printopts">
          <label class="stp__field">
            <span class="mc-label">纸张</span>
            <select v-model="printOptions.size" class="mc-select" aria-label="纸张" @change="refreshPreview">
              <option value="A4">A4（210×297mm）</option>
              <option value="A3">A3（297×420mm）</option>
            </select>
          </label>
          <label class="stp__field">
            <span class="mc-label">方向</span>
            <select v-model="printOptions.orientation" class="mc-select" aria-label="方向" @change="refreshPreview">
              <option value="portrait">纵向</option>
              <option value="landscape">横向</option>
            </select>
          </label>
          <label class="stp__field">
            <span class="mc-label">分栏</span>
            <select v-model.number="printOptions.columns" class="mc-select" aria-label="分栏" @change="refreshPreview">
              <option :value="1">单栏</option>
              <option :value="2">双栏</option>
            </select>
          </label>
          <label class="mc-checkbox">
            <input v-model="printOptions.answers" type="checkbox" @change="refreshPreview" />
            含答案与解析（教师版）
          </label>
          <label class="mc-checkbox">
            <input v-model="printOptions.sheet" type="checkbox" @change="refreshPreview" />
            附答题卡
          </label>
          <label class="mc-checkbox">
            <input v-model="printOptions.seal" type="checkbox" @change="refreshPreview" />
            密封线（装订线）
          </label>
          <button class="mc-btn mc-btn--primary" type="button" @click="openPrint">
            <Icon name="print" :size="15" />
            打印 / 导出 PDF
          </button>
          <button class="mc-btn mc-btn--sm" type="button" @click="openPaperWord">
            <Icon name="download" :size="15" />
            导出 Word
          </button>
          <p class="mc-hint">浏览器打印对话框里选「另存为 PDF」即可导出文件；纸张与方向按上面设置排版。</p>
        </aside>
        <iframe :src="previewSrc" class="stp__preview" title="试卷预览" />
      </div>
    </section>

    <BlueprintComposeModal
      :open="blueprintOpen"
      :exam-id="examId"
      scope="course"
      :busy="busy"
      @close="blueprintOpen = false"
      @composed="
        loadPaper();
        loadExam();
        step = 3;
      "
    />

    <ReplaceQuestionModal
      :open="replaceOpen"
      :exam-id="examId"
      :question-id="replaceQuestionId"
      :busy="busy"
      @close="replaceOpen = false"
      @replaced="loadPaper()"
    />

    <AppModal :open="parallelOpen" title="平行组卷（A/B 卷）" width="620px" @close="parallelOpen = false">
      <div class="mc-col">
        <p class="mc-muted">
          按当前试卷逐题配一道<strong>同题型、同难度档、知识点尽量相同</strong>的另一道题，生成一场新考试；
          分值、大题、结构与考试设置都会沿用。新卷是<strong>草稿</strong>。
        </p>
        <label class="stp__field stp__field--wide">
          <span class="mc-label">新试卷名称（留空自动命名）</span>
          <input v-model="parallelForm.title" class="mc-input" :placeholder="`${exam?.title ?? ''}（平行卷）`" />
        </label>
        <label class="stp__field">
          <span class="mc-label">抽题范围</span>
          <select v-model="parallelForm.scope" class="mc-select">
            <option value="course">本课程（推荐）</option>
            <option value="all">全库所有题</option>
          </select>
        </label>
      </div>
      <template #footer>
        <button class="mc-btn mc-btn--sm" type="button" @click="parallelOpen = false">取消</button>
        <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" :disabled="parallelBusy" @click="runParallel">
          {{ parallelBusy ? '生成中…' : '生成平行卷' }}
        </button>
      </template>
    </AppModal>

    <AppModal :open="viewQuestion !== null" title="查看题目" width="760px" @close="viewQuestion = null">
      <div v-if="viewQuestion" class="mc-col">
        <RichText :text="viewQuestion.stem" />
        <ul v-if="viewQuestion.options.length > 0" class="stp__opts">
          <li v-for="(opt, oi) in viewQuestion.options" :key="oi">
            <span class="stp__optlabel">{{ String.fromCharCode(65 + oi) }}.</span>
            <RichText inline :text="opt" />
          </li>
        </ul>
        <p><strong>答案：</strong>{{ viewQuestion.answer || '（未录入）' }}</p>
        <p v-if="viewQuestion.analysis"><strong>解析：</strong><RichText inline :text="viewQuestion.analysis" /></p>
      </div>
    </AppModal>
  </section>
</template>

<style scoped>
.stp {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-2) var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-elevated);
  flex-wrap: wrap;
}

.stp__item {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-1) var(--mc-space-2);
  border: 1px solid transparent;
  border-radius: var(--mc-radius);
  background: none;
  cursor: pointer;
  font: inherit;
  color: inherit;
}

.stp__item.is-on {
  border-color: var(--mc-primary);
  background: var(--mc-primary-soft);
}

.stp__no {
  width: 22px;
  height: 22px;
  border-radius: var(--mc-radius-pill);
  background: var(--mc-bg-sunken);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--mc-text-xs);
  flex: none;
}

.stp__item.is-on .stp__no {
  background: var(--mc-primary);
  color: var(--mc-primary-fg);
}

.stp__text {
  display: flex;
  flex-direction: column;
  line-height: var(--mc-leading-display);
}

.stp__text em {
  font-style: normal;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.stp__meta {
  font-variant-numeric: tabular-nums;
  color: var(--mc-text-secondary);
}

.stp__meta.is-off {
  color: var(--mc-text-muted);
}

.stp__loading {
  height: 260px;
  border-radius: var(--mc-radius);
}

.stp__row {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
  padding-top: var(--mc-space-2);
}

.stp__emptyhint {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: var(--mc-space-2);
  border: 1px solid var(--mc-warning-border);
  border-radius: var(--mc-radius);
  background: var(--mc-warning-soft);
  font-size: var(--mc-text-sm);
}

.stp__scope {
  gap: var(--mc-space-2);
}

.stp__modes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: var(--mc-space-3);
}

.stp__mode {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding: var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-elevated);
}

.stp__modehead {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.stp__modehead em {
  font-style: normal;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
  flex-basis: 100%;
}

.stp__modetip {
  margin: 0;
  font-size: var(--mc-text-xs);
}

.stp__quota th,
.stp__quota td {
  font-size: var(--mc-text-sm);
}

.stp__num {
  width: 76px;
}

.stp__ratio {
  display: flex;
  gap: var(--mc-space-2);
}

.stp__ratioitem {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stp__sectionbar {
  display: flex;
  align-items: flex-end;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
  padding: var(--mc-space-2) var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
}

.stp__sectionname {
  flex: 1;
  min-width: 160px;
}

.stp__sectioninput {
  width: 132px;
}

.stp__group {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
}

.stp__grouphead {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-1) var(--mc-space-3);
  background: var(--mc-bg-sunken);
  border-radius: var(--mc-radius);
}

.stp__groupname {
  font-weight: var(--mc-font-medium);
}

.stp__q {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
}

.stp__qtop {
  display: flex;
  gap: var(--mc-space-2);
}

.stp__qno {
  min-width: 24px;
  height: 24px;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-sunken);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--mc-text-xs);
  flex: none;
}

.stp__qbody {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stp__qstem {
  line-height: var(--mc-leading);
}

.stp__opts {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stp__optlabel {
  margin-right: 4px;
  color: var(--mc-text-muted);
}

.stp__answer {
  padding: var(--mc-space-3);
  border: 1px solid var(--mc-primary-border);
  background: var(--mc-primary-soft);
  border-radius: var(--mc-radius);
}

.stp__answer p {
  margin: 0 0 4px;
}

.stp__qbar {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
  padding-left: 32px;
}

.stp__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.stp__field--wide {
  grid-column: 1 / -1;
}

.stp__diff {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stp__diffrow {
  display: grid;
  grid-template-columns: 48px 1fr auto;
  align-items: center;
  gap: var(--mc-space-2);
  font-size: var(--mc-text-xs);
}

.stp__diffbar {
  height: 10px;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-sunken);
  overflow: hidden;
}

.stp__difffill {
  height: 100%;
  background: var(--mc-primary);
}

.stp__diffrow .is-off {
  color: var(--mc-danger-fg);
  font-weight: var(--mc-font-medium);
}

.stp__settings {
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  padding: var(--mc-space-2) var(--mc-space-3);
}

.stp__settings summary {
  cursor: pointer;
  font-weight: var(--mc-font-medium);
}

.stp__settingsbody {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--mc-space-2);
  align-items: end;
  padding-top: var(--mc-space-2);
}

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

.stp__preview {
  width: 100%;
  height: 76vh;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
}
</style>
