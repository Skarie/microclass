/**
 * 实践关联（迁移 0025）的视图模型与请求。
 *
 * 一个「目标」可以关联多个课时：整个题库 / 题库内章节 / 小节 / 单道题。
 * 接口返回统一是 camelCase（与题库、课程的 snake_case 不同），这里原样沿用。
 */
import { api } from './client';

export type PracticeTargetType = 'bank' | 'chapter' | 'section' | 'question';

/** 关联到某个课时的简要信息（弹窗里展示已关联课时用） */
export interface PracticeLinkLesson {
  id: number;
  title: string;
  courseId: number | null;
  courseName: string;
  groupName: string;
}

export interface PracticeLink {
  id: number;
  targetType: PracticeTargetType;
  bankId: number;
  questionId: number | null;
  chapter: string;
  section: string;
  lessonIds: number[];
  lessons: PracticeLinkLesson[];
  createdAt: string;
}

/** 新建关联的请求体；chapter/section/questionId 只在对应粒度传 */
export interface PracticeLinkInput {
  targetType: PracticeTargetType;
  bankId: number;
  questionId?: number;
  chapter?: string;
  section?: string;
  lessonIds: number[];
}

/** 课时页的练习来源：题库（可带章节/小节范围） */
export interface LessonPracticeBank {
  bankId: number;
  name: string;
  chapter: string;
  section: string;
}

/** 课时页的练习来源：单题 */
export interface LessonPracticeQuestion {
  linkId: number;
  bankId: number;
  bankName: string;
  questionId: number;
  stem: string;
}

/** `GET /lessons/:id/practice` 的返回 */
export interface LessonPractice {
  lessonId: number;
  banks: LessonPracticeBank[];
  questions: LessonPracticeQuestion[];
}

export const practiceApi = {
  listByBank: (bankId: number): Promise<PracticeLink[]> => api.get<PracticeLink[]>('/practice-links', { bankId }),
  create: async (input: PracticeLinkInput): Promise<PracticeLink> =>
    (await api.post<{ link: PracticeLink }>('/practice-links', input)).link,
  update: async (id: number, lessonIds: number[]): Promise<PracticeLink> =>
    (await api.patch<{ link: PracticeLink }>(`/practice-links/${id}`, { lessonIds })).link,
  remove: (id: number): Promise<{ ok: boolean }> => api.del<{ ok: boolean }>(`/practice-links/${id}`),
  lessonPractice: (lessonId: number): Promise<LessonPractice> =>
    api.get<LessonPractice>(`/lessons/${lessonId}/practice`),
};
