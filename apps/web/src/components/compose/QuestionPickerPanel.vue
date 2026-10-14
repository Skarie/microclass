<script setup lang="ts">
/**
 * 选题（整页三区，不是弹窗）。
 *
 * 为什么从弹窗改成整页：教师挑题是最花时间的动作，弹窗里塞"树 + 列表 + 试题篮"三栏后，
 * 每栏只剩两三百像素 —— 真机上「题型」被压成竖排、"操作"列直接被裁到弹窗外面，
 * 一屏还看不到几道题。这里改成整页：
 *   左：范围（本课程/全库）+ 章节·知识点树 + 题型/难度/关键词/排序
 *   中：题目列表（题干给足宽度、可展开、行内「加入」）+ 全选本页 / 全选筛选结果 + 分页
 *   右：已选试题篮（题数、合计分值、题型分布、移除、去排卷）
 */
import { computed, reactive, ref, watch } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import Icon from '@/components/Icon.vue';
import RangeTree from '@/components/compose/RangeTree.vue';
import QuestionTable from '@/components/compose/QuestionTable.vue';
import PaperCart from '@/components/compose/PaperCart.vue';
import type { ComposeQuestionRow, FacetBook, FacetPoint } from '@/components/compose/types';

const TYPE_LABEL: Record<string, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  fill: '填空题',
  short: '简答题',
};
const LEVEL_LABEL: Record<'easy' | 'medium' | 'hard', string> = { easy: '基础', medium: '中档', hard: '较难' };
const QUOTA_TYPES = ['single', 'multiple', 'judge', 'fill', 'short'] as const;

const props = defineProps<{
  examId: number;
  /** 已在试卷里的题（表格里标注"已加入"并禁用） */
  inPaper: number[];
  /** 当前试卷（右侧试题篮：题数 / 合计分值 / 题型分布） */
  paper: { id: number; type: string; stem: string; score: number }[];
  /** 第①步已经圈好的范围，进来就带上（老师不用再勾一遍） */
  initialSelected: { books: string[]; chapters: string[]; points: string[] };
  defaultScope: 'course' | 'all';
}>();
const emit = defineEmits<{
  added: [count: number];
  remove: [id: number];
  /** 去排卷（回到第③步） */
  next: [];
  /** 返回组卷方式 */
  back: [];
  /** 清空试卷（试题篮里的「清空」） */
  clear: [];
}>();

const toast = useToastStore();
const busy = ref(false);
const loading = ref(true);

const scope = ref<'course' | 'all'>(props.defaultScope);
const selected = ref<{ books: string[]; chapters: string[]; points: string[] }>({
  books: [...props.initialSelected.books],
  chapters: [...props.initialSelected.chapters],
  points: [...props.initialSelected.points],
});
const facets = ref<{ total: number; books: FacetBook[] } | null>(null);
const pointsByChapter = ref<Record<string, FacetPoint[]>>({});
const loadingPoints = ref<string | null>(null);

const filters = reactive<{
  types: string[];
  levels: string[];
  keyword: string;
  orderBy: 'default' | 'difficulty_asc' | 'difficulty_desc' | 'error_desc';
  page: number;
  pageSize: number;
}>({ types: [], levels: [], keyword: '', orderBy: 'default', page: 1, pageSize: 30 });

const pool = ref<{ total: number; questions: ComposeQuestionRow[] } | null>(null);
const checked = ref<number[]>([]);
const viewRow = ref<ComposeQuestionRow | null>(null);

const typeLabel = (type: string): string => TYPE_LABEL[type] ?? type;

const rangeSummary = computed(() => {
  const parts: string[] = [];
  if (selected.value.books.length > 0) parts.push(`${selected.value.books.length} 个册次`);
  if (selected.value.chapters.length > 0) parts.push(`${selected.value.chapters.length} 个章节`);
  if (selected.value.points.length > 0) parts.push(`${selected.value.points.length} 个知识点`);
  return parts.length === 0 ? '全部范围（本课程所有题）' : parts.join(' + ');
});

function filterPayload(): Record<string, string | string[]> {
  return {
    ...(scope.value === 'all' ? { scope: 'all' } : {}),
    ...(selected.value.books.length > 0 ? { books: selected.value.books } : {}),
    ...(selected.value.chapters.length > 0 ? { chapters: selected.value.chapters } : {}),
    ...(selected.value.points.length > 0 ? { points: selected.value.points } : {}),
    ...(filters.types.length > 0 ? { types: filters.types } : {}),
    ...(filters.levels.length > 0 ? { levels: filters.levels } : {}),
    ...(filters.keyword ? { keyword: filters.keyword } : {}),
  };
}

async function refresh(): Promise<void> {
  filters.page = 1;
  loading.value = true;
  try {
    const [facetRes, poolRes] = await Promise.all([
      api.get<{ total: number; books: FacetBook[] }>(`/exams/${props.examId}/facets`, {
        ...filterPayload(),
        excludeInExam: '1',
      }),
      api.get<{ total: number; questions: ComposeQuestionRow[] }>(`/exams/${props.examId}/pool`, {
        ...filterPayload(),
        orderBy: filters.orderBy,
        page: 1,
        pageSize: filters.pageSize,
        excludeInExam: '1',
      }),
    ]);
    facets.value = facetRes;
    pool.value = poolRes;
    checked.value = [];
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}

async function loadPool(): Promise<void> {
  loading.value = true;
  try {
    pool.value = await api.get<{ total: number; questions: ComposeQuestionRow[] }>(`/exams/${props.examId}/pool`, {
      ...filterPayload(),
      orderBy: filters.orderBy,
      page: filters.page,
      pageSize: filters.pageSize,
      excludeInExam: '1',
    });
    checked.value = [];
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}

async function loadPointsOfChapter(chapter: string): Promise<void> {
  loadingPoints.value = chapter;
  try {
    const res = await api.get<{ points: FacetPoint[] }>(`/exams/${props.examId}/points`, {
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
    const res = await api.get<{ points: FacetPoint[] }>(`/exams/${props.examId}/points`, {
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

/** 加入勾选的题 */
async function addChecked(): Promise<void> {
  if (checked.value.length === 0) return;
  busy.value = true;
  try {
    const res = await api.post<{ added: number }>(`/exams/${props.examId}/questions`, { questionIds: checked.value });
    toast.success(`已加入 ${res.added} 题`);
    emit('added', res.added);
    await refresh();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    busy.value = false;
  }
}

/** 全选当前筛选结果（服务端整批加入） */
async function addAllMatched(): Promise<void> {
  const total = pool.value?.total ?? 0;
  if (total === 0) return;
  if (!window.confirm(`把当前筛选结果的 ${total} 道题全部加入试卷？`)) return;
  busy.value = true;
  try {
    const res = await api.post<{ added: number; matched: number; truncated: boolean }>(
      `/exams/${props.examId}/questions`,
      { filters: filterPayload(), limit: 2000 },
    );
    toast.success(`按当前筛选加入 ${res.added} 题（匹配 ${res.matched} 题）`);
    if (res.truncated) toast.warning('匹配超过 2000 题，本次只加入前 2000 题');
    emit('added', res.added);
    await refresh();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    busy.value = false;
  }
}

/** 行内加入一题 */
async function addOne(id: number): Promise<void> {
  busy.value = true;
  try {
    const res = await api.post<{ added: number }>(`/exams/${props.examId}/questions`, { questionIds: [id] });
    if (res.added === 0) toast.info('这道题已经在试卷里了');
    else toast.success('已加入试卷');
    emit('added', res.added);
    await refresh();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    busy.value = false;
  }
}

function toggleFilter(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

watch(
  () => props.examId,
  () => void refresh(),
  { immediate: true },
);
</script>

<template>
  <div class="pk">
    <!-- 工具条：当前范围 + 返回 -->
    <div class="pk__bar">
      <Icon name="list" :size="16" />
      <strong>自己挑题</strong>
      <span class="mc-muted">当前范围：{{ rangeSummary }}</span>
      <span class="mc-spacer" />
      <span class="mc-muted">共 {{ pool?.total ?? 0 }} 题匹配</span>
      <button class="mc-btn mc-btn--sm" type="button" @click="emit('back')">
        <Icon name="arrow-left" :size="15" />
        返回组卷方式
      </button>
      <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click="emit('next')">
        去排卷（{{ paper.length }} 题）
        <Icon name="arrow-right" :size="15" />
      </button>
    </div>

    <div class="pk__body">
      <!-- 左：范围与筛选 -->
      <aside class="pk__side mc-card">
        <div class="mc-card__body mc-col">
          <label class="pk__field">
            <span class="mc-label">范围</span>
            <select v-model="scope" class="mc-select" aria-label="抽题范围" @change="refresh">
              <option value="course">本课程</option>
              <option value="all">全库所有题（跨课程）</option>
            </select>
          </label>

          <p v-if="(facets?.total ?? 0) === 0 && scope === 'course'" class="pk__hint mc-muted">
            本课程没有绑定题库的题目，改成「全库所有题」就能按章节挑。
          </p>
          <button
            v-if="(facets?.total ?? 0) === 0 && scope === 'course'"
            class="mc-btn mc-btn--soft mc-btn--sm"
            type="button"
            @click="
              scope = 'all';
              refresh();
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
            @update:selected="refresh"
          />

          <div class="pk__group">
            <span class="mc-label">题型</span>
            <div class="pk__chips">
              <button
                v-for="t in QUOTA_TYPES"
                :key="t"
                class="pk__chip"
                :class="{ 'is-on': filters.types.includes(t) }"
                type="button"
                @click="
                  filters.types = toggleFilter(filters.types, t);
                  refresh();
                "
              >
                {{ typeLabel(t) }}
              </button>
            </div>
          </div>

          <div class="pk__group">
            <span class="mc-label">难度</span>
            <div class="pk__chips">
              <button
                v-for="l in ['easy', 'medium', 'hard'] as const"
                :key="l"
                class="pk__chip"
                :class="{ 'is-on': filters.levels.includes(l) }"
                type="button"
                @click="
                  filters.levels = toggleFilter(filters.levels, l);
                  refresh();
                "
              >
                {{ LEVEL_LABEL[l] }}
              </button>
            </div>
          </div>

          <label class="pk__field">
            <span class="mc-label">关键词</span>
            <input
              v-model.trim="filters.keyword"
              class="mc-input"
              type="search"
              placeholder="题干关键词，回车即筛"
              aria-label="题干关键词"
              @keyup.enter="refresh"
            />
          </label>

          <label class="pk__field">
            <span class="mc-label">排序</span>
            <select v-model="filters.orderBy" class="mc-select" aria-label="排序" @change="refresh">
              <option value="default">默认顺序</option>
              <option value="difficulty_asc">由易到难</option>
              <option value="difficulty_desc">由难到易</option>
              <option value="error_desc">易错题优先</option>
            </select>
          </label>

          <button class="mc-btn mc-btn--sm" type="button" @click="refresh">
            <Icon name="refresh" :size="15" />
            刷新
          </button>
        </div>
      </aside>

      <!-- 中：题目列表 -->
      <section class="pk__main mc-card">
        <div class="mc-card__header pk__listhead">
          <span class="mc-card__title">题目（{{ pool?.total ?? 0 }}）</span>
          <span class="mc-spacer" />
          <span v-if="checked.length > 0" class="pk__count">已勾选 {{ checked.length }} 题</span>
          <button
            class="mc-btn mc-btn--primary mc-btn--sm"
            type="button"
            :disabled="busy || checked.length === 0"
            @click="addChecked"
          >
            <Icon name="plus" :size="15" />
            加入试卷（{{ checked.length }}）
          </button>
        </div>
        <div class="mc-card__body mc-col">
          <QuestionTable
            v-model:checked="checked"
            :questions="pool?.questions ?? []"
            :in-paper="inPaper"
            :loading="loading"
            :total="pool?.total ?? 0"
            :page-size="filters.pageSize"
            :type-label="typeLabel"
            @select-all-matched="addAllMatched"
            @add="addOne"
            @switch-scope="
              scope = 'all';
              refresh();
            "
            @view="(row) => (viewRow = row)"
          />

          <div class="pk__foot">
            <span class="mc-muted">第 {{ filters.page }} 页 · 每页 {{ filters.pageSize }} 题</span>
            <button
              class="mc-btn mc-btn--sm"
              type="button"
              :disabled="filters.page <= 1 || loading"
              @click="
                filters.page -= 1;
                loadPool();
              "
            >
              上一页
            </button>
            <button
              class="mc-btn mc-btn--sm"
              type="button"
              :disabled="(pool?.questions.length ?? 0) < filters.pageSize || loading"
              @click="
                filters.page += 1;
                loadPool();
              "
            >
              下一页
            </button>
            <span class="mc-spacer" />
            <span class="mc-muted">已选 {{ paper.length }} 题</span>
          </div>
        </div>
      </section>

      <!-- 右：已选试题篮 -->
      <PaperCart
        :questions="paper"
        :type-label="typeLabel"
        :busy="busy"
        @remove="emit('remove', $event)"
        @clear="emit('clear')"
        @next="emit('next')"
      />
    </div>
  </div>
</template>

<style scoped>
.pk {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
}

.pk__bar {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
  padding: var(--mc-space-2) var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-elevated);
}

/* 三区：左筛选（可滚动） / 中列表（主区） / 右试题篮（270px） */
.pk__body {
  display: grid;
  grid-template-columns: minmax(240px, 290px) minmax(0, 1fr) minmax(240px, 282px);
  gap: var(--mc-space-3);
  align-items: start;
}

@media (max-width: 1500px) {
  .pk__body {
    grid-template-columns: minmax(220px, 260px) minmax(0, 1fr);
  }

  .pk__body > :last-child {
    grid-column: 1 / -1;
  }
}

.pk__side {
  position: sticky;
  top: var(--mc-space-2);
  max-height: calc(100vh - 190px);
  overflow-y: auto;
}

.pk__side .mc-card__body {
  gap: var(--mc-space-2);
}

.pk__field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pk__group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pk__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.pk__chip {
  padding: 3px 8px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-pill);
  background: var(--mc-bg-elevated);
  cursor: pointer;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-secondary);
}

.pk__chip.is-on {
  border-color: var(--mc-primary);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-medium);
}

.pk__hint {
  margin: 0;
  font-size: var(--mc-text-xs);
}

.pk__main {
  min-width: 0;
}

.pk__listhead {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
}

.pk__count {
  font-size: var(--mc-text-sm);
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-medium);
}

.pk__foot {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
  padding-top: var(--mc-space-2);
  border-top: 1px solid var(--mc-border);
}
</style>
