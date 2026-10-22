<script setup lang="ts">
import AnswerText from '@/components/AnswerText.vue';
import AppModal from '@/components/AppModal.vue';
import RichText from '@/components/RichText.vue';
import type { useConflictBatch } from '@/composables/use-conflict-batch';

/**
 * 两个批量弹窗（都先预演、确认后才落库）：
 *   - 合并同义写法：数学等价的写法合并成「A|B」，两种写法都算对；
 *   - 按多数答案：每组采用出现次数最多的答案，票数并列的留给人工。
 */
defineProps<{ batch: ReturnType<typeof useConflictBatch> }>();
</script>

<template>
  <!-- 批量合并同义写法 -->
  <AppModal :open="batch.equivOpen" title="合并同义写法" width="680px" @close="batch.closeEquiv()">
    <div v-if="batch.equivLoading && !batch.equivPreview" class="loading">
      <div class="mc-skeleton loading__row" />
    </div>
    <div v-else-if="batch.equivPreview" class="mc-col majority">
      <p>
        可自动合并 <strong>{{ batch.equivPreview.groups }}</strong> 组（共 {{ batch.equivPreview.questions }} 题）：
        组内各写法 <strong>数学上等价</strong>，合并后两种写法都算对；
        <strong>其余 {{ batch.equivPreview.skipped }} 组是真的答案不同</strong>，需要人工判断（含票数并列的）。
      </p>
      <ul v-if="batch.equivPreview.samples.length > 0" class="majority__samples">
        <li v-for="(s, i) in batch.equivPreview.samples" :key="i">
          <span class="mc-muted"><RichText inline :text="s.stem" /></span><br />
          {{ s.from.join('  ／  ') }} → <AnswerText :answer="s.merged" />
        </li>
      </ul>
      <p class="mc-muted">为什么是合并而不是投票：投票是二选一，会把另一种正确写法判成错；合并是「都接受」。</p>
    </div>

    <template #footer>
      <button class="mc-btn mc-btn--ghost mc-btn--sm" type="button" @click="batch.closeEquiv()">取消</button>
      <button
        class="mc-btn mc-btn--primary mc-btn--sm"
        type="button"
        :disabled="batch.equivLoading || (batch.equivPreview?.groups ?? 0) === 0"
        @click="batch.applyEquivalent()"
      >
        {{ batch.equivLoading ? '处理中…' : '确认合并' }}
      </button>
    </template>
  </AppModal>

  <!-- 批量按多数答案 -->
  <AppModal :open="batch.majorityOpen" title="按多数答案批量处理" width="640px" @close="batch.closeMajority()">
    <div v-if="batch.majorityLoading && !batch.majorityPreview" class="loading">
      <div class="mc-skeleton loading__row" />
    </div>
    <div v-else-if="batch.majorityPreview" class="mc-col majority">
      <p>
        将处理 <strong>{{ batch.majorityPreview.groups }}</strong> 组（共 {{ batch.majorityPreview.questions }} 题）：
        每组采用出现次数最多的答案；<strong>票数并列的 {{ batch.majorityPreview.skipped }} 组不处理</strong
        >，留给人工判断。
      </p>
      <ul v-if="batch.majorityPreview.samples.length > 0" class="majority__samples">
        <li v-for="(s, i) in batch.majorityPreview.samples" :key="i">
          <span class="mc-muted"><RichText inline :text="s.stem" /></span> → 答案「<AnswerText
            :answer="s.answer"
          />」（{{ s.n }} 票）
        </li>
      </ul>
      <p class="mc-muted">此操作会修改题目答案（每次核对都会写审计日志，可在设置里查）。</p>
    </div>

    <template #footer>
      <button class="mc-btn mc-btn--ghost mc-btn--sm" type="button" @click="batch.closeMajority()">取消</button>
      <button
        class="mc-btn mc-btn--primary mc-btn--sm"
        type="button"
        :disabled="batch.majorityLoading || (batch.majorityPreview?.groups ?? 0) === 0"
        @click="batch.applyMajority()"
      >
        {{ batch.majorityLoading ? '处理中…' : '确认执行' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.majority {
  gap: var(--mc-space-3);
}

.majority__samples {
  margin: 0;
  padding-left: 16px;
  max-height: 240px;
  overflow-y: auto;
}

.loading__row {
  height: 72px;
  border-radius: var(--mc-radius);
}
</style>
