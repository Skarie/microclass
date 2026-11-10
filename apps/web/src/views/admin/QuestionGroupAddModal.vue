<script setup lang="ts">
/**
 * 向题组加入题目（题组详情右上角「加入题目」）。
 *
 * 流程：选题库 → 搜题干 → 勾选 → 选角色（母题 / 变式）→ 加入。
 * 只显示当前题库的前 50 题（关键词可继续缩小范围），避免一次拉整本题库；
 * 「已在组内」的题直接标出来，避免老师重复添加后以为是没生效。
 */
import { computed, ref, watch } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import AppModal from '@/components/AppModal.vue';
import RichText from '@/components/RichText.vue';
import { QUESTION_GROUP_ROLES, ROLE_LABEL, type QuestionGroupRole } from '@/api/question-group';
import type { Bank, QuestionView } from '@/api/types';

const props = defineProps<{
  open: boolean;
  /** 组内已有的题目 id：勾选框标成「已在组内」 */
  inGroup: number[];
  saving: boolean;
}>();

const emit = defineEmits<{
  close: [];
  submit: [questionIds: number[], role: QuestionGroupRole];
}>();

const toast = useToastStore();
const banks = ref<Bank[]>([]);
const bankId = ref<number | null>(null);
const keyword = ref('');
const questions = ref<QuestionView[]>([]);
const total = ref(0);
const loading = ref(false);
const selected = ref<number[]>([]);
const role = ref<QuestionGroupRole>('variant');

const selectedSet = computed(() => new Set(selected.value));
const inGroupSet = computed(() => new Set(props.inGroup));
const bankOptions = computed(() => banks.value.map((bank) => ({ id: bank.id, name: bank.name })));

async function loadBanks(): Promise<void> {
  try {
    const res = await api.get<{ banks: Bank[] }>('/banks', { limit: 300 });
    banks.value = res.banks;
    if (bankId.value === null && res.banks.length > 0) bankId.value = res.banks[0]?.id ?? null;
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

async function loadQuestions(): Promise<void> {
  const id = bankId.value;
  if (id === null) {
    questions.value = [];
    total.value = 0;
    return;
  }
  loading.value = true;
  try {
    const res = await api.get<{ total: number; questions: QuestionView[] }>(`/banks/${id}/questions`, {
      pageSize: 50,
      ...(keyword.value.trim() === '' ? {} : { keyword: keyword.value.trim() }),
    });
    questions.value = res.questions;
    total.value = res.total;
  } catch (e) {
    toast.error(errorMessage(e));
    questions.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    selected.value = [];
    role.value = 'variant';
    keyword.value = '';
    if (banks.value.length === 0) void loadBanks().then(() => loadQuestions());
    else void loadQuestions();
  },
);

watch(bankId, () => void loadQuestions());

function toggle(id: number): void {
  if (inGroupSet.value.has(id)) return;
  selected.value = selectedSet.value.has(id) ? selected.value.filter((x) => x !== id) : [...selected.value, id];
}

function submit(): void {
  if (selected.value.length === 0) {
    toast.warning('请先勾选要加入的题目');
    return;
  }
  emit('submit', selected.value, role.value);
}
</script>

<template>
  <AppModal
    :open="open"
    title="加入题目"
    description="从题库里挑题加入本组：第一道通常是母题，其余是变式。"
    width="760px"
    @close="emit('close')"
  >
    <div class="mc-col">
      <div class="qga__bar">
        <label class="qga__field">
          <span class="mc-label">题库</span>
          <select v-model.number="bankId" class="mc-select" aria-label="选择题库">
            <option v-for="bank in bankOptions" :key="bank.id" :value="bank.id">{{ bank.name }}</option>
          </select>
        </label>
        <label class="qga__field qga__field--grow">
          <span class="mc-label">搜索题干</span>
          <input
            v-model.trim="keyword"
            class="mc-input"
            type="search"
            placeholder="输入关键词后回车"
            aria-label="搜索题干关键词"
            @keyup.enter="loadQuestions"
          />
        </label>
        <label class="qga__field">
          <span class="mc-label">加入为</span>
          <select v-model="role" class="mc-select" aria-label="加入角色">
            <option v-for="item in QUESTION_GROUP_ROLES" :key="item" :value="item">{{ ROLE_LABEL[item] }}</option>
          </select>
        </label>
      </div>

      <p v-if="banks.length === 0" class="mc-muted">还没有题库，先去「题目」视图新建题库并导入题目。</p>

      <div v-else-if="loading" class="qga__list">
        <div v-for="i in 5" :key="i" class="mc-skeleton qga__skeleton" />
      </div>

      <p v-else-if="questions.length === 0" class="mc-muted">这个题库里没有匹配的题目，换个关键词或换题库试试。</p>

      <ul v-else class="qga__list">
        <li v-for="question in questions" :key="question.id" class="qga__row">
          <label class="qga__pick">
            <input
              type="checkbox"
              :checked="selectedSet.has(question.id) || inGroupSet.has(question.id)"
              :disabled="inGroupSet.has(question.id)"
              :aria-label="`选择题目 ${question.id}`"
              @change="toggle(question.id)"
            />
          </label>
          <div class="qga__stem">
            <RichText :text="question.stem" />
          </div>
          <span v-if="inGroupSet.has(question.id)" class="mc-badge">已在组内</span>
        </li>
      </ul>

      <p v-if="questions.length > 0" class="mc-hint">
        共 {{ total }} 题匹配，这里只列出前 50 题（可用关键词继续缩小范围）。
      </p>
    </div>

    <template #footer>
      <span class="mc-muted qga__count">已勾选 {{ selected.length }} 题</span>
      <button class="mc-btn" type="button" @click="emit('close')">取消</button>
      <button class="mc-btn mc-btn--primary" type="button" :disabled="saving || selected.length === 0" @click="submit">
        {{ saving ? '加入中…' : `加入 ${selected.length} 题` }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped src="./question-group-add.css"></style>
