import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'apps/web/dist/**', '**/*.d.ts'],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        // 显式列出工程：测试与根级配置各自有 tsconfig，
        // 不用 projectService 的默认工程兜底（那样拿不到 node 类型）。
        project: [
          './tsconfig.json',
          './apps/*/tsconfig.json',
          './apps/*/tsconfig.test.json',
          './packages/*/tsconfig.json',
          './packages/*/tsconfig.test.json',
          './tests/tsconfig.json',
        ],
        tsconfigRootDir: import.meta.dirname,
        // 让 TS 工程也能解析 .vue 模块类型（前端 .ts 里会 import 组件）
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/require-await': 'off',
      'no-console': ['warn', { allow: ['error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },
  // Vue 单文件组件：模板用 vue-eslint-parser，<script lang="ts"> 交给 tseslint 解析。
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['apps/web/**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        project: ['./apps/web/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      // 组件名与驼峰属性：Vue 官方推荐规则已开启，这里只调整个别项
      'vue/multi-word-component-names': 'off',
      // 排版交给 Prettier，避免两条规则互相打架
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/attributes-order': 'off',
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'no-console': ['warn', { allow: ['error'] }],
    },
  },
  // 配置文件等纯 JS 文件不进 TS 工程，关掉需要类型信息的规则，
  // 否则 tseslint 会因取不到 parserServices 直接报错。
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
);
