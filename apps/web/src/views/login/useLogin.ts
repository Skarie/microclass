import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { errorMessage } from '@/composables/useAsync';

const REMEMBER_KEY = 'mc.login.username';

/**
 * 登录 / 注册的状态与动作：从 LoginView 抽出来，让视图只负责布局与表单外观。
 * 账号校验、记住账号、协议勾选、登录后跳转都保持原行为。
 */
export function useLogin() {
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

  return {
    auth,
    mode,
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
  };
}
