<script setup lang="ts">
/**
 * 登录 / 注册
 *
 * 设计方向（用户反馈：「上一版太素，要更有设计感」）：
 *   左侧＝有分量的品牌面板：深绿渐变底 + 环状图层 + 悬浮的"课程卡/进度卡"叙事 + 大标题 + 功能清单
 *   右侧＝登录卡片：分段切换、字段、错误块、主按钮、默认账号提示
 *   窄屏＝品牌面板收成顶部横幅，表单铺满（不做左右分栏）
 *
 * 对比度：品牌面板用深绿渐变（--mc-gradient-primary），白字全程 >= 4.7:1；
 * 高亮用浅绿 --mc-primary-200（深底上足够亮），不用橙色（深底上不够）。
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
    <!-- 品牌面板 -->
    <aside class="login__aside">
      <div class="aside__rings" aria-hidden="true">
        <span class="aside__ring aside__ring--a" />
        <span class="aside__ring aside__ring--b" />
        <span class="aside__ring aside__ring--c" />
      </div>

      <header class="aside__brand">
        <span class="aside__logo" aria-hidden="true">微</span>
        <span class="aside__name">{{ auth.siteName }}</span>
      </header>

      <div class="aside__main">
        <p class="aside__eyebrow">自托管 · 轻量学习平台</p>
        <h1 class="aside__slogan">
          看的每一分钟<br />
          <em>都算数</em>
        </h1>
        <p class="aside__desc">课程视频、章节归类、课后练习与错题本一体；断点续播，练习自动归档。</p>

        <ul class="aside__features">
          <li class="aside__feature">
            <span class="aside__feature-icon"><Icon name="video" :size="15" /></span>
            本地视频与外部链接统一管理
          </li>
          <li class="aside__feature">
            <span class="aside__feature-icon"><Icon name="check-circle" :size="15" /></span>
            看完 80% 才解锁练习，进度真实可信
          </li>
          <li class="aside__feature">
            <span class="aside__feature-icon"><Icon name="wrong" :size="15" /></span>
            错题自动收录，答对自动标记掌握
          </li>
        </ul>
      </div>

      <!-- 悬浮卡片：用界面元素讲"这里能干什么"（纯装饰） -->
      <div class="aside__cards" aria-hidden="true">
        <div class="aside__card aside__card--course">
          <span class="aside__card-cover" />
          <span class="aside__card-lines">
            <i class="aside__card-line" />
            <i class="aside__card-line aside__card-line--short" />
          </span>
        </div>
        <div class="aside__card aside__card--progress">
          <span class="aside__card-label">本周学习</span>
          <span class="aside__card-value mc-num">4.2 小时</span>
          <span class="aside__card-track"><i class="aside__card-fill" /></span>
        </div>
        <div class="aside__card aside__card--done">
          <Icon name="check-circle" :size="16" />
          已完成 12 个课时
        </div>
      </div>
    </aside>

    <!-- 表单面板 -->
    <main class="login__panel">
      <div class="login__card">
        <header class="login__head">
          <h2 class="login__title">{{ isLogin ? '登录' : '注册账号' }}</h2>
          <p class="login__sub">{{ isLogin ? '继续你的学习进度' : '创建账号后自动登录' }}</p>
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
            {{ submitting ? '处理中…' : isLogin ? '登录' : '注册并登录' }}
          </button>
        </form>

        <p class="login__hint">首次部署的默认管理员账号为 <code>admin</code>，密码由部署时配置决定。</p>
      </div>

      <p class="login__meta">微课堂 · 数据保存在你自己的机器上</p>
    </main>
  </div>
</template>

<style scoped>
.login {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  min-height: 100dvh;
  background: var(--mc-bg-elevated);
}

/* ---------- 品牌面板 ---------- */
.login__aside {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-6);
  padding: var(--mc-space-8);
  overflow: hidden;
  background-image: var(--mc-gradient-primary);
  background-color: var(--mc-primary-700);
}

/* 环状图层：给面板空间感（纯装饰） */
.aside__rings {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.aside__ring {
  position: absolute;
  border-radius: var(--mc-radius-pill);
  border: 1px solid var(--mc-primary-300);
  opacity: 0.35;
}

.aside__ring--a {
  top: -80px;
  right: -60px;
  width: 320px;
  height: 320px;
}

.aside__ring--b {
  top: 40px;
  right: 20px;
  width: 200px;
  height: 200px;
  opacity: 0.25;
}

.aside__ring--c {
  bottom: -120px;
  left: -80px;
  width: 360px;
  height: 360px;
  opacity: 0.2;
}

.aside__brand {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
}

.aside__logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-elevated);
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-bold);
}

.aside__name {
  font-size: var(--mc-text-base);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-neutral-0);
}

.aside__main {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  max-width: 30rem;
}

.aside__eyebrow {
  margin: 0;
  font-size: var(--mc-text-xs);
  letter-spacing: 0.12em;
  color: var(--mc-primary-100);
}

.aside__slogan {
  margin: 0;
  font-size: var(--mc-text-3xl);
  font-weight: var(--mc-font-bold);
  line-height: var(--mc-leading-display);
  letter-spacing: var(--mc-tracking-tight);
  color: var(--mc-neutral-0);
}

.aside__slogan em {
  font-style: normal;
  color: var(--mc-primary-200);
}

.aside__desc {
  margin: 0;
  font-size: var(--mc-text-sm);
  line-height: var(--mc-leading-loose);
  color: var(--mc-primary-100);
}

.aside__features {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  margin: var(--mc-space-2) 0 0;
  padding: 0;
  list-style: none;
}

.aside__feature {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  font-size: var(--mc-text-sm);
  color: var(--mc-primary-100);
}

.aside__feature-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--mc-radius-pill);
  background: var(--mc-primary-800);
  color: var(--mc-primary-200);
  flex: none;
}

/* 悬浮卡片：右下堆叠，形成层次 */
.aside__cards {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  margin-top: auto;
  width: 250px;
  align-self: flex-end;
}

.aside__card {
  border-radius: var(--mc-radius-lg);
  background: var(--mc-bg-elevated);
  box-shadow: var(--mc-shadow-lg);
}

.aside__card--course {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-2);
}

.aside__card-cover {
  display: block;
  width: 52px;
  height: 36px;
  border-radius: var(--mc-radius-sm);
  background-image: var(--mc-gradient-brand-soft);
  flex: none;
}

.aside__card-lines {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  flex: 1;
}

.aside__card-line {
  display: block;
  height: 7px;
  border-radius: var(--mc-radius-pill);
  background: var(--mc-bg-sunken);
}

.aside__card-line--short {
  width: 60%;
}

.aside__card--progress {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  padding: var(--mc-space-3);
}

.aside__card-label {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.aside__card-value {
  font-size: var(--mc-text-lg);
  font-weight: var(--mc-font-bold);
  color: var(--mc-text);
}

.aside__card-track {
  display: block;
  height: 5px;
  border-radius: var(--mc-radius-pill);
  background: var(--mc-bg-sunken);
  overflow: hidden;
}

.aside__card-fill {
  display: block;
  width: 62%;
  height: 100%;
  border-radius: var(--mc-radius-pill);
  background-image: var(--mc-gradient-progress);
}

.aside__card--done {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-2) var(--mc-space-3);
  font-size: var(--mc-text-xs);
  color: var(--mc-success-fg);
}

/* ---------- 表单面板 ---------- */
.login__panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--mc-space-4);
  padding: var(--mc-space-8);
}

.login__card {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-4);
  width: min(380px, 100%);
  padding: var(--mc-space-6);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-xl);
  background: var(--mc-bg-elevated);
  box-shadow: var(--mc-shadow-lg);
}

.login__head {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
}

.login__title {
  margin: 0;
  font-size: var(--mc-text-xl);
  font-weight: var(--mc-font-bold);
  color: var(--mc-text);
}

.login__sub {
  margin: 0;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

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
  margin: 0;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

/* ---------- 窄屏：品牌面板收成横幅 ---------- */
@media (max-width: 1080px) {
  .login {
    grid-template-columns: 1fr;
  }

  .login__aside {
    gap: var(--mc-space-3);
    padding: var(--mc-space-6) var(--mc-space-5);
  }

  .aside__main {
    gap: var(--mc-space-2);
  }

  .aside__slogan {
    font-size: var(--mc-text-2xl);
  }

  .aside__desc,
  .aside__features,
  .aside__cards {
    display: none;
  }

  .login__panel {
    padding: var(--mc-space-5);
  }
}

@media (max-width: 480px) {
  .login__aside {
    padding: var(--mc-space-5) var(--mc-space-4);
  }

  .login__panel {
    padding: var(--mc-space-4);
  }

  .login__card {
    padding: var(--mc-space-5);
  }
}
</style>
