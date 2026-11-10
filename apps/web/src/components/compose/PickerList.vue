<script setup lang="ts">
/**
 * 挑题列表（组卷「自己挑题」的中栏）：表头统计 + 加入按钮 + 选题表 + 分页。
 *
 * 从 QuestionPickerPanel 抽出：那个文件已经顶到行数上限，而“列表区”和“筛选区”本来就是
 * 两块可以独立刷新的界面；抽出来后中栏还能挂「题组」的整组操作，不用再动左栏。
 *
 * 题组相关：选中某个题组时表头显示「题组：标题」，并提供「整组加入」
 * （顺序由服务端按「母题在前、变式按 sort」给出，父级负责取 id 与提交）。
 */
import Icon from '@/components/Icon.vue';
import QuestionTable from '@/components/compose/QuestionTable.vue';
import type { ComposeQuestionRow, PickerGroupSummary } from '@/components/compose/types';

const props = defineProps<{
  questions: ComposeQuestionRow[];
  checked: number[];
  inPaper: number[];
  loading: boolean;
  total: number;
  page: number;
  pageSize: number;
  busy: boolean;
  typeLabel: (type: string) => string;
  /** 当前选中的题组（null = 没按题组筛） */
  group: PickerGroupSummary | null;
}>();

const emit = defineEmits<{
  'update:checked': [value: number[]];
  'add-checked': [];
  'add-all': [];
  'add-one': [id: number];
  'add-group': [];
  'clear-group': [];
  'switch-scope': [];
  view: [row: ComposeQuestionRow];
  'prev-page': [];
  'next-page': [];
}>();

const hasMore = (): boolean => props.page * props.pageSize < props.total;
</script>

<template>
  <section class="mc-card pl pk__main">
    <div class="mc-card__header pl__head">
      <span class="mc-card__title">{{ group ? `题组：${group.title}` : `题目（${total}）` }}</span>
      <span v-if="group" class="mc-badge">
        母题 {{ group.roleCounts.stem }} · 变式 {{ group.roleCounts.variant }}
      </span>
      <span class="mc-spacer" />
      <span v-if="checked.length > 0" class="pl__count">已勾选 {{ checked.length }} 题</span>
      <button
        v-if="group"
        class="mc-btn mc-btn--ghost mc-btn--sm"
        type="button"
        :disabled="busy"
        @click="emit('clear-group')"
      >
        取消题组筛选
      </button>
      <button
        v-if="group"
        class="mc-btn mc-btn--soft mc-btn--sm"
        type="button"
        :disabled="busy || group.total === 0"
        @click="emit('add-group')"
      >
        <Icon name="plus" :size="16" />
        整组加入（{{ group.total }} 题）
      </button>
      <button
        class="mc-btn mc-btn--primary mc-btn--sm"
        type="button"
        :disabled="busy || checked.length === 0"
        @click="emit('add-checked')"
      >
        <Icon name="plus" :size="16" />
        加入试卷（{{ checked.length }}）
      </button>
    </div>

    <div class="mc-card__body mc-col">
      <p v-if="group" class="mc-muted pl__grouptip">
        整组加入会按「母题在前、变式按组内次序」排入试卷；只想挑一部分就勾选后点「加入试卷」。
      </p>

      <div class="pl__tablewrap">
        <QuestionTable
          :questions="questions"
          :checked="checked"
          :in-paper="inPaper"
          :loading="loading"
          :total="total"
          :page-size="pageSize"
          :type-label="typeLabel"
          @update:checked="(value) => emit('update:checked', value)"
          @select-all-matched="emit('add-all')"
          @add="(id) => emit('add-one', id)"
          @switch-scope="emit('switch-scope')"
          @view="(row) => emit('view', row)"
        />
      </div>

      <div class="pl__foot">
        <span class="mc-muted">第 {{ page }} 页 · 每页 {{ pageSize }} 题</span>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="page <= 1 || loading" @click="emit('prev-page')">
          上一页
        </button>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="!hasMore() || loading" @click="emit('next-page')">
          下一页
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.pl {
  min-width: 0;
}

.pl__head {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
}

.pl__count {
  font-size: var(--mc-text-sm);
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-medium);
}

.pl__grouptip {
  margin: 0;
  font-size: var(--mc-text-xs);
}

/* 窄屏时表格比视口宽：让表格在自己的容器里横向滚动，不要撑开整页（390 溢出） */
.pl__tablewrap {
  min-width: 0;
  overflow-x: auto;
}

.pl__foot {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
  padding-top: var(--mc-space-2);
  border-top: 1px solid var(--mc-border);
}

@media (max-width: 900px) {
  .pl__head .mc-btn {
    min-height: var(--mc-touch-target-mobile);
  }
}
</style>
