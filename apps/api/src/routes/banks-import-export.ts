/**
 * 题库导入 / 导出路由：CSV / Markdown / Word 导出与导入模板、文件导入、
 * 资料提炼结果的批量导入（multipart + manifest）。
 *
 * 从 `routes/banks.ts` 拆出；路径、方法、返回结构全部保持不变。
 * 文件格式与清单校验的纯逻辑在 `domain/bankImport.ts`（可单测），
 * 解析与落库在 `services/bankImportService`、`services/bankManifestImportService`。
 */
import type { FastifyInstance } from 'fastify';
import { AppError } from '@microclass/shared';
import { requireTeacherOrAdmin } from '../http/guards.js';
import { csvHeaders } from '../utils/csv.js';
import { textHeaders, docxHeaders } from '../utils/download.js';
import type { Deps } from '../app.js';
import {
  importFileError,
  isImportFileName,
  mediaFieldIndex,
  mediaFilesError,
  parseImportManifest,
} from '../domain/bankImport.js';
import { bankIdOf } from './banks-shared.js';
import { withAnswersFlag } from './bankQuery.js';

/** multipart 里已读进内存的文件（字段名 → 文件） */
interface UploadedFile {
  fileName: string;
  data: Buffer;
  mimeType: string;
}

/** 批量导入单次请求的 multipart 分片结构（`@fastify/multipart` 的 part） */
interface MultipartPart {
  type: string;
  fieldname: string;
  filename?: string;
  mimetype?: string;
  toBuffer: () => Promise<Buffer>;
  value?: unknown;
}

export async function registerBankImportExportRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /** 导出题库 CSV */
  app.get('/banks/:id/export.csv', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const { filename, body } = deps.bankService.exportCsv(bankIdOf(req));
    return reply.headers(csvHeaders(filename)).send(body);
  });

  /** 下载导入模板 CSV */
  app.get('/banks/template.csv', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const { filename, body } = deps.bankService.templateCsv();
    return reply.headers(csvHeaders(filename)).send(body);
  });

  /** 导出题库 Markdown（人可读，可再次导入）；`?answers=0` 导出不含答案的试卷 */
  app.get('/banks/:id/export.md', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const withAnswers = withAnswersFlag((req.query as { answers?: string }).answers);
    const { filename, body } = deps.bankService.exportMarkdown(bankIdOf(req), { withAnswers });
    return reply.headers(textHeaders(filename, 'text/markdown; charset=utf-8')).send(body);
  });

  /** 下载 Markdown 导入模板（Markdown / Word 通用写法） */
  app.get('/banks/template.md', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const { filename, body } = deps.bankService.templateMarkdown();
    return reply.headers(textHeaders(filename, 'text/markdown; charset=utf-8')).send(body);
  });

  /** 导出题库 Word（.docx，含内嵌配图；`?answers=0` 导出不含答案解析的试卷） */
  app.get('/banks/:id/export.docx', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const withAnswers = withAnswersFlag((req.query as { answers?: string }).answers);
    const { filename, body } = deps.bankService.exportDocx(bankIdOf(req), { withAnswers });
    return reply.headers(docxHeaders(filename)).send(body);
  });

  /**
   * 导入题目（multipart 上传文件）：
   * `.csv`（Excel）/ `.md`、`.txt`（纯文本题块）/ `.docx`（Word，抽出正文后按同一套规则解析）
   */
  app.post('/banks/:id/import', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const id = bankIdOf(req);
    const file = await req.file();
    if (!file) throw AppError.badRequest('请选择要导入的文件');
    const name = file.filename.toLowerCase();
    // 先按扩展名拦掉不支持的类型，避免把任意文件读进内存
    if (!isImportFileName(name)) {
      throw AppError.badRequest('支持 CSV（Excel）、Markdown（.md/.txt）与 Word（.docx）');
    }
    const data = await file.toBuffer();
    const error = importFileError(data.length);
    if (error) throw AppError.badRequest(error);
    const result = deps.bankService.importFile(user, id, { filename: name, data });
    return { ok: true, ...result };
  });

  /**
   * 批量导入题目（含图片）：资料提炼结果一次灌进题库。
   * multipart：`manifest`（JSON）+ 若干文件字段（字段名对应 manifest 里每题的 `image`）。
   * 逐题独立处理，单题失败不影响其它题，返回失败清单。
   */
  app.post('/banks/:id/questions/batch', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    const bankId = bankIdOf(req);
    if (!req.isMultipart()) throw AppError.badRequest('请以 multipart 方式上传（字段 manifest + 图片文件）');
    let manifest = '';
    const files = new Map<string, UploadedFile>();
    /** `mediaN` 字段 = 题干里 `[[img:N]]` 对应的图片（一份资料一个请求，避免限流） */
    const mediaFiles = new Map<number, UploadedFile>();
    let parts: AsyncIterable<unknown>;
    try {
      parts = req.parts() as AsyncIterable<unknown>;
    } catch {
      throw AppError.badRequest('请以 multipart 方式上传');
    }
    try {
      for await (const part of parts as AsyncIterable<MultipartPart>) {
        if (part.type === 'file') {
          const value: UploadedFile = {
            fileName: part.filename ?? 'upload',
            data: await part.toBuffer(),
            mimeType: part.mimetype ?? 'application/octet-stream',
          };
          const mediaIdx = mediaFieldIndex(part.fieldname);
          if (mediaIdx === undefined) files.set(part.fieldname, value);
          else mediaFiles.set(mediaIdx, value);
        } else if (part.fieldname === 'manifest') {
          const raw: unknown = part.value;
          if (typeof raw === 'string') manifest = raw;
          else if (Buffer.isBuffer(raw)) manifest = raw.toString('utf8');
        }
      }
    } catch (e) {
      // busboy 的文件数/分片超限要变成可读的 4xx，而不是 500
      const code = (e as { code?: string }).code ?? '';
      if (code === 'FST_FILES_LIMIT' || code === 'FST_PARTS_LIMIT') {
        throw AppError.badRequest('这次携带的图片太多，请把资料分成几批导入（每批 ≤ 400 张图）');
      }
      throw e;
    }
    const mediaError = mediaFilesError(mediaFiles.size);
    if (mediaError) throw AppError.badRequest(mediaError);
    // 清单校验（空 / 非法 JSON / 非数组 / 超过 500 题）统一在纯函数里，消息与拆分前一致
    const questions = parseImportManifest(manifest);
    return deps.bankService.importQuestions(user, bankId, questions, files, mediaFiles);
  });
}
