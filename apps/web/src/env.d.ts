/// <reference types="vite/client" />

/**
 * 让纯 TypeScript 工具链（eslint 的类型感知规则、tsc）也能解析 .vue 单文件组件。
 * vue-tsc 会优先使用 Volar 生成的真实组件类型，这里的声明只是兜底。
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
