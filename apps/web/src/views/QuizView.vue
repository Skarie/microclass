<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { api } from '@/api/client';
import { errorMessage, useAsync } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import Icon from '@/components/Icon.vue';
import Tag from '@/components/Tag.vue';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import AnswerText from '@/components/AnswerText.vue';
import RichText from '@/components/RichText.vue';
import type { GradedItem, QuestionType, QuestionView, QuizSubmitResult } from '@/api/types';

interface QuizResponse {
  lesson: { id: number; title: string };
  questions: QuestionView[];
  total: number;
  mode: string;
  unlocked: boolean;
}

const route = useRoute();
const toast = useToastStore();
const lessonId = computed(() => Number(route.params.id));
const count = ref<number>(0);
const answers = reactive<Record<number, string>>({});
const multipleAnswers = reactive<Record<number, string[]>>({});
const result = ref<QuizSubmitResult | null>(null);
const submitting = ref(false);

const typeLabel: Record<QuestionType, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  fill: '填空题',
  short: '简答题',
};

const { data, loading, run } = useAsync<QuizResponse>(() =>
  api.get<QuizResponse>(`/lessons/${lessonId.value}/quiz`, count.value > 0 ? { count: count.value } : undefined),
);

const questions = computed(() => data.value?.questions ?? []);
const resultMap = computed(() => new Map((result.value?.results ?? []).map((r) => [r.qid, r])));
const answeredCount = computed(
  () =>
    questions.value.filter((q) => {
      if (q.type === 'multiple') return pickedOf(q.id).length > 0;
      return (answers[q.id] ?? '').trim() !== '';
    }).length,
);

function optionLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

/** 填空题输入提示：多个空时提醒按顺序用「；」分隔（与题库导入的答案编码一致） */
function fillPlaceholder(blanks?: number): string {
  if (blanks && blanks > 1) return `共 ${blanks} 个空，请按顺序填写，用「；」分隔（如 3；-9）`;
  return '请填写答案（数学式可直接输入，如 -3/4）';
}

/**
 * 旧版「题目配图」入口：只有题干里没有内联图片时才用（题库导入的题目图片在题干里，
 * 再渲染一遍会重复，而且 image_path 指向 question-media 时旧路由也取不到）。
 */
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

/** 题目加载后为多选题初始化空数组，保证绑定值类型稳定 */
function ensureMultipleState(): void {
  for (const q of questions.value) {
    if (q.type === 'multiple' && !Array.isArray(multipleAnswers[q.id])) multipleAnswers[q.id] = [];
  }
}
watch(questions, ensureMultipleState, { immediate: true });

function resultOf(qid: number): GradedItem | undefined {
  return resultMap.value.get(qid);
}

/** 学生提交的是选项下标串；结果里回显正确选项的字母 */
function lettersOf(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .split(',')
    .map((x) => Number.parseInt(x, 10))
    .filter((x) => !Number.isNaN(x))
    .sort((a, b) => a - b)
    .map((i) => optionLabel(i))
    .join('');
}

async function submit(): Promise<void> {
  if (answeredCount.value === 0) {
    toast.warning('请至少作答一题');
    return;
  }
  submitting.value = true;
  try {
    const payload = {
      answers: questions.value.map((q) => ({
        qid: q.id,
        answer:
          q.type === 'multiple'
            ? [...pickedOf(q.id)].sort((a, b) => Number(a) - Number(b)).join(',')
            : (answers[q.id] ?? ''),
      })),
    };
    result.value = await api.post<QuizSubmitResult>(`/lessons/${lessonId.value}/quiz/submit`, payload);
    toast.success(`本次得分 ${result.value.score}/${result.value.total}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    submitting.value = false;
  }
}

function retry(randomCount = 0): void {
  result.value = null;
  for (const key of Object.keys(answers)) delete answers[Number(key)];
  for (const key of Object.keys(multipleAnswers)) delete multipleAnswers[Number(key)];
  count.value = randomCount;
  void run();
}

watch(lessonId, () => retry(0));
</script>

<template>
  <section v-if="loading && questions.length === 0" class="mc-col">
    <div class="mc-skeleton" style="height: 160px" />
    <div class="mc-skeleton" style="height: 300px" />
  </section>

  <EmptyState v-else-if="!data" icon="pen-line" title="无法加载练习" description="课时可能已被删除。" />

  <section v-else class="quiz mc-col">
    <PageHeader
      :title="`课后练习 · ${data.lesson.title}`"
      description="提交后立即判分并展示解析；答错的客观题会自动进入错题本，答对后自动标记为已掌握。"
      icon="pen-line"
      :breadcrumb="[
        { label: '课程大厅', to: '/' },
        { label: '课时', to: `/lessons/${lessonId}` },
        { label: '课后练习' },
      ]"
    >
      <template #actions>
        <RouterLink class="mc-btn mc-btn--sm" :to="{ name: 'watch', params: { id: lessonId } }">
          <Icon name="arrow-left" :size="15" />
          返回课时
        </RouterLink>
      </template>
      <template #meta>
        <Tag icon="list">{{ data.total }} 题</Tag>
        <Tag v-if="data.mode !== 'all'" tone="primary" icon="sparkles">随机抽题</Tag>
      </template>
    </PageHeader>

    <div
      v-if="result"
      class="quiz__score"
      :class="result.score / result.total >= 0.6 ? 'quiz__score--pass' : 'quiz__score--fail'"
    >
      <span class="quiz__score-num">{{ result.score }}</span>
      <span class="quiz__score-total">/ {{ result.total }}</span>
      <span class="quiz__score-label">
        {{ result.total > 0 ? Math.round((result.score / result.total) * 100) : 0 }}% · 历史最好 {{ result.best }}%
        <template v-if="result.manual > 0"> · {{ result.manual }} 题待自评</template>
      </span>
    </div>

    <div v-if="!data.unlocked" class="notice mc-card">
      <Icon name="shield" :size="15" /> 该课时尚未解锁练习（本地视频需看完 80%）。请先完整观看视频后再来作答。
    </div>

    <EmptyState
      v-if="questions.length === 0"
      icon="bank"
      title="本课时还没有配套题目"
      description="教师可在「题库管理」中创建题目并关联到该课时。"
    />

    <ol v-else class="qlist">
      <li
        v-for="(q, index) in questions"
        :key="q.id"
        class="question mc-card"
        :class="{ 'question--done': Boolean(resultOf(q.id)) }"
      >
        <div class="question__head">
          <span class="question__index">{{ index + 1 }}</span>
          <span class="mc-badge">{{ typeLabel[q.type] }}</span>
          <RichText class="question__stem" :text="q.stem" />
          <span
            v-if="resultOf(q.id)"
            class="mc-badge"
            :class="
              resultOf(q.id)?.correct === true
                ? 'mc-badge--success'
                : resultOf(q.id)?.correct === false
                  ? 'mc-badge--danger'
                  : ''
            "
          >
            {{ resultOf(q.id)?.correct === true ? '正确' : resultOf(q.id)?.correct === false ? '错误' : '待自评' }}
          </span>
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
              :disabled="Boolean(result)"
            />
            <input
              v-else
              type="checkbox"
              :checked="isPicked(q.id, String(oi))"
              :disabled="Boolean(result)"
              @change="toggleMultiple(q.id, String(oi))"
            />
            <span class="option__label">{{ optionLabel(oi) }}</span>
            <RichText class="option__text" inline :text="opt" />
          </label>
        </div>

        <div v-else-if="q.type === 'judge'" class="options options--inline">
          <label class="option">
            <input v-model="answers[q.id]" type="radio" :name="`q-${q.id}`" value="T" :disabled="Boolean(result)" />
            <span class="option__text">对</span>
          </label>
          <label class="option">
            <input v-model="answers[q.id]" type="radio" :name="`q-${q.id}`" value="F" :disabled="Boolean(result)" />
            <span class="option__text">错</span>
          </label>
        </div>

        <input
          v-else-if="q.type === 'fill'"
          v-model="answers[q.id]"
          class="mc-input question__fill"
          :placeholder="fillPlaceholder(q.blanks)"
          :disabled="Boolean(result)"
        />

        <textarea
          v-else
          v-model="answers[q.id]"
          class="mc-textarea"
          placeholder="请作答（简答题不自动判分，可与参考答案自行比对）"
          :disabled="Boolean(result)"
        />

        <div v-if="resultOf(q.id)" class="answer">
          <div class="mc-row mc-row--wrap answer__row">
            <span class="mc-muted">你的作答：</span>
            <span class="mc-mono">{{ resultOf(q.id)?.given || '（未作答）' }}</span>
          </div>
          <div class="mc-row mc-row--wrap answer__row">
            <span class="mc-muted">参考答案：</span>
            <span class="answer__correct">
              <template v-if="q.type === 'single' || q.type === 'multiple'">
                {{ lettersOf(resultOf(q.id)?.answer) }}
                <template v-if="resultOf(q.id)?.answer">（{{ resultOf(q.id)?.answer }}）</template>
              </template>
              <template v-else-if="q.type === 'judge'">{{ resultOf(q.id)?.answer === 'T' ? '对' : '错' }}</template>
              <template v-else>
                <AnswerText :answer="resultOf(q.id)?.answer" :type="q.type" />
              </template>
            </span>
          </div>
          <div v-if="resultOf(q.id)?.analysis" class="answer__analysis">
            <span>解析：</span><RichText inline :text="resultOf(q.id)?.analysis" />
          </div>
        </div>
      </li>
    </ol>

    <footer v-if="questions.length > 0" class="quiz__footer mc-card">
      <div class="mc-row mc-row--wrap">
        <span class="mc-muted">已作答 {{ answeredCount }} / {{ questions.length }}</span>
        <div class="mc-spacer" />
        <template v-if="!result">
          <label class="mc-row quiz__count">
            <span class="mc-label">随机题数</span>
            <select v-model.number="count" class="mc-select" style="width: 110px" @change="retry(count)">
              <option :value="0">全部</option>
              <option v-for="n in [5, 10, 20, 30]" :key="n" :value="n">{{ n }} 题</option>
            </select>
          </label>
          <button class="mc-btn mc-btn--primary" type="button" :disabled="submitting || !data.unlocked" @click="submit">
            {{ submitting ? '提交中…' : '提交并判分' }}
          </button>
        </template>
        <template v-else>
          <button class="mc-btn" type="button" @click="retry(count)">再练一次</button>
          <RouterLink class="mc-btn" :to="{ name: 'wrong-book' }">查看错题本</RouterLink>
          <RouterLink class="mc-btn mc-btn--primary" :to="{ name: 'watch', params: { id: lessonId } }"
            >返回视频</RouterLink
          >
        </template>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.quiz__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--mc-space-5);
  padding: var(--mc-space-5);
}

.quiz__title {
  font-size: var(--mc-text-lg);
}

.quiz__hint {
  margin: 0;
  font-size: var(--mc-text-sm);
}

.quiz__score {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--mc-space-3) var(--mc-space-5);
  border-radius: var(--mc-radius-lg);
  background: var(--mc-bg-sunken);
  min-width: 150px;
}

.quiz__score--pass {
  background: var(--mc-success-soft);
  color: var(--mc-success-fg);
}

.quiz__score--fail {
  background: var(--mc-danger-soft);
  color: var(--mc-danger-fg);
}

.quiz__score-num {
  font-size: var(--mc-text-2xl);
  font-weight: var(--mc-font-bold);
  line-height: var(--mc-leading-display);
}

.quiz__score-total {
  font-size: var(--mc-text-sm);
  opacity: 0.8;
}

.quiz__score-label {
  font-size: var(--mc-text-xs);
  text-align: center;
}

.notice {
  padding: var(--mc-space-3) var(--mc-space-4);
  background: var(--mc-warning-soft);
  color: var(--mc-warning-fg);
  border-color: transparent;
  font-size: var(--mc-text-sm);
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

.answer {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  padding: var(--mc-space-3) var(--mc-space-4);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
  font-size: var(--mc-text-sm);
}

.answer__row {
  gap: var(--mc-space-2);
}

.answer__correct {
  color: var(--mc-success-fg);
  font-weight: var(--mc-font-semibold);
}

.answer__analysis {
  margin: var(--mc-space-1) 0 0;
  color: var(--mc-text-secondary);
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 4px;
}

.quiz__footer {
  padding: var(--mc-space-4) var(--mc-space-5);
  position: sticky;
  bottom: var(--mc-space-4);
}

.quiz__count {
  gap: var(--mc-space-2);
}
</style>
