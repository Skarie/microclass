/** 题型常量：题库管理页与题目编辑器共用（抽出来避免两处各写一份） */
import type { QuestionType } from '@/api/types';

export const TYPE_LABEL: Record<QuestionType, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  fill: '填空题',
  short: '简答题',
};

export const TYPE_OPTIONS: QuestionType[] = ['single', 'multiple', 'judge', 'fill', 'short'];
