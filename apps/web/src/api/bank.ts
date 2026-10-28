/**
 * 题库视图模型：列表 / 详情 / 表单共用。
 *
 * 单独成文件：`api/types.ts` 已是历史超限文件（技术债只能减不能增），
 * 文件夹树模型新增的字段放这里，旧文件只保留一层 re-export。
 */
export interface Bank {
  id: number;
  name: string;
  lesson_id: number | null;
  created_at: number;
  lesson_title: string;
  question_count: number;
  /** 题库类型：lesson 课时配套 / chapter 章节题库 / paper 整卷试卷 */
  kind?: 'lesson' | 'chapter' | 'paper';
  subject?: string;
  book?: string;
  section?: string;
  /** 所属文件夹（文件夹树模型）；null = 未分类 */
  folderId?: number | null;
  /** 兼容后端可能沿用的 snake_case 输出 */
  folder_id?: number | null;
  /** 文件夹路径，如「必刷题 / 第一章」 */
  folderPath?: string;
  folder_path?: string;
  /** 关联课程名（空串 = 未关联课程） */
  courseName?: string;
  course_name?: string;
  /** 关联课程 id（接口未返回时为 undefined） */
  course_id?: number | null;
  /** 关联课时标题（与已有 lesson_title 等价，兼容接口命名） */
  lessonTitle?: string;
}
