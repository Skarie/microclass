/**
 * 组卷组件的共享类型。
 *
 * 为什么单独放文件：`<script setup>` 里不允许 `export`，类型没法被别的模块 import；
 * 写在 `.vue` 里会让使用方退化成 `any`（ESLint 的 no-unsafe-* 会直接报错）。
 */

/** 选题树的册次节点 */
export interface FacetBook {
  /** 过滤用的真实值；空值用哨兵 `__none__`（对应"未标注"节点） */
  book: string;
  /** 展示用文案 */
  label: string;
  count: number;
  chapters: { chapter: string; label: string; count: number }[];
}

/** 知识点节点（按章节懒加载 / 搜索结果） */
export interface FacetPoint {
  /** 过滤用真实值（空值 = `__none__`） */
  point: string;
  /** 展示用文案 */
  label: string;
  chapter: string;
  count: number;
}

/** 题库里的题目（选题表格一行） */
export interface ComposeQuestionRow {
  id: number;
  stem: string;
  type: string;
  bank_name: string;
  point: string;
  book?: string;
  chapter?: string;
  difficulty: string;
  difficulty_score?: number;
  attempts?: number;
  error_rate?: number;
}
