<script setup lang="ts">
/**
 * 同题不同答案核对页。
 *
 * 数据口径：题干 + 选项完全相同（同一内容指纹）但答案不一致的题组。
 * 这类题不能像重复题那样自动删——不知道该信哪个答案，必须人来定：
 *   1. 逐组核对：看组内每道题来自哪个题库/册次，选定一个答案，整组统一；
 *   2. 批量按多数答案：一组里出现次数最多的答案即选定值（票数并列的不猜，留人工）；
 *   3. 忽略：确认「答案不同是合理的」，不再出现在待核对列表（题目保持原样）。
 *
 * 页面只做编排：台账列表 / 逐组核对 / 批量处理在 composables/use-question-conflicts.ts、
 * use-conflict-detail.ts、use-conflict-batch.ts，界面按区块拆到 ./conflicts/*，
 * 两个批量弹窗收口在 ConflictBatchModals。
 */
import { onMounted } from 'vue';
import Icon from '@/components/Icon.vue';
import PageHeader from '@/components/PageHeader.vue';
import ConflictTabs from './conflicts/ConflictTabs.vue';
import ConflictGroupList from './conflicts/ConflictGroupList.vue';
import ConflictDetailModal from './conflicts/ConflictDetailModal.vue';
import ConflictBatchModals from './conflicts/ConflictBatchModals.vue';
import { useQuestionConflicts, type ConflictGroup } from '@/composables/use-question-conflicts';
import { useConflictDetail } from '@/composables/use-conflict-detail';
import { useConflictBatch } from '@/composables/use-conflict-batch';

const list = useQuestionConflicts();
const detail = useConflictDetail({ reload: list.load });
const batch = useConflictBatch({ reload: list.load });

/** 列表里点「核对 / 查看」：打开逐组核对弹窗 */
function openGroup(group: ConflictGroup): void {
  void detail.openDetail(group);
}

/** 批量入口都先预演（dryRun），弹窗里确认后才落库 */
function openMajority(): void {
  void batch.previewMajority();
}

function openEquivalent(): void {
  void batch.previewEquivalent();
}

/** 手动重新扫描全库（唯一会扫全库的入口，按钮上已提示可能较慢） */
function rescan(): void {
  void list.rescan();
}

onMounted(() => void list.load());
</script>

<template>
  <div class="mc-col conflict">
    <PageHeader
      title="同题不同答案核对"
      description="题干与选项完全相同、但答案不一致的题组。系统不会自动删改，请看清题目来源后选定一个答案，或确认「答案不同是合理的」后忽略；同一答案的不同写法可以一键合并成「两种写法都算对」。"
      icon="conflict"
      :breadcrumb="[{ label: '首页', to: '/' }, { label: '教学管理' }, { label: '冲突题核对' }]"
    >
      <template #actions>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="list.scanning" @click="rescan">
          {{ list.scanning ? '扫描中（全库分组，冷缓存可能要几分钟）…' : '重新扫描全库' }}
        </button>
        <button class="mc-btn mc-btn--sm" type="button" @click="openEquivalent">合并同义写法</button>
        <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click="openMajority">
          按多数答案批量处理
        </button>
      </template>
    </PageHeader>

    <p v-if="list.staleHint" class="stale" :class="{ 'stale--strong': list.data?.total === 0 }">
      <Icon name="alert" :size="16" /> {{ list.staleHint }}
    </p>

    <ConflictTabs :list="list" />

    <div v-if="list.loading && !list.data" class="loading"><div class="mc-skeleton loading__row" /></div>

    <ConflictGroupList v-else-if="list.data" :list="list" @open="openGroup" />

    <!-- 逐组核对 -->
    <ConflictDetailModal :detail="detail" />

    <!-- 批量：合并同义写法 / 按多数答案 -->
    <ConflictBatchModals :batch="batch" />
  </div>
</template>

<style scoped>
.conflict {
  gap: var(--mc-space-4);
}

.stale {
  margin: 0;
  padding: var(--mc-space-3) var(--mc-space-4);
  border: 1px solid var(--mc-warning);
  border-radius: var(--mc-radius);
  background: var(--mc-warning-soft);
  font-size: var(--mc-text-sm);
}

.stale--strong {
  font-weight: var(--mc-font-semibold);
}

.loading__row {
  height: 72px;
  border-radius: var(--mc-radius);
}
</style>
