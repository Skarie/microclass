<script setup lang="ts">
/**
 * 登录 / 注册
 *
 * 优化前：左侧一整块扁平深绿面板（占半屏、上下大量死空间）+ 右侧窄卡片，
 * 是典型的老式分栏登录页；手机端还会先看到一大块色板。
 *
 * 优化后：全屏品牌氛围背景 + 居中卡片。理由：
 *  - 登录页只有"一个任务"，居中卡片的视线动线最短；
 *  - 不再用整块重色压住半个屏幕（之前也嫌"留白大"）；
 *  - 窄屏天然适配，卡片直接铺满宽度。
 */
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { errorMessage } from '@/composables/useAsync';
import Icon from '@/components/Icon.vue';

const auth = useAuthStore();
const toast = useToastStore();
const route = useRoute();
const router = useRouter();

const mode = ref<'login' | 'register'>('login');
const form = reactive({ username: '', password: '', confirm: '', displayName: '' });
const submitting = ref(false);
const error = ref('');

const isLogin = computed(() => mode.value === 'login');
const usernameError = computed(() =>
  form.username && !/^[a-z0-9_\u4e00-\u9fa5]{2,32}$/i.test(form.username)
    ? '账号需为 2-32 位字母、数字、下划线或中文'
    : '',
);
const passwordError = computed(() => (form.password && form.password.length < 6 ? '密码至少 6 位' : ''));
const confirmError = computed(() =>
  !isLogin.value && form.confirm && form.confirm !== form.password ? '两次输入的密码不一致' : '',
);
const canSubmit = computed(
  () =>
    form.username.length >= 2 &&
    form.password.length >= 6 &&
    (isLogin.value || (form.confirm === form.password && form.confirm.length >= 6)) &&
    !usernameError.value,
);

function switchMode(next: 'login' | 'register'): void {
  mode.value = next;
  error.value = '';
}

async function submit(): Promise<void> {
  if (!canSubmit.value || submitting.value) return;
  submitting.value = true;
  error.value = '';
  try {
    if (isLogin.value) {
      await auth.login(form.username, form.password);
      toast.success('登录成功');
    } else {
      await auth.register(form.username, form.password, form.displayName || undefined);
      toast.success('注册成功，已自动登录');
    }
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    await router.replace(redirect);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="login">
    <main class="login__card">
      <header class="login__head">
        <span class="login__logo" aria-hidden="true">微</span>
        <div class="login__head-text">
          <h1 class="login__title">{{ auth.siteName }}</h1>
          <p class="login__slogan">看的每一分钟，都算数</p>
        </div>
      </header>

      <div class="login__tabs" role="tablist" aria-label="登录或注册">
        <button
          class="login__tab"
          :class="{ 'login__tab--active': isLogin }"
          type="button"
          role="tab"
          :aria-selected="isLogin"
          @click="switchMode('login')"
        >
          登录
        </button>
        <button
          v-if="auth.allowRegister"
          class="login__tab"
          :class="{ 'login__tab--active': !isLogin }"
          type="button"
          role="tab"
          :aria-selected="!isLogin"
          @click="switchMode('register')"
        >
          注册
        </button>
      </div>

      <form class="login__form" @submit.prevent="submit">
        <div class="mc-field">
          <label class="mc-label mc-label--required" for="username">账号</label>
          <input
            id="username"
            v-model.trim="form.username"
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
            v-model="form.password"
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
              v-model="form.confirm"
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
            <input id="displayName" v-model.trim="form.displayName" class="mc-input" placeholder="用于成绩单显示" />
          </div>
        </template>

        <p v-if="error" class="login__error" role="alert">{{ error }}</p>

        <button
          class="mc-btn mc-btn--primary mc-btn--lg mc-btn--block"
          type="submit"
          :disabled="!canSubmit || submitting"
        >
          <Icon name="graduation" :size="16" />
          {{ submitting ? '处理中…' : isLogin ? '登录' : '注册并登录' }}
        </button>
      </form>

      <p class="login__hint">首次部署的默认管理员账号为 <code>admin</code>，密码由部署时配置决定。</p>
    </main>

    <footer class="login__meta">
      <span>微课堂 · 自托管轻量学习平台</span>
      <span class="login__meta-sep">·</span>
      <span>学习数据保存在你自己的机器上</span>
    </footer>
  </div>
</template>

<style scoped>
.login {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--mc-space-6);
  min-height: 100dvh;
  padding: var(--mc-space-6);
  background-image: var(--mc-bg-art);
}

.login__card {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-4);
  width: min(400px, 100%);
  padding: var(--mc-space-6);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-xl);
  background: var(--mc-bg-elevated);
  box-shadow: var(--mc-shadow-lg);
}

/* 头部：Logo + 站点名 + 主张，一行说清"这是什么地方" */
.login__head {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
}

.login__logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: var(--mc-radius-md);
  background-image: var(--mc-gradient-brand);
  color: var(--mc-neutral-0);
  font-size: var(--mc-text-lg);
  font-weight: var(--mc-font-bold);
}

.login__head-text {
  min-width: 0;
}

.login__title {
  margin: 0;
  font-size: var(--mc-text-lg);
  font-weight: var(--mc-font-bold);
  color: var(--mc-text);
}

.login__slogan {
  margin: 0;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

/* 分段式登录/注册切换（比细下划线更像"选中"） */
.login__tabs {
  display: grid;
  grid-auto-flow: column;
  gap: var(--mc-space-1);
  padding: var(--mc-space-1);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
}

.login__tab {
  padding: var(--mc-space-2);
  border: 0;
  border-radius: var(--mc-radius-sm);
  background: transparent;
  font-size: var(--mc-text-sm);
  color: var(--mc-text-secondary);
  cursor: pointer;
  transition: var(--mc-transition-colors);
}

.login__tab--active {
  background: var(--mc-bg-elevated);
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-semibold);
  box-shadow: var(--mc-shadow-sm);
}

.login__form {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
}

.login__error {
  margin: 0;
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-danger-soft);
  color: var(--mc-danger-fg);
  font-size: var(--mc-text-xs);
}

.login__hint {
  margin: 0;
  padding-top: var(--mc-space-3);
  border-top: 1px solid var(--mc-border);
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading-relaxed);
  color: var(--mc-text-muted);
}

.login__hint code {
  padding: 0 var(--mc-space-1);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-sunken);
  font-family: var(--mc-font-mono);
}

.login__meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--mc-space-2);
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.login__meta-sep {
  opacity: 0.6;
}

@media (max-width: 480px) {
  .login {
    padding: var(--mc-space-4);
  }

  .login__card {
    padding: var(--mc-space-5);
  }
}
</style>
