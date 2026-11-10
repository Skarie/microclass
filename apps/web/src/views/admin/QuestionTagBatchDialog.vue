<script setup lang="ts">
/**
 * 批量打标（题目表格勾选后从批量条打开）：
 * 勾选标签 + 选择「加标签 / 去标签」，一次提交给选中的 N 道题。
 *
 * 支持就地新建标签：教研现场常常是「想打一个新标记」，逼老师先跳去标签视图
 * 建完再回来勾选，一次要丢四五个操作。新建后自动勾上，继续提交即可。
 */
import { computed, ref, watch } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import AppModal from '@/components/AppModal.vue';
import Icon from '@/components/Icon.vue';
import type { TagBatchMode, TagItem } from '@/api/tag';

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** 选中了多少道题（文案用） */
    count: number;
    saving: boolean;
    /** 默认模式：从批量条点「加标签」进来是 add，点「去标签」是 remove */
    initialMode?: Exclude<TagBatchMode, 'replace'>;
  }>(),
  { initialMode: 'add' },
);

const emit = defineEmits<{
  close: [];
  submit: [tagIds: number[], mode: Exclude<TagBatchMode, 'replace'>];
}>();

const toast = useToastStore();
const tags = ref<TagItem[]>([]);
const selected = ref<number[]>([]);
const mode = ref<Exclude<TagBatchMode, 'replace'>>('add');
const loading = ref(false);
const newName = ref('');
const creating = ref(false);

const selectedSet = computed(() => new Set(selected.value));

async function loadTags(): Promise<void> {
  loading.value = true;
  try {
    const res = await api.get<{ tags: TagItem[] }>('/tags');
    tags.value = res.tags;
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    selected.value = [];
    mode.value = props.initialMode;
    newName.value = '';
    void loadTags();
  },
);

function toggle(tagId: number): void {
  selected.value = selectedSet.value.has(tagId)
    ? selected.value.filter((id) => id !== tagId)
    : [...selected.value, tagId];
}

async function createTag(): Promise<void> {
  const name = newName.value.trim();
  if (name === '') {
    toast.warning('请填写标签名');
    return;
  }
  creating.value = true;
  try {
    const res = await api.post<{ ok: boolean; id: number }>('/tags', { name });
    newName.value = '';
    await loadTags();
    if (!selectedSet.value.has(res.id)) selected.value = [...selected.value, res.id];
    toast.success(`已新建标签「${name}」并勾选`);
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    creating.value = false;
  }
}

function submit(): void {
  if (selected.value.length === 0) {
    toast.warning('请先勾选要操作的标签');
    return;
  }
  emit('submit', selected.value, mode.value);
}
</script>

<template>
  <AppModal
    :open="open"
    title="批量打标签"
    :description="`将对选中的 ${count} 道题生效。`"
    width="620px"
    @close="emit('close')"
  >
    <div class="mc-col">
      <div class="qtb__modes" role="group" aria-label="打标方式">
        <button
          class="qtb__mode"
          :class="{ 'qtb__mode--on': mode === 'add' }"
          type="button"
          :aria-pressed="mode === 'add'"
          @click="mode = 'add'"
        >
          加标签
        </button>
        <button
          class="qtb__mode"
          :class="{ 'qtb__mode--on': mode === 'remove' }"
          type="button"
          :aria-pressed="mode === 'remove'"
          @click="mode = 'remove'"
        >
          去标签
        </button>
        <span class="mc-muted qtb__modehint">
          {{ mode === 'add' ? '给这些题加上勾选的标签，原标签保留。' : '只移除勾选的标签，题目其他标签保留。' }}
        </span>
      </div>

      <div v-if="loading" class="qtb__list">
        <div v-for="i in 3" :key="i" class="mc-skeleton qtb__skeleton" />
      </div>

      <p v-else-if="tags.length === 0" class="mc-muted">还没有标签，先在下面新建一个。</p>

      <ul v-else class="qtb__list">
        <li v-for="tag in tags" :key="tag.id" class="qtb__row">
          <label class="qtb__pick">
            <input
              type="checkbox"
              :checked="selectedSet.has(tag.id)"
              :aria-label="`选择标签 ${tag.name}`"
              @change="toggle(tag.id)"
            />
            <span class="qtb__name">{{ tag.name }}</span>
            <span class="mc-muted qtb__count">{{ tag.questionCount }} 题</span>
          </label>
        </li>
      </ul>

      <div class="qtb__create">
        <input
          v-model.trim="newName"
          class="mc-input qtb__newinput"
          type="text"
          maxlength="40"
          placeholder="新建标签名，例如：需重录"
          aria-label="新建标签名"
          @keyup.enter="createTag"
        />
        <button class="mc-btn mc-btn--soft mc-btn--sm" type="button" :disabled="creating" @click="createTag">
          <Icon name="plus" :size="14" />
          {{ creating ? '新建中…' : '新建并勾选' }}
        </button>
      </div>
    </div>

    <template #footer>
      <span class="mc-muted qtb__selected">已勾选 {{ selected.length }} 个标签</span>
      <button class="mc-btn" type="button" @click="emit('close')">取消</button>
      <button class="mc-btn mc-btn--primary" type="button" :disabled="saving || selected.length === 0" @click="submit">
        {{ saving ? '提交中…' : mode === 'add' ? '加标签' : '去标签' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.qtb__modes {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
}

.qtb__mode {
  min-height: 32px;
  padding: 0 var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-pill);
  background: transparent;
  color: var(--mc-text-secondary);
  font-size: var(--mc-text-sm);
  cursor: pointer;
}

.qtb__mode--on {
  border-color: var(--mc-primary);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-medium);
}

.qtb__modehint {
  font-size: var(--mc-text-xs);
}

.qtb__list {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  max-height: 46vh;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}

.qtb__row {
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
}

.qtb__pick {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  min-height: 44px;
  padding: var(--mc-space-2) var(--mc-space-3);
  cursor: pointer;
}

.qtb__name {
  font-size: var(--mc-text-sm);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qtb__count {
  font-size: var(--mc-text-xs);
  flex: none;
}

.qtb__create {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
  padding-top: var(--mc-space-2);
  border-top: 1px solid var(--mc-border);
}

.qtb__newinput {
  flex: 1 1 200px;
}

.qtb__skeleton {
  height: 44px;
  border-radius: var(--mc-radius);
}

.qtb__selected {
  margin-right: auto;
  font-size: var(--mc-text-sm);
}

@media (max-width: 900px) {
  .qtb__list {
    max-height: none;
  }

  /* 手机（390）触控目标：加/去标签切换按钮要 ≥44 */
  .qtb__mode {
    min-height: var(--mc-touch-target-mobile);
  }

  .qtb__create {
    flex-direction: column;
    align-items: stretch;
  }

  /* 竖排时 flex-basis 会变成高度：输入框保持控件默认高度，别被拉成 200px 高 */
  .qtb__newinput {
    flex: 0 0 auto;
  }
}
</style>
