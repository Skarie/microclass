<script setup lang="ts">
/**
 * 错题本：答错/未作答的客观题自动收录。
 * 支持按掌握状态筛选、按题干搜索、标记或取消掌握、移除，并可回到课时重新练习。
 */
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { api } from '@/api/client';
import { errorMessage, useAsync } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import PageHeader from '@/components/PageHeader.vue';
import StatCard from '@/components/StatCard.vue';
import Icon from '@/components/Icon.vue';
import EmptyState from '@/components/EmptyState.vue';
import AnswerText from '@/components/AnswerText.vue';
import RichText from '@/components/RichText.vue';
import type { QuestionType, WrongItem } from '@/api/types';

interface WrongBookResponse {
  total: number;
  pending: number;
  items: WrongItem[];
}

const router = useRouter();
const toast = useToastStore();

/** false：只看未掌握；true：包含已掌握 */
const includeMastered = ref(false);
const keyword = ref('');
const busyId = ref<number | null>(null);

const typeLabel: Record<QuestionType, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  fill: '填空题',
  short: '简答题',
};

const { data, loading, run } = useAsync<WrongBookResponse>(() =>
  api.get<WrongBookResponse>('/me/wrong-questions', includeMastered.value ? { includeMastered: 1 } : undefined),
);

const items = computed<WrongItem[]>(() => data.value?.items ?? []);
const pendingCount = computed(() => data.value?.pending ?? 0);
const totalCount = computed(() => data.value?.total ?? 0);
const masteredCount = computed(() => Math.max(0, totalCount.value - pendingCount.value));

const filtered = computed<WrongItem[]>(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return items.value;
  return items.value.filter((item) => item.stem.toLowerCase().includes(kw));
});

function optionLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

/** 旧版「题目配图」入口：题干里已有内联图片（题库导入的题）时不再重复渲染 */
function legacyImageUrl(item: WrongItem): string {
  if (!item.image_path) return '';
  if (/!\[[^\]]*\]\(/.test(item.stem)) return '';
  return `/api/v1/question-images/${item.id}`;
}

/** 选项题的正确答案在库里是下标串，展示时转成字母；其他题型直接展示 */
function answerText(item: WrongItem): string {
  const raw = item.answer ?? '';
  if (!raw) return '—';
  if (item.type === 'single' || item.type === 'multiple') {
    const letters = raw
      .split(',')
      .map((x) => Number.parseInt(x, 10))
      .filter((x) => !Number.isNaN(x))
      .sort((a, b) => a - b)
      .map((i) => optionLabel(i))
      .join('');
    return letters || raw;
  }
  if (item.type === 'judge') return raw === 'T' ? '对' : raw === 'F' ? '错' : raw;
  return raw;
}

function isRightOption(item: WrongItem, index: number): boolean {
  if (item.type !== 'single' && item.type !== 'multiple') return false;
  return (item.answer ?? '').split(',').includes(String(index));
}

function formatTime(ms: number): string {
  return new Date(ms * 1000).toLocaleString('zh-CN');
}

function onFilterChange(): void {
  void run();
}

async function toggleMaster(item: WrongItem): Promise<void> {
  busyId.value = item.id;
  try {
    const nextMastered = item.mastered !== 1;
    await api.post(`/me/wrong-questions/${item.id}/master`, { mastered: nextMastered });
    toast.success(nextMastered ? '已标记为掌握' : '已取消掌握标记');
    await run(true);
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    busyId.value = null;
  }
}

async function remove(item: WrongItem): Promise<void> {
  if (!window.confirm('确定要把这道题从错题本移除吗？')) return;
  busyId.value = item.id;
  try {
    await api.del(`/me/wrong-questions/${item.id}`);
    toast.success('已从错题本移除');
    await run(true);
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    busyId.value = null;
  }
}

/** 回到该题所属课时的练习页重新作答 */
function practice(item: WrongItem): void {
  if (item.lesson_id === null) return;
  void router.push({ name: 'quiz', params: { id: item.lesson_id } });
}
</script>

<template>
  <section class="wb mc-col">
    <PageHeader
      title="错题本"
      description="答错或未作答的客观题自动收录；重新答对后自动标记为已掌握，也可以在这里手动管理。"
      icon="wrong"
      :breadcrumb="[{ label: '课程大厅', to: '/' }, { label: '错题本' }]"
    >
      <template #actions>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="loading" @click="run()">
          <Icon name="refresh" :size="15" />
          {{ loading ? '刷新中…' : '刷新列表' }}
        </button>
        <RouterLink class="mc-btn mc-btn--sm" :to="{ name: 'hall' }">
          <Icon name="hall" :size="15" />
          课程大厅
        </RouterLink>
      </template>

      <template #meta>
        <StatCard label="收录总题数" :value="totalCount" unit="题" icon="wrong" tone="primary" />
        <StatCard label="未掌握" :value="pendingCount" unit="题" icon="alert" tone="warning" />
        <StatCard label="已掌握" :value="masteredCount" unit="题" icon="check-circle" tone="success" />
        <StatCard label="当前筛选命中" :value="filtered.length" unit="题" icon="search" tone="neutral" />
      </template>
    </PageHeader>

    <div class="mc-card wb__filters">
      <div class="mc-row mc-row--wrap">
        <label class="mc-field wb__filter" for="wb-filter-state">
          <span class="mc-label">掌握状态</span>
          <select id="wb-filter-state" v-model="includeMastered" class="mc-select" @change="onFilterChange">
            <option :value="false">只看未掌握</option>
            <option :value="true">全部（含已掌握）</option>
          </select>
        </label>
        <label class="mc-field wb__filter wb__filter--grow" for="wb-filter-keyword">
          <span class="mc-label">题干关键词</span>
          <input
            id="wb-filter-keyword"
            v-model="keyword"
            class="mc-input"
            type="search"
            placeholder="输入关键词搜索题干…"
          />
        </label>
      </div>
    </div>

    <section v-if="loading && items.length === 0" class="mc-col">
      <div class="mc-skeleton" style="height: 120px" />
      <div class="mc-skeleton" style="height: 260px" />
    </section>

    <EmptyState
      v-else-if="items.length === 0"
      icon="target"
      title="错题本是空的"
      description="做课后练习时答错的题目会自动收录到这里，方便反复巩固。"
    />

    <EmptyState
      v-else-if="filtered.length === 0"
      icon="search"
      title="没有匹配的错题"
      description="试试更换关键词，或切换为「全部（含已掌握）」查看完整记录。"
    />

    <ol v-else class="wblist">
      <li v-for="(item, index) in filtered" :key="item.id" class="question mc-card">
        <div class="question__head">
          <span class="question__index">{{ index + 1 }}</span>
          <span class="mc-badge">{{ typeLabel[item.type] }}</span>
          <span class="mc-badge" :class="item.mastered === 1 ? 'mc-badge--success' : 'mc-badge--warning'">
            {{ item.mastered === 1 ? '已掌握' : '未掌握' }}
          </span>
          <RichText class="question__stem" :text="item.stem" />
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
            <span class="mc-muted">正确答案：</span>
            <span class="answer__correct">
              <AnswerText
                v-if="(item.type === 'fill' || item.type === 'short') && item.answer"
                :answer="item.answer"
                :type="item.type"
              />
              <template v-else>{{ answerText(item) }}</template>
            </span>
          </div>
          <p v-if="item.analysis" class="answer__analysis">解析：<RichText inline :text="item.analysis" /></p>
          <div class="mc-row mc-row--wrap answer__meta">
            <span class="mc-badge mc-badge--danger">累计答错 {{ item.wrong_count }} 次</span>
            <span class="mc-muted">最近答错：{{ formatTime(item.last_at) }}</span>
          </div>
        </div>

        <div class="mc-row mc-row--wrap question__actions">
          <button class="mc-btn mc-btn--sm" type="button" :disabled="busyId === item.id" @click="toggleMaster(item)">
            {{ item.mastered === 1 ? '取消掌握' : '标记已掌握' }}
          </button>
          <button
            v-if="item.lesson_id !== null"
            class="mc-btn mc-btn--sm mc-btn--primary"
            type="button"
            :disabled="busyId === item.id"
            @click="practice(item)"
          >
            错题重练
          </button>
          <button
            class="mc-btn mc-btn--sm mc-btn--danger"
            type="button"
            :disabled="busyId === item.id"
            @click="remove(item)"
          >
            移除
          </button>
        </div>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.wb__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--mc-space-5);
  padding: var(--mc-space-5);
}

.wb__head-main {
  gap: var(--mc-space-2);
  min-width: 0;
}

.wb__title {
  font-size: var(--mc-text-lg);
}

.wb__hint {
  margin: 0;
  font-size: var(--mc-text-sm);
}

.wb__head-actions {
  flex: none;
}

.wb__stat {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  padding: var(--mc-space-4) var(--mc-space-5);
}

.wb__stat-label {
  font-size: var(--mc-text-xs);
}

.wb__stat-value {
  font-size: var(--mc-text-2xl);
  font-weight: var(--mc-font-bold);
  line-height: var(--mc-leading-display);
}

.wb__stat-value--pending {
  color: var(--mc-warning-fg);
}

.wb__stat-value--done {
  color: var(--mc-success-fg);
}

.wb__filters {
  padding: var(--mc-space-4) var(--mc-space-5);
}

.wb__filter {
  min-width: 180px;
}

.wb__filter--grow {
  flex: 1;
  min-width: 240px;
}

.wblist {
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

.answer__analysis {
  margin: var(--mc-space-1) 0 0;
  color: var(--mc-text-secondary);
  white-space: pre-wrap;
}

.answer__meta {
  gap: var(--mc-space-3);
  margin-top: var(--mc-space-1);
  font-size: var(--mc-text-xs);
}

.question__actions {
  justify-content: flex-end;
}
</style>
