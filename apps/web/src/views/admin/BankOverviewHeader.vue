<script setup lang="ts">
/**
 * 题库页顶部（从 BankAdminView 抽出）：
 * 四张 KPI 卡 + 「按册次挂到课程」弹窗。
 */
import AppModal from '@/components/AppModal.vue';

interface CourseOption {
  id: number;
  name: string;
}

defineProps<{
  binding: { banks: number; bound: number; unbound: number };
  questionTotal: number | null;
  emptyAnswer: number | null;
  bindBookTarget: { book: string; bankCount: number } | null;
  bindCourseId: number | '';
  courses: CourseOption[];
  bindingBook: boolean;
}>();

const emit = defineEmits<{
  'pick-unbound': [];
  'close-bind': [];
  'confirm-bind': [];
  'update:bindCourseId': [number | ''];
}>();
</script>

<template>
  <div class="kpi">
    <div class="kpi__card">
      <div class="kpi__label">题库总数</div>
      <div class="kpi__value">{{ binding.banks.toLocaleString() }}</div>
      <div class="kpi__sub mc-muted">
        已归属 {{ binding.bound.toLocaleString() }} · 未归属
        {{ binding.unbound.toLocaleString() }}
      </div>
    </div>
    <div class="kpi__card">
      <div class="kpi__label">题目总量</div>
      <div class="kpi__value">{{ questionTotal === null ? '—' : questionTotal.toLocaleString() }}</div>
      <div class="kpi__sub mc-muted">全部题库合计</div>
    </div>
    <button class="kpi__card kpi__card--action" type="button" @click="emit('pick-unbound')">
      <div class="kpi__label">未归属课程</div>
      <div class="kpi__value">{{ binding.unbound.toLocaleString() }}</div>
      <div class="kpi__sub mc-muted">点这里按册次归类 →</div>
    </button>
    <div class="kpi__card">
      <div class="kpi__label">待补答案</div>
      <div class="kpi__value">{{ emptyAnswer === null ? '—' : emptyAnswer.toLocaleString() }}</div>
      <div class="kpi__sub mc-muted">答案册未覆盖，需补齐</div>
    </div>
  </div>

  <AppModal :open="bindBookTarget !== null" title="按册次挂到课程" width="520px" @close="emit('close-bind')">
    <div class="mc-col bindbook">
      <p class="bindbook__lead">
        把「{{ bindBookTarget?.book }}」下的
        <strong>{{ bindBookTarget?.bankCount ?? 0 }}</strong>
        个未归属题库挂到：
      </p>
      <select
        :value="bindCourseId"
        @change="emit('update:bindCourseId', Number(($event.target as HTMLSelectElement).value) || '')"
        class="mc-select"
        aria-label="选择课程"
      >
        <option value="">请选择课程…</option>
        <option v-for="c in courses" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <p class="mc-muted bindbook__hint">
        只会影响该册次下<strong>尚未归属</strong>的题库；已经挂在其它课程下的题库不会被改动。
      </p>
    </div>
    <template #footer>
      <div class="mc-spacer" />
      <button class="mc-btn mc-btn--sm" type="button" @click="emit('close-bind')">取消</button>
      <button
        class="mc-btn mc-btn--sm mc-btn--primary"
        type="button"
        :disabled="bindingBook || bindCourseId === ''"
        @click="emit('confirm-bind')"
      >
        {{ bindingBook ? '挂载中…' : '确认挂载' }}
      </button>
    </template>
  </AppModal>
</template>
