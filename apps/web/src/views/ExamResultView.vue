<script setup lang="ts">
/**
 * 考试成绩复盘页：得分卡 + 逐题回看（作答、参考答案、解析）。
 */
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { api } from '@/api/client';
import { useAsync } from '@/composables/useAsync';
import Icon from '@/components/Icon.vue';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import AnswerText from '@/components/AnswerText.vue';
import RichText from '@/components/RichText.vue';
import type { GradedItem, QuestionType } from '@/api/types';

interface ExamResultResponse {
  attemptId: number;
  score: number;
  total: number;
  passed: boolean;
  need: number;
  usedSeconds: number;
  manual: number;
  results: GradedItem[];
  created_at: number;
}

const route = useRoute();
const examId = computed(() => Number(route.params.id));

const typeLabel: Record<QuestionType, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  fill: '填空题',
  short: '简答题',
};

const { data, loading, run } = useAsync<ExamResultResponse>(() =>
  api.get<ExamResultResponse>(`/exams/${examId.value}/result`),
);

const results = computed<GradedItem[]>(() => data.value?.results ?? []);
const percentValue = computed(() => {
  const d = data.value;
  if (!d || d.total <= 0) return 0;
  return Math.round((d.score / d.total) * 100);
});
const correctCount = computed(() => results.value.filter((r) => r.correct === true).length);
const wrongCount = computed(() => results.value.filter((r) => r.correct === false).length);

function optionLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

/** 旧版「题目配图」入口：题干里已有内联图片（题库导入的题）时不再重复渲染 */
function legacyImageUrl(item: { qid: number; image_path?: string; stem: string }): string {
  if (!item.image_path) return '';
  if (/!\[[^\]]*\]\(/.test(item.stem)) return '';
  return `/api/v1/question-images/${item.qid}`;
}

/** 选项题的作答/答案都是下标串，展示时转成字母 */
function lettersOf(raw: string): string {
  if (!raw) return '';
  return raw
    .split(',')
    .map((x) => Number.parseInt(x, 10))
    .filter((x) => !Number.isNaN(x))
    .sort((a, b) => a - b)
    .map((i) => optionLabel(i))
    .join('');
}

function givenText(item: GradedItem): string {
  if (item.type === 'single' || item.type === 'multiple') {
    const letters = lettersOf(item.given);
    return letters || '（未作答）';
  }
  if (item.type === 'judge') {
    if (item.given === 'T') return '对';
    if (item.given === 'F') return '错';
    return '（未作答）';
  }
  return item.given || '（未作答）';
}

function answerText(item: GradedItem): string {
  if (item.type === 'single' || item.type === 'multiple') {
    const letters = lettersOf(item.answer);
    return letters ? `${letters}（${item.answer}）` : item.answer;
  }
  if (item.type === 'judge') return item.answer === 'T' ? '对' : item.answer === 'F' ? '错' : item.answer;
  return item.answer;
}

function isRightOption(item: GradedItem, index: number): boolean {
  if (item.type !== 'single' && item.type !== 'multiple') return false;
  return item.answer.split(',').includes(String(index));
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function formatTime(ms: number): string {
  return new Date(ms * 1000).toLocaleString('zh-CN');
}

function resultBadgeClass(item: GradedItem): string {
  if (item.correct === true) return 'mc-badge--success';
  if (item.correct === false) return 'mc-badge--danger';
  return 'mc-badge--warning';
}

function resultBadgeText(item: GradedItem): string {
  if (item.correct === true) return '正确';
  if (item.correct === false) return '错误';
  return '待自评';
}
</script>

<template>
  <section v-if="loading && !data" class="mc-col">
    <div class="mc-skeleton" style="height: 180px" />
    <div class="mc-skeleton" style="height: 320px" />
  </section>

  <section v-else-if="!data" class="mc-card loadfail">
    <EmptyState icon="exam" title="暂无考试成绩" description="可能还没有交卷，或考试已被删除。" />
    <div class="mc-row loadfail__actions">
      <button class="mc-btn" type="button" :disabled="loading" @click="run()">
        {{ loading ? '重试中…' : '重试' }}
      </button>
      <RouterLink class="mc-btn mc-btn--primary" :to="{ name: 'hall' }">返回课程大厅</RouterLink>
    </div>
  </section>

  <section v-else class="result mc-col">
    <PageHeader
      title="考试成绩"
      description="逐题复盘得分与解析；错题可一键加入错题本。"
      icon="stats"
      :breadcrumb="[{ label: '课程大厅', to: '/' }, { label: '考试成绩' }]"
    >
      <template #actions>
        <RouterLink class="mc-btn mc-btn--sm" :to="{ name: 'wrong-book' }">
          <Icon name="wrong" :size="15" />
          查看错题本
        </RouterLink>
        <RouterLink class="mc-btn mc-btn--sm" :to="{ name: 'me' }">
          <Icon name="user" :size="15" />
          我的成绩单
        </RouterLink>
      </template>
    </PageHeader>

    <header class="mc-card result__score">
      <div class="scorecard" :class="data.passed ? 'scorecard--pass' : 'scorecard--fail'">
        <span class="scorecard__num">{{ data.score }}</span>
        <span class="scorecard__total">/ {{ data.total }}</span>
        <span class="scorecard__percent">{{ percentValue }}%</span>
      </div>

      <div class="mc-col result__score-info">
        <div class="mc-row mc-row--wrap">
          <h2 class="result__title">{{ data.passed ? '恭喜通过考试' : '本次未通过，继续加油' }}</h2>
          <span class="mc-badge" :class="data.passed ? 'mc-badge--success' : 'mc-badge--danger'">
            {{ data.passed ? '及格' : '不及格' }}
          </span>
          <span v-if="data.manual > 0" class="mc-badge mc-badge--warning">{{ data.manual }} 题待自评</span>
        </div>

        <div class="mc-grid mc-grid--stats result__metrics">
          <div class="metric">
            <span class="mc-muted metric__label">及格线</span>
            <span class="metric__value"
              >{{ data.need }} <small>/ {{ data.total }} 分</small></span
            >
          </div>
          <div class="metric">
            <span class="mc-muted metric__label">用时</span>
            <span class="metric__value mc-mono">{{ formatDuration(data.usedSeconds) }}</span>
          </div>
          <div class="metric">
            <span class="mc-muted metric__label">答对 / 答错</span>
            <span class="metric__value"
              >{{ correctCount }} <small>/ {{ wrongCount }}</small></span
            >
          </div>
          <div class="metric">
            <span class="mc-muted metric__label">交卷时间</span>
            <span class="metric__value metric__value--time">{{ formatTime(data.created_at) }}</span>
          </div>
        </div>

        <div class="mc-row mc-row--wrap result__actions">
          <RouterLink class="mc-btn mc-btn--primary" :to="{ name: 'hall' }">返回课程大厅</RouterLink>
          <RouterLink class="mc-btn" :to="{ name: 'me' }">我的成绩单</RouterLink>
          <RouterLink class="mc-btn" :to="{ name: 'wrong-book' }">查看错题本</RouterLink>
        </div>
      </div>
    </header>

    <h3 class="result__section-title">逐题复盘</h3>

    <EmptyState
      v-if="results.length === 0"
      icon="pen-line"
      title="没有可复盘的题目"
      description="本次答卷没有记录到题目结果。"
    />

    <ol v-else class="qlist">
      <li v-for="(item, index) in results" :key="item.qid" class="question mc-card">
        <div class="question__head">
          <span class="question__index">{{ index + 1 }}</span>
          <span class="mc-badge">{{ typeLabel[item.type] }}</span>
          <RichText class="question__stem" :text="item.stem" />
          <span class="mc-badge" :class="resultBadgeClass(item)">{{ resultBadgeText(item) }}</span>
        </div>

        <img
          v-if="legacyImageUrl(item)"
          class="question__image"
          :src="legacyImageUrl(item)"
          :alt="`第 ${index + 1} 题配图`"
          loading="lazy"
        />

        <div v-if="item.type === 'single' || item.type === 'multiple'" class="options">
          <div
            v-for="(opt, oi) in item.options"
            :key="oi"
            class="option"
            :class="{ 'option--right': isRightOption(item, oi) }"
          >
            <span class="option__label">{{ optionLabel(oi) }}</span>
            <RichText class="option__text" inline :text="opt" />
          </div>
        </div>

        <div class="answer">
          <div class="mc-row mc-row--wrap answer__row">
            <span class="mc-muted">你的作答：</span>
            <span class="mc-mono" :class="item.correct === true ? 'answer__correct' : 'answer__given'">
              {{ givenText(item) }}
            </span>
          </div>
          <div class="mc-row mc-row--wrap answer__row">
            <span class="mc-muted">参考答案：</span>
            <span class="answer__correct">
              <AnswerText
                v-if="(item.type === 'fill' || item.type === 'short') && item.answer"
                :answer="item.answer"
                :type="item.type"
              />
              <template v-else>{{ answerText(item) }}</template>
            </span>
          </div>
          <div v-if="item.analysis" class="answer__analysis">
            <span>解析：</span><RichText inline :text="item.analysis" />
          </div>
          <p v-if="item.correct === null" class="mc-muted answer__manual">简答题不自动判分，请对照参考答案自评。</p>
        </div>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.loadfail {
  padding: var(--mc-space-4);
}

.loadfail__actions {
  justify-content: center;
  padding-bottom: var(--mc-space-4);
}

.result__score {
  display: flex;
  align-items: flex-start;
  gap: var(--mc-space-6);
  padding: var(--mc-space-5);
}

.scorecard {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 168px;
  padding: var(--mc-space-5);
  border-radius: var(--mc-radius-lg);
  background: var(--mc-bg-sunken);
}

.scorecard--pass {
  background: var(--mc-success-soft);
  color: var(--mc-success-fg);
}

.scorecard--fail {
  background: var(--mc-danger-soft);
  color: var(--mc-danger-fg);
}

.scorecard__num {
  font-size: var(--mc-text-2xl);
  font-weight: var(--mc-font-bold);
  line-height: var(--mc-leading-display);
}

.scorecard__total {
  font-size: var(--mc-text-sm);
  opacity: 0.85;
}

.scorecard__percent {
  margin-top: var(--mc-space-1);
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-semibold);
}

.result__score-info {
  flex: 1;
  min-width: 0;
}

.result__title {
  font-size: var(--mc-text-lg);
}

.result__metrics {
  gap: var(--mc-space-3);
}

.metric {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  padding: var(--mc-space-3) var(--mc-space-4);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
}

.metric__label {
  font-size: var(--mc-text-xs);
}

.metric__value {
  font-size: var(--mc-text-lg);
  font-weight: var(--mc-font-bold);
  line-height: var(--mc-leading-display);
}

.metric__value small {
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-normal);
  color: var(--mc-text-muted);
}

.metric__value--time {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-medium);
  color: var(--mc-text-secondary);
}

.result__section-title {
  font-size: var(--mc-text-md);
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

.option {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3) var(--mc-space-4);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
}

.option--right {
  border-color: var(--mc-success);
  background: var(--mc-success-soft);
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

.answer__given {
  color: var(--mc-text);
}

.answer__analysis {
  margin: var(--mc-space-1) 0 0;
  color: var(--mc-text-secondary);
  white-space: pre-wrap;
}

.answer__manual {
  margin: var(--mc-space-1) 0 0;
  font-size: var(--mc-text-xs);
}

@media (max-width: 900px) {
  .result__score {
    flex-direction: column;
  }

  .scorecard {
    width: 100%;
  }
}
</style>
