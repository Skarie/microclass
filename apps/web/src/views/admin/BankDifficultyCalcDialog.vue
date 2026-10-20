<script setup lang="ts">
/**
 * 重算难度弹窗（从 BankAdminView 抽出）：先预览「算完之后的结构」再确认执行。
 * 预览数据与执行由父组件负责，这里只渲染与触发。
 */
import AppModal from '@/components/AppModal.vue';
import RichText from '@/components/RichText.vue';
import type { DifficultyPreview } from './bankTypes';

/** 三档难度中文名 */
const DIFFICULTY_LABEL: Record<string, string> = { easy: '基础', medium: '中等', hard: '较难' };
/** 难度来源中文名 */
const SOURCE_LABEL: Record<string, string> = {
  auto: '模型先验',
  calibrated: '作答校准',
  manual: '人工标注',
  unknown: '未评估',
};

defineProps<{
  open: boolean;
  busy: boolean;
  scopeAll: boolean;
  bankName: string;
  preview: DifficultyPreview | null;
}>();

const emit = defineEmits<{ close: []; apply: []; 'toggle-scope': [] }>();
</script>

<template>
  <AppModal :open="open" title="重算难度" width="760px" @close="emit('close')">
    <div v-if="busy && !preview" class="loading"><div class="mc-skeleton loading__row" /></div>
    <div v-else-if="preview" class="mc-col diff-preview">
      <label class="mc-row diff-preview__scope">
        <input :checked="scopeAll" type="checkbox" @change="emit('toggle-scope')" />
        <span>重算<strong>全库</strong>难度（当前{{ bankName ? `题库「${bankName}」` : '' }}）</span>
      </label>

      <p>
        将评估 <strong>{{ preview.willScore }}</strong> 道题（共 {{ preview.total }} 道）； 保留<strong
          >人工标注</strong
        >
        {{ preview.skippedManual }} 道、<strong>已校准</strong> {{ preview.skippedCalibrated }} 道不动。
      </p>
      <p class="mc-muted">
        判定方式（主流做法）：内容特征先验（学段年级、题型、算式与公式复杂度、小问数、题干阅读量、看图、高阶目标动词、
        卷型与知识点标注）→ 0–100 分 → 按**分位数**分档，保证结构合理。作答数据积累后会再做一次校准。
      </p>

      <div class="diff-preview__grid">
        <div>
          <div class="mc-label">算完之后的三档结构</div>
          <p v-for="b in preview.predicted.buckets" :key="b.difficulty" class="mc-muted">
            {{ DIFFICULTY_LABEL[b.difficulty] ?? b.difficulty }}：{{ b.questions }} 题（{{ b.ratio }}%）
          </p>
          <div class="mc-label">五级口径</div>
          <p v-for="l in preview.predicted.levels" :key="l.level" class="mc-muted">
            {{ l.level }}★ {{ l.label }}：{{ l.questions }} 题（{{ l.ratio }}%）
          </p>
        </div>
        <div>
          <div class="mc-label">当前库里已有的</div>
          <p v-for="b in preview.current.buckets" :key="b.difficulty" class="mc-muted">
            {{ DIFFICULTY_LABEL[b.difficulty] ?? b.difficulty }}：{{ b.questions }} 题
          </p>
          <p class="mc-muted">
            来源：
            <span v-for="s in preview.current.sources" :key="s.source">
              {{ SOURCE_LABEL[s.source] ?? s.source }} {{ s.questions }}
            </span>
          </p>
          <p class="mc-muted">
            阈值：基础 &lt; {{ preview.cuts.easyMax }} 分｜中档 &lt; {{ preview.cuts.mediumMax }} 分｜其余为较难
          </p>
        </div>
      </div>

      <div class="mc-label">抽查：模型认为最容易 / 最难的题</div>
      <ul class="diff-preview__samples">
        <li v-for="s in preview.samples.easiest" :key="`e${s.id}`">
          <span class="diff-preview__score">{{ s.score }}</span>
          <RichText class="stem__text" :text="s.stem" />
        </li>
        <li v-for="s in preview.samples.hardest" :key="`h${s.id}`" class="diff-preview__sample--hard">
          <span class="diff-preview__score">{{ s.score }}</span>
          <RichText class="stem__text" :text="s.stem" />
          <span class="mc-muted">{{ s.reasons }}</span>
        </li>
      </ul>
    </div>

    <template #footer>
      <button class="mc-btn mc-btn--ghost" type="button" @click="emit('close')">取消</button>
      <button class="mc-btn mc-btn--primary" type="button" :disabled="busy" @click="emit('apply')">
        {{ busy ? '重算中…' : '确认重算' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.diff-preview {
  gap: var(--mc-space-3);
}

.diff-preview__scope {
  gap: var(--mc-space-2);
  align-items: center;
}

.diff-preview__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--mc-space-4);
}

.diff-preview__samples {
  margin: 0;
  padding-left: 0;
  list-style: none;
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.diff-preview__score {
  min-width: 32px;
  font-variant-numeric: tabular-nums;
  color: var(--mc-text-secondary, inherit);
}

.loading {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  padding: var(--mc-space-4);
}

.loading__row {
  height: 44px;
}
</style>
