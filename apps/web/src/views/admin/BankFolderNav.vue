<script setup lang="ts">
import { computed, reactive } from 'vue';
import DropdownMenu from '@/components/DropdownMenu.vue';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import { folderCountLabel } from './folder-tree';
import type { MenuItem } from '@/components/DropdownMenu.vue';
import type { useBankCatalog } from '@/composables/use-bank-catalog';
import type { BankFolder, FolderFilter } from './bankTypes';

/**
 * 「题库」视图的文件夹树：
 * 只渲染文件夹（题库在右侧列表，避免 1.2 万条叶子撑爆树）；
 * 行尾「⋯」= 新建子文件夹 / 重命名 / 删除，删除确认在组合式函数里做。
 */
const props = defineProps<{ catalog: ReturnType<typeof useBankCatalog> }>();
const catalogApi = props.catalog;
const catalogState = reactive(catalogApi);

const FOLDER_MENU: MenuItem[] = [
  { key: 'create-child', label: '新建子文件夹', icon: 'plus' },
  { key: 'rename', label: '重命名', icon: 'edit' },
  { key: 'delete', label: '删除文件夹', icon: 'trash', danger: true },
];

const allQuestionCount = computed(
  () =>
    catalogState.folderTree.reduce((sum, folder) => sum + folder.questionCount, 0) + catalogState.unfiled.questionCount,
);

function pick(filter: FolderFilter): void {
  void catalogState.pickFolder(filter);
}

function onMenu(folder: BankFolder, key: string): void {
  if (key === 'create-child') catalogState.openCreateFolder(folder.id);
  else if (key === 'rename') catalogState.openRenameFolder(folder);
  else if (key === 'delete') void catalogState.deleteFolder(folder);
}
</script>

<template>
  <div class="folder-nav">
    <div class="folder-nav__head">
      <button class="mc-btn mc-btn--soft mc-btn--sm" type="button" @click="catalogState.openCreateFolder(null)">
        <Icon name="plus" :size="16" />
        新建文件夹
      </button>
      <span class="mc-muted folder-nav__tip">选中文件夹后看右侧题库</span>
    </div>

    <div v-if="catalogState.foldersLoading && catalogState.folderRows.length === 0" class="folder-nav__loading">
      <div v-for="i in 4" :key="i" class="mc-skeleton folder-nav__skeleton" />
    </div>

    <EmptyState
      v-else-if="catalogState.folderTree.length === 0 && catalogState.unfiled.bankCount === 0"
      icon="folder"
      title="还没有文件夹"
      description="先建一个根文件夹，把题库按册次/章节收进去。"
    />

    <ul v-else class="folder-list">
      <li class="folder-row" :class="{ 'folder-row--active': catalogState.selectedFolder === 'all' }">
        <button class="folder-row__main" type="button" @click="pick('all')">
          <Icon name="bank" :size="16" class="folder-row__icon" />
          <span class="folder-row__text">
            <span class="folder-row__name mc-truncate">全部题库</span>
            <span class="folder-row__meta mc-muted">
              {{ catalogState.folderBankTotal }} 库 / {{ allQuestionCount }} 题
            </span>
          </span>
        </button>
      </li>

      <li class="folder-row" :class="{ 'folder-row--active': catalogState.selectedFolder === 'none' }">
        <button class="folder-row__main" type="button" @click="pick('none')">
          <Icon name="folder" :size="16" class="folder-row__icon folder-row__icon--muted" />
          <span class="folder-row__text">
            <span class="folder-row__name mc-truncate">未分类</span>
            <span class="folder-row__meta mc-muted">
              {{ catalogState.unfiled.bankCount }} 库 / {{ catalogState.unfiled.questionCount }} 题
            </span>
          </span>
        </button>
      </li>

      <li
        v-for="row in catalogState.folderRows"
        :key="row.id"
        class="folder-row"
        :class="{ 'folder-row--active': catalogState.selectedFolder === row.id }"
        :style="{ paddingLeft: `${row.depth * 16}px` }"
      >
        <button
          v-if="row.hasChildren"
          class="folder-row__toggle"
          type="button"
          :aria-label="`${catalogState.expandedFolders.has(row.id) ? '收起' : '展开'}「${row.name}」`"
          :aria-expanded="catalogState.expandedFolders.has(row.id)"
          @click.stop="catalogState.toggleFolder(row.id)"
        >
          <Icon :name="catalogState.expandedFolders.has(row.id) ? 'chevron-down' : 'chevron-right'" :size="14" />
        </button>
        <span v-else class="folder-row__toggle folder-row__toggle--empty" aria-hidden="true" />

        <button class="folder-row__main" type="button" :title="row.path" @click="pick(row.id)">
          <Icon name="folder" :size="16" class="folder-row__icon" />
          <span class="folder-row__text">
            <span class="folder-row__name mc-truncate">{{ row.name }}</span>
            <span class="folder-row__meta mc-muted">{{ folderCountLabel(row) }}</span>
          </span>
        </button>

        <div class="folder-row__actions" @click.stop>
          <DropdownMenu
            :items="FOLDER_MENU"
            label=""
            icon="more"
            :show-caret="false"
            aria-label="文件夹操作（新建子文件夹 / 重命名 / 删除）"
            variant="ghost"
            @select="(key) => onMenu(row, key)"
          />
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped src="./bank-folder-nav.css"></style>
