<script setup lang="ts">
import AppModal from '@/components/AppModal.vue';
import type { Role } from '@/api/types';

defineProps<{
  open: boolean;
  saving: boolean;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
}>();

const username = defineModel<string>('username', { required: true });
const password = defineModel<string>('password', { required: true });
const role = defineModel<Role>('role', { required: true });
const displayName = defineModel<string>('displayName', { required: true });
</script>

<template>
  <AppModal :open="open" title="新建账号" width="520px" @close="emit('close')">
    <div class="mc-col">
      <label class="mc-field">
        <span class="mc-label mc-label--required">账号</span>
        <input v-model="username" class="mc-input" type="text" maxlength="32" placeholder="2~32 个字符，登录用" />
      </label>

      <label class="mc-field">
        <span class="mc-label mc-label--required">初始密码</span>
        <input v-model="password" class="mc-input" type="password" maxlength="128" placeholder="至少 6 位" />
      </label>

      <label class="mc-field">
        <span class="mc-label">角色</span>
        <select v-model="role" class="mc-select">
          <option value="student">学员</option>
          <option value="teacher">教师</option>
        </select>
        <span class="mc-hint">管理员账号只能由后端引导配置生成。</span>
      </label>

      <label class="mc-field">
        <span class="mc-label">姓名 / 昵称</span>
        <input v-model="displayName" class="mc-input" type="text" maxlength="64" placeholder="显示在成绩单与统计中" />
      </label>
    </div>

    <template #footer>
      <button class="mc-btn" type="button" @click="emit('close')">取消</button>
      <button class="mc-btn mc-btn--primary" type="button" :disabled="saving" @click="emit('submit')">
        {{ saving ? '创建中…' : '创建' }}
      </button>
    </template>
  </AppModal>
</template>
