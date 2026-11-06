<script setup lang="ts">
/**
 * 管理端 · 公告管理（挂在「系统设置」页的卡片里）。
 *
 * 列表顺序由后端决定（置顶 + 发布时间），前端不重排；
 * 新建/编辑共用 AnnouncementFormDialog；删除先二次确认；
 * 写操作成功后 composable 会重新拉列表并 toast。
 */
import { onMounted, ref } from 'vue';
import AppModal from '@/components/AppModal.vue';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import AnnouncementFormDialog from './AnnouncementFormDialog.vue';
import AnnouncementRow from './AnnouncementRow.vue';
import { useAnnouncementsAdmin } from '@/composables/use-announcements-admin';
import type { Announcement, AnnouncementPayload } from '@/api/announcement';

const { items, loading, saving, removing, load, save, remove } = useAnnouncementsAdmin();

const formOpen = ref(false);
const editing = ref<Announcement | null>(null);
const deleteTarget = ref<Announcement | null>(null);

function openCreate(): void {
  editing.value = null;
  formOpen.value = true;
}

function openEdit(item: Announcement): void {
  editing.value = item;
  formOpen.value = true;
}

async function submit(payload: AnnouncementPayload): Promise<void> {
  if (await save(payload, editing.value?.id)) formOpen.value = false;
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value;
  if (!target) return;
  if (await remove(target.id)) deleteTarget.value = null;
}

onMounted(() => void load());
</script>

<template>
  <section class="mc-card">
    <div class="mc-card__header ann-admin__head">
      <span class="mc-card__title"><Icon name="bell" :size="16" /> 公告管理</span>
      <span class="mc-muted ann-admin__count"
        >共 <span class="mc-num">{{ items.length }}</span> 条</span
      >
      <span class="mc-spacer" />
      <span class="ann-admin__actions">
        <button class="mc-btn mc-btn--sm" type="button" :disabled="loading" @click="load">
          <Icon name="refresh" :size="15" />
          刷新
        </button>
        <button class="mc-btn mc-btn--sm mc-btn--primary" type="button" @click="openCreate">
          <Icon name="plus" :size="15" />
          新建公告
        </button>
      </span>
    </div>

    <div v-if="loading && items.length === 0" class="ann-admin__loading">
      <div v-for="i in 3" :key="i" class="mc-skeleton ann-admin__row" />
    </div>

    <EmptyState
      v-else-if="items.length === 0"
      icon="bell"
      title="还没有公告"
      description="公告会出现在学员首页顶部，最多显示 2 条；置顶的排在最前。"
      action-text="新建公告"
      @action="openCreate"
    />

    <ul v-else class="ann-admin__list">
      <AnnouncementRow
        v-for="item in items"
        :key="item.id"
        :item="item"
        :removing="removing === item.id"
        @edit="openEdit(item)"
        @remove="deleteTarget = item"
      />
    </ul>

    <AnnouncementFormDialog
      :open="formOpen"
      :target="editing"
      :saving="saving"
      @close="formOpen = false"
      @submit="submit"
    />

    <AppModal :open="deleteTarget !== null" title="删除公告" width="440px" @close="deleteTarget = null">
      <p class="ann-admin__confirm">
        确定删除「<strong>{{ deleteTarget?.title }}</strong
        >」？删除后学员首页立即不再显示，且无法恢复。
      </p>
      <template #footer>
        <button class="mc-btn" type="button" @click="deleteTarget = null">取消</button>
        <button class="mc-btn mc-btn--danger" type="button" :disabled="removing !== null" @click="confirmDelete">
          {{ removing !== null ? '删除中…' : '删除' }}
        </button>
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
.ann-admin__loading {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding: var(--mc-space-5);
}

.ann-admin__row {
  height: 48px;
}

.ann-admin__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.ann-admin__confirm {
  margin: 0;
  font-size: var(--mc-text-sm);
  line-height: var(--mc-leading);
  color: var(--mc-text-secondary);
}

/* 窄屏：卡头允许换行，标题与计数各自不折行（否则「公告管理」会被压成两行） */
.ann-admin__head {
  flex-wrap: wrap;
  row-gap: var(--mc-space-2);
}

.ann-admin__head .mc-card__title,
.ann-admin__count {
  white-space: nowrap;
}

/* 两个操作按钮成组换行，窄屏时一起掉到第二行而不是各自散开 */
.ann-admin__actions {
  display: flex;
  gap: var(--mc-space-2);
  margin-left: auto;
}

@media (max-width: 1023px) {
  .ann-admin__actions .mc-btn {
    min-height: var(--mc-touch-target-mobile);
  }
}
</style>
