<script setup lang="ts">
/**
 * 在线考试作答页：一次性交卷，限时倒计时，到点自动交卷。
 * 答案编码与后端一致：单选/多选传选项下标（多选逗号升序），判断传 T/F。
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { RouterLink, onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { api } from '@/api/client';
import { errorMessage, useAsync } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import Tag from '@/components/Tag.vue';
import Icon from '@/components/Icon.vue';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import RichText from '@/components/RichText.vue';
import type { ExamSubmitResult, QuestionType } from '@/api/types';

interface ExamQuestion {
  id: number;
  type: QuestionType;
  stem: string;
  image_path: string;
  options: string[];
  sort: number;
  /** 填空题空位数（>1 时按顺序用「；」分隔作答） */
  blanks?: number;
}

interface ExamTakeResponse {
  already: boolean;
  exam: {
    id: number;
    title: string;
    description?: string;
    duration_minutes?: number;
    pass_score?: number;
  };
  questions?: ExamQuestion[];
  total?: number;
}

const route = useRoute();
const router = useRouter();
const toast = useToastStore();
const examId = computed(() => Number(route.params.id));

const answers = reactive<Record<number, string>>({});
const multipleAnswers = reactive<Record<number, string[]>>({});
const submitting = ref(false);
const submitted = ref(false);
const startedAt = ref(Date.now());
const limitSeconds = ref(0);
const remaining = ref(0);

let timer: number | undefined;
let warned = false;

const typeLabel: Record<QuestionType, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  fill: '填空题',
  short: '简答题',
};

const { data, loading, run } = useAsync<ExamTakeResponse>(async () => {
  const res = await api.get<ExamTakeResponse>(`/exams/${examId.value}/take`);
  if (!res.already) startCountdown(res.exam.duration_minutes);
  return res;
});

const questions = computed<ExamQuestion[]>(() => data.value?.questions ?? []);

/** 填空题输入提示：多个空时提醒按顺序用「；」分隔（与题库导入的答案编码一致） */
function fillPlaceholder(blanks?: number): string {
  if (blanks && blanks > 1) return `共 ${blanks} 个空，请按顺序填写，用「；」分隔（如 3；-9）`;
  return '请填写答案（数学式可直接输入，如 -3/4）';
}

/** 旧版「题目配图」入口：题干里已有内联图片（题库导入的题）时不再重复渲染 */
function legacyImageUrl(q: { id: number; image_path?: string; stem: string }): string {
  if (!q.image_path) return '';
  if (/!\[[^\]]*\]\(/.test(q.stem)) return '';
  return `/api/v1/question-images/${q.id}`;
}

/** 多选题已选项：始终返回数组，避免绑定值被写成字符串/false 后渲染抛错 */
function pickedOf(qid: number): string[] {
  const value = multipleAnswers[qid];
  return Array.isArray(value) ? value : [];
}

function isPicked(qid: number, value: string): boolean {
  return pickedOf(qid).includes(value);
}

/** 显式受控的多选切换：不依赖 v-model 在「非数组模型」下的兜底行为 */
function toggleMultiple(qid: number, value: string): void {
  const next = new Set(pickedOf(qid));
  if (next.has(value)) next.delete(value);
  else next.add(value);
  multipleAnswers[qid] = [...next].sort((a, b) => Number(a) - Number(b));
  answers[qid] = multipleAnswers[qid].join(',');
}

const answeredIds = computed<Set<number>>(() => {
  const set = new Set<number>();
  for (const q of questions.value) {
    if (q.type === 'multiple') {
      if (pickedOf(q.id).length > 0) set.add(q.id);
    } else if ((answers[q.id] ?? '').trim() !== '') {
      set.add(q.id);
    }
  }
  return set;
});
const answeredCount = computed(() => answeredIds.value.size);

function optionLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

/** 题目加载后为多选题初始化空数组，保证绑定值类型稳定 */
function ensureMultipleState(): void {
  for (const q of questions.value) {
    if (q.type === 'multiple' && !Array.isArray(multipleAnswers[q.id])) multipleAnswers[q.id] = [];
  }
}
watch(questions, ensureMultipleState, { immediate: true });

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function stopTimer(): void {
  if (timer !== undefined) {
    window.clearInterval(timer);
    timer = undefined;
  }
}

function tick(): void {
  const left = Math.max(0, limitSeconds.value - Math.floor((Date.now() - startedAt.value) / 1000));
  remaining.value = left;
  if (left > 0 && left <= 60 && !warned) {
    warned = true;
    toast.warning('距离考试结束不足 1 分钟，请尽快交卷');
  }
  if (left <= 0) {
    stopTimer();
    toast.info('考试时间已到，正在自动交卷');
    void submit(true);
  }
}

/** 进入作答页即开始计时（不限时考试 duration_minutes 为 0 或缺失） */
function startCountdown(minutes: number | undefined): void {
  stopTimer();
  startedAt.value = Date.now();
  limitSeconds.value = Math.max(0, Math.floor((minutes ?? 0) * 60));
  remaining.value = limitSeconds.value;
  warned = false;
  if (limitSeconds.value > 0) timer = window.setInterval(tick, 1000);
}

function scrollToQuestion(qid: number): void {
  document.getElementById(`exam-q-${qid}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function submit(auto = false): Promise<void> {
  if (submitting.value || submitted.value) return;
  const list = questions.value;
  if (list.length === 0) {
    toast.error('本场考试还没有题目');
    return;
  }
  if (!auto) {
    const missing = list.length - answeredCount.value;
    const tip = missing > 0 ? `还有 ${missing} 题未作答，确定要交卷吗？` : '确定要交卷吗？交卷后不能修改。';
    if (!window.confirm(tip)) return;
  }

  submitting.value = true;
  try {
    const payload = {
      answers: list.map((q) => ({
        qid: q.id,
        answer:
          q.type === 'multiple'
            ? [...pickedOf(q.id)].sort((a, b) => Number(a) - Number(b)).join(',')
            : (answers[q.id] ?? ''),
      })),
      startedAt: startedAt.value,
    };
    await api.post<ExamSubmitResult>(`/exams/${examId.value}/submit`, payload);
    submitted.value = true;
    stopTimer();
    toast.success('交卷成功，正在生成成绩…');
    await router.push({ name: 'exam-result', params: { id: examId.value } });
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    submitting.value = false;
  }
}

onBeforeRouteLeave(() => {
  if (!data.value || data.value.already || submitted.value) return true;
  if (questions.value.length > 0 && answeredCount.value === questions.value.length) return true;
  return window.confirm('试卷尚未提交，离开将丢失本次作答，确定离开吗？');
});

onBeforeUnmount(stopTimer);
</script>

<template>
  <section v-if="loading && !data" class="mc-col">
    <div class="mc-skeleton mc-skeleton--h160" />
    <div class="mc-skeleton" style="height: 320px" />
  </section>

  <section v-else-if="!data" class="mc-card loadfail">
    <EmptyState icon="exam" title="无法加载试卷" description="考试可能已被删除或尚未发布。" />
    <div class="mc-row loadfail__actions">
      <button class="mc-btn mc-btn--primary" type="button" :disabled="loading" @click="run()">
        {{ loading ? '重试中…' : '重试' }}
      </button>
      <RouterLink class="mc-btn" :to="{ name: 'hall' }">返回课程大厅</RouterLink>
    </div>
  </section>

  <section v-else-if="data.already" class="take mc-col">
    <PageHeader
      :title="`在线考试 · ${data.exam.title}`"
      description="本场考试你已经交卷，不能重复作答。可以进入成绩页复盘每一道题。"
      icon="exam"
      :breadcrumb="[{ label: '课程大厅', to: '/' }, { label: '在线考试' }]"
    >
      <template #actions>
        <RouterLink class="mc-btn mc-btn--sm" :to="{ name: 'hall' }">
          <Icon name="hall" :size="15" />
          返回课程大厅
        </RouterLink>
      </template>
    </PageHeader>

    <div class="notice mc-card">
      <Icon name="info" :size="15" /> 每场考试只能作答一次，成绩已记录。请前往成绩页查看得分与解析。
    </div>

    <div class="mc-row mc-row--wrap">
      <RouterLink class="mc-btn mc-btn--primary" :to="{ name: 'exam-result', params: { id: examId } }">
        查看考试成绩
      </RouterLink>
      <RouterLink class="mc-btn" :to="{ name: 'hall' }">返回课程大厅</RouterLink>
    </div>
  </section>

  <section v-else class="take mc-col">
    <PageHeader
      :title="`在线考试 · ${data.exam.title}`"
      :description="data.exam.description || '提交后立即判分；每场考试只能交卷一次，请确认无误后再提交。'"
      icon="exam"
      :breadcrumb="[{ label: '课程大厅', to: '/' }, { label: '在线考试' }]"
    >
      <template #actions>
        <RouterLink class="mc-btn mc-btn--sm" :to="{ name: 'hall' }">
          <Icon name="hall" :size="15" />
          返回课程大厅
        </RouterLink>
      </template>
    </PageHeader>

    <!-- 题量/及格线/倒计时：从原页头里拆出来，做成一行状态条 -->
    <div class="take__status mc-card">
      <Tag tone="primary" icon="list">{{ questions.length }} 题</Tag>
      <Tag v-if="data.exam.pass_score !== undefined" icon="target">及格线 {{ data.exam.pass_score }}%</Tag>
      <div class="mc-spacer" />
      <div class="clock" :class="{ 'clock--warn': limitSeconds > 0 && remaining <= 60 }">
        <span class="mc-muted clock__label">剩余时间</span>
        <span class="clock__value mc-mono">{{ limitSeconds > 0 ? formatClock(remaining) : '不限时' }}</span>
      </div>
    </div>

    <EmptyState
      v-if="questions.length === 0"
      icon="bank"
      title="本场考试还没有组卷"
      description="请联系教师完成组卷后再来作答。"
    />

    <template v-else>
      <ol class="qlist">
        <li
          v-for="(q, index) in questions"
          :id="`exam-q-${q.id}`"
          :key="q.id"
          class="question mc-card"
          :class="{ 'question--done': answeredIds.has(q.id) }"
        >
          <div class="question__head">
            <span class="question__index">{{ index + 1 }}</span>
            <span class="mc-badge">{{ typeLabel[q.type] }}</span>
            <RichText class="question__stem" :text="q.stem" />
          </div>

          <img
            v-if="legacyImageUrl(q)"
            class="question__image"
            :src="legacyImageUrl(q)"
            :alt="`第 ${index + 1} 题配图`"
            loading="lazy"
          />

          <div v-if="q.type === 'single' || q.type === 'multiple'" class="options">
            <label
              v-for="(opt, oi) in q.options"
              :key="oi"
              class="option"
              :class="{
                'option--picked': q.type === 'multiple' ? isPicked(q.id, String(oi)) : answers[q.id] === String(oi),
              }"
            >
              <input
                v-if="q.type === 'single'"
                v-model="answers[q.id]"
                type="radio"
                :name="`q-${q.id}`"
                :value="String(oi)"
              />
              <input
                v-else
                type="checkbox"
                :checked="isPicked(q.id, String(oi))"
                @change="toggleMultiple(q.id, String(oi))"
              />
              <span class="option__label">{{ optionLabel(oi) }}</span>
              <RichText class="option__text" inline :text="opt" />
            </label>
          </div>

          <div v-else-if="q.type === 'judge'" class="options options--inline">
            <label class="option" :class="{ 'option--picked': answers[q.id] === 'T' }">
              <input v-model="answers[q.id]" type="radio" :name="`q-${q.id}`" value="T" />
              <span class="option__text">对</span>
            </label>
            <label class="option" :class="{ 'option--picked': answers[q.id] === 'F' }">
              <input v-model="answers[q.id]" type="radio" :name="`q-${q.id}`" value="F" />
              <span class="option__text">错</span>
            </label>
          </div>

          <input
            v-else-if="q.type === 'fill'"
            v-model="answers[q.id]"
            class="mc-input question__fill"
            :aria-label="`第 ${index + 1} 题答案`"
            :placeholder="fillPlaceholder(q.blanks)"
          />

          <textarea
            v-else
            v-model="answers[q.id]"
            class="mc-textarea"
            :aria-label="`第 ${index + 1} 题作答`"
            placeholder="请作答（简答题不自动判分，交卷后可对照参考答案）"
          />
        </li>
      </ol>

      <footer class="take__footer mc-card">
        <div class="mc-row mc-row--wrap take__footer-row">
          <span class="mc-muted take__count">已作答 {{ answeredCount }} / {{ questions.length }}</span>
          <nav class="nav" aria-label="题目导航">
            <button
              v-for="(q, index) in questions"
              :key="q.id"
              class="nav__item"
              :class="{ 'nav__item--done': answeredIds.has(q.id) }"
              type="button"
              :aria-label="`跳转到第 ${index + 1} 题${answeredIds.has(q.id) ? '（已作答）' : ''}`"
              @click="scrollToQuestion(q.id)"
            >
              {{ index + 1 }}
            </button>
          </nav>
          <div class="mc-spacer" />
          <button class="mc-btn mc-btn--primary" type="button" :disabled="submitting" @click="submit(false)">
            {{ submitting ? '交卷中…' : '交卷' }}
          </button>
        </div>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.take__status {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
  padding: var(--mc-space-2) var(--mc-space-4);
}

.clock {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 132px;
  padding: var(--mc-space-3) var(--mc-space-5);
  border-radius: var(--mc-radius-lg);
  background: var(--mc-bg-sunken);
}

.clock--warn {
  background: var(--mc-danger-soft);
  color: var(--mc-danger-fg);
}

.clock__label {
  font-size: var(--mc-text-xs);
}

.clock__value {
  font-size: var(--mc-text-xl);
  font-weight: var(--mc-font-bold);
  line-height: var(--mc-leading-display);
}

.notice {
  padding: var(--mc-space-3) var(--mc-space-4);
  background: var(--mc-warning-soft);
  color: var(--mc-warning-fg);
  border-color: transparent;
  font-size: var(--mc-text-sm);
}

.loadfail {
  padding: var(--mc-space-4);
}

.loadfail__actions {
  justify-content: center;
  padding-bottom: var(--mc-space-4);
}

.qlist {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-4);
}

.question {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  padding: var(--mc-space-5);
  scroll-margin-top: var(--mc-space-6);
}

.question--done {
  border-color: var(--mc-border-strong);
}

.question__head {
  display: flex;
  align-items: flex-start;
  gap: var(--mc-space-3);
}

.question__index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: none;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-bold);
}

.question__stem {
  flex: 1;
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-medium);
  white-space: pre-wrap;
}

.question__image {
  max-width: 100%;
  max-height: 320px;
  align-self: flex-start;
  border-radius: var(--mc-radius);
  border: 1px solid var(--mc-border);
}

.options {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
}

.options--inline {
  flex-direction: row;
  gap: var(--mc-space-5);
}

.option {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3) var(--mc-space-4);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  cursor: pointer;
  transition:
    background var(--mc-transition),
    border-color var(--mc-transition);
}

.option:hover {
  background: var(--mc-bg-hover);
}

.option--picked {
  border-color: var(--mc-primary);
  background: var(--mc-primary-soft);
}

.option__label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: var(--mc-radius-pill);
  background: var(--mc-bg-sunken);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-semibold);
}

.option__text {
  font-size: var(--mc-text-base);
}

.question__fill {
  max-width: 460px;
}

.take__footer {
  position: sticky;
  bottom: var(--mc-space-4);
  padding: var(--mc-space-3) var(--mc-space-5);
  z-index: var(--mc-z-sticky);
}

.take__footer-row {
  gap: var(--mc-space-3);
}

.take__count {
  font-size: var(--mc-text-sm);
}

.nav {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mc-space-1);
  max-width: 100%;
}

.nav__item {
  min-width: 26px;
  height: 26px;
  padding: 0 var(--mc-space-1);
  border: 1px solid var(--mc-border-strong);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-elevated);
  color: var(--mc-text-secondary);
  font: inherit;
  font-size: var(--mc-text-xs);
  cursor: pointer;
  transition:
    background var(--mc-transition),
    border-color var(--mc-transition),
    color var(--mc-transition);
}

.nav__item:hover {
  background: var(--mc-bg-hover);
}

.nav__item--done {
  border-color: var(--mc-primary);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-bold);
}
</style>
