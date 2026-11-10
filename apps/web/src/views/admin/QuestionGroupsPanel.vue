<script setup lang="ts">
/**
 * 题库页「题组」视图：左边题组列表（标题 + 母题数 / 变式数 / 总题数），右边题组详情。
 *
 * 只做编排：状态与请求在 `composables/use-question-groups`，
 * 详情渲染在 QuestionGroupDetail，新建/重命名在 QuestionGroupDialog，加题在 QuestionGroupAddModal。
 * 切回「题目」视图后筛选条里也能按题组筛，两边读的是同一份关联数据。
 */
import { onMounted, ref } from 'vue';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import QuestionGroupDetail from './QuestionGroupDetail.vue';
import QuestionGroupDialog from './QuestionGroupDialog.vue';
import QuestionGroupAddModal from './QuestionGroupAddModal.vue';
import { useQuestionGroups } from '@/composables/use-question-groups';
import type { QuestionGroupRole } from '@/api/question-group';

const {
  groups,
  listLoading,
  search,
  selectedId,
  detail,
  detailLoading,
  busy,
  selectedSummary,
  dialogOpen,
  dialogEditingId,
  dialogTitle,
  dialogNote,
  dialogSaving,
  loadGroups,
  selectGroup,
  openCreate,
  openRename,
  saveDialog,
  removeGroup,
  removeItem,
  addItems,
} = useQuestionGroups();

const addOpen = ref(false);

onMounted(() => void loadGroups());

async function submitAdd(questionIds: number[], role: QuestionGroupRole): Promise<void> {
  const ok = await addItems(questionIds, role);
  if (ok) addOpen.value = false;
}

function renameSelected(): void {
  if (selectedSummary.value) openRename(selectedSummary.value);
}

function removeSelected(): void {
  if (selectedSummary.value) void removeGroup(selectedSummary.value);
}
</script>

<template>
  <div class="qg">
    <section class="mc-card qg__list">
      <div class="mc-card__header qg__listhead">
        <span class="mc-card__title">题组（{{ groups.length }}）</span>
        <span class="mc-spacer" />
        <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click="openCreate">
          <Icon name="plus" :size="16" />
          新建题组
        </button>
      </div>

      <div class="mc-card__body mc-col">
        <input
          v-model.trim="search"
          class="mc-input"
          type="search"
          placeholder="搜题组标题或备注"
          aria-label="搜索题组"
        />

        <div v-if="listLoading && groups.length === 0" class="qg__skeleton mc-col">
          <div v-for="i in 4" :key="i" class="mc-skeleton qg__skeleton-row" />
        </div>

        <EmptyState
          v-else-if="groups.length === 0"
          icon="list"
          :title="search.trim() === '' ? '还没有题组' : '没有匹配的题组'"
          :description="
            search.trim() === ''
              ? '把同一考点的「一道母题 + 若干变式」放进一个题组，组卷时可以整组一起挑。'
              : '换个关键词，或清空搜索看看全部题组。'
          "
          :action-text="search.trim() === '' ? '新建题组' : ''"
          @action="openCreate"
        />

        <ul v-else class="qg__rows">
          <li v-for="group in groups" :key="group.id">
            <button
              class="qg__row"
              :class="{ 'qg__row--on': selectedId === group.id }"
              type="button"
              :aria-current="selectedId === group.id ? 'true' : undefined"
              @click="selectGroup(group.id)"
            >
              <span class="qg__rowtitle">{{ group.title }}</span>
              <span class="qg__rowmeta">
                母题 {{ group.roleCounts.stem }} · 变式 {{ group.roleCounts.variant }} · 共 {{ group.total }} 题
              </span>
            </button>
          </li>
        </ul>
      </div>
    </section>

    <QuestionGroupDetail
      :detail="detail"
      :loading="detailLoading"
      :busy="busy"
      @add="addOpen = true"
      @remove-item="removeItem"
      @rename="renameSelected"
      @remove="removeSelected"
    />

    <QuestionGroupDialog
      v-model:title="dialogTitle"
      v-model:note="dialogNote"
      :open="dialogOpen"
      :editing-id="dialogEditingId"
      :saving="dialogSaving"
      @close="dialogOpen = false"
      @save="saveDialog"
    />

    <QuestionGroupAddModal
      :open="addOpen"
      :in-group="detail ? detail.questions.map((q) => q.id) : []"
      :saving="busy"
      @close="addOpen = false"
      @submit="submitAdd"
    />
  </div>
</template>

<style scoped src="./question-groups-panel.css"></style>
