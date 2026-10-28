/**
 * 题目输入规范化：校验 + 答案编码 + 标准化元数据（学科/书册/指纹/配图标记）。
 * 从 BankService 抽成纯函数 + 显式依赖，题库 CRUD 与批量操作共用同一口径。
 */
import { AppError, type Question, type QuestionType } from '@microclass/shared';
import type { BankRepository } from '../db/repositories/bankRepository.js';
import type { LessonRepository } from '../db/repositories/lessonRepository.js';
import type { QuestionInput } from '../db/repositories/questionRepository.js';
import {
  hasMediaOnlyAnalysis,
  hasQuestionImage,
  normalizeAnswer,
  parseOptions,
  questionFingerprint,
} from '../domain/question.js';
import { inferStage } from '../domain/difficulty.js';
import { QUESTION_SECTION_MAX } from '../domain/questionCsv.js';
import type { QuestionDto } from './bankTypes.js';
import type { StorageService } from './storageService.js';

const REQUIRES_ANSWER: QuestionType[] = ['single', 'multiple', 'judge'];

/** 规范化题目输入所需的最小依赖（方便单测时替换） */
export interface QuestionInputContext {
  banks: BankRepository;
  lessons: LessonRepository;
  storage: StorageService;
}

/** 校验课时存在并返回 id；未关联课时返回 null */
export function resolveLessonId(lessons: LessonRepository, lessonId: number | null | undefined): number | null {
  if (lessonId === undefined || lessonId === null) return null;
  const lesson = lessons.findById(lessonId);
  if (!lesson) throw AppError.badRequest('关联的课时不存在');
  return lessonId;
}

/** 校验并规范化题目输入 */
export function prepareQuestionInput(ctx: QuestionInputContext, input: QuestionDto): QuestionInput {
  const bankId = Number(input.bankId);
  const bank = Number.isInteger(bankId) ? ctx.banks.findById(bankId) : undefined;
  if (!bank) throw AppError.notFound('题库不存在');

  const type = input.type;
  if (!['single', 'multiple', 'judge', 'fill', 'short'].includes(type)) throw AppError.badRequest('题型非法');

  const stem = String(input.stem ?? '').trim();
  if (!stem) throw AppError.badRequest('题干不能为空');

  let options: string[] = [];
  if (type === 'single' || type === 'multiple') {
    options = (Array.isArray(input.options) ? input.options : []).map((s) => String(s).trim()).filter(Boolean);
    if (options.length < 2) throw AppError.badRequest('选择题至少需要 2 个选项');
  }

  const rawAnswer = String(input.answer ?? '');
  // 单选/多选的答案允许两种写法：字母串（ACD）或下标串（0,2）
  const asIndexes = /^[A-Fa-f]+$/.test(rawAnswer.trim())
    ? rawAnswer
        .trim()
        .toUpperCase()
        .split('')
        .map((ch) => ch.charCodeAt(0) - 65)
        .join(',')
    : rawAnswer;
  const answer = normalizeAnswer(type, type === 'judge' ? rawAnswer : asIndexes, options);
  /** 批量导入允许缺答案（答案册扫描不清的资料）；单题创建仍然强制 */
  const allowMissingAnswer = input.allowMissingAnswer === true;
  if (!allowMissingAnswer && REQUIRES_ANSWER.includes(type) && answer === '')
    throw AppError.badRequest('请设置正确答案');

  const lessonId = resolveLessonId(ctx.lessons, input.lessonId ?? null);
  // 配图必须是 uploads 目录下真实存在的文件（路径穿越由 StorageService 拦截）
  let imagePath = '';
  if (input.imagePath !== undefined && input.imagePath !== null) {
    const raw = String(input.imagePath).trim();
    if (raw !== '' && !ctx.storage.exists(raw)) throw AppError.badRequest('配图文件不存在，请重新上传');
    imagePath = raw;
  }

  const difficulty = String(input.difficulty ?? '')
    .trim()
    .toLowerCase();
  if (difficulty !== '' && !['easy', 'medium', 'hard'].includes(difficulty)) {
    throw AppError.badRequest('难度只能是 easy / medium / hard');
  }

  return {
    bankId,
    lessonId,
    type,
    stem,
    options,
    answer,
    analysis: String(input.analysis ?? ''),
    sort: Number.isInteger(input.sort) ? Number(input.sort) : 0,
    imagePath,
    difficulty,
    // 标准化元数据：题目没带学科/书册时**继承题库的**（题库是导入时按册次建的），
    // 难度模型的学段基准就靠它——否则手工新建的题会全部落在默认中档。
    subject: String(input.subject ?? '').trim() || String(bank.subject ?? ''),
    stage: String(input.stage ?? '').trim() || inferStage(String(bank.book ?? '')),
    book: String(input.book ?? '').trim() || String(bank.book ?? ''),
    chapter: String(input.chapter ?? '')
      .trim()
      .slice(0, QUESTION_SECTION_MAX),
    section: String(input.section ?? '')
      .trim()
      .slice(0, QUESTION_SECTION_MAX),
    point: String(input.point ?? '').trim(),
    // 标准化元数据在写入时就补齐：指纹用于查重与「同题不同答案」体检，
    // has_image 让体检不必对题干/选项做 LIKE 全表扫描（详见 docs/bank-standardization.md）
    contentHash: questionFingerprint(stem, options),
    hasImage: hasQuestionImage(stem, options, String(input.analysis ?? '')),
    // 解析「只有图片、没有一个字」也预先算好：真机 1.95 万道题是这样，
    // 体检给数量、题库里能筛出来（否则要靠关键字搜解析，搜不到任何东西）
    analysisMediaOnly: hasMediaOnlyAnalysis(String(input.analysis ?? '')),
  };
}

/** 数据行 → 写入用 DTO：批量操作只改一个字段，其余字段要原样带回校验流程 */
export function questionRowToDto(q: Question): QuestionDto {
  return {
    bankId: q.bank_id,
    lessonId: q.lesson_id,
    type: q.type,
    stem: q.stem,
    options: parseOptions(q.options),
    answer: q.answer,
    analysis: q.analysis ?? '',
    imagePath: q.image_path ?? '',
    sort: q.sort,
    difficulty: q.difficulty ?? '',
    subject: q.subject ?? '',
    stage: q.stage ?? '',
    book: q.book ?? '',
    chapter: q.chapter ?? '',
    section: (q as Question & { section?: string }).section ?? '',
    point: q.point ?? '',
  };
}
