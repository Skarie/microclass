<script setup lang="ts">
/**
 * 登录 / 注册页：左侧品牌区 + 右侧表单卡片（移动端只留表单卡 + 小品牌头）。
 * 页面只做布局；登录逻辑在 ./login/useLogin.ts，品牌区与表单卡各自成组件。
 */
import LoginBrand from './login/LoginBrand.vue';
import LoginFormCard from './login/LoginFormCard.vue';
import { useLogin } from './login/useLogin';

const appVersion = __APP_VERSION__;
const {
  auth,
  form,
  submitting,
  error,
  rememberMe,
  agreed,
  isLogin,
  usernameError,
  passwordError,
  confirmError,
  canSubmit,
  switchMode,
  submit,
} = useLogin();
</script>

<template>
  <div class="login">
    <LoginBrand class="login__brand" :site-name="auth.siteName" />

    <main class="login__main">
      <LoginFormCard
        v-model:username="form.username"
        v-model:password="form.password"
        v-model:confirm="form.confirm"
        v-model:display-name="form.displayName"
        v-model:remember-me="rememberMe"
        v-model:agreed="agreed"
        :site-name="auth.siteName"
        :is-login="isLogin"
        :submitting="submitting"
        :error="error"
        :username-error="usernameError"
        :password-error="passwordError"
        :confirm-error="confirmError"
        :can-submit="canSubmit"
        :allow-register="auth.allowRegister"
        @submit="submit"
        @switch-mode="switchMode"
      />
      <p class="login__meta">微课堂 v{{ appVersion }} · 自托管轻量学习平台 · 数据保存在本机</p>
    </main>
  </div>
</template>

<style scoped>
.login {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
  min-height: 100dvh;
  background: var(--mc-bg);
}

.login__main {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--mc-space-4);
  padding: var(--mc-space-8);
}

.login__meta {
  margin: 0;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
  text-align: center;
}

@media (max-width: 900px) {
  .login {
    grid-template-columns: minmax(0, 1fr);
  }

  .login__brand {
    display: none;
  }

  .login__main {
    justify-content: flex-start;
    padding: var(--mc-space-6) var(--mc-space-4);
  }
}
</style>
