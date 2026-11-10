/**
 * 题组（母题 + 变式）的视图模型：与 `GET /question-groups` 系列接口的返回结构一致。
 *
 * 命名约定：后端返回 `roleCounts` / `updatedAt`（camelCase），组内题目只带
 * `id / stem / type / difficulty / role / sort`；题干已由后端截断到 200 字（保留图片语法）。
 */

/** 组内角色：母题（stem）/ 变式（variant） */
export type QuestionGroupRole = 'stem' | 'variant';

/** 角色下拉的运行时来源：渲染与校验共用一处，避免各处手写字符串 */
export const QUESTION_GROUP_ROLES: readonly QuestionGroupRole[] = ['stem', 'variant'];

/** 角色中文名（按钮与标签统一用这个） */
export const ROLE_LABEL: Record<QuestionGroupRole, string> = { stem: '母题', variant: '变式' };

/** 列表行 */
export interface QuestionGroupSummary {
  id: number;
  title: string;
  note: string;
  roleCounts: { stem: number; variant: number };
  total: number;
  /** 最后变更时间（UTC 字符串） */
  updatedAt: string;
}

/** 组内题目（详情用） */
export interface QuestionGroupQuestion {
  id: number;
  stem: string;
  type: string;
  difficulty: string;
  role: QuestionGroupRole;
  sort: number;
}

/** 详情：组信息 + 组内题目（母题在前、变式按 sort） */
export interface QuestionGroupDetail extends QuestionGroupSummary {
  questions: QuestionGroupQuestion[];
}

/** 题目详情弹窗里的「所属题组」一行 */
export interface QuestionGroupMembership {
  id: number;
  title: string;
  role: QuestionGroupRole;
}
