<script setup lang="ts">
/**
 * 难度划分面板（从 BankAdminView 抽出）：
 * 三档 / 五级 / 来源分布 + 重算与按作答校准入口。
 * 只负责展示与触发，数据处理留在父组件。
 */
/** 三档难度中文名 */
const DIFFICULTY_LABEL: Record<string, string> = { easy: '基础', medium: '中等', hard: '较难' };

/** 难度来源的中文名（与后端返回的 source 值一一对应） */
const SOURCE_LABEL: Record<string, string> = {
  auto: '模型先验',
  calibrated: '作答校准',
  manual: '人工标注',
  unknown: '未评估',
};

defineProps<{
  difficulty: {
    buckets: { difficulty: string; questions: number }[];
    levels: { level: number; questions: number }[];
    sources: { source: string; questions: number }[];
    unscored: number;
  };
  totalQuestions: number;
  busy: boolean;
}>();

const emit = defineEmits<{ recalc: []; calibrate: [] }>();

/** 百分比（与体检弹窗其它统计口径一致） */
function pct(part: number, total: number): string {
  if (!total) return '0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}
</script>

<template>
  <div class="health__rows difficulty-panel">
    <div class="difficulty-panel__head">
      <span class="mc-card__title">难度划分</span>
      <span class="mc-muted"> 模型先验（内容特征）+ 作答数据校准 + 人工优先，阈值按分位数自动定 </span>
      <button class="mc-btn mc-btn--sm" type="button" @click="emit('recalc')">重算难度</button>
      <button class="mc-btn mc-btn--sm" type="button" :disabled="busy" @click="emit('calibrate')">按作答校准</button>
    </div>
    <p class="mc-muted">
      三档：
      <span v-for="b in difficulty.buckets" :key="b.difficulty" class="health__kind">
        {{ DIFFICULTY_LABEL[b.difficulty] ?? b.difficulty }} {{ b.questions }} （{{
          pct(b.questions, totalQuestions)
        }}）
      </span>
    </p>
    <p class="mc-muted">
      五级：
      <span v-for="l in difficulty.levels" :key="l.level" class="health__kind">
        {{ l.level === 0 ? '未评估' : `${l.level}★` }} {{ l.questions }}
      </span>
    </p>
    <p class="mc-muted">
      来源：
      <span v-for="s in difficulty.sources" :key="s.source" class="health__kind">
        {{ SOURCE_LABEL[s.source] ?? s.source }} {{ s.questions }}
      </span>
      <span v-if="difficulty.unscored > 0" class="health__kind"> · 未算过 {{ difficulty.unscored }} 题 </span>
    </p>
  </div>
</template>

<style scoped>
.difficulty-panel {
  gap: var(--mc-space-2);
  padding-top: var(--mc-space-3);
  border-top: 1px dashed var(--mc-border);
}

.difficulty-panel__head {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
}

.difficulty-panel__head .mc-card__title {
  margin-right: auto;
}
</style>
