<script setup lang="ts">
/**
 * 错题本 = 学习通式单题流：固定题头 + 单题卡片 + 题下操作 + 右侧答题卡/移动抽屉。
 * 取列表/筛选/看解析/标记掌握/移除在 use-wrong-book；单题渲染与答题卡复用 views/quiz/*。
 */
import { computed, ref } from 'vue';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import Tag from '@/components/Tag.vue';
import QuizFlowHeader from './quiz/QuizFlowHeader.vue';
import QuizStage from './quiz/QuizStage.vue';
import WrongBookActions from './wrongbook/WrongBookActions.vue';
import WrongBookFilter from './wrongbook/WrongBookFilter.vue';
import { useWrongBook } from '@/composables/use-wrong-book';

const wb = useWrongBook();
const filtersOpen = ref(false);

/** 生效中的筛选项数量（掌握状态 + 题型 + 关键词），显示在「筛选」按钮上 */
const filterCount = computed(
  () => (wb.includeMastered ? 1 : 0) + (wb.typeFilter !== '' ? 1 : 0) + (wb.keyword.trim() !== '' ? 1 : 0),
);
</script>

<template>
  <section v-if="wb.loading && wb.items.length === 0" class="mc-col">
    <div class="mc-skeleton mc-skeleton--h160" />
    <div class="mc-skeleton mc-skeleton--h320" />
  </section>

  <section v-else class="wb mc-col">
    <QuizFlowHeader
      :back-to="{ name: 'hall' }"
      back-label="课程大厅"
      title="错题本"
      :total="wb.items.length"
      :answered="wb.seenCount"
      answered-label="已看"
      :percent="wb.seenPercent"
      progress-label="错题查看进度"
    >
      <template #badges>
        <span class="wb__badges">
          <Tag tone="warning" size="sm">未掌握 {{ wb.pendingCount }}</Tag>
          <Tag v-if="wb.masteredCount > 0" tone="success" size="sm">已掌握 {{ wb.masteredCount }}</Tag>
        </span>
      </template>

      <template #actions>
        <button
          class="mc-btn mc-btn--sm wb__filter"
          type="button"
          :aria-expanded="filtersOpen"
          @click="filtersOpen = !filtersOpen"
        >
          <Icon name="filter" :size="15" />
          筛选<template v-if="filterCount > 0">（{{ filterCount }}）</template>
        </button>
      </template>
    </QuizFlowHeader>

    <WrongBookFilter
      v-if="filtersOpen"
      v-model:include-mastered="wb.includeMastered"
      v-model:keyword="wb.keyword"
      v-model:type="wb.typeFilter"
      :loading="wb.loading"
      :total="wb.totalCount"
      :pending="wb.pendingCount"
      :mastered="wb.masteredCount"
      :matched="wb.items.length"
      @refresh="wb.refresh()"
    />

    <EmptyState
      v-if="wb.allItems.length === 0"
      icon="target"
      title="错题本是空的"
      description="做课后练习时答错的题目会自动收录到这里，方便反复巩固。"
    />

    <EmptyState
      v-else-if="wb.filteredEmpty"
      icon="search"
      title="没有匹配的错题"
      description="试试更换关键词，或切换为「全部（含已掌握）」查看完整记录。"
    />

    <QuizStage v-else :flow="wb" mode="wrong" :show-count="false" :show-mark="false">
      <template #after-question>
        <WrongBookActions
          v-if="wb.current"
          :item="wb.current"
          :revealed="wb.isRevealed(wb.current.id)"
          :mastered="wb.current.mastered === 1"
          :busy="wb.busyId === wb.current.id"
          @reveal="wb.toggleReveal(wb.current.id)"
          @master="wb.toggleMaster(wb.current)"
          @practice="wb.practice(wb.current)"
          @remove="wb.remove(wb.current)"
        />
      </template>
    </QuizStage>
  </section>
</template>

<style scoped>
.wb__filter {
  white-space: nowrap;
}

.wb__badges {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--mc-space-2);
}

/* 手机题头优先保证「已看 / 进度 / 筛选」一行放得下，统计在答题卡与筛选面板里仍有 */
@media (max-width: 1023px) {
  .wb__badges {
    display: none;
  }
}
</style>
