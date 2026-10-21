/**
 * 题目配图：上传到 uploads/question-images、绑定到题目、解析绝对路径。
 * 图片题（扫描件拆题）也在这里落库：题面就是图片，题干文字可以为空。
 */
import fs from 'node:fs';
import { AppError, type Question, type QuestionType, type User } from '@microclass/shared';
import type { BankRepository } from '../db/repositories/bankRepository.js';
import type { QuestionRepository } from '../db/repositories/questionRepository.js';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { StorageService } from './storageService.js';

export interface ImageUpload {
  fileName: string;
  data: Buffer;
  mimeType: string;
}

export interface ImageQuestionInput {
  bankId: number;
  type: QuestionType;
  /** 题干文字（可有可无：有文字层/OCR 时填，纯图片题留空） */
  stem?: string;
  answer?: string;
  analysis?: string;
  difficulty?: string;
  lessonId?: number | null;
  subject?: string;
  stage?: string;
  book?: string;
  chapter?: string;
  point?: string;
  file: ImageUpload;
}

export class BankQuestionImageService {
  constructor(
    private readonly banks: BankRepository,
    private readonly questions: QuestionRepository,
    private readonly audit: AuditRepository,
    private readonly storage: StorageService,
  ) {}

  /**
   * 建**图片题**（扫描件拆题用）：题面是图片，题干文本可以为空。
   * 返回题目 id；图片落在 `question-images` 目录（与「上传配图」同一套存储）。
   */
  createImageQuestion(actor: User, input: ImageQuestionInput): { id: number; imagePath: string } {
    const bank = this.banks.findById(input.bankId);
    if (!bank) throw AppError.notFound('题库不存在');
    if (!['single', 'multiple', 'judge', 'fill', 'short'].includes(input.type)) {
      throw AppError.badRequest('题型非法');
    }
    const stem = String(input.stem ?? '').trim();
    // 选择题：选项内容在图片里，这里补字母位让学生能作答、判分照旧
    const options = input.type === 'single' || input.type === 'multiple' ? ['A', 'B', 'C', 'D'] : [];
    const id = this.questions.create({
      bankId: input.bankId,
      lessonId: input.lessonId ?? bank.lesson_id ?? null,
      type: input.type,
      stem,
      imagePath: '',
      options,
      answer: String(input.answer ?? ''),
      analysis: String(input.analysis ?? ''),
      difficulty: String(input.difficulty ?? ''),
      subject: String(input.subject ?? bank.subject ?? ''),
      stage: String(input.stage ?? ''),
      book: String(input.book ?? ''),
      chapter: String(input.chapter ?? ''),
      point: String(input.point ?? ''),
      // 图片题：题面就是图片，has_image 必须为真（否则"有图"筛选与统计会漏）
      hasImage: true,
      analysisMediaOnly: false,
    });
    const saved = this.storage.save({
      subdir: 'question-images',
      fileName: input.file.fileName || `scan-${id}.png`,
      data: input.file.data,
      mimeType: input.file.mimeType,
      imagesOnly: true,
    });
    this.questions.setImage(id, saved.relPath);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'question.create_image',
      targetType: 'question',
      targetId: id,
      detail: { bankId: input.bankId, type: input.type, fileName: input.file.fileName },
    });
    return { id, imagePath: saved.relPath };
  }

  attachImage(actor: User, id: number, file: ImageUpload): string {
    const question = this.questions.findById(id);
    if (!question) throw AppError.notFound('题目不存在');
    const saved = this.storage.save({
      subdir: 'question-images',
      fileName: file.fileName,
      data: file.data,
      mimeType: file.mimeType,
      imagesOnly: true,
    });
    this.questions.setImage(id, saved.relPath);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'question.image',
      targetType: 'question',
      targetId: id,
      detail: { imagePath: saved.relPath },
    });
    return saved.relPath;
  }

  /** 题目配图绝对路径（越权/穿越防护由 StorageService 负责） */
  resolveImage(question: Question): string | null {
    if (!question.image_path) return null;
    const abs = this.storage.resolve(question.image_path);
    return abs && fs.existsSync(abs) ? abs : null;
  }
}
