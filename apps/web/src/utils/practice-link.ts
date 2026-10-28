/**
 * 实践关联的纯展示逻辑：目标匹配、关联徽标文案、题库/单题标题、题干摘要。
 *
 * 关联弹窗、题库列表行的徽标、题目分组行都按同一份规则找「当前目标的关联记录」；
 * 多个记录时按粒度取一条（后端对同目标会复用同一条 link）。
 */
import type { LessonPracticeBank, PracticeLink, PracticeTargetType } from '@/api/practice';

/** 关联目标：弹窗按它决定 POST 的 targetType / chapter / section / questionId */
export interface PracticeTarget {
  type: PracticeTargetType;
  bankId: number;
  bankName: string;
  /** 章节粒度 / 小节粒度的章节名；bank / question 为空串 */
  chapter: string;
  /** 小节粒度的小节名；其余为空串 */
  section: string;
  /** 单题粒度的题目 id；其余为 null */
  questionId: number | null;
  /** 单题粒度的题干（弹窗里给个上下文） */
  stem?: string;
  /** 打开弹窗时预选课程（题库归属课程） */
  courseId?: number | null;
}

/** 徽标文案 + 悬停提示（课时名） */
export interface LinkBadge {
  text: string;
  title: string;
}

/** 四种粒度的入口都从这里构造 target；chapter/section/questionId 按粒度给 */
export function practiceTargetOf(
  type: PracticeTargetType,
  bank: { id: number; name: string },
  extra: {
    chapter?: string;
    section?: string;
    questionId?: number | null;
    stem?: string;
    courseId?: number | null;
  } = {},
): PracticeTarget {
  return {
    type,
    bankId: bank.id,
    bankName: bank.name,
    chapter: extra.chapter ?? '',
    section: extra.section ?? '',
    questionId: extra.questionId ?? null,
    ...(extra.stem === undefined ? {} : { stem: extra.stem }),
    courseId: extra.courseId ?? null,
  };
}

/** 当前目标是否就是这条关联（章节 / 小节按原文精确匹配） */
export function linkMatches(link: PracticeLink, target: PracticeTarget): boolean {
  if (link.targetType !== target.type) return false;
  if (link.targetType === 'bank') return true;
  if (link.targetType === 'question') return link.questionId === target.questionId;
  if (link.chapter !== target.chapter) return false;
  return link.targetType === 'chapter' || link.section === target.section;
}

/** 从某题库的关联列表里挑出当前目标那一条 */
export function findPracticeLink(links: PracticeLink[], target: PracticeTarget): PracticeLink | undefined {
  return links.find((link) => linkMatches(link, target));
}

/** 整个题库粒度的关联（题库列表行徽标用） */
export function bankPracticeLink(links: PracticeLink[]): PracticeLink | undefined {
  return links.find((link) => link.targetType === 'bank');
}

/** 关联标记：已关联 N 课时，title 列出课时名 */
export function linkBadge(link: PracticeLink | null | undefined): LinkBadge | null {
  if (!link || link.lessonIds.length === 0) return null;
  return {
    text: `已关联 ${link.lessonIds.length} 课时`,
    title: link.lessons.map((lesson) => lesson.title).join('、'),
  };
}

/** 关联目标的人话（弹窗标题下的说明） */
export function targetLabelOf(target: PracticeTarget): string {
  if (target.type === 'bank') return `${target.bankName}（整个题库）`;
  if (target.type === 'chapter') return `${target.bankName} · ${target.chapter}`;
  if (target.type === 'section') return `${target.bankName} · ${target.chapter} · ${target.section}`;
  const stem = stemPreview(target.stem ?? '', 18);
  return stem === '' ? `${target.bankName} · 单题` : `${target.bankName} · 单题「${stem}」`;
}

/** 课时页的题库条目：题库 · 章节 · 小节（空的部分不显示） */
export function practiceBankLabel(bank: Pick<LessonPracticeBank, 'name' | 'chapter' | 'section'>): string {
  return [bank.name, bank.chapter, bank.section].filter((part) => part.trim() !== '').join(' · ');
}

/** 题干纯文本前缀：去掉图片/链接/HTML，压缩空白，超出 max 字加省略号 */
export function stemPreview(stem: string, max = 60): string {
  const text = String(stem ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
