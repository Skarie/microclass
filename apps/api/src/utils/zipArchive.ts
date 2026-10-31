/**
 * ZIP 读取（基于 yauzl，流式、随机访问）：
 * - 只把中央目录（条目名）读进内存，md 逐个解压读取，图片按需再读；
 * - 100MB 级资料包不会整体读进内存；
 * - 条目名按 UTF-8 / GBK 双解码，兼容 Windows 中文文件名。
 */
import { openPromise, type Entry, type ZipFile } from 'yauzl';
import type { Readable } from 'node:stream';
import { AppError } from '@microclass/shared';
import { isIgnoredArchivePath, isMarkdownName } from '../domain/knowledgeImport.js';

const UTF8_FLAG = 0x800;

/** 条目名解码：UTF-8 优先，失败回退 GBK（Windows 自带压缩常见） */
export function decodeZipEntryName(entry: Entry): string {
  const raw = entry.fileNameRaw;
  if (!raw || raw.length === 0) return entry.fileName;
  if ((entry.generalPurposeBitFlag & UTF8_FLAG) !== 0) return raw.toString('utf8');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    try {
      return new TextDecoder('gbk').decode(raw);
    } catch {
      return entry.fileName;
    }
  }
}

function normalizeEntryName(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\.?\//, '');
}

/** 流 → Buffer，超过 maxBytes 立即中断（避免单个畸形条目吃掉内存） */
async function readStream(stream: Readable, maxBytes: number, label: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += buf.length;
      if (size > maxBytes) throw AppError.badRequest(`${label} 过大（上限 ${Math.round(maxBytes / 1024 / 1024)}MB）`);
      chunks.push(buf);
    }
  } finally {
    stream.destroy();
  }
  return Buffer.concat(chunks);
}

export class ZipArchive {
  private readonly byName = new Map<string, Entry>();
  /** 小写名 → 实际名，兼容不同工具写入的大小写差异 */
  private readonly byLowerName = new Map<string, string>();

  private constructor(private readonly zip: ZipFile) {}

  static async open(filePath: string): Promise<ZipArchive> {
    let zip: ZipFile;
    try {
      zip = await openPromise(filePath, { lazyEntries: true, autoClose: false, validateEntrySizes: true });
    } catch (e) {
      throw AppError.badRequest(`无法读取压缩包：${e instanceof Error ? e.message : String(e)}`);
    }
    const archive = new ZipArchive(zip);
    try {
      for await (const entry of zip.eachEntry()) {
        const name = normalizeEntryName(decodeZipEntryName(entry));
        if (!name || name.endsWith('/')) continue;
        if (entry.isEncrypted()) throw AppError.badRequest('不支持加密的 ZIP，请先解压后重新打包');
        archive.byName.set(name, entry);
        const lower = name.toLowerCase();
        if (!archive.byLowerName.has(lower)) archive.byLowerName.set(lower, name);
      }
    } catch (e) {
      zip.close();
      if (e instanceof AppError) throw e;
      throw AppError.badRequest(`压缩包解析失败：${e instanceof Error ? e.message : String(e)}`);
    }
    return archive;
  }

  /** 所有非目录条目（规范化路径） */
  names(): string[] {
    return [...this.byName.keys()];
  }

  has(name: string): boolean {
    return this.resolveName(name) !== null;
  }

  private resolveName(name: string): string | null {
    const normalized = normalizeEntryName(name);
    if (this.byName.has(normalized)) return normalized;
    return this.byLowerName.get(normalized.toLowerCase()) ?? null;
  }

  async readBinary(name: string, maxBytes: number): Promise<Buffer | null> {
    const actual = this.resolveName(name);
    if (!actual) return null;
    const entry = this.byName.get(actual);
    if (!entry) return null;
    const stream = await this.zip.openReadStreamPromise(entry);
    return readStream(stream, maxBytes, actual);
  }

  /** 包内 Markdown 条目路径（跳过 macOS 残留与隐藏文件） */
  markdownPaths(): string[] {
    return [...this.byName.keys()].filter((name) => isMarkdownName(name) && !isIgnoredArchivePath(name));
  }

  /** 读取单个 Markdown（逐个读，避免把整包 md 同时放进内存） */
  async readMarkdownFile(name: string, maxBytes: number): Promise<string | null> {
    const data = await this.readBinary(name, maxBytes);
    return data ? data.toString('utf8') : null;
  }

  close(): void {
    try {
      this.zip.close();
    } catch {
      /* 已关闭时忽略 */
    }
  }
}
