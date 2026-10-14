/**
 * 通用 CSV 解析与生成（RFC 4180 子集，兼容 Excel 导出的引号与换行）。
 */
import { asText } from './text.js';

/** 解析 CSV 文本为二维数组，自动去 BOM、统一换行、丢弃空行 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  for (let i = 0; i < src.length; i += 1) {
    const c = src[i] as string;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/** 单元格转义：含逗号/引号/换行时加引号并双写内部引号 */
export function escapeCsvCell(value: unknown): string {
  const s = asText(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 二维数组 → CSV 文本（CRLF 换行，带 UTF-8 BOM 便于 Excel 打开） */
export function toCsv(rows: unknown[][], options?: { bom?: boolean }): string {
  const body = rows.map((r) => r.map(escapeCsvCell).join(',')).join('\r\n');
  return (options?.bom === false ? '' : '\uFEFF') + body;
}

/** 生成下载响应头（文件名走 RFC 5987，兼容中文） */
export function csvHeaders(filename: string): Record<string, string> {
  return {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'cache-control': 'no-store',
  };
}
