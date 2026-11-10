<script setup lang="ts">
/**
 * 题目编辑器里的「标签」区域：显示并编辑这道题的教研标签（多选 chips）。
 *
 * 知识点在编辑器里是文本字段（questions.point），标签是关联表（question_tags），
 * 所以这里用 chips 直接增删：每次变更都提交**完整的标签集合**（接口是覆盖式语义），
 * 避免「先删后加」两次请求之间出现中间态。
 *
 * 新建的题还没 id，保存后再打开就能打标；标签本身的管理在「标签」视图里。
 */
import { computed, ref, watch } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import Icon from '@/components/Icon.vue';
import type { QuestionTagItem, TagItem } from '@/api/tag';

const props = defineProps<{
  /** null = 正在新建题目（还没保存） */
  questionId: number | null;
  /** 弹窗是否打开：关着就不发请求 */
  open: boolean;
}>();

const toast = useToastStore();
const allTags = ref<TagItem[]>([]);
const current = ref<QuestionTagItem[]>([]);
const loading = ref(false);
const busy = ref(false);

const currentIds = computed(() => current.value.map((tag) => tag.id));
const currentSet = computed(() => new Set(currentIds.value));
/** 下拉里只放还没打的标签，避免重复点 */
const available = computed(() => allTags.value.filter((tag) => !currentSet.value.has(tag.id)));

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [listRes, mineRes] = await Promise.all([
      api.get<{ tags: TagItem[] }>('/tags'),
      props.questionId === null
        ? Promise.resolve({ tags: [] as QuestionTagItem[] })
        : api.get<{ tags: QuestionTagItem[] }>(`/questions/${props.questionId}/tags`),
    ]);
    allTags.value = listRes.tags;
    current.value = mineRes.tags;
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.open, props.questionId] as const,
  ([open, id]) => {
    if (!open || id === null) {
      allTags.value = [];
      current.value = [];
      return;
    }
    void load();
  },
  { immediate: true },
);

async function save(next: number[]): Promise<void> {
  const id = props.questionId;
  if (id === null) return;
  busy.value = true;
  try {
    await api.post(`/questions/${id}/tags`, { tagIds: next });
    await load();
    toast.success('已更新标签');
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    busy.value = false;
  }
}

function onAdd(event: Event): void {
  const select = event.target as HTMLSelectElement;
  const value = Number(select.value);
  select.value = '';
  if (!Number.isInteger(value) || value <= 0) return;
  void save([...currentIds.value, value]);
}

function remove(tagId: number): void {
  void save(currentIds.value.filter((id) => id !== tagId));
}
</script>

<template>
  <section class="qte">
    <div class="qte__head">
      <span class="mc-label">标签</span>
      <span class="qte__count">{{ current.length }} 个</span>
    </div>

    <p v-if="questionId === null" class="mc-hint">保存题目后就能给它打标签（易错 / 高考真题 / 自编 等）。</p>

    <div v-else-if="loading" class="qte__loading">
      <div v-for="i in 2" :key="i" class="mc-skeleton qte__skeleton" />
    </div>

    <template v-else>
      <div v-if="current.length > 0" class="qte__chips">
        <span v-for="tag in current" :key="tag.id" class="qte__chip">
          {{ tag.name }}
          <button
            class="qte__chipbtn"
            type="button"
            :aria-label="`移除标签 ${tag.name}`"
            :disabled="busy"
            @click="remove(tag.id)"
          >
            <Icon name="close" :size="12" />
          </button>
        </span>
      </div>
      <p v-else class="mc-hint">这道题还没有标签。</p>

      <div class="qte__add">
        <select class="mc-select qte__select" aria-label="添加标签" :value="''" :disabled="busy" @change="onAdd">
          <option value="">{{ available.length === 0 ? '没有更多标签（去「标签」视图新建）' : '添加标签…' }}</option>
          <option v-for="tag in available" :key="tag.id" :value="String(tag.id)">{{ tag.name }}</option>
        </select>
      </div>
    </template>
  </section>
</template>

<style scoped>
.qte {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding: var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
}

.qte__head {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
}

.qte__count {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.qte__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mc-space-2);
}

.qte__chip {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  max-width: 100%;
  padding: var(--mc-space-1) var(--mc-space-2);
  border: 1px solid var(--mc-primary-border);
  border-radius: var(--mc-radius-pill);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  font-size: var(--mc-text-sm);
}

.qte__chipbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: var(--mc-radius-pill);
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.qte__select {
  max-width: 320px;
}

.qte__loading {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
}

.qte__skeleton {
  height: 32px;
  border-radius: var(--mc-radius-pill);
}

@media (max-width: 900px) {
  .qte__chipbtn {
    min-width: var(--mc-touch-target-mobile);
    min-height: var(--mc-touch-target-mobile);
  }

  .qte__select {
    max-width: none;
  }
}
</style>
