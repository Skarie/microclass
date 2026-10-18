<script setup lang="ts">
/**
 * 登录 / 注册
 *
 * 布局：**居中卡片**（用户要求）+ 背景承担设计感（渐变 + 圆形光斑 + 堆叠"书本卡"插画）。
 * 要素对标超星学习通：用户登录标题 + 帮助入口 / 账号 / 密码 / 记住账号 / 协议勾选 /
 * 新用户注册 / 页脚信息。做不到的（扫码、验证码、自助找回密码）不放假按钮，改为明确指引。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { errorMessage } from '@/composables/useAsync';

const REMEMBER_KEY = 'mc.login.username';

const appVersion = __APP_VERSION__;
const auth = useAuthStore();
const toast = useToastStore();
const route = useRoute();
const router = useRouter();

const mode = ref<'login' | 'register'>('login');
const form = reactive({ username: '', password: '', confirm: '', displayName: '' });
const submitting = ref(false);
const error = ref('');
const rememberMe = ref(false);
const agreed = ref(false);

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
    !usernameError.value &&
    agreed.value,
);

onMounted(() => {
  try {
    const saved = window.localStorage.getItem(REMEMBER_KEY);
    if (saved) {
      form.username = saved;
      rememberMe.value = true;
    }
  } catch {
    /* 隐私模式下忽略 */
  }
});

function switchMode(next: 'login' | 'register'): void {
  mode.value = next;
  error.value = '';
}

function persistRemember(): void {
  try {
    if (rememberMe.value) window.localStorage.setItem(REMEMBER_KEY, form.username);
    else window.localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* 隐私模式下忽略 */
  }
}

async function submit(): Promise<void> {
  if (!canSubmit.value || submitting.value) return;
  submitting.value = true;
  error.value = '';
  try {
    if (isLogin.value) {
      await auth.login(form.username, form.password);
      persistRemember();
      toast.success('登录成功');
    } else {
      await auth.register(form.username, form.password, form.displayName || undefined);
      persistRemember();
      toast.success('注册成功，已自动登录');
    }
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : null;
    if (redirect) {
      await router.replace(redirect);
    } else {
      // 管理员默认落在教学管理面板；学员落首页
      await router.replace({ name: auth.isTeacher ? 'admin-overview' : 'home' });
    }
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="login">
    <!-- 背景装饰：圆形光斑 + 堆叠书本卡（纯装饰，居中卡片压在上面） -->
    <div class="login__deco" aria-hidden="true">
      <span class="deco__circle deco__circle--a" />
      <span class="deco__circle deco__circle--b" />
      <span class="deco__book deco__book--a" />
      <span class="deco__book deco__book--b" />
      <span class="deco__book deco__book--c" />
    </div>

    <main class="login__card">
      <header class="card__head">
        <span class="card__logo" aria-hidden="true">微</span>
        <h1 class="card__name">{{ auth.siteName }}</h1>
        <p class="card__slogan">看的每一分钟，都算数</p>
      </header>

      <div class="card__titles">
        <h2 class="card__title">{{ isLogin ? '用户登录' : '注册账号' }}</h2>
        <span class="card__help mc-muted">忘记密码请联系管理员重置</span>
      </div>

      <div class="login__tabs" role="tablist" aria-label="登录或注册">
        <button
          class="login__tab"
          :class="{ 'login__tab--active': isLogin }"
          type="button"
          role="tab"
          :aria-selected="isLogin"
          @click="switchMode('login')"
        >
          账号登录
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
          新用户注册
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

        <div class="login__options">
          <label class="mc-checkbox">
            <input v-model="rememberMe" type="checkbox" />
            记住账号
          </label>
          <span class="login__options-hint mc-muted">只记住账号，不保存密码</span>
        </div>

        <p v-if="error" class="login__error" role="alert">{{ error }}</p>

        <button
          class="mc-btn mc-btn--primary mc-btn--lg mc-btn--block"
          type="submit"
          :disabled="!canSubmit || submitting"
        >
          {{ submitting ? '处理中…' : isLogin ? '登录' : '注册并登录' }}
        </button>

        <label class="login__agree">
          <input v-model="agreed" type="checkbox" />
          <span>
            我已了解：本平台是自托管的内部学习系统，账号由管理员创建，学习记录只保存在本机；
            视频与题目内容的版权归各自权利人所有。
          </span>
        </label>
      </form>

      <footer class="card__foot">
        <span class="mc-muted">首次部署的默认管理员账号为 <code>admin</code>，密码由部署时配置决定。</span>
      </footer>
    </main>

    <p class="login__meta">微课堂 v{{ appVersion }} · 自托管轻量学习平台 · 数据保存在本机</p>
  </div>
</template>

<style scoped>
/* 全屏容器：内容整体居中（卡片 + 底部说明） */
.login {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--mc-space-4);
  min-height: 100dvh;
  padding: var(--mc-space-6);
  overflow: hidden;
  background-image: var(--mc-gradient-brand-soft);
}

/* ---------- 背景装饰 ---------- */
.login__deco {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.deco__circle {
  position: absolute;
  border-radius: var(--mc-radius-pill);
  background-image: var(--mc-gradient-brand);
  opacity: 0.1;
}

.deco__circle--a {
  top: -160px;
  left: -120px;
  width: 420px;
  height: 420px;
}

.deco__circle--b {
  bottom: -180px;
  right: -140px;
  width: 380px;
  height: 380px;
  opacity: 0.08;
}

/* 堆叠"书本卡"：给背景一点叙事，不抢卡片 */
.deco__book {
  position: absolute;
  border-radius: var(--mc-radius-lg);
  background: var(--mc-bg-elevated);
  box-shadow: var(--mc-shadow-md);
}

.deco__book--a {
  bottom: 88px;
  left: 96px;
  width: 150px;
  height: 96px;
  transform: rotate(-8deg);
}

.deco__book--b {
  bottom: 40px;
  left: 40px;
  width: 120px;
  height: 78px;
  transform: rotate(7deg);
  opacity: 0.7;
}

.deco__book--c {
  top: 72px;
  right: 80px;
  width: 110px;
  height: 72px;
  transform: rotate(10deg);
  opacity: 0.55;
}

/* ---------- 居中卡片 ---------- */
.login__card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-4);
  width: min(420px, 100%);
  padding: var(--mc-space-6);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-xl);
  background: var(--mc-bg-elevated);
  box-shadow: var(--mc-shadow-lg);
}

.card__head {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--mc-space-1);
  text-align: center;
}

.card__logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-bottom: var(--mc-space-1);
  border-radius: var(--mc-radius-md);
  background-image: var(--mc-gradient-brand);
  color: var(--mc-neutral-0);
  font-size: var(--mc-text-lg);
  font-weight: var(--mc-font-bold);
}

.card__name {
  margin: 0;
  font-size: var(--mc-text-lg);
  font-weight: var(--mc-font-bold);
  color: var(--mc-text);
}

.card__slogan {
  margin: 0;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.card__titles {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--mc-space-2);
}

.card__title {
  margin: 0;
  font-size: var(--mc-text-lg);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
}

.card__help {
  font-size: var(--mc-text-xs);
}

.login__tabs {
  display: flex;
  gap: var(--mc-space-4);
  border-bottom: 1px solid var(--mc-border);
}

.login__tab {
  padding: var(--mc-space-2) 0;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  font-size: var(--mc-text-sm);
  color: var(--mc-text-secondary);
  cursor: pointer;
  transition: var(--mc-transition-colors);
}

.login__tab--active {
  border-bottom-color: var(--mc-primary);
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-semibold);
}

.login__form {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
}

.login__options {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
}

.login__options-hint {
  font-size: var(--mc-text-xs);
}

.login__agree {
  display: flex;
  align-items: flex-start;
  gap: var(--mc-space-2);
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading-loose);
  color: var(--mc-text-muted);
}

.login__agree input {
  margin-top: var(--mc-space-1);
  flex: none;
}

.login__error {
  margin: 0;
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-danger-soft);
  color: var(--mc-danger-fg);
  font-size: var(--mc-text-xs);
}

.card__foot {
  padding-top: var(--mc-space-3);
  border-top: 1px solid var(--mc-border);
  font-size: var(--mc-text-xs);
}

.card__foot code {
  padding: 0 var(--mc-space-1);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-sunken);
  font-family: var(--mc-font-mono);
}

.login__meta {
  position: relative;
  margin: 0;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
  text-align: center;
}

/* 窄屏：装饰收敛，卡片铺满宽度 */
@media (max-width: 720px) {
  .login {
    padding: var(--mc-space-4);
  }

  .deco__book {
    display: none;
  }

  .login__card {
    padding: var(--mc-space-5);
  }

  .card__titles {
    flex-direction: column;
    gap: var(--mc-space-1);
  }
}
</style>
