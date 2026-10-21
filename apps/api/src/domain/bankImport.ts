/**
 * CSV 导入解析（纯函数）：表头识别 + 逐行校验。
 *
 * 从 BankService.importCsv 抽出来，行为保持不变：
 *   - 找到含「题型/题干/选项A」的行就当表头，按表头建列映射；
 *   - 没有表头时按导入模板的默认列序，从第一行开始解析；
 *   - 失败行带 CSV 行号返回，不阻断其它行。
 */
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
