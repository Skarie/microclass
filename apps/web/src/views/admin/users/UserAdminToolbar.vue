<script setup lang="ts">
import Toolbar from '@/components/Toolbar.vue';
import type { Role } from '@/api/types';

defineProps<{
  keyword: string;
  roleFilter: '' | Role;
  filteredCount: number;
  totalCount: number;
}>();

const emit = defineEmits<{
  'update:keyword': [value: string];
  'update:roleFilter': [value: '' | Role];
}>();

function onKeywordInput(e: Event): void {
  emit('update:keyword', (e.target as HTMLInputElement).value.trim());
}

function onRoleChange(e: Event): void {
  emit('update:roleFilter', (e.target as HTMLSelectElement).value as '' | Role);
}
</script>

<template>
  <Toolbar>
    <template #left>
      <label class="mc-row toolbar__pick">
        <span class="mc-label">搜索</span>
        <input
          :value="keyword"
          class="mc-input toolbar__search"
          type="search"
          placeholder="搜索账号或姓名"
          aria-label="搜索账号"
          @input="onKeywordInput"
        />
      </label>
      <label class="mc-row toolbar__pick">
        <span class="mc-label">角色</span>
        <select :value="roleFilter" class="mc-select toolbar__select" aria-label="按角色筛选" @change="onRoleChange">
          <option value="">全部角色</option>
          <option value="student">学员</option>
          <option value="teacher">教师</option>
          <option value="admin">管理员</option>
        </select>
      </label>
    </template>
    <template #right>
      <span class="mc-muted toolbar__count">{{ filteredCount }} / {{ totalCount }} 个账号</span>
    </template>
  </Toolbar>
</template>

<style scoped>
.toolbar {
  padding: var(--mc-space-4) var(--mc-space-5);
}

.toolbar__search {
  width: 240px;
}

.toolbar__select {
  width: 140px;
}

.toolbar__count {
  font-size: var(--mc-text-xs);
}
</style>
