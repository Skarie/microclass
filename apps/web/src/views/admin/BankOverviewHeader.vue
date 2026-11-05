<script setup lang="ts">
/**
 * 题库页顶部 KPI 卡片（从 BankAdminView 抽出）：
 * 题库总数 / 题目总量 / 未关联课程 / 待补答案。
 */
defineProps<{
  binding: { banks: number; bound: number; unbound: number };
  questionTotal: number | null;
  emptyAnswer: number | null;
}>();

const emit = defineEmits<{ 'pick-unbound': [] }>();
</script>

<template>
  <div class="kpi">
    <div class="kpi__card">
      <div class="kpi__label">题库总数</div>
      <div class="kpi__value">{{ binding.banks.toLocaleString() }}</div>
      <div class="kpi__sub mc-muted">
        已关联 {{ binding.bound.toLocaleString() }} · 未关联
        {{ binding.unbound.toLocaleString() }}
      </div>
    </div>
    <div class="kpi__card">
      <div class="kpi__label">题目总量</div>
      <div class="kpi__value">{{ questionTotal === null ? '—' : questionTotal.toLocaleString() }}</div>
      <div class="kpi__sub mc-muted">全部题库合计</div>
    </div>
    <button class="kpi__card kpi__card--action" type="button" @click="emit('pick-unbound')">
      <div class="kpi__label">未关联课程</div>
      <div class="kpi__value">{{ binding.unbound.toLocaleString() }}</div>
      <div class="kpi__sub mc-muted">点这里看未关联题库 →</div>
    </button>
    <div class="kpi__card">
      <div class="kpi__label">待补答案</div>
      <div class="kpi__value">{{ emptyAnswer === null ? '—' : emptyAnswer.toLocaleString() }}</div>
      <div class="kpi__sub mc-muted">答案册未覆盖，需补齐</div>
    </div>
  </div>
</template>

<style scoped>
.kpi {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--mc-space-4);
}

.kpi__card {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  padding: var(--mc-space-4) var(--mc-space-5);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-md);
  background: var(--mc-bg-elevated);
  box-shadow: none;
  text-align: left;
}

.kpi__card--action {
  cursor: pointer;
  font: inherit;
  color: inherit;
  transition:
    border-color var(--mc-transition),
    background-color var(--mc-transition);
}

.kpi__card--action:hover {
  border-color: var(--mc-primary-border);
  background: var(--mc-primary-soft);
}

.kpi__label {
  font-size: var(--mc-text-sm);
  color: var(--mc-text-muted);
}

.kpi__value {
  font-size: var(--mc-text-2xl);
  font-weight: var(--mc-font-semibold);
  line-height: var(--mc-leading-display);
  font-variant-numeric: tabular-nums;
}

.kpi__sub {
  font-size: var(--mc-text-xs);
}

/* 移动端：KPI 两列排，避免四张全宽卡片把题目列表挤到三屏之后 */
@media (max-width: 640px) {
  .kpi {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--mc-space-3);
  }

  .kpi__card {
    padding: var(--mc-space-3) var(--mc-space-4);
  }
}
</style>
