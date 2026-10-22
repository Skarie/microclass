<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import BarList from '@/components/charts/BarList.vue';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import Tag from '@/components/Tag.vue';
import type { BarItem } from '@/components/charts/types';
import { MASTERY_ICON, MASTERY_LABEL, MASTERY_TONE, pct, type PointsResponse } from './analytics-types';

/**
 * 知识点掌握度页签：条形榜按错误量排序，点一行展开该知识点的典型错题。
 * 同时只展开一个，避免页面过长。
 */
const props = defineProps<{ points: PointsResponse | null; bars: BarItem[] }>();

const expanded = ref<string | null>(null);
const expandedPoints = computed(() => (props.points?.points ?? []).filter((p) => p.point === expanded.value));

/** 点条形榜某一行 → 展开/收起它的典型错题，并滚动定位到详情 */
function onPointSelect(key: string | number): void {
  const point = String(key);
  expanded.value = expanded.value === point ? null : point;
  void nextTick(() => {
    document.querySelector('.ana__detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}
</script>

<template>
  <div class="mc-card ana__panel">
    <template v-if="points && points.points.length > 0">
      <div class="mc-card__title-row">
        <span class="mc-card__title">薄弱知识点优先（条长 = 错误量，颜色 = 掌握度）</span>
        <span class="mc-muted ana__titlehint">点一行展开典型错题</span>
      </div>
      <BarList :items="bars" :limit="15" clickable caption="知识点掌握度条形榜" @select="onPointSelect" />
      <div v-for="p in expandedPoints" :key="`d-${p.point}`" class="ana__detail">
        <div class="mc-label">
          <Icon :name="MASTERY_ICON[p.mastery]" :size="14" />
          {{ p.point }} 的典型错题
          <Tag :tone="MASTERY_TONE[p.mastery]" size="sm">{{ MASTERY_LABEL[p.mastery] }}</Tag>
          <span class="mc-muted">{{ p.wrong }} 错 / {{ p.graded }} 作答 · 正确率 {{ pct(p.accuracy) }}</span>
        </div>
        <ul class="ana__wronglist">
          <li v-for="q in p.topWrong" :key="q.question_id">
            <span class="mc-muted">#{{ q.question_id }}</span>
            <RichText inline :text="q.stem" />
            <em class="mc-muted">（{{ q.graded }} 次作答错 {{ q.wrong }} 次）</em>
          </li>
          <li v-if="p.topWrong.length === 0" class="mc-muted">还没有错题记录</li>
        </ul>
      </div>
      <p class="mc-hint">{{ points.dataNote }}</p>
    </template>
    <EmptyState
      v-else
      icon="target"
      title="还没有知识点维度的作答数据"
      description="需要两件事：题目先设置「知识点」，学员再做过这些题（课后练习或考试）。"
    />
  </div>
</template>

<style scoped>
/* 卡片内边距：直接在 .mc-card 里放内容，没有走 __header/__body，必须自己留白 */
.ana__panel {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding: var(--mc-space-6);
}

.ana__detail td {
  background: var(--mc-bg-sunken);
}

.ana__wronglist {
  margin: var(--mc-space-1) 0 0;
  padding-left: 1.2em;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--mc-text-sm);
}

/* 标题行：标题 + 灰度说明，宽屏同行，窄屏换行，绝不再贴边 */
.mc-card__title-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--mc-space-1) var(--mc-space-3);
  margin-bottom: var(--mc-space-3);
}

.mc-card__title-row .mc-card__title {
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-semibold);
  line-height: var(--mc-leading-snug);
}

/* 标题旁说明文字：次要色、小一号、可换行 */
.ana__titlehint {
  font-size: var(--mc-text-sm);
  line-height: var(--mc-leading-snug);
}

@media (max-width: 720px) {
  .ana__panel {
    padding: var(--mc-space-4);
  }
}
</style>
