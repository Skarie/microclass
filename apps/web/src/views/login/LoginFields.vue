<script setup lang="ts">
/**
 * 登录/注册的字段组：账号、密码、（注册时）确认密码与姓名。
 * 只负责输入与错误展示，校验结果由父级传入。
 */
defineProps<{
  isLogin: boolean;
  usernameError?: string;
  passwordError?: string;
  confirmError?: string;
}>();

const username = defineModel<string>('username', { required: true });
const password = defineModel<string>('password', { required: true });
const confirm = defineModel<string>('confirm', { required: true });
const displayName = defineModel<string>('displayName', { required: true });
</script>

<template>
  <div class="mc-field">
    <label class="mc-label mc-label--required" for="username">账号</label>
    <input
      id="username"
      v-model.trim="username"
      class="mc-input"
      autocomplete="username"
      placeholder="请输入账号"
      :aria-invalid="Boolean(usernameError)"
    />
    <span v-if="usernameError" class="mc-error-text">{{ usernameError }}</span>
  </div>

  <div class="mc-field">
    <label class="mc-label mc-label--required" for="password">密码</label>
    <input
      id="password"
      v-model="password"
      class="mc-input"
      type="password"
      :autocomplete="isLogin ? 'current-password' : 'new-password'"
      placeholder="请输入密码"
      :aria-invalid="Boolean(passwordError)"
    />
    <span v-if="passwordError" class="mc-error-text">{{ passwordError }}</span>
  </div>

  <template v-if="!isLogin">
    <div class="mc-field">
      <label class="mc-label mc-label--required" for="confirm">确认密码</label>
      <input
        id="confirm"
        v-model="confirm"
        class="mc-input"
        type="password"
        autocomplete="new-password"
        placeholder="再次输入密码"
        :aria-invalid="Boolean(confirmError)"
      />
      <span v-if="confirmError" class="mc-error-text">{{ confirmError }}</span>
    </div>
    <div class="mc-field">
      <label class="mc-label" for="displayName">姓名（选填）</label>
      <input id="displayName" v-model.trim="displayName" class="mc-input" placeholder="用于成绩单显示" />
    </div>
  </template>
</template>
