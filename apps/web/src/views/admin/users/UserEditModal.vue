<script setup lang="ts">
import AppModal from '@/components/AppModal.vue';
import { ROLE_BADGE, ROLE_LABEL } from './user-roles';
import type { Role, User } from '@/api/types';

defineProps<{
  open: boolean;
  saving: boolean;
  target: User | null;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
}>();

const displayName = defineModel<string>('displayName', { required: true });
const role = defineModel<Role>('role', { required: true });
const password = defineModel<string>('password', { required: true });
</script>

<template>
  <AppModal :open="open" title="编辑账号" width="520px" @close="emit('close')">
    <div class="mc-col">
      <div class="mc-row mc-row--wrap">
        <span class="mc-label">账号</span>
        <span class="mc-mono">{{ target?.username }}</span>
        <span class="mc-badge" :class="target ? ROLE_BADGE[target.role] : ''">
          {{ target ? ROLE_LABEL[target.role] : '' }}
        </span>
      </div>

      <label class="mc-field">
        <span class="mc-label">姓名 / 昵称</span>
        <input v-model="displayName" class="mc-input" type="text" maxlength="64" placeholder="显示在成绩单与统计中" />
      </label>

      <label class="mc-field">
        <span class="mc-label">角色</span>
        <select v-model="role" class="mc-select">
          <option value="student">学员</option>
          <option value="teacher">教师</option>
          <option value="admin">管理员</option>
        </select>
        <span class="mc-hint">仅当角色发生变化时才会提交该字段。</span>
      </label>

      <label class="mc-field">
        <span class="mc-label">重置密码</span>
        <input v-model="password" class="mc-input" type="password" maxlength="128" placeholder="留空表示不修改" />
      </label>
    </div>

    <template #footer>
      <button class="mc-btn" type="button" @click="emit('close')">取消</button>
      <button class="mc-btn mc-btn--primary" type="button" :disabled="saving" @click="emit('submit')">
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </template>
  </AppModal>
</template>
