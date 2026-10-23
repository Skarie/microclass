/**
 * 题库导入的纯逻辑：CSV 解析（表头识别 + 逐行校验）与文件 / 清单校验。
 *
 * CSV 部分从 BankService.importCsv 抽出，行为保持不变：
 *   - 找到含「题型/题干/选项A」的行就当表头，按表头建列映射；
 *   - 没有表头时按导入模板的默认列序，从第一行开始解析；
 *   - 失败行带 CSV 行号返回，不阻断其它行。
 *
 * 文件与清单部分从 `routes/banks.ts` 的导入 handler 抽出（限制值与错误文案原样保留），
 * 让路由只负责 multipart 读取与转发；测试见 `test/bank-request.test.ts`。
 */
import { AppError } from '@microclass/shared';
import {
  DEFAULT_COLUMN_MAP,
  buildColumnMap,
  csvRowToQuestion,
  type CsvColumnMap,
  type CsvQuestionRow,
} from './question.js';

export interface CsvImportParseResult {
  /** 通过校验、待入库的题目草稿 */
  drafts: CsvQuestionRow[];
  /** 失败行：`第 N 行: 原因`（N 为 CSV 文件行号，从 1 开始） */
  errors: string[];
}

const HEADER_PATTERN = /题型|题干|选项A/;

/** 表头行 → 列映射；没有表头时用默认列序（与导入模板一致） */
function resolveColumnMap(rows: string[][]): { map: CsvColumnMap; start: number } {
  for (let i = 0; i < rows.length; i += 1) {
    if (HEADER_PATTERN.test((rows[i] ?? []).join(','))) {
      return { map: buildColumnMap(rows[i] ?? []), start: i + 1 };
    }
  }
  return { map: DEFAULT_COLUMN_MAP, start: 0 };
}

/** CSV 二维数组 → 题目草稿与逐行错误（调用方负责空文件校验） */
export function parseCsvQuestionRows(rows: string[][]): CsvImportParseResult {
  const { map, start } = resolveColumnMap(rows);
  const drafts: CsvQuestionRow[] = [];
  const errors: string[] = [];
  for (let i = start; i < rows.length; i += 1) {
    const parsed = csvRowToQuestion(rows[i] ?? [], map);
    if (!parsed.ok) {
      errors.push(`第 ${i + 1} 行: ${parsed.error}`);
      continue;
    }
    drafts.push(parsed.question);
  }
  return { drafts, errors };
}

/** 单个导入文件上限 20MB（再大基本是导错了文件） */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
/** 一次批量导入最多 500 题（与请求体上限同一量级） */
export const MAX_MANIFEST_QUESTIONS = 500;
/** 一次 multipart 最多携带 400 张题图 */
export const MAX_MEDIA_FILES = 400;

const IMPORT_FILE_PATTERN = /\.(csv|md|markdown|txt|docx)$/i;

/** 导入文件扩展名白名单：CSV（Excel）/ Markdown（.md/.txt）/ Word（.docx） */
export function isImportFileName(name: string): boolean {
  return IMPORT_FILE_PATTERN.test(name);
}

/** 文件内容校验：空文件与超限各给一条可读错误；合法时返回 null */
export function importFileError(bytes: number): string | null {
  if (bytes === 0) return '文件内容为空';
  if (bytes > MAX_IMPORT_BYTES) return '文件过大（上限 20MB）';
  return null;
}

/** multipart 字段名 `media<N>` → 题图序号（`[[img:N]]` 里的 N）；不是题图字段返回 undefined */
export function mediaFieldIndex(fieldname: string): number | undefined {
  const matched = /^media(\d+)$/.exec(fieldname);
  return matched ? Number(matched[1]) : undefined;
}

/** 题图张数超限提示；未超限返回 null（限制在 multipart 读完后再判断） */
export function mediaFilesError(count: number): string | null {
  return count > MAX_MEDIA_FILES ? `一次最多携带 400 张题图（本次 ${count} 张），请分批导入` : null;
}

/**
 * 批量导入的 manifest（JSON 字符串）→ 题目数组。
 * 空清单 / 非法 JSON / 非数组 / 超过 500 题都是 400，错误文案与拆分前一致。
 */
export function parseImportManifest(raw: string): unknown[] {
  if (raw.trim() === '') throw AppError.badRequest('缺少 manifest（题目清单 JSON）');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw AppError.badRequest('manifest 不是合法 JSON');
  }
  const questions = (parsed ?? {}) as { questions?: unknown };
  if (!Array.isArray(questions.questions) || questions.questions.length === 0) {
    throw AppError.badRequest('manifest.questions 必须是非空数组');
  }
  if (questions.questions.length > MAX_MANIFEST_QUESTIONS) {
    throw AppError.badRequest('一次最多导入 500 题，请分批');
  }
  return questions.questions;
}
