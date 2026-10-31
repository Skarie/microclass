/**
 * 知识点批量导入的 multipart 接收：只把 md 读进内存，zip 边收边落临时文件
 * （100MB 级资料包不能整体进内存）。处理完由路由删除临时目录。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyRequest } from 'fastify';
import { AppError } from '@microclass/shared';
import { isMarkdownName, isZipName } from '../domain/knowledgeImport.js';
import { MAX_MD_BYTES } from './knowledgeImportTypes.js';

/** 单次导入请求体积上限：200MB（大资料包常见 100MB+） */
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
/** 一次最多挑几个文件（zip + 多个 md） */
const MAX_FILES = 50;

export interface ImportMarkdownFile {
  name: string;
  content: string;
}

export interface KnowledgeImportUpload {
  markdowns: ImportMarkdownFile[];
  /** 已落盘的 zip 临时文件绝对路径 */
  zips: string[];
}

export interface CollectedKnowledgeImport {
  upload: KnowledgeImportUpload;
  /** 本次请求的临时目录；没有 zip 时为 null */
  tempDir: string | null;
}

function baseName(name: string): string {
  return path.posix.basename(name.replace(/\\/g, '/'));
}

/**
 * 读取 multipart（字段名 `file`，可多个）：
 * - `.zip`：流式写临时文件；
 * - `.md` / `.markdown`：读字符串；
 * - 其它扩展名直接 400（避免把任意大文件读进内存）。
 */
export async function collectKnowledgeImportUpload(
  req: FastifyRequest,
  tmpRoot: string,
): Promise<CollectedKnowledgeImport> {
  const markdowns: ImportMarkdownFile[] = [];
  const zips: string[] = [];
  let tempDir: string | null = null;
  let index = 0;

  try {
    for await (const part of req.parts({ limits: { fileSize: MAX_IMPORT_BYTES, files: MAX_FILES } })) {
      if (part.type !== 'file') continue;
      const name = baseName(part.filename);
      if (isZipName(name)) {
        tempDir = tempDir ?? fs.mkdtempSync(path.join(ensureTmpRoot(tmpRoot), 'knowledge-import-'));
        const zipPath = path.join(tempDir, `upload-${index}.zip`);
        index += 1;
        await pipeline(part.file, fs.createWriteStream(zipPath));
        zips.push(zipPath);
        continue;
      }
      if (isMarkdownName(name)) {
        const data = await part.toBuffer();
        if (data.length > MAX_MD_BYTES) throw AppError.badRequest(`单个 Markdown 文件过大：${name}`);
        markdowns.push({ name, content: data.toString('utf8') });
        continue;
      }
      throw AppError.badRequest(`不支持的文件类型：${name}（仅支持 .zip 或 .md）`);
    }
  } catch (e) {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    const code = (e as { code?: string }).code ?? '';
    if (code === 'FST_REQ_FILE_TOO_LARGE') throw AppError.badRequest('文件超过 200MB 上限');
    if (code === 'FST_FILES_LIMIT') throw AppError.badRequest(`一次最多上传 ${MAX_FILES} 个文件`);
    throw e;
  }

  if (zips.length === 0 && markdowns.length === 0) {
    throw AppError.badRequest('请选择要导入的文件（.zip 或 .md，字段名 file）');
  }
  return { upload: { markdowns, zips }, tempDir };
}

function ensureTmpRoot(tmpRoot: string): string {
  fs.mkdirSync(tmpRoot, { recursive: true });
  return tmpRoot;
}

/** 删除本次请求落盘的临时 zip */
export function cleanupKnowledgeImport(collected: CollectedKnowledgeImport): void {
  if (!collected.tempDir) return;
  try {
    fs.rmSync(collected.tempDir, { recursive: true, force: true });
  } catch {
    /* 清理失败不影响导入结果 */
  }
}
