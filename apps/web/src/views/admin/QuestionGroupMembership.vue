<script setup lang="ts">
/**
 * 题目编辑器里的「所属题组」区域：看这道题被放进了哪些题组，并直接加组 / 移出。
 *
 * 为什么放在编辑弹窗里：老师改题时最常问的就是「这道题是不是已经在哪个变式组里了」，
 * 跳出去查题组页再回来编辑，一次要丢三四个操作。
 *
 * 只在「编辑已有题目」时可用：新建的题还没 id，保存后再打开就能加组。
 * 数据每次展开都重新拉（题组可能刚在别处改过），不做跨页面缓存。
 */
import { computed, ref, watch } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import Icon from '@/components/Icon.vue';
import {
  QUESTION_GROUP_ROLES,
  ROLE_LABEL,
  type QuestionGroupMembership,
  type QuestionGroupRole,
  type QuestionGroupSummary,
} from '@/api/question-group';

const props = defineProps<{
  /** null = 正在新建题目（还没保存） */
  questionId: number | null;
  /** 弹窗是否打开：关着就不发请求 */
  open: boolean;
}>();

const toast = useToastStore();
const memberships = ref<QuestionGroupMembership[]>([]);
const groups = ref<QuestionGroupSummary[]>([]);
const loading = ref(false);
const busy = ref(false);
const pickGroupId = ref<number | null>(null);
const pickRole = ref<QuestionGroupRole>('variant');

/** 候选：还没加入的题组（已经在组里的不再出现在下拉里，避免误点） */
const candidates = computed(() => {
  const joined = new Set(memberships.value.map((m) => m.id));
  return groups.value.filter((g) => !joined.has(g.id));
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [memberRes, groupRes] = await Promise.all([
      props.questionId === null
        ? Promise.resolve({ groups: [] })
        : api.get<{ groups: QuestionGroupMembership[] }>(`/questions/${props.questionId}/groups`),
      api.get<{ groups: QuestionGroupSummary[] }>('/question-groups'),
    ]);
    memberships.value = memberRes.groups;
    groups.value = groupRes.groups;
    if (pickGroupId.value === null || !candidates.value.some((g) => g.id === pickGroupId.value)) {
      pickGroupId.value = candidates.value[0]?.id ?? null;
    }
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
      memberships.value = [];
      return;
    }
    void load();
  },
  { immediate: true },
);

async function addToGroup(): Promise<void> {
  const id = props.questionId;
  const groupId = pickGroupId.value;
  if (id === null || groupId === null) return;
  busy.value = true;
  try {
    await api.post(`/question-groups/${groupId}/items`, { questionIds: [id], role: pickRole.value });
    toast.success(`已加入题组（${ROLE_LABEL[pickRole.value]}）`);
    await load();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    busy.value = false;
  }
}

async function removeFrom(groupId: number): Promise<void> {
  const id = props.questionId;
  if (id === null) return;
  busy.value = true;
  try {
    await api.del(`/question-groups/${groupId}/items/${id}`);
    toast.success('已从题组移出');
    await load();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="qgm">
    <div class="qgm__head">
      <span class="mc-label">所属题组</span>
      <span class="qgm__count">{{ memberships.length }} 个</span>
    </div>

    <p v-if="questionId === null" class="mc-hint">保存题目后，就能把它加入某个题组（母题或变式）。</p>

    <div v-else-if="loading" class="qgm__loading">
      <div v-for="i in 2" :key="i" class="mc-skeleton qgm__skeleton" />
    </div>

    <template v-else>
      <div v-if="memberships.length > 0" class="qgm__chips">
        <span v-for="item in memberships" :key="item.id" class="qgm__chip">
          <span class="qgm__chiprole">{{ ROLE_LABEL[item.role] }}</span>
          <span class="qgm__chiptitle">{{ item.title }}</span>
          <button
            class="qgm__chipbtn"
            type="button"
            :disabled="busy"
            :aria-label="`从题组 ${item.title} 移出`"
            @click="removeFrom(item.id)"
          >
            <Icon name="close" :size="12" />
          </button>
        </span>
      </div>
      <p v-else class="mc-hint">这道题还没加入任何题组。</p>

      <div v-if="candidates.length > 0" class="qgm__add">
        <select v-model.number="pickGroupId" class="mc-select qgm__select" aria-label="选择题组">
          <option v-for="group in candidates" :key="group.id" :value="group.id">{{ group.title }}</option>
        </select>
        <select v-model="pickRole" class="mc-select qgm__role" aria-label="以哪种角色加入">
          <option v-for="role in QUESTION_GROUP_ROLES" :key="role" :value="role">加入为{{ ROLE_LABEL[role] }}</option>
        </select>
        <button
          class="mc-btn mc-btn--soft mc-btn--sm"
          type="button"
          :disabled="busy || pickGroupId === null"
          @click="addToGroup"
        >
          <Icon name="plus" :size="14" />
          加入题组
        </button>
      </div>
      <p v-else-if="groups.length === 0" class="mc-hint">还没有题组，去「题组」视图新建一个再回来。</p>
      <p v-else class="mc-hint">所有题组都包含这道题了；需要新题组请到「题组」视图新建。</p>
    </template>
  </section>
</template>

<style scoped src="./question-group-membership.css"></style>
