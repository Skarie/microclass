import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * 前端构建：产物输出到 apps/web/dist，由 API 服务同源托管
 * （apps/api 的 MC_WEB_DIST 指向该目录）。
 * 开发期用 dev server + 代理，避免跨域与 Cookie 问题。
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 开发期默认连本机 API；连远端（如 NAS 上的真机数据）时设 MC_DEV_API，
      // 例如：MC_DEV_API=http://<NAS-IP>:8091 npm run dev:web
      '/api': {
        target: process.env.MC_DEV_API ?? 'http://127.0.0.1:8091',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue', 'vue-router', 'pinia'],
        },
      },
    },
  },
});
