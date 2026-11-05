<script setup lang="ts">
/**
 * 登录页右侧表单卡：1px 边框 + 12px 圆角 + 极轻阴影；字段间距 16、主按钮整宽。
 * 移动端（≤900px）左栏隐藏后，本卡顶部显示小品牌头。
 */
import Icon from '@/components/Icon.vue';
import LoginFields from './LoginFields.vue';

withDefaults(
  defineProps<{
    siteName: string;
    isLogin: boolean;
    submitting: boolean;
    error: string;
    usernameError?: string;
    passwordError?: string;
    confirmError?: string;
    canSubmit: boolean;
    allowRegister: boolean;
  }>(),
  { usernameError: '', passwordError: '', confirmError: '' },
);
const emit = defineEmits<{ submit: []; 'switch-mode': [mode: 'login' | 'register'] }>();

const username = defineModel<string>('username', { required: true });
const password = defineModel<string>('password', { required: true });
const confirm = defineModel<string>('confirm', { required: true });
const displayName = defineModel<string>('displayName', { required: true });
const rememberMe = defineModel<boolean>('rememberMe', { required: true });
const agreed = defineModel<boolean>('agreed', { required: true });
</script>

<template>
  <section class="card">
    <header class="card__mobile-brand">
      <span class="card__mobile-logo" aria-hidden="true">微</span>
      <span class="card__mobile-name">{{ siteName }}</span>
    </header>

    <div class="card__head">
      <h1 class="card__title">{{ isLogin ? '登录' : '注册账号' }}</h1>
      <span class="card__hint">忘记密码请联系管理员重置</span>
    </div>

    <div class="tabs" role="tablist" aria-label="登录或注册">
      <button
        class="tabs__tab"
        :class="{ 'tabs__tab--active': isLogin }"
        type="button"
        role="tab"
        :aria-selected="isLogin"
        @click="emit('switch-mode', 'login')"
      >
        账号登录
      </button>
      <button
        v-if="allowRegister"
        class="tabs__tab"
        :class="{ 'tabs__tab--active': !isLogin }"
        type="button"
        role="tab"
        :aria-selected="!isLogin"
        @click="emit('switch-mode', 'register')"
      >
        新用户注册
      </button>
    </div>

    <form class="form" @submit.prevent="emit('submit')">
      <LoginFields
        v-model:username="username"
        v-model:password="password"
        v-model:confirm="confirm"
        v-model:display-name="displayName"
        :is-login="isLogin"
        :username-error="usernameError"
        :password-error="passwordError"
        :confirm-error="confirmError"
      />

      <div class="options">
        <label class="mc-checkbox">
          <input v-model="rememberMe" type="checkbox" />
          记住账号
        </label>
        <span class="options__hint">只记住账号，不保存密码</span>
      </div>

      <p v-if="error" class="form__error" role="alert">
        <Icon name="alert" :size="14" />
        {{ error }}
      </p>

      <button
        class="mc-btn mc-btn--primary mc-btn--lg mc-btn--block"
        type="submit"
        :disabled="!canSubmit || submitting"
      >
        {{ submitting ? '处理中…' : isLogin ? '登录' : '注册并登录' }}
      </button>

      <label class="agree login__agree">
        <input v-model="agreed" type="checkbox" />
        <span>
          我已了解：本平台是自托管的内部学习系统，账号由管理员创建，学习记录只保存在本机；
          视频与题目内容的版权归各自权利人所有。
        </span>
      </label>
    </form>

    <footer class="card__foot">首次部署的默认管理员账号为 <code>admin</code>，密码由部署时配置决定。</footer>
  </section>
</template>

<style scoped src="./login-form-card.css"></style>
