<script setup lang="ts">
/**
 * 选题大表格：勾选式挑题（对齐学科网/智学网的「试题篮」前置步骤）。
 *
 * 针对原工作台的具体毛病：
 *   - 原来挑题区只有 396px 宽、每行信息被挤没 → 这里占满整宽，题干给足空间且**可展开看全**；
 *   - 原来没有批量操作 → 支持「全选本页」「全选筛选结果 N 题」；
 *   - 原来点"加入"是一道一道来 → 底部常驻操作条，选中后一次加入。
 */
import { computed, ref } from 'vue';
import Icon from '@/components/Icon.vue';
import RichText from '@/components/RichText.vue';
import Tag from '@/components/Tag.vue';
import DifficultyBadge from '@/components/DifficultyBadge.vue';
import type { ComposeQuestionRow } from '@/components/compose/types';

const props = withDefaults(
  defineProps<{
    questions: ComposeQuestionRow[];
    /** 已勾选（受控） */
    checked: number[];
    /** 已在试卷里（表格里标注，不让重复加入） */
    inPaper?: number[];
    loading?: boolean;
    /** 当前筛选下的总题数（"全选筛选结果 N 题"用） */
    total?: number;
    /** 本页之外还有多少 */
    pageSize?: number;
    typeLabel?: (type: string) => string;
  }>(),
  { inPaper: () => [], loading: false, total: 0, pageSize: 50, typeLabel: undefined },
);

const emit = defineEmits<{
  'update:checked': [value: number[]];
  /** 全选筛选结果（父级去服务端取 id 或直接按筛选批量加入） */
  selectAllMatched: [];
  view: [row: ComposeQuestionRow];
  replace: [row: ComposeQuestionRow];
  /** 空结果时提供"切到全库"的动作（课程没绑题库时很常见） */
  switchScope: [];
  /** 行内「加入」：学习通式随手加入（不必先勾选再批量） */
  add: [id: number];
}>();

const expanded = ref<number[]>([]);

const typeText = (type: string): string => props.typeLabel?.(type) ?? type;

const checkedSet = computed(() => new Set(props.checked));
const paperSet = computed(() => new Set(props.inPaper));
const allOnPageChecked = computed(
  () => props.questions.length > 0 && props.questions.every((q) => checkedSet.value.has(q.id)),
);

function toggle(id: number): void {
  emit('update:checked', checkedSet.value.has(id) ? props.checked.filter((x) => x !== id) : [...props.checked, id]);
}

function toggleAllOnPage(): void {
  if (allOnPageChecked.value) {
    const pageIds = new Set(props.questions.map((q) => q.id));
    emit(
      'update:checked',
      props.checked.filter((id) => !pageIds.has(id)),
    );
  } else {
    emit('update:checked', [...new Set([...props.checked, ...props.questions.map((q) => q.id)])]);
  }
}

function toggleExpand(id: number): void {
  expanded.value = expanded.value.includes(id) ? expanded.value.filter((x) => x !== id) : [...expanded.value, id];
}

function pct(rate: number | undefined): string {
  return `${Math.round(Number(rate ?? 0) * 100)}%`;
}

const matchedBeyondPage = computed(() => Math.max(0, (props.total ?? 0) - props.questions.length));
</script>

<template>
  <div class="qt">
    <div class="qt__bar">
      <label class="mc-checkbox qt__all">
        <input
          type="checkbox"
          :checked="allOnPageChecked"
          :disabled="questions.length === 0"
          @change="toggleAllOnPage"
        />
        全选本页（{{ questions.length }} 题）
      </label>
      <button
        v-if="(total ?? 0) > questions.length"
        class="mc-btn mc-btn--ghost mc-btn--sm"
        type="button"
        @click="emit('selectAllMatched')"
      >
        <Icon name="check-circle" :size="15" />
        全选筛选结果 {{ total }} 题
        <span v-if="matchedBeyondPage > 0" class="mc-muted">（本页之外 {{ matchedBeyondPage }} 题）</span>
      </button>
      <span class="mc-spacer" />
      <span v-if="checked.length > 0" class="qt__count">已勾选 {{ checked.length }} 题</span>
    </div>

    <div v-if="loading" class="qt__loading">
      <div v-for="i in 5" :key="i" class="mc-skeleton qt__skeleton" />
    </div>

    <div v-else-if="questions.length === 0" class="qt__empty">
      <p class="mc-muted">当前筛选条件下没有题目。</p>
      <p class="mc-muted">
        常见原因：这门课还没绑定题库（新导入的题常常只归到题库、没归到课程）， 或章节/知识点选得太窄。
      </p>
      <button class="mc-btn mc-btn--soft mc-btn--sm" type="button" @click="emit('switchScope')">
        <Icon name="grid" :size="15" />
        改成「全库所有题」再挑
      </button>
    </div>

    <table v-else class="mc-table qt__table">
      <thead>
        <tr>
          <th class="qt__col-check"><span class="mc-sr-only">选择</span></th>
          <th>题干</th>
          <th class="qt__col-type">题型</th>
          <th class="qt__col-diff">难度</th>
          <th class="qt__col-point">知识点</th>
          <th class="qt__col-act">操作</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="q in questions" :key="q.id">
          <tr :class="{ 'qt__row--checked': checkedSet.has(q.id), 'qt__row--inpaper': paperSet.has(q.id) }">
            <td class="qt__col-check">
              <input
                type="checkbox"
                :checked="checkedSet.has(q.id)"
                :aria-label="`选择第 ${q.id} 题`"
                @change="toggle(q.id)"
              />
            </td>
            <td class="qt__stemcell">
              <RichText v-if="expanded.includes(q.id)" :text="q.stem" />
              <span v-else class="qt__stem1">{{ q.stem }}</span>
              <button class="qt__expand" type="button" @click="toggleExpand(q.id)">
                {{ expanded.includes(q.id) ? '收起' : '展开' }}
              </button>
              <Tag v-if="paperSet.has(q.id)" size="sm" tone="success">已在试卷</Tag>
              <Tag v-if="Number(q.attempts ?? 0) > 0" size="sm" tone="warning">
                错率 {{ pct(q.error_rate) }}（{{ q.attempts }} 次）
              </Tag>
              <!-- 来源从独立列挪到这里：180px 的列宽把题干和操作列都挤没了（真机踩过） -->
              <span v-if="q.bank_name" class="qt__src" :title="q.bank_name">{{ q.bank_name }}</span>
            </td>
            <td class="qt__col-type">{{ typeText(q.type) }}</td>
            <td class="qt__col-diff">
              <DifficultyBadge :difficulty="q.difficulty" :score="q.difficulty_score" />
            </td>
            <td class="qt__col-point">{{ q.point || '未归类' }}</td>
            <td class="qt__col-act">
              <button
                class="mc-btn mc-btn--soft mc-btn--sm"
                type="button"
                :disabled="paperSet.has(q.id)"
                @click="emit('add', q.id)"
              >
                {{ paperSet.has(q.id) ? '已加入' : '加入' }}
              </button>
              <button class="mc-btn mc-btn--ghost mc-btn--sm" type="button" @click="emit('view', q)">看题</button>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.qt {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  min-width: 0;
}

.qt__bar {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  flex-wrap: wrap;
  padding: var(--mc-space-2) var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
}

.qt__all {
  font-size: var(--mc-text-sm);
}

.qt__count {
  font-size: var(--mc-text-sm);
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-medium);
}

.qt__loading {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
}

.qt__skeleton {
  height: 34px;
  border-radius: var(--mc-radius-sm);
}

.qt__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-6);
  text-align: center;
  border: 1px dashed var(--mc-border);
  border-radius: var(--mc-radius);
}

.qt__empty p {
  margin: 0;
  font-size: var(--mc-text-sm);
}

.qt__table {
  width: 100%;
}

.qt__col-check {
  width: 36px;
}

.qt__col-type {
  width: 68px;
  white-space: nowrap;
}

.qt__col-diff {
  width: 88px;
}

.qt__col-point {
  width: 130px;
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qt__col-act {
  width: 128px;
  white-space: nowrap;
}

/* 来源：跟在题干下方的小字（原先是独立列，180px 把题干挤到只剩一两行） */
.qt__src {
  display: block;
  margin-top: 4px;
  color: var(--mc-text-muted);
  font-size: var(--mc-text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 去掉固定列后，题干必须拿到剩余宽度，且不能被压到看不见 */
.qt__stemcell {
  min-width: 260px;
}

.qt__stemcell {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  min-width: 0;
}

.qt__stem1 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: var(--mc-text-sm);
}

.qt__expand {
  border: none;
  background: none;
  color: var(--mc-primary-fg);
  cursor: pointer;
  font-size: var(--mc-text-xs);
  flex: none;
  padding: 0;
}

.qt__row--checked {
  background: var(--mc-primary-soft);
}

.qt__row--inpaper {
  color: var(--mc-text-muted);
}
</style>
