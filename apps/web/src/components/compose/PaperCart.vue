<script setup lang="ts">
/**
 * 已选试题（试题篮）：学习通/菁优网式挑题页的右栏。
 *
 * 为什么必须有它：老师挑题时最关心"现在卷子里有多少题、多少分、题型够不够"，
 * 而不是一路挑完才发现少了/多了。主流的做法就是把篮子常驻在右侧，
 * 每加一题它立刻变——这样"随手加入"才成立。
 */
import { computed } from 'vue';
import Icon from '@/components/Icon.vue';
import Tag from '@/components/Tag.vue';
import RichText from '@/components/RichText.vue';

interface CartQuestion {
  id: number;
  type: string;
  stem: string;
  score: number;
}

const props = withDefaults(
  defineProps<{
    questions: CartQuestion[];
    typeLabel: (type: string) => string;
    busy?: boolean;
  }>(),
  { busy: false },
);

const emit = defineEmits<{
  remove: [id: number];
  /** 去排卷（进入第 3 步） */
  next: [];
  /** 清空试卷 */
  clear: [];
}>();

const totalScore = computed(() => props.questions.reduce((sum, q) => sum + (Number(q.score) || 0), 0));

const byType = computed(() => {
  const map = new Map<string, number>();
  for (const q of props.questions) map.set(q.type, (map.get(q.type) ?? 0) + 1);
  return [...map.entries()].map(([type, count]) => ({ type, count }));
});
</script>

<template>
  <aside class="cart mc-card">
    <div class="cart__head">
      <Icon name="list" :size="16" />
      <span class="mc-card__title">已选试题</span>
      <span class="mc-spacer" />
      <button v-if="questions.length > 0" class="mc-btn mc-btn--ghost mc-btn--sm" type="button" @click="emit('clear')">
        清空
      </button>
    </div>

    <div class="cart__stats">
      <div class="cart__stat">
        <span class="cart__num">{{ questions.length }}</span>
        <span class="mc-muted">题</span>
      </div>
      <div class="cart__stat">
        <span class="cart__num">{{ Math.round(totalScore * 10) / 10 }}</span>
        <span class="mc-muted">分</span>
      </div>
    </div>

    <div v-if="byType.length > 0" class="cart__types">
      <Tag v-for="t in byType" :key="t.type" size="sm">{{ typeLabel(t.type) }} {{ t.count }}</Tag>
    </div>

    <div v-if="questions.length === 0" class="cart__empty mc-muted">
      还没有选题。在中间列表点「加入」，或用「全选筛选结果」一次加一批。
    </div>

    <ol v-else class="cart__list">
      <li v-for="(q, i) in questions" :key="q.id" class="cart__item">
        <span class="cart__no">{{ i + 1 }}</span>
        <RichText inline class="cart__stem" :text="q.stem" />
        <span class="cart__score">{{ Math.round((Number(q.score) || 0) * 10) / 10 }} 分</span>
        <button class="cart__del" type="button" :aria-label="`移出第 ${i + 1} 题`" @click="emit('remove', q.id)">
          <Icon name="close" :size="14" />
        </button>
      </li>
    </ol>

    <div class="cart__foot">
      <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" :disabled="busy" @click="emit('next')">
        去排卷与导出
        <Icon name="arrow-right" :size="15" />
      </button>
    </div>
  </aside>
</template>

<style scoped>
.cart {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding: var(--mc-space-3);
  position: sticky;
  top: var(--mc-space-2);
  max-height: calc(100vh - 220px);
}

.cart__head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cart__stats {
  display: flex;
  gap: var(--mc-space-4);
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius);
  background: var(--mc-primary-soft);
}

.cart__stat {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.cart__num {
  font-size: var(--mc-text-2xl);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-primary-fg);
  font-variant-numeric: tabular-nums;
}

.cart__types {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.cart__empty {
  padding: var(--mc-space-3);
  font-size: var(--mc-text-xs);
  border: 1px dashed var(--mc-border);
  border-radius: var(--mc-radius);
}

.cart__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
  flex: 1;
  min-height: 80px;
}

.cart__item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-sunken);
}

.cart__no {
  width: 18px;
  height: 18px;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-elevated);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  flex: none;
}

.cart__stem {
  flex: 1;
  min-width: 0;
  font-size: var(--mc-text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cart__score {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
  flex: none;
}

.cart__del {
  border: none;
  background: none;
  cursor: pointer;
  color: var(--mc-text-muted);
  display: inline-flex;
  padding: 0;
  flex: none;
}

.cart__del:hover {
  color: var(--mc-danger-fg);
}

.cart__foot {
  display: flex;
  justify-content: flex-end;
  padding-top: var(--mc-space-1);
  border-top: 1px solid var(--mc-border);
}
</style>
