<script setup lang="ts">
/**
 * 双向细目表组卷：可编辑的「知识点 × 题型 × 难度」目标矩阵，一键按表配题。
 *
 * 与「智能组卷（题型配额 + 难度配比）」的区别：细目表能控制**知识点覆盖**，
 * 这是教研真正拿来做卷子的表。每格显示题池可用量，配不满的格如实报缺口。
 */
import { computed, ref, watch } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import AppModal from '@/components/AppModal.vue';
import Icon from '@/components/Icon.vue';
import Tag from '@/components/Tag.vue';

type QType = 'single' | 'multiple' | 'judge' | 'fill' | 'short';
type Level = 'easy' | 'medium' | 'hard';

interface Row {
  point: string;
  type: QType;
  level: Level;
  count: number;
}

interface TaxonomyCell {
  type: string;
  easy: number;
  medium: number;
  hard: number;
}
interface TaxonomyPoint {
  point: string;
  total: number;
  cells: TaxonomyCell[];
}
interface TaxonomyResponse {
  scope: { mode: string; courseId: number | undefined };
  total: number;
  points: TaxonomyPoint[];
}
interface ComposeResult {
  added: number;
  requested: number;
  shortfall: number;
  cells: {
    point: string;
    type: string;
    level: string;
    requested: number;
    added: number;
    missing: number;
    available: number;
  }[];
}

const props = defineProps<{ open: boolean; examId: number; scope: 'course' | 'all'; busy?: boolean }>();
const emit = defineEmits<{ close: []; composed: [] }>();

const TYPE_LABEL: Record<QType, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  fill: '填空题',
  short: '简答题',
};
const LEVEL_LABEL: Record<Level, string> = { easy: '易', medium: '中', hard: '难' };
const TYPES = Object.keys(TYPE_LABEL) as QType[];
const LEVELS = Object.keys(LEVEL_LABEL) as Level[];

const toast = useToastStore();
const loading = ref(false);
const submitting = ref(false);
const taxonomy = ref<TaxonomyResponse | null>(null);
const rows = ref<Row[]>([]);
const result = ref<ComposeResult | null>(null);
const replaceExisting = ref(false);
const carryScore = ref(true);

/** 题池里某格有多少题（用于显示"够不够"，避免老师凭感觉填） */
function availableOf(point: string, type: QType, level: Level): number {
  const source = taxonomy.value?.points ?? [];
  // 知识点留空 = 不限知识点：把全范围同题型同难度的量加起来，
  // 否则这一列对"不限知识点"的行永远显示 0，老师会以为题池空着。
  if (!point) {
    return source.reduce((sum, p) => {
      const cell = p.cells.find((c) => c.type === type);
      return sum + (cell ? cell[level] : 0);
    }, 0);
  }
  const p = source.find((x) => x.point === point);
  if (!p) return 0;
  const cell = p.cells.find((c) => c.type === type);
  return cell ? cell[level] : 0;
}

const summary = computed(() => {
  const total = rows.value.reduce((n, r) => n + (Number(r.count) || 0), 0);
  const byType = new Map<QType, number>();
  const byLevel = new Map<Level, number>();
  for (const r of rows.value) {
    const c = Number(r.count) || 0;
    if (c <= 0) continue;
    byType.set(r.type, (byType.get(r.type) ?? 0) + c);
    byLevel.set(r.level, (byLevel.get(r.level) ?? 0) + c);
  }
  return { total, byType: [...byType.entries()], byLevel: [...byLevel.entries()] };
});

/** 每格题池够不够：不够的标出来（配题前就能看到会不会有缺口） */
const shortCells = computed(() =>
  rows.value.filter((r) => {
    const need = Number(r.count) || 0;
    if (need <= 0) return false;
    return availableOf(r.point, r.type, r.level) < need;
  }),
);

function addRow(): void {
  rows.value.push({ point: '', type: 'single', level: 'medium', count: 1 });
}

function removeRow(index: number): void {
  rows.value.splice(index, 1);
}

/** 按当前试卷的实际分布填充（"照着我已有的卷子再来一份"） */
async function fillFromPaper(): Promise<void> {
  if (props.examId === 0) return;
  try {
    const paper = await api.get<{
      questions: { type: QType; point: string; difficulty: string; difficulty_score?: number }[];
    }>(`/exams/${props.examId}/paper`);
    const map = new Map<string, Row>();
    for (const q of paper.questions ?? []) {
      const level: Level =
        q.difficulty === 'easy' || q.difficulty === 'hard' || q.difficulty === 'medium'
          ? q.difficulty
          : Number(q.difficulty_score ?? 50) < 42
            ? 'easy'
            : Number(q.difficulty_score ?? 50) < 71
              ? 'medium'
              : 'hard';
      const key = `${q.point}|${q.type}|${level}`;
      const row = map.get(key) ?? { point: q.point ?? '', type: q.type, level, count: 0 };
      row.count += 1;
      map.set(key, row);
    }
    rows.value = [...map.values()].sort((a, b) => b.count - a.count);
    if (rows.value.length === 0) toast.info('这份试卷还没有题目，先手工加几行吧');
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

async function loadTaxonomy(): Promise<void> {
  if (props.examId === 0) return;
  loading.value = true;
  try {
    taxonomy.value = await api.get<TaxonomyResponse>(`/exams/${props.examId}/taxonomy`, {
      scope: props.scope,
      limit: 200,
    });
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}

async function submit(): Promise<void> {
  const cells = rows.value.map((r) => ({ ...r, count: Number(r.count) || 0 })).filter((r) => r.count > 0);
  if (cells.length === 0) {
    toast.warning('请至少填一格的题量');
    return;
  }
  submitting.value = true;
  result.value = null;
  try {
    const res = await api.post<ComposeResult>(`/exams/${props.examId}/compose`, {
      cells,
      scope: props.scope,
      ...(replaceExisting.value ? { replaceExisting: true } : {}),
      ...(carryScore.value ? {} : {}),
    });
    result.value = res;
    if (res.shortfall === 0) toast.success(`按细目表配齐 ${res.added} 题`);
    else toast.warning(`配到 ${res.added} 题，缺口 ${res.shortfall} 题（详见下方逐格结果）`);
    emit('composed');
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    submitting.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    result.value = null;
    if (rows.value.length === 0) rows.value = [{ point: '', type: 'single', level: 'medium', count: 1 }];
    void loadTaxonomy();
  },
);
</script>

<template>
  <AppModal :open="open" title="按双向细目表组卷" width="900px" @close="emit('close')">
    <div class="mc-col bp">
      <p class="mc-muted bp__intro">
        逐格填写「知识点 × 题型 × 难度」的目标题量 —— 这是教研做卷子的表。右边会显示题池里该格有多少题，
        配不满的格会<strong>如实报缺口</strong>（不会静默少配）。
      </p>

      <div class="bp__toolbar">
        <button class="mc-btn mc-btn--sm" type="button" @click="addRow">
          <Icon name="plus" :size="15" />
          加一行
        </button>
        <button class="mc-btn mc-btn--sm" type="button" @click="fillFromPaper">
          <Icon name="copy" :size="15" />
          按当前试卷填充
        </button>
        <button class="mc-btn mc-btn--ghost mc-btn--sm" type="button" @click="rows = []">清空</button>
        <span class="mc-spacer" />
        <span class="mc-muted">合计 {{ summary.total }} 题</span>
      </div>

      <div class="bp__table">
        <div class="bp__head">
          <span>知识点</span>
          <span>题型</span>
          <span>难度</span>
          <span>题量</span>
          <span>题池</span>
          <span />
        </div>
        <div v-for="(row, i) in rows" :key="i" class="bp__row">
          <input
            v-model.trim="row.point"
            class="mc-input"
            list="bp-points"
            placeholder="留空 = 不限知识点"
            :aria-label="`第 ${i + 1} 行知识点`"
          />
          <select v-model="row.type" class="mc-select" :aria-label="`第 ${i + 1} 行题型`">
            <option v-for="t in TYPES" :key="t" :value="t">{{ TYPE_LABEL[t] }}</option>
          </select>
          <select v-model="row.level" class="mc-select" :aria-label="`第 ${i + 1} 行难度`">
            <option v-for="l in LEVELS" :key="l" :value="l">{{ LEVEL_LABEL[l] }}</option>
          </select>
          <input
            v-model.number="row.count"
            class="mc-input bp__count"
            type="number"
            min="0"
            max="100"
            :aria-label="`第 ${i + 1} 行题量`"
          />
          <span class="bp__avail">
            <Tag
              :tone="availableOf(row.point, row.type, row.level) >= row.count ? 'success' : 'warning'"
              size="sm"
              :title="row.point ? `${row.point} 在题池里的可选题量` : '不限知识点时的全范围可选题量'"
            >
              {{ availableOf(row.point, row.type, row.level) }} 题可用
            </Tag>
          </span>
          <button
            class="mc-btn mc-btn--ghost mc-btn--sm mc-btn--icon"
            type="button"
            aria-label="删除此行"
            @click="removeRow(i)"
          >
            <Icon name="close" :size="15" />
          </button>
        </div>
      </div>
      <datalist id="bp-points">
        <option v-for="p in taxonomy?.points ?? []" :key="p.point" :value="p.point">{{ p.total }} 题</option>
      </datalist>

      <div v-if="shortCells.length > 0" class="bp__warn">
        <Icon name="alert" :size="15" />
        <span>
          有 {{ shortCells.length }} 格的题池不够（如「{{ shortCells[0]?.point || '不限知识点' }} /
          {{ TYPE_LABEL[shortCells[0]!.type] }} / {{ LEVEL_LABEL[shortCells[0]!.level] }}」需要
          {{ shortCells[0]?.count }} 题，题池只有
          {{ availableOf(shortCells[0]!.point, shortCells[0]!.type, shortCells[0]!.level) }} 题）。
          可以放宽难度、或到题库里补题。
        </span>
      </div>

      <div class="bp__summary">
        <span class="mc-label">题型分布</span>
        <Tag v-for="[t, n] in summary.byType" :key="t" size="sm">{{ TYPE_LABEL[t] }} {{ n }}</Tag>
        <span class="mc-label bp__gap">难度分布</span>
        <Tag v-for="[l, n] in summary.byLevel" :key="l" size="sm" tone="info">{{ LEVEL_LABEL[l] }} {{ n }}</Tag>
        <span class="mc-spacer" />
        <label class="mc-checkbox">
          <input v-model="replaceExisting" type="checkbox" />
          先清空现有题目
        </label>
      </div>

      <div v-if="result" class="bp__result">
        <div class="bp__result-head">
          <Tag :tone="result.shortfall === 0 ? 'success' : 'warning'" icon="check">
            配到 {{ result.added }} / {{ result.requested }} 题{{
              result.shortfall > 0 ? `，缺口 ${result.shortfall}` : ''
            }}
          </Tag>
        </div>
        <ul class="bp__result-list">
          <li v-for="(c, i) in result.cells" :key="i" :class="{ 'is-missing': c.missing > 0 }">
            {{ c.point || '不限知识点' }} / {{ TYPE_LABEL[c.type as QType] ?? c.type }} /
            {{ LEVEL_LABEL[c.level as Level] ?? c.level }}：
            <strong>{{ c.added }}/{{ c.requested }}</strong>
            <span v-if="c.missing > 0" class="mc-muted">（题池可用 {{ c.available }}，缺 {{ c.missing }}）</span>
          </li>
        </ul>
      </div>
    </div>

    <template #footer>
      <button class="mc-btn mc-btn--ghost mc-btn--sm" type="button" @click="emit('close')">关闭</button>
      <button
        class="mc-btn mc-btn--primary mc-btn--sm"
        type="button"
        :disabled="busy || submitting || loading"
        @click="submit"
      >
        <Icon name="sparkles" :size="15" />
        {{ submitting ? '配题中…' : '按细目表组卷' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.bp {
  gap: var(--mc-space-3);
}

.bp__intro {
  margin: 0;
  font-size: var(--mc-text-sm);
}

.bp__toolbar {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
}

.bp__table {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 320px;
  overflow-y: auto;
}

.bp__head,
.bp__row {
  display: grid;
  grid-template-columns: minmax(140px, 1.4fr) 110px 80px 90px minmax(96px, 1fr) 36px;
  gap: var(--mc-space-2);
  align-items: center;
}

.bp__head {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
  padding: 0 var(--mc-space-1);
}

.bp__count {
  text-align: right;
}

.bp__avail {
  font-size: var(--mc-text-xs);
}

.bp__warn {
  display: flex;
  align-items: flex-start;
  gap: var(--mc-space-2);
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius);
  background: var(--mc-warning-soft);
  color: var(--mc-warning-fg);
  font-size: var(--mc-text-xs);
}

.bp__summary {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
}

.bp__gap {
  margin-left: var(--mc-space-3);
}

.bp__result {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding: var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
}

.bp__result-list {
  margin: 0;
  padding-left: 1.2em;
  font-size: var(--mc-text-xs);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bp__result-list .is-missing {
  color: var(--mc-warning-fg);
}
</style>
