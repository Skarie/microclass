<script setup lang="ts">
import AnswerText from '@/components/AnswerText.vue';
import EmptyState from '@/components/EmptyState.vue';
import RichText from '@/components/RichText.vue';
import { fmtTime } from './conflict-formatters';
import type { ConflictGroup, useQuestionConflicts } from '@/composables/use-question-conflicts';

/**
 * 冲突组列表：组数/页码表头 + 空态 + 每组（题干、各答案票数、核对结果）+ 分页。
 * 数据与分页都在父级的 useQuestionConflicts 里，这里只负责展示；点「核对/查看」抛给页面打开弹窗。
 */
defineProps<{ list: ReturnType<typeof useQuestionConflicts> }>();
const emit = defineEmits<{ open: [group: ConflictGroup] }>();
</script>

<template>
  <section class="mc-card">
    <div class="mc-card__header">
      <span class="mc-card__title">冲突组</span>
      <span class="mc-muted"
        >{{ list.data?.total ?? 0 }} 组 · 第 {{ list.data?.page ?? 1 }}/{{ list.totalPages }} 页</span
      >
    </div>

    <EmptyState
      v-if="list.visibleGroups.length === 0"
      :title="list.statusFilter === 'pending' ? '没有待核对的冲突组' : '没有记录'"
      description="导入新题库后点「重新扫描全库」即可发现新的冲突组。"
    />

    <ul v-else class="list">
      <li v-for="g in list.visibleGroups" :key="g.contentHash" class="item">
        <div class="item__main">
          <RichText class="item__stem" :text="g.stem" />
          <div class="item__answers">
            <span
              v-for="a in g.answers"
              :key="a.answer"
              class="mc-badge"
              :class="a.n === g.answers[0]?.n ? 'mc-badge--primary' : ''"
            >
              答案「<AnswerText :answer="a.answer" />」× {{ a.n }}
            </span>
            <span v-if="g.status === 'resolved'" class="mc-badge mc-badge--success">
              已核对：<AnswerText :answer="g.chosenAnswer || '—'" />{{ g.reviewerName ? ` · ${g.reviewerName}` : '' }}
            </span>
            <span v-else-if="g.status === 'ignored'" class="mc-badge">已忽略</span>
          </div>
        </div>
        <div class="item__meta mc-muted">
          共 {{ g.groupSize }} 题 / {{ g.answerCount }} 种答案
          <template v-if="g.updatedAt"> · {{ fmtTime(g.updatedAt) }}</template>
        </div>
        <button class="mc-btn mc-btn--sm" type="button" @click="emit('open', g)">
          {{ g.status === 'pending' ? '核对' : '查看' }}
        </button>
      </li>
    </ul>

    <div v-if="list.totalPages > 1" class="pager">
      <button class="mc-btn mc-btn--sm" type="button" :disabled="list.page <= 1" @click="list.goto(list.page - 1)">
        上一页
      </button>
      <span class="mc-muted">第 {{ list.page }} / {{ list.totalPages }} 页</span>
      <button
        class="mc-btn mc-btn--sm"
        type="button"
        :disabled="list.page >= list.totalPages"
        @click="list.goto(list.page + 1)"
      >
        下一页
      </button>
    </div>
  </section>
</template>

<style scoped>
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.item {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3) var(--mc-space-4);
  border-top: 1px solid var(--mc-border);
}

.item:first-child {
  border-top: none;
}

.item__main {
  flex: 1;
  min-width: 0;
}

.item__stem {
  display: block;
  overflow-x: auto;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow-y: hidden;
}

.item__answers {
  display: flex;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
  margin-top: 8px;
}

.item__meta {
  font-size: var(--mc-text-xs);
  white-space: nowrap;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3);
  border-top: 1px solid var(--mc-border);
}
</style>
