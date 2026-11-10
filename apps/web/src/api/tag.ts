/**
 * 自由标签（迁移 0030）的视图模型：与 `/tags` 系列接口的返回结构一致。
 *
 * 标签是**教研标记**（易错 / 高考真题 / 自编 / 需重录），和「知识点」分开：
 * 知识点回答「这题考什么」，标签回答「这题在教学上怎么用」。
 */

/** 列表行：标签 + 题目数 */
export interface TagItem {
  id: number;
  name: string;
  note: string;
  questionCount: number;
  /** UTC 时间字符串 */
  createdAt: string;
}

/** 题目详情里的一个标签 */
export interface QuestionTagItem {
  id: number;
  name: string;
  note: string;
  createdAt: string;
}

/** 批量打标语义：只加 / 只删指定 / 整题覆盖 */
export type TagBatchMode = 'add' | 'remove' | 'replace';

/** 标签筛选模式：命中任意一个 / 同时包含全部 */
export type TagFilterMode = 'any' | 'all';
