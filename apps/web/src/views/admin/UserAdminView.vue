<script setup lang="ts">
import { onMounted } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import Icon from '@/components/Icon.vue';
import UserAdminToolbar from './users/UserAdminToolbar.vue';
import UserListCard from './users/UserListCard.vue';
import AuditLogCard from './users/AuditLogCard.vue';
import UserCreateModal from './users/UserCreateModal.vue';
import UserEditModal from './users/UserEditModal.vue';
import { useUserList } from '@/composables/use-user-list';
import { useUserAdmin } from '@/composables/use-user-admin';
import { useAuditLog } from '@/composables/use-audit-log';

/**
 * 学员与账号（账号列表 / 搜索筛选 / 新建编辑 / 审计日志）。
 * 页面只做编排：列表读取、写操作、审计日志分别在三个组合式函数里，
 * 界面按工具栏 / 两个卡片 / 两个弹窗拆到 ./users/*。
 */
const list = useUserList();
const audit = useAuditLog();
const admin = useUserAdmin({ reloadUsers: list.load, reloadLogs: audit.load });

function changeLogLimit(limit: number): void {
  audit.limit = limit;
  void audit.load();
}

onMounted(() => {
  void list.load();
  void audit.load();
});
</script>

<template>
  <section class="page mc-col">
    <PageHeader
      title="学员与账号"
      description="维护学员/教师/管理员账号，设置初始密码与角色；学员的学习记录随账号保留。"
      icon="users"
      :breadcrumb="[{ label: '首页', to: '/' }, { label: '教学管理' }, { label: '学员与账号' }]"
    >
      <template #actions>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="list.loading" @click="list.load">
          <Icon name="refresh" :size="15" />
          刷新
        </button>
        <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click="admin.openCreate">
          <Icon name="plus" :size="15" />
          新建账号
        </button>
      </template>
    </PageHeader>

    <UserAdminToolbar
      :keyword="list.keyword"
      :role-filter="list.roleFilter"
      :filtered-count="list.filtered.length"
      :total-count="list.users.length"
      @update:keyword="list.keyword = $event"
      @update:role-filter="list.roleFilter = $event"
    />

    <UserListCard
      :users="list.filtered"
      :total-count="list.users.length"
      :loading="list.loading"
      :current-user-name="admin.currentUserName"
      :current-user-id="admin.currentUserId"
      @create="admin.openCreate"
      @edit="admin.openEdit"
      @delete="admin.removeUser"
    />

    <AuditLogCard
      :logs="audit.logs"
      :loading="audit.loading"
      :limit="audit.limit"
      @limit-change="changeLogLimit"
      @refresh="audit.load"
    />

    <UserCreateModal
      :open="admin.createOpen"
      :saving="admin.createSaving"
      v-model:username="admin.createForm.username"
      v-model:password="admin.createForm.password"
      v-model:role="admin.createForm.role"
      v-model:display-name="admin.createForm.displayName"
      @close="admin.createOpen = false"
      @submit="admin.createUser"
    />
    <UserEditModal
      :open="admin.editOpen"
      :saving="admin.editSaving"
      :target="admin.editTarget"
      v-model:display-name="admin.editForm.displayName"
      v-model:role="admin.editForm.role"
      v-model:password="admin.editForm.password"
      @close="admin.editOpen = false"
      @submit="admin.saveEdit"
    />
  </section>
</template>

<style scoped>
.page {
  gap: var(--mc-space-5);
}
</style>
