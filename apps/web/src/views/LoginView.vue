<script setup lang="ts">
/**
 * 登录 / 注册（对标超星学习通 passport2.chaoxing.com/login 的结构与要素）
 *
 * 学习通登录页的真实要素（抓取实际页面）：
 *   用户登录标题 + 客服入口 / 账号 / 密码 / 忘记密码 / 登录 / 「下次自动登录」+ 说明 /
 *   新用户注册 / 验证码登录 / 其他登录方式 / 扫码登录 / 勾选同意协议 / 页脚备案信息
 *
 * 我们做不到的不假装：没有扫码（无 App）、没有验证码登录（无短信）、没有自助找回密码
 * （无邮件/短信通道）—— 改为明确指引：联系管理员重置。
 * 能真做的都做了：
 *   - 「记住账号」：真实记忆到 localStorage（只记账号，不保存密码）
 *   - 协议勾选：不勾选不能登录（文案写本平台真实情况，不是法务套话）
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { errorMessage } from '@/composables/useAsync';
import Icon from '@/components/Icon.vue';

const REMEMBER_KEY = 'mc.login.username';

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
    <!-- 左侧：品牌 + 抽象插画（学习通式分栏，浅底） -->
    <aside class="login__brand">
      <div class="brand__deco" aria-hidden="true">
        <span class="brand__circle brand__circle--a" />
        <span class="brand__circle brand__circle--b" />
        <span class="brand__book brand__book--a" />
        <span class="brand__book brand__book--b" />
        <span class="brand__book brand__book--c" />
      </div>

      <header class="brand__head">
        <span class="brand__logo" aria-hidden="true">微</span>
        <span class="brand__name">{{ auth.siteName }}</span>
      </header>

      <div class="brand__text">
        <h1 class="brand__slogan">看的每一分钟，都算数</h1>
        <p class="brand__desc">课程视频、章节归类、课后练习与错题本一体的一站式学习平台。</p>
      </div>

      <ul class="brand__points">
        <li><Icon name="video" :size="15" /> 本地视频与外部链接统一管理，断点续播</li>
        <li><Icon name="check-circle" :size="15" /> 看完 80% 才解锁练习，进度真实可信</li>
        <li><Icon name="bank" :size="15" /> 题库导入导出，五种题型自动判分</li>
        <li><Icon name="wrong" :size="15" /> 错题自动收录，答对自动标记掌握</li>
      </ul>
    </aside>

    <!-- 右侧：表单 -->
    <main class="login__main">
      <div class="login__card">
        <header class="card__head">
          <h2 class="card__title">{{ isLogin ? '用户登录' : '注册账号' }}</h2>
          <span class="card__help mc-muted">忘记密码请联系管理员重置</span>
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
      </div>

      <p class="login__meta">微课堂 · 自托管轻量学习平台 · 数据保存在本机</p>
    </main>
  </div>
</template>

<style scoped>
.login {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  min-height: 100dvh;
  background: var(--mc-bg-elevated);
}

/* ---------- 左侧品牌区（学习通式：浅底 + 抽象插画） ---------- */
.login__brand {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-6);
  padding: var(--mc-space-8);
  overflow: hidden;
  background-image: var(--mc-gradient-brand-soft);
  border-right: 1px solid var(--mc-border);
}

.brand__deco {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.brand__circle {
  position: absolute;
  border-radius: var(--mc-radius-pill);
  background-image: var(--mc-gradient-brand);
  opacity: 0.12;
}

.brand__circle--a {
  top: -120px;
  right: -80px;
  width: 340px;
  height: 340px;
}

.brand__circle--b {
  bottom: -140px;
  left: -100px;
  width: 300px;
  height: 300px;
  opacity: 0.08;
}

/* 抽象"书本/卡片"插画：矩形 + 圆角堆出层次 */
.brand__book {
  position: absolute;
  border-radius: var(--mc-radius-md);
  background: var(--mc-bg-elevated);
  box-shadow: var(--mc-shadow-md);
}

.brand__book--a {
  right: 60px;
  bottom: 150px;
  width: 150px;
  height: 96px;
  transform: rotate(-6deg);
}

.brand__book--b {
  right: 130px;
  bottom: 96px;
  width: 120px;
  height: 78px;
  transform: rotate(8deg);
  opacity: 0.7;
}

.brand__book--c {
  right: 40px;
  bottom: 40px;
  width: 96px;
  height: 64px;
  transform: rotate(-12deg);
  opacity: 0.45;
}

.brand__head {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
}

.brand__logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-primary);
  color: var(--mc-neutral-0);
  font-weight: var(--mc-font-bold);
}

.brand__name {
  font-size: var(--mc-text-base);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
}

.brand__text {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  max-width: 26rem;
  margin-top: var(--mc-space-6);
}

.brand__slogan {
  margin: 0;
  font-size: var(--mc-text-2xl);
  font-weight: var(--mc-font-bold);
  line-height: var(--mc-leading-display);
  letter-spacing: var(--mc-tracking-tight);
  color: var(--mc-text);
}

.brand__desc {
  margin: 0;
  font-size: var(--mc-text-sm);
  line-height: var(--mc-leading-loose);
  color: var(--mc-text-secondary);
}

.brand__points {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--mc-text-sm);
  color: var(--mc-text-secondary);
}

.brand__points li {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
}

.brand__points :deep(svg) {
  color: var(--mc-primary-fg);
  flex: none;
}

/* ---------- 右侧表单 ---------- */
.login__main {
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
  width: min(400px, 100%);
}

.card__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--mc-space-2);
}

.card__title {
  margin: 0;
  font-size: var(--mc-text-xl);
  font-weight: var(--mc-font-bold);
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
  margin: 0;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

/* ---------- 窄屏：收起插画区，表单铺满 ---------- */
@media (max-width: 1080px) {
  .login {
    grid-template-columns: 1fr;
  }

  .login__brand {
    gap: var(--mc-space-3);
    padding: var(--mc-space-6) var(--mc-space-5);
    border-right: 0;
    border-bottom: 1px solid var(--mc-border);
  }

  .brand__text {
    margin-top: 0;
  }

  .brand__slogan {
    font-size: var(--mc-text-xl);
  }

  .brand__points,
  .brand__book {
    display: none;
  }

  .login__main {
    padding: var(--mc-space-5);
  }
}

@media (max-width: 480px) {
  .login__brand {
    padding: var(--mc-space-5) var(--mc-space-4);
  }

  .login__main {
    padding: var(--mc-space-4);
  }
}
</style>
