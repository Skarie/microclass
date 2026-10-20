<script setup lang="ts">
/**
 * 题库体检弹窗（从 BankAdminView 抽出）：
 * 指标卡、难度划分、元数据覆盖、重复题表与刷新/关闭操作。
 * 数据由父组件查询后传入，这里只负责展示与触发。
 */
import { RouterLink } from 'vue-router';
import AppModal from '@/components/AppModal.vue';
import RichText from '@/components/RichText.vue';
import BankDifficultyPanel from './BankDifficultyPanel.vue';
import type { BankHealth } from './bankTypes';

/** 题库类型中文名 */
const KIND_LABEL: Record<string, string> = {
  chapter: '章节题库',
  lesson: '课时配套',
  paper: '整卷试卷',
};

defineProps<{
  open: boolean;
  health: BankHealth;
  loading: boolean;
  diffBusy: boolean;
}>();

const emit = defineEmits<{
  close: [];
  refresh: [];
  'show-media-only': [];
  recalc: [];
  calibrate: [];
}>();

function pct(part: number, total: number): string {
  if (!total) return '0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}
</script>

<template>
  <AppModal :open="open" :title="`题库体检（${health?.scope.name ?? '全库'}）`" width="920px" @close="emit('close')">
    <div v-if="loading && !health" class="loading"><div class="mc-skeleton loading__row" /></div>
    <div v-else-if="health" class="mc-col health__body">
      <div class="mc-grid mc-grid--stats">
        <div class="metric">
          <div class="metric__value">{{ health.stats.total }}</div>
          <div class="mc-muted">题目总量</div>
        </div>
        <div class="metric">
          <div class="metric__value">{{ health.stats.duplicateGroups }}</div>
          <div class="mc-muted">重复题分组（{{ health.stats.duplicateQuestions }} 题）</div>
        </div>
        <div class="metric">
          <div class="metric__value">{{ health.stats.conflictGroups }}</div>
          <div class="mc-muted">
            同题不同答案
            <RouterLink v-if="health.stats.conflictGroups > 0" class="metric__link" to="/admin/question-conflicts">
              去核对 →
            </RouterLink>
          </div>
        </div>
        <div class="metric">
          <div class="metric__value">{{ health.stats.withImage }}</div>
          <div class="mc-muted">带配图（{{ pct(health.stats.withImage, health.stats.total) }}）</div>
        </div>
        <div class="metric" :class="{ 'metric--warn': health.stats.mediaOnlyAnalysis > 0 }">
          <div class="metric__value">{{ health.stats.mediaOnlyAnalysis }}</div>
          <div class="mc-muted">
            解析只有图片
            <button
              v-if="health.stats.mediaOnlyAnalysis > 0"
              class="metric__link metric__link--btn"
              type="button"
              @click="emit('show-media-only')"
            >
              筛出来看 →
            </button>
          </div>
        </div>
        <div class="metric">
          <div class="metric__value">{{ health.stats.missingDifficulty }}</div>
          <div class="mc-muted">未标难度（旧的粗标）</div>
        </div>
      </div>

      <BankDifficultyPanel
        v-if="health.difficulty"
        :difficulty="health.difficulty"
        :total-questions="health.stats.total"
        :busy="diffBusy"
        @recalc="emit('recalc')"
        @calibrate="emit('calibrate')"
      />

      <div class="health__rows">
        <p class="mc-muted">
          标准化元数据覆盖率：学科 {{ pct(health.metadata.withSubject, health.stats.total) }}｜ 书册
          {{ pct(health.metadata.withBook, health.stats.total) }}｜ 知识点
          {{ pct(health.metadata.withPoint, health.stats.total) }}｜ 内容指纹
          {{ pct(health.metadata.withHash, health.stats.total) }}
        </p>
        <p class="mc-muted">
          题库类型：
          <span v-for="k in health.kinds" :key="k.kind" class="health__kind">
            {{ KIND_LABEL[k.kind] ?? k.kind }} {{ k.banks }} 个 / {{ k.questions }} 题
          </span>
        </p>
      </div>

      <div v-if="health.duplicates.length > 0" class="mc-table-wrap table-wrap">
        <table class="mc-table mc-table--compact">
          <thead>
            <tr>
              <th>重复题（题干）</th>
              <th>出现次数</th>
              <th>答案种类</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in health.duplicates" :key="d.content_hash">
              <td><RichText class="stem__text" :text="d.stem" /></td>
              <td>{{ d.n }}</td>
              <td>
                <span class="mc-badge" :class="d.answers > 1 ? 'mc-badge--danger' : ''">{{ d.answers }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <template #footer>
      <span v-if="health" class="mc-muted">共 {{ health.stats.total }} 题</span>
      <div class="mc-spacer" />
      <button class="mc-btn mc-btn--sm" type="button" :disabled="loading" @click="emit('refresh')">重新统计</button>
      <button class="mc-btn mc-btn--sm mc-btn--primary" type="button" @click="emit('close')">关闭</button>
    </template>
  </AppModal>
</template>

<style scoped>
.metric__link {
  margin-left: 8px;
  color: var(--mc-primary-fg);
  white-space: nowrap;
}

.metric__link--btn {
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
}

.table-wrap {
  max-height: 52vh;
  overflow: auto;
}
</style>
