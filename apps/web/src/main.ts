import { createApp } from 'vue';
import { createPinia } from 'pinia';
import router from './router';
import App from './App.vue';
import { useThemeStore } from './stores/theme';
import './styles/tokens.css';
import './styles/base.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
// 在挂载前应用主题，避免首屏闪烁
useThemeStore().init();
/**
 * 兜底：组件渲染期未捕获的异常。
 * 之前是静默失败——页面局部空白、控制台之外没有任何提示；现在记录并提示一次。
 */
app.config.errorHandler = (err, _instance, info) => {
  console.error('[microclass] 渲染异常：', info, err);
  const message = err instanceof Error ? err.message : String(err);
  // 只提示一次，避免同一异常刷屏
  if (!document.body.dataset.renderErrorShown) {
    document.body.dataset.renderErrorShown = '1';
    const box = document.createElement('div');
    box.className = 'mc-error-banner';
    box.setAttribute('role', 'alert');
    box.textContent = `页面出现异常：${message}（可刷新重试）`;
    document.body.appendChild(box);
  }
};

app.mount('#app');
