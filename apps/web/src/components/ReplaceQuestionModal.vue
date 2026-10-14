<script setup lang="ts">
/**
 * 换题候选：把级联匹配到的相似题列出来让老师挑，而不是随机替换。
 *
 * 与旧行为的关系：弹窗里保留「随机换一题」按钮（走原来的 replace 接口），
 * 但默认路径是**看清候选再决定**。
 */
import { computed, ref, watch } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import AppModal from '@/components/AppModal.vue';
import Icon from '@/components/Icon.vue';
import RichText from '@/components/RichText.vue';
import Tag from '@/components/Tag.vue';

interface Candidate {
  id: number;
  stem: string;
  type: string;
  difficulty: string;
  point: string;
  level: number;
  bankName: string;
  levelDelta: number;
  /** 后端在挑题池里带的错率（换题候选接口不一定有，容错处理） */
  attempts?: number;
  error_rate?: number;
}

interface CandidatesResponse {
  current: { id: number; stem: string; type: string; difficulty: string; point: string; level: number };
  groups: { reason: string; candidates: Candidate[] }[];
}

const props = defineProps<{ open: boolean; examId: number; questionId: number | null; busy?: boolean }>();
const emit = defineEmits<{ close: []; replaced: [] }>();

const toast = useToastStore();
const loading = ref(false);
const data = ref<CandidatesResponse | null>(null);
const picking = ref<number | null>(null);

const TYPE_LABEL: Record<string, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  fill: '填空题',
  short: '简答题',
};

const total = computed(() => (data.value?.groups ?? []).reduce((n, g) => n + g.candidates.length, 0));

async function load(): Promise<void> {
  if (!props.open || props.questionId === null) return;
  loading.value = true;
  data.value = null;
  try {
    data.value = await api.get<CandidatesResponse>(`/exams/${props.examId}/questions/${props.questionId}/candidates`, {
      limit: 8,
    });
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.open, props.questionId],
  () => void load(),
);

/** 选用某个候选 */
async function pick(candidate: Candidate): Promise<void> {
  if (props.questionId === null) return;
  picking.value = candidate.id;
  try {
    await api.post(`/exams/${props.examId}/questions/${props.questionId}/replace`, { withId: candidate.id });
    toast.success('已换成挑中的题');
    emit('replaced');
    emit('close');
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    picking.value = null;
  }
}

/** 随机换（保留旧行为：由后端按匹配强度随机取一条） */
async function randomReplace(): Promise<void> {
  if (props.questionId === null) return;
  picking.value = -1;
  try {
    const res = await api.post<{ ok: boolean; reason: string }>(
      `/exams/${props.examId}/questions/${props.questionId}/replace`,
    );
    if (res.ok) toast.success(`已随机换一题（${res.reason}）`);
    else toast.warning(res.reason);
    emit('replaced');
    emit('close');
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    picking.value = null;
  }
}

function pct(v: number | undefined): string {
  if (v === undefined) return '';
  return `${Math.round(v * 100)}%`;
}
</script>

<template>
  <AppModal :open="open" title="换一题 · 挑一个更合适的" width="760px" @close="emit('close')">
    <div v-if="loading" class="loading"><div class="mc-skeleton loading__row" /></div>

    <div v-else-if="data" class="mc-col pick">
      <div class="pick__current">
        <span class="mc-label">当前这道题</span>
        <div class="pick__stem"><RichText inline :text="data.current.stem" /></div>
        <div class="pick__meta">
          <Tag size="sm">{{ TYPE_LABEL[data.current.type] ?? data.current.type }}</Tag>
          <Tag v-if="data.current.point" size="sm" tone="info">{{ data.current.point }}</Tag>
          <Tag size="sm" tone="neutral">难度分 {{ data.current.level }}</Tag>
        </div>
      </div>

      <p v-if="total === 0" class="mc-muted">题池里没有可替换的同类型题目（试试放宽筛选范围，或到题库里补题）。</p>

      <div v-for="group in data.groups" :key="group.reason" class="pick__group">
        <div class="pick__grouphead">
          <Icon name="target" :size="14" />
          <span class="pick__groupname">{{ group.reason }}</span>
          <span class="mc-muted">{{ group.candidates.length }} 条</span>
        </div>
        <ul class="pick__list">
          <li v-for="c in group.candidates" :key="c.id" class="pick__item">
            <div class="pick__body">
              <div class="pick__stem"><RichText inline :text="c.stem" /></div>
              <div class="pick__meta">
                <Tag size="sm">{{ TYPE_LABEL[c.type] ?? c.type }}</Tag>
                <Tag v-if="c.point" size="sm" tone="info">{{ c.point }}</Tag>
                <Tag size="sm" tone="neutral">难度分 {{ c.level }}</Tag>
                <Tag size="sm" tone="neutral">分差 {{ c.levelDelta }}</Tag>
                <span v-if="c.bankName" class="mc-muted pick__bank">{{ c.bankName }}</span>
                <Tag v-if="c.attempts && c.attempts > 0" size="sm" tone="warning">
                  错率 {{ pct(c.error_rate) }}（{{ c.attempts }} 次）
                </Tag>
              </div>
            </div>
            <button
              class="mc-btn mc-btn--soft mc-btn--sm"
              type="button"
              :disabled="busy || picking !== null"
              @click="pick(c)"
            >
              {{ picking === c.id ? '替换中…' : '换成这道' }}
            </button>
          </li>
        </ul>
      </div>

      <p class="mc-muted pick__hint">
        提示：候选已排除试卷里已有的题；按「同知识点 + 同难度」优先，组内按难度分差从近到远排列。
      </p>
    </div>

    <template #footer>
      <button class="mc-btn mc-btn--ghost mc-btn--sm" type="button" @click="emit('close')">取消</button>
      <button
        class="mc-btn mc-btn--sm"
        type="button"
        :disabled="busy || picking !== null || !data"
        @click="randomReplace"
      >
        <Icon name="refresh" :size="15" />
        随机换一题
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.pick {
  gap: var(--mc-space-4);
}

.pick__current {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
}

.pick__stem {
  font-size: var(--mc-text-sm);
  line-height: var(--mc-leading);
  min-width: 0;
}

.pick__meta {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
  font-size: var(--mc-text-xs);
}

.pick__group {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
}

.pick__grouphead {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  color: var(--mc-primary-fg);
}

.pick__groupname {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-medium);
}

.pick__list {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.pick__item {
  display: flex;
  align-items: flex-start;
  gap: var(--mc-space-3);
  padding: var(--mc-space-2) var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
}

.pick__body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.pick__bank {
  font-size: var(--mc-text-xs);
}

.pick__hint {
  margin: 0;
  font-size: var(--mc-text-xs);
}
</style>
