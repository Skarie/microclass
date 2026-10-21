/**
 * 题库导出：CSV（V1 列序）、Markdown（可回导的纯文本）、Word（图片内嵌、可直接打印）。
 */
import { AppError } from '@microclass/shared';
import type { BankRepository } from '../db/repositories/bankRepository.js';
import type { QuestionRepository } from '../db/repositories/questionRepository.js';
import { TYPE_LABEL, answerToCsv, parseOptions } from '../domain/question.js';
import { questionsToMarkdown } from '../domain/questionText.js';
import { inlineImagesToDocx } from '../utils/questionDocxImages.js';
import { toCsv } from '../utils/csv.js';
import { buildDocx, imageExtension, imageSize, readImageFile, type DocxBlock, type DocxImage } from '../utils/docx.js';
import type { QuestionMediaStore } from './questionMediaStore.js';
import type { BankQuestionImageService } from './bankQuestionImageService.js';

export class BankExportService {
  constructor(
    private readonly banks: BankRepository,
    private readonly questions: QuestionRepository,
    /** 题库导入的题图（内容寻址）：导出 Word 时把题面里的内联图片也嵌进去 */
    private readonly media: QuestionMediaStore,
    private readonly images: BankQuestionImageService,
  ) {}

  /** 导出题库为 CSV（列序与 V1 模板一致） */
  exportCsv(bankId: number): { filename: string; body: string } {
    const bank = this.banks.findById(bankId);
    if (!bank) throw AppError.notFound('题库不存在');
    const rows: unknown[][] = [['题型', '题干', '选项A', '选项B', '选项C', '选项D', '选项E', '选项F', '答案', '解析']];
    for (const q of this.questions.listByBank(bankId)) {
      const options = parseOptions(q.options);
      const cells: unknown[] = [TYPE_LABEL[q.type], q.stem];
      for (let i = 0; i < 6; i += 1) cells.push(options[i] ?? '');
      cells.push(answerToCsv(q), q.analysis);
      rows.push(cells);
    }
    return { filename: `${bank.name}_题库.csv`, body: toCsv(rows) };
  }

  /**
   * 导出 Markdown：人可读、可进版本库、可直接贴进笔记软件或交给 AI 改写；
   * 用同一套纯文本规则，导出的文件可以再次导入（往返无损）。
   */
  exportMarkdown(bankId: number, options?: { withAnswers?: boolean }): { filename: string; body: string } {
    const bank = this.banks.findById(bankId);
    if (!bank) throw AppError.notFound('题库不存在');
    const questions = this.questions.listByBank(bankId);
    return {
      filename: `${bank.name}_题库.md`,
      body: questionsToMarkdown({
        title: bank.name,
        questions,
        ...(options?.withAnswers === undefined ? {} : { withAnswers: options.withAnswers }),
      }),
    };
  }

  /**
   * 导出 Word：一份可以直接打印、发给学生或教研组继续改的试卷。
   * 题目配图会**内嵌**进 docx（单文件即可分发）。
   */
  exportDocx(bankId: number, options?: { withAnswers?: boolean }): { filename: string; body: Buffer } {
    const bank = this.banks.findById(bankId);
    if (!bank) throw AppError.notFound('题库不存在');
    const withAnswers = options?.withAnswers !== false;
    const questions = this.questions.listByBank(bankId);

    const blocks: DocxBlock[] = [
      { type: 'title', text: bank.name },
      { type: 'subtitle', text: `共 ${questions.length} 题 · 由微课堂导出${withAnswers ? '' : '（不含答案解析）'}` },
    ];
    const images: DocxImage[] = [];

    questions.forEach((q, i) => {
      const optionTexts = parseOptions(q.options);
      blocks.push({ type: 'heading', text: `${i + 1}. ${TYPE_LABEL[q.type]}` });
      // 题面里的内联题图先转成 docx 图片标记（题库导入的题图片就在题干/选项/解析里）
      const stemText = this.inlineImagesToDocx(q.stem, images);
      blocks.push({ type: 'text', text: stemText });

      // 旧版「题目配图」：题干里没有内联图片时才单独嵌一张，避免重复
      const abs = stemText.includes('[[img:') ? null : this.images.resolveImage(q);
      if (abs) {
        const data = readImageFile(abs);
        if (data) {
          const size = imageSize(data) ?? { width: 480, height: 270 };
          const scale = size.width > 480 ? 480 / size.width : 1;
          const ext = imageExtension(data, abs);
          images.push({
            name: `image${images.length + 1}.${ext}`,
            data,
            widthPx: Math.round(size.width * scale),
            heightPx: Math.round(size.height * scale),
          });
          blocks.push({ type: 'text', text: `[[img:${images.length}]]` });
        }
      }

      optionTexts.forEach((opt, oi) => {
        blocks.push({
          type: 'option',
          text: `${String.fromCharCode(65 + oi)}. ${this.inlineImagesToDocx(opt, images)}`,
        });
      });
      if (withAnswers) {
        blocks.push({ type: 'answer', text: `答案：${answerToCsv(q)}` });
        if (q.analysis) {
          blocks.push({ type: 'analysis', text: `解析：${this.inlineImagesToDocx(q.analysis, images)}` });
        }
      }
      blocks.push({ type: 'divider', text: '' });
    });

    return { filename: `${bank.name}_试卷.docx`, body: buildDocx({ title: bank.name, blocks, images }) };
  }

  /** 内联题图 → docx 图片标记（逻辑与试卷 Word 导出共用 utils/questionDocxImages） */
  private inlineImagesToDocx(text: string, images: DocxImage[]): string {
    return inlineImagesToDocx(text, images, (file) => this.media.resolve(file));
  }
}
