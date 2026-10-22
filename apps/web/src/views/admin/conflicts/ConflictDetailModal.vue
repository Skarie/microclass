<script setup lang="ts">
/* eslint-disable vue/no-mutating-props -- 核对状态（选定答案）由 useConflictDetail 持有，弹窗就地编辑 */
import AnswerText from '@/components/AnswerText.vue';
import AppModal from '@/components/AppModal.vue';
import { DIFFICULTY_LABEL, KIND_LABEL, fmtTime } from './conflict-formatters';
import type { useConflictDetail } from '@/composables/use-conflict-detail';

/**
 * 逐组核对弹窗：先看组内每道题来自哪个题库/册次、难度与来源，
 * 再选定一个答案整组统一，或确认「答案不同是合理的」后忽略 / 恢复为待核对。
 */
defineProps<{ detail: ReturnType<typeof useConflictDetail> }>();
</script>

<template>
  <AppModal :open="detail.open" title="核对冲突组" width="820px" @close="detail.close()">
    <div v-if="detail.loading" class="loading"><div class="mc-skeleton loading__row" /></div>
    <div v-else-if="detail.group" class="mc-col detail">
      <p class="mc-muted">组内 {{ detail.questions.length }} 道题，题干与选项一致。选定答案后整组统一。</p>

      <div class="mc-table-wrap" tabindex="0" role="region" aria-label="数据表（可用方向键横向滚动）">
        <table class="mc-table mc-table--compact">
          <thead>
            <tr>
              <th>#</th>
              <th>现有答案</th>
              <th>所在题库</th>
              <th>类型</th>
              <th>难度</th>
              <th>来源</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="q in detail.questions" :key="q.id">
              <td>{{ q.id }}</td>
              <td>
                <button class="answer-pick" type="button" @click="detail.choice = q.answer">
                  <AnswerText :answer="q.answer" :type="q.type" />
                </button>
              </td>
              <td>{{ q.bank_name }}</td>
              <td>{{ KIND_LABEL[q.bank_kind] ?? q.bank_kind ?? '—' }}</td>
              <td>{{ DIFFICULTY_LABEL[q.difficulty] ?? q.difficulty ?? '—' }}</td>
              <td class="mc-muted">{{ q.source_no || q.source_path || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mc-col pick">
        <span class="mc-label">选定正确答案（点答案或直接填写）</span>
        <div class="pick__answers">
          <button
            v-for="a in detail.group.answers"
            :key="a.answer"
            class="answer-pick"
            :class="{ 'answer-pick--on': detail.choice === a.answer }"
            type="button"
            @click="detail.choice = a.answer"
          >
            <AnswerText :answer="a.answer" /> <span class="mc-muted">×{{ a.n }}</span>
          </button>
        </div>
        <input v-model="detail.choice" class="mc-input" type="text" placeholder="正确答案" aria-label="正确答案" />
        <p v-if="detail.group.status === 'resolved'" class="mc-muted">
          上次核对：<AnswerText :answer="detail.group.chosenAnswer" /> · {{ detail.group.reviewerName }}
          {{ detail.group.updatedAt ? ` · ${fmtTime(detail.group.updatedAt)}` : '' }}
        </p>
        <p v-else-if="detail.group.status === 'ignored'" class="mc-muted">
          该组已被忽略（答案不同视为合理）。如需重新处理请点「恢复为待核对」。
        </p>
      </div>
    </div>

    <template #footer>
      <button class="mc-btn mc-btn--sm" type="button" :disabled="detail.saving" @click="detail.ignore()">
        忽略该组
      </button>
      <button
        v-if="detail.group?.status !== 'pending'"
        class="mc-btn mc-btn--sm"
        type="button"
        :disabled="detail.saving"
        @click="detail.reopen()"
      >
        恢复为待核对
      </button>
      <button class="mc-btn mc-btn--ghost mc-btn--sm" type="button" @click="detail.close()">取消</button>
      <button
        class="mc-btn mc-btn--primary mc-btn--sm"
        type="button"
        :disabled="detail.saving"
        @click="detail.resolve()"
      >
        {{ detail.saving ? '处理中…' : '统一为选定答案' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.detail {
  gap: var(--mc-space-3);
}

.pick {
  gap: var(--mc-space-2);
}

.pick__answers {
  display: flex;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
}

.answer-pick {
  padding: var(--mc-space-1) var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-sm);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
}

.answer-pick--on {
  border-color: var(--mc-primary);
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-semibold);
}

.loading__row {
  height: 72px;
  border-radius: var(--mc-radius);
}
</style>
