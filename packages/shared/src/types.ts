/**
 * 领域类型定义：与数据库表结构一一对应（snake_case 保留，便于直接映射行数据）。
 */
import type { KnowledgeKind, PublishStatus, QuestionType, Role, VideoKind } from './constants.js';

export interface User {
  id: number;
  username: string;
  role: Role;
  display_name: string;
  created_at: number;
}

export interface Category {
  id: number;
  name: string;
  sort: number;
}

export interface Course {
  id: number;
  name: string;
  description: string;
  sort: number;
  created_at: number;
  category_id: number | null;
  cover: string;
  published: 0 | 1;
  /** 绑定的媒体根目录 id（课程文件夹），未绑定为 null */
  folder_root_id: string | null;
  /** 媒体根目录下的相对路径（空串表示根目录本身） */
  folder_path: string | null;
  /** 上次扫描导入时间（Unix 秒），未扫描过为 null */
  last_scan_at: number | null;
}

/** 课时来源：manual = 手工创建/上传，folder = 课程文件夹扫描导入 */
export type LessonSource = 'manual' | 'folder';

export interface Lesson {
  id: number;
  title: string;
  description: string;
  video_kind: VideoKind;
  media_root: string;
  video_path: string;
  sort: number;
  created_at: number;
  group_name: string;
  course_id: number | null;
  /** 视频总秒数（ffprobe 抽取；未抽取为 null） */
  duration: number | null;
  /** 封面图相对路径（uploads 下，例如 covers/lesson_xxx.jpg） */
  cover_path: string;
  /** 媒体类型（video/audio/other） */
  media_type: string;
  /** 元数据抽取时间（毫秒为空表示还没抽过） */
  probed_at: number | null;
  /** 课时来源（manual / folder），历史数据为 manual */
  source: LessonSource;
}

export interface Knowledge {
  id: number;
  lesson_id: number;
  title: string;
  kind: KnowledgeKind;
  file_name: string;
  file_path: string;
  content: string;
  url: string;
  sort: number;
  created_at: number;
}

export interface Bank {
  id: number;
  name: string;
  lesson_id: number | null;
  created_at: number;
  /** 题库类型：lesson 课时配套 / chapter 章节题库 / paper 整卷试卷（迁移 0008） */
  kind?: BankKind;
  subject?: string;
  book?: string;
  /** 归属课程（迁移 0017）：目录树与组卷题池按它分类 */
  course_id?: number | null;
}

export type BankKind = 'lesson' | 'chapter' | 'paper';
export interface Question {
  id: number;
  bank_id: number;
  lesson_id: number | null;
  type: QuestionType;
  stem: string;
  image_path: string;
  options: string;
  answer: string;
  analysis: string;
  sort: number;
  created_at: number;
  /** 难度：easy / medium / hard，空串表示未标注 */
  difficulty: string;
  /** 难度模型（迁移 0016）：0–100 综合分，-1 表示还没算过 */
  difficulty_score?: number;
  /** 难度来源：auto 模型先验 / calibrated 作答校准 / manual 老师手改 */
  difficulty_source?: string;
  /** 参与校准的作答样本数与经验正确率 */
  difficulty_n?: number;
  difficulty_p?: number | null;
  /** 标准化元数据（迁移 0008，历史数据为空串） */
  subject?: string;
  stage?: string;
  book?: string;
  chapter?: string;
  point?: string;
  source_path?: string;
  source_no?: string;
  content_hash?: string;
  /** 题干/选项/解析里是否引用了题图（迁移 0009 的预计算列，0/1） */
  has_image?: number;
}

export interface LessonProgress {
  user_id: number;
  lesson_id: number;
  position: number;
  duration: number;
  finished: 0 | 1;
  quiz_done: 0 | 1;
  quiz_best: number;
  updated_at: number;
}

export interface LessonNote {
  id: number;
  user_id: number;
  lesson_id: number;
  pos: number;
  text: string;
  created_at: number;
}

export interface WrongQuestion {
  user_id: number;
  question_id: number;
  wrong_count: number;
  mastered: 0 | 1;
  last_at: number;
}

export interface Exam {
  id: number;
  course_id: number;
  title: string;
  description: string;
  duration_minutes: number;
  pass_score: number;
  status: PublishStatus;
  created_at: number;
  /** 试卷结构（大题分组，迁移 0018）：JSON 字符串 */
  structure?: string;
  /** 目标难度配比：{"easy":0.3,"medium":0.5,"hard":0.2} */
  difficulty_target?: string;
  /** 试卷总分（默认 100） */
  total_score?: number;
  /** 考试开始时间（unix 秒；0 = 不限） */
  start_at?: number;
  /** 考试结束时间（unix 秒；0 = 不限） */
  end_at?: number;
  /** 允许作答次数（0 = 不限） */
  attempt_limit?: number;
  /** 题目顺序随机（0/1） */
  shuffle_questions?: number;
  /** 交卷后是否公布答案解析（0/1） */
  show_answers?: number;
}

/** 统一 API 错误信封 */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

/** 分页响应 */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
