<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { errorMessage } from '@/composables/useAsync';

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
    <div class="login__aside">
      <div class="login__brand">
        <span class="login__logo" aria-hidden="true">微</span>
        <span>{{ auth.siteName }}</span>
      </div>
      <h1 class="login__slogan">看的每一分钟，都算数</h1>
      <p class="login__desc">课程视频 · 章节归类 · 课后刷题 · 错题本 · 在线考试，一站式轻量学习平台。</p>
      <ul class="login__features">
        <li><Icon name="video" :size="16" /> 本地视频与外部链接统一管理，支持断点续播</li>
        <li><Icon name="bank" :size="16" /> 题库导入导出，五种题型自动判分</li>
        <li><Icon name="wrong" :size="16" /> 错题自动收录，答对自动标记掌握</li>
        <li><Icon name="stats" :size="16" /> 学习统计与成绩单导出，进度一目了然</li>
      </ul>
    </div>

    <div class="login__panel">
      <div class="mc-card login__card">
        <div class="login__tabs" role="tablist">
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

        <form class="mc-col login__form" @submit.prevent="submit">
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
            {{ submitting ? '处理中…' : isLogin ? '登录' : '注册并登录' }}
          </button>
        </form>
      </div>
      <p class="login__foot mc-muted">首次部署的默认管理员账号为 admin，密码由部署时配置决定。</p>
    </div>
  </div>
</template>

<style scoped>
.login {
  min-height: 100%;
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  background: transparent;
}

.login__aside {
  position: relative;
  overflow: hidden;
  padding: var(--mc-space-12) var(--mc-space-10);
  /* 墨卷：纯色深松绿面板，不用多色渐变；白字对比充足 */
  background-image: none;
  background-color: var(--mc-primary-700);
  color: var(--mc-neutral-0);
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-4);
  justify-content: center;
}

/* 墨卷：不加装饰光斑，保持平面 */
.login__aside > * {
  position: relative;
  z-index: 1;
}

.login__brand {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  font-size: var(--mc-text-lg);
  font-weight: 600;
}

.login__logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: var(--mc-radius-md);
  background: var(--mc-overlay-light);
  border: 1px solid color-mix(in srgb, var(--mc-neutral-0) 30%, transparent);
  font-weight: 700;
}

.login__slogan {
  font-size: var(--mc-text-3xl);
  font-weight: var(--mc-font-bold);
  letter-spacing: var(--mc-tracking-tight);
  line-height: var(--mc-leading-tight);
  max-width: 460px;
}

.login__desc {
  max-width: 460px;
  opacity: 0.9;
  margin: 0;
}

.login__features {
  margin: var(--mc-space-4) 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  font-size: var(--mc-text-sm);
  opacity: 0.92;
}

.login__panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--mc-space-4);
  padding: var(--mc-space-10) var(--mc-space-8);
}

.login__card {
  width: 100%;
  max-width: 400px;
  padding: var(--mc-space-6);
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-5);
}

.login__tabs {
  display: flex;
  gap: var(--mc-space-4);
  border-bottom: 1px solid var(--mc-border);
}

.login__tab {
  padding: var(--mc-space-2) 0;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--mc-text-secondary);
  font: inherit;
  font-size: var(--mc-text-md);
  font-weight: 500;
  cursor: pointer;
}

.login__tab--active {
  color: var(--mc-primary-fg);
  border-bottom-color: var(--mc-primary);
}

.login__form {
  gap: var(--mc-space-4);
}

.login__error {
  margin: 0;
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius);
  background: var(--mc-danger-soft);
  color: var(--mc-danger-fg);
  font-size: var(--mc-text-sm);
}

.login__foot {
  font-size: var(--mc-text-xs);
  max-width: 400px;
  text-align: center;
  margin: 0;
}

@media (max-width: 900px) {
  .login {
    grid-template-columns: 1fr;
  }

  .login__aside {
    display: none;
  }
}
</style>
