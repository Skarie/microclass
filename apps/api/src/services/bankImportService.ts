/**
 * 题库文件导入：CSV / Markdown / txt / Word。解析后统一批量落库，
 * 逐题校验，某一行失败只记错误、不影响其它题。
 */
import { AppError, type User } from '@microclass/shared';
import type { BankRepository } from '../db/repositories/bankRepository.js';
import type { QuestionInput, QuestionRepository } from '../db/repositories/questionRepository.js';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { StorageService } from './storageService.js';
import {
  hasMediaOnlyAnalysis,
  hasQuestionImage,
  questionFingerprint,
  type CsvQuestionRow,
} from '../domain/question.js';
import { parseQuestionText } from '../domain/questionText.js';
import { parseCsv } from '../utils/csv.js';
import { parseCsvQuestionRows } from '../domain/bankImport.js';
import { imageExtension, readDocx, type DocxContent, type DocxImageFile } from '../utils/docx.js';

/** 单次导入最多带进来多少张 Word 配图（防止一个巨大的 docx 把磁盘写满） */
const MAX_IMPORTED_IMAGES = 200;

export class BankImportService {
  constructor(
    private readonly banks: BankRepository,
    private readonly questions: QuestionRepository,
    private readonly storage: StorageService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * 按文件类型导入题目：
   *   - `.csv` → 逐行解析（Excel 习惯）
   *   - `.md` / `.txt` / 其它纯文本 → 纯文本题块解析
   *   - `.docx` → 抽出 Word 正文文本后，走**同一套**纯文本题块解析
   * 逐题校验：失败的题带序号与原因返回，不影响其它题。
   */
  importFile(
    actor: User,
    bankId: number,
    file: { filename: string; data: Buffer },
  ): { inserted: number; errors: string[]; warnings: string[] } {
    const name = file.filename.toLowerCase();
    if (name.endsWith('.docx')) {
      let content: DocxContent;
      try {
        content = readDocx(file.data);
      } catch (e) {
        throw AppError.badRequest(`无法读取 Word 文件：${e instanceof Error ? e.message : '格式不受支持'}`);
      }
      // 图片位置以 `[[img:N]]` 标记留在文本里，解析后按题把配图存进题目图片目录
      return this.importText(actor, bankId, content.paragraphs.join('\n'), 'docx', content.images);
    }
    const text = file.data.toString('utf8');
    if (name.endsWith('.csv')) {
      const res = this.importCsv(actor, bankId, text);
      return { ...res, warnings: [] };
    }
    return this.importText(actor, bankId, text, 'md');
  }

  /** 导入 Markdown / 纯文本题块（Word 时带内嵌图片） */
  importText(
    actor: User,
    bankId: number,
    text: string,
    source: 'md' | 'docx' = 'md',
    images: DocxImageFile[] = [],
  ): { inserted: number; errors: string[]; warnings: string[] } {
    const bank = this.banks.findById(bankId);
    if (!bank) throw AppError.notFound('题库不存在');
    const parsed = parseQuestionText(text);
    if (parsed.questions.length === 0 && parsed.errors.length === 0) {
      throw AppError.badRequest('没有解析到题目：请确认每道题都有题型与「答案：」行');
    }
    const { inserted, warnings: imageWarnings } = this.insertDrafts(bankId, bank.lesson_id, parsed.questions, images);
    const warnings = [...parsed.warnings, ...imageWarnings];
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'bank.import_text',
      targetType: 'bank',
      targetId: bankId,
      detail: {
        source,
        inserted,
        failed: parsed.errors.length,
        warnings: warnings.length,
        images: images.length,
      },
    });
    return { inserted, errors: parsed.errors, warnings };
  }

  /** 导入 CSV：逐行校验，失败行返回行号与原因，不阻断其它行 */
  importCsv(actor: User, bankId: number, text: string): { inserted: number; errors: string[] } {
    const bank = this.banks.findById(bankId);
    if (!bank) throw AppError.notFound('题库不存在');
    const rows = parseCsv(text);
    if (rows.length === 0) throw AppError.badRequest('CSV 内容为空');
    const { drafts, errors } = parseCsvQuestionRows(rows);
    const { inserted } = this.insertDrafts(bankId, bank.lesson_id, drafts);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'bank.import_csv',
      targetType: 'bank',
      targetId: bankId,
      detail: { inserted, failed: errors.length },
    });
    return { inserted, errors };
  }

  /**
   * 批量入库（导入的各格式共用）。
   * `imageIndex` 指向 docx 内嵌图片（1 开始）：存进题目图片目录并写回 `image_path`；
   * 单张图片不合法（格式不在白名单等）时只记 warning，题目照常导入。
   */
  private insertDrafts(
    bankId: number,
    lessonId: number | null,
    drafts: CsvQuestionRow[],
    images: DocxImageFile[] = [],
  ): { inserted: number; warnings: string[] } {
    const warnings: string[] = [];
    let savedImages = 0;

    const pending: QuestionInput[] = drafts.map((q) => {
      let imagePath: string | undefined;
      if (q.imageIndex !== undefined) {
        const img = images[q.imageIndex - 1];
        if (!img) {
          warnings.push(`有 1 道题的 Word 配图在文件里找不到（第 ${q.imageIndex} 张），已跳过图片`);
        } else if (savedImages >= MAX_IMPORTED_IMAGES) {
          warnings.push(`Word 里的配图超过 ${MAX_IMPORTED_IMAGES} 张，超出的已跳过`);
        } else {
          try {
            const ext = imageExtension(img.data, img.name);
            const saved = this.storage.save({
              subdir: 'question-images',
              fileName: `word-${Date.now().toString(36)}-${savedImages + 1}.${ext}`,
              data: img.data,
              mimeType: `image/${ext}`,
              imagesOnly: true,
            });
            imagePath = saved.relPath;
            savedImages += 1;
          } catch {
            warnings.push('有 1 道题的 Word 配图格式不受支持（仅支持 png/jpg/gif/webp/bmp），已跳过');
          }
        }
      }
      return {
        bankId,
        lessonId,
        type: q.type,
        stem: q.stem,
        options: q.options,
        answer: q.answer,
        analysis: q.analysis,
        // 与手工新增走同一套标准化元数据口径
        contentHash: questionFingerprint(q.stem, q.options),
        hasImage: hasQuestionImage(q.stem, q.options, q.analysis),
        analysisMediaOnly: hasMediaOnlyAnalysis(q.analysis),
        ...(imagePath === undefined ? {} : { imagePath }),
      };
    });

    return { inserted: this.questions.insertMany(pending), warnings };
  }
}
