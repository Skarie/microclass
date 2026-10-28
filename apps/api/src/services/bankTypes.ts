/**
 * 题库服务的对外输入 DTO：路由层与 BankService 共用，拆服务时保持签名不变。
 */
import type { QuestionType } from '@microclass/shared';

export interface BankDto {
  name: string;
  lessonId?: number | null;
  /** 标准化元数据（题库类型/学科/书册）：新建题目会继承，难度模型据此判断学段 */
  kind?: string;
  subject?: string;
  book?: string;
  /** 章节（迁移 0023）：trim，最长 120；为空且绑了课时则继承 group_name */
  section?: string;
  /** 归属课程（手工把「未归属」的题库挂到某门课）；`null` = 移出课程 */
  courseId?: number | null;
  /** 归属文件夹（迁移 0024）；`null` = 移到未分类，不传 = 不变 */
  folderId?: number | null;
}

export interface QuestionDto {
  bankId: number;
  lessonId?: number | null;
  type: QuestionType;
  stem: string;
  /** 选项文本；单/多选题以字母串（如 "ACD"）或下标串（"0,2"）提交答案 */
  options?: string[];
  answer?: string;
  analysis?: string;
  sort?: number;
  /** 直接指定已上传图片的相对路径（一般走独立的图片上传接口） */
  imagePath?: string;
  /** 难度：easy / medium / hard（留空 = 交给难度模型自动判定） */
  difficulty?: string;
  /**
   * 允许缺答案：仅"资料批量导入"使用（答案册扫描不清/缺失时，整题不该丢）。
   * 界面单题创建不传，仍强制填答案。
   */
  allowMissingAnswer?: boolean;
  /** 标准化元数据：不传则**继承题库**的学科/书册（难度模型的学段基准靠它） */
  subject?: string;
  stage?: string;
  book?: string;
  chapter?: string;
  point?: string;
}
