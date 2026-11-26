/**
 * 实践关联服务：题库 / 章节 / 小节 / 单题 四种目标，一个目标可关联多个课时。
 *
 * 写操作只允许教师/管理员（路由层守卫）；读接口登录即可，学生按课时看到
 * 该课时挂的整个题库、章节/小节范围与单题。
 */
import { AppError, type User } from '@microclass/shared';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { BankRepository } from '../db/repositories/bankRepository.js';
import type { LessonRepository } from '../db/repositories/lessonRepository.js';
import type { QuestionRepository } from '../db/repositories/questionRepository.js';
import type {
  LessonLinkRow,
  PracticeLinkRepository,
  PracticeLinkRow,
  PracticeTarget,
} from '../db/repositories/practiceLinkQueries.js';
import { QUESTION_SECTION_MAX } from '../domain/questionCsv.js';

export type PracticeTargetType = 'bank' | 'chapter' | 'section' | 'question';
const TARGET_TYPES: readonly PracticeTargetType[] = ['bank', 'chapter', 'section', 'question'];

export interface PracticeLinkLessonDto {
  id: number;
  title: string;
  courseId: number | null;
  courseName: string;
  groupName: string;
}

export interface PracticeLinkDto {
  id: number;
  targetType: PracticeTargetType;
  bankId: number;
  questionId: number | null;
  chapter: string;
  section: string;
  lessonIds: number[];
  lessons: PracticeLinkLessonDto[];
  createdAt: string;
}

export interface PracticeLinkInput {
  targetType: string;
  bankId: number;
  questionId?: number;
  chapter?: string;
  section?: string;
  lessonIds: number[];
}

export interface LessonPracticeBank {
  bankId: number;
  name: string;
  chapter: string;
  section: string;
}

export interface LessonPracticeQuestion {
  linkId: number;
  bankId: number;
  bankName: string;
  questionId: number;
  stem: string;
}

export interface LessonPracticeResult {
  lessonId: number;
  banks: LessonPracticeBank[];
  questions: LessonPracticeQuestion[];
}

const normalizeSection = (value: string | undefined): string =>
  String(value ?? '')
    .trim()
    .slice(0, QUESTION_SECTION_MAX);

/** 题干纯文本前缀：去掉图片/链接/HTML，压缩空白，最多 max 字 */
export function plainStemPrefix(stem: string, max = 120): string {
  const text = String(stem ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, max);
}

export class PracticeLinkService {
  constructor(
    private readonly links: PracticeLinkRepository,
    private readonly banks: BankRepository,
    private readonly questions: QuestionRepository,
    private readonly lessons: LessonRepository,
    private readonly audit: AuditRepository,
  ) {}

  async list(bankId: number): Promise<PracticeLinkDto[]> {
    const rows = await this.links.listByBank(bankId);
    return Promise.all(rows.map((row) => this.dto(row)));
  }

  async create(actor: User, input: PracticeLinkInput): Promise<PracticeLinkDto> {
    const target = await this.normalizeTarget(input);
    const lessonIds = this.normalizeLessonIds(input.lessonIds);
    await this.assertLessons(lessonIds);
    // 同目标重复关联：不报错，复用已有 link 并补上缺少的课时
    const existing = await this.links.findByTarget(target);
    const link = existing ?? (await this.links.insert(target));
    if (existing) await this.links.addLessonIds(link.id, lessonIds);
    else await this.links.setLessonIds(link.id, lessonIds);
    await this.writeAudit(actor, 'practice_link.create', link.id, { ...target, lessonIds });
    return await this.dto(link);
  }

  async update(actor: User, id: number, lessonIds: number[]): Promise<PracticeLinkDto> {
    const row = await this.links.findById(id);
    if (!row) throw AppError.notFound('实践关联不存在');
    const normalized = this.normalizeLessonIds(lessonIds);
    await this.assertLessons(normalized);
    await this.links.setLessonIds(id, normalized);
    await this.writeAudit(actor, 'practice_link.update', id, { lessonIds: normalized });
    return await this.dto(row);
  }

  async remove(actor: User, id: number): Promise<void> {
    const row = await this.links.findById(id);
    if (!row) throw AppError.notFound('实践关联不存在');
    await this.links.delete(id);
    await this.writeAudit(actor, 'practice_link.delete', id, {
      targetType: row.target_type,
      bankId: row.bank_id,
      questionId: row.question_id,
    });
  }

  /** 某课时关联的练习内容：题库/章节/小节进 banks，单题进 questions */
  async lessonPractice(lessonId: number): Promise<LessonPracticeResult> {
    if (!(await this.lessons.findById(lessonId))) throw AppError.notFound('课时不存在');
    const rows = await this.links.listByLesson(lessonId);
    const banks: LessonPracticeBank[] = [];
    const seenBank = new Set<string>();
    for (const row of rows) {
      if (row.target_type !== 'bank' && row.target_type !== 'chapter' && row.target_type !== 'section') continue;
      const bank = await this.banks.findById(row.bank_id);
      if (!bank) continue;
      const key = `${row.bank_id}\u0000${row.chapter}\u0000${row.section}`;
      if (seenBank.has(key)) continue;
      seenBank.add(key);
      banks.push({ bankId: bank.id, name: bank.name, chapter: row.chapter, section: row.section });
    }
    const questionLinks = rows.filter((row) => row.target_type === 'question');
    const questionRows = await this.links.questionsFor(questionLinks.map((row) => row.id));
    const questions = questionRows.map((row) => ({
      linkId: row.link_id,
      bankId: row.bank_id,
      bankName: row.bank_name,
      questionId: row.question_id,
      stem: plainStemPrefix(row.stem),
    }));
    return { lessonId, banks, questions };
  }

  private async normalizeTarget(input: PracticeLinkInput): Promise<PracticeTarget> {
    const targetType = String(input.targetType) as PracticeTargetType;
    if (!TARGET_TYPES.includes(targetType)) throw AppError.badRequest('关联目标类型非法');
    const bankId = Number(input.bankId);
    if (!Number.isInteger(bankId) || bankId <= 0) throw AppError.badRequest('题库 id 非法');
    if (!(await this.banks.findById(bankId))) throw AppError.notFound('题库不存在');

    let questionId: number | null = null;
    let chapter = '';
    let section = '';
    if (targetType === 'question') {
      const parsed = Number(input.questionId);
      if (!Number.isInteger(parsed) || parsed <= 0) throw AppError.badRequest('题目 id 非法');
      const question = await this.questions.findById(parsed);
      if (!question) throw AppError.badRequest('题目不存在');
      if (question.bank_id !== bankId) throw AppError.badRequest('题目不属于该题库');
      questionId = parsed;
    } else if (targetType === 'chapter') {
      chapter = normalizeSection(input.chapter);
      if (chapter === '') throw AppError.badRequest('章节不能为空');
    } else if (targetType === 'section') {
      chapter = normalizeSection(input.chapter);
      section = normalizeSection(input.section);
      if (chapter === '') throw AppError.badRequest('章节不能为空');
      if (section === '') throw AppError.badRequest('小节不能为空');
    }
    return { targetType, bankId, questionId, chapter, section };
  }

  private normalizeLessonIds(raw: unknown): number[] {
    if (!Array.isArray(raw) || raw.length === 0) throw AppError.badRequest('至少关联一个课时');
    const ids = raw.map((value) => Number(value));
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) throw AppError.badRequest('课时 id 非法');
    return [...new Set(ids)];
  }

  private async assertLessons(lessonIds: number[]): Promise<void> {
    for (const id of lessonIds) {
      if (!(await this.lessons.findById(id))) throw AppError.badRequest('关联的课时不存在');
    }
  }

  private async dto(row: PracticeLinkRow): Promise<PracticeLinkDto> {
    const lessonRows: LessonLinkRow[] = await this.links.lessonsFor([row.id]);
    return {
      id: row.id,
      targetType: row.target_type as PracticeTargetType,
      bankId: row.bank_id,
      questionId: row.question_id,
      chapter: row.chapter,
      section: row.section,
      lessonIds: lessonRows.map((lesson) => lesson.lesson_id),
      lessons: lessonRows.map((lesson) => ({
        id: lesson.lesson_id,
        title: lesson.title,
        courseId: lesson.course_id,
        courseName: lesson.course_name,
        groupName: lesson.group_name,
      })),
      createdAt: row.created_at,
    };
  }

  private async writeAudit(actor: User, action: string, targetId: number, detail: unknown): Promise<void> {
    await this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action,
      targetType: 'practice_link',
      targetId,
      detail,
    });
  }
}
