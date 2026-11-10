<script setup lang="ts">
/**
 * 题库页「标签」视图（迁移 0030）：标签列表 + 新建 / 重命名 / 删除。
 *
 * 用途是把「易错 / 高考真题 / 自编 / 需重录」这类**教研标记**沉淀下来：
 * 知识点回答「这题考什么」，标签回答「这题在教学上怎么用」。
 * 打标入口在题目编辑弹窗和题目表格的批量条，这里只管标签本身的生命周期。
 */
import { onMounted } from 'vue';
import DropdownMenu, { type MenuItem } from '@/components/DropdownMenu.vue';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import TagDialog from './TagDialog.vue';
import { useTags } from '@/composables/use-tags';
import type { TagItem } from '@/api/tag';

const {
  tags,
  loading,
  search,
  busy,
  dialogOpen,
  dialogEditingId,
  dialogName,
  dialogNote,
  dialogSaving,
  loadTags,
  openCreate,
  openRename,
  saveDialog,
  removeTag,
} = useTags();

onMounted(() => void loadTags());

const rowMenu: MenuItem[] = [
  { key: 'rename', label: '重命名 / 改备注', icon: 'edit' },
  { key: 'delete', label: '删除标签', icon: 'trash', danger: true },
];

function onRowMenu(tag: TagItem, key: string): void {
  if (key === 'rename') openRename(tag);
  else if (key === 'delete') void removeTag(tag);
}
</script>

<template>
  <section class="mc-card tp">
    <div class="mc-card__header tp__head">
      <span class="mc-card__title">标签（{{ tags.length }}）</span>
      <span class="mc-spacer" />
      <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click="openCreate">
        <Icon name="plus" :size="16" />
        新建标签
      </button>
    </div>

    <div class="mc-card__body mc-col">
      <input
        v-model.trim="search"
        class="mc-input tp__search"
        type="search"
        placeholder="搜标签名或备注"
        aria-label="搜索标签"
      />

      <div v-if="loading && tags.length === 0" class="tp__skeleton mc-col">
        <div v-for="i in 4" :key="i" class="mc-skeleton tp__skeleton-row" />
      </div>

      <EmptyState
        v-else-if="tags.length === 0"
        icon="list"
        :title="search.trim() === '' ? '还没有标签' : '没有匹配的标签'"
        :description="
          search.trim() === ''
            ? '标签是教研标记（易错 / 高考真题 / 自编 / 需重录），打标后可以在题库筛选和组卷挑题里按标签找题。'
            : '换个关键词，或清空搜索看看全部标签。'
        "
        :action-text="search.trim() === '' ? '新建标签' : ''"
        @action="openCreate"
      />

      <ul v-else class="tp__list">
        <li v-for="tag in tags" :key="tag.id" class="tp__row">
          <div class="tp__main">
            <span class="tp__name">{{ tag.name }}</span>
            <span v-if="tag.note" class="tp__note">{{ tag.note }}</span>
          </div>
          <span class="mc-badge tp__count">{{ tag.questionCount }} 题</span>
          <DropdownMenu
            :items="rowMenu"
            label=""
            icon="more"
            :show-caret="false"
            aria-label="标签操作（重命名 / 删除）"
            variant="ghost"
            :disabled="busy"
            @select="(key) => onRowMenu(tag, key)"
          />
        </li>
      </ul>

      <p v-if="tags.length > 0" class="mc-hint tp__hint">
        给题目打标：在「题目」视图勾选后点「加标签」，或打开某道题的编辑弹窗逐个改。
      </p>
    </div>

    <TagDialog
      v-model:name="dialogName"
      v-model:note="dialogNote"
      :open="dialogOpen"
      :editing-id="dialogEditingId"
      :saving="dialogSaving"
      @close="dialogOpen = false"
      @save="saveDialog"
    />
  </section>
</template>

<style scoped src="./tag-panel.css"></style>
