/**
 * 测试用最小 ZIP 写入器（deflate 压缩，UTF-8 文件名）。
 * 只为验证「zip 内 md + images」导入链路，不追求实现完整 ZIP 规范。
 */
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    const index = (crc ^ byte) & 0xff;
    crc = (CRC_TABLE[index] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntryInput {
  name: string;
  data: Buffer | string;
}

interface BuiltEntry {
  name: Buffer;
  data: Buffer;
  compressed: Buffer;
  crc: number;
  offset: number;
}

/** 生成一个内存中的 zip：条目名按 UTF-8 写入并置 UTF-8 标志位 */
export function buildZip(entries: ZipEntryInput[]): Buffer {
  const locals: Buffer[] = [];
  const built: BuiltEntry[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data;
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 文件名
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const record: BuiltEntry = { name, data, compressed, crc, offset };
    built.push(record);
    locals.push(local, name, compressed);
    offset += local.length + name.length + compressed.length;
  }

  const central: Buffer[] = [];
  for (const entry of built) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4); // version made by
    header.writeUInt16LE(20, 6); // version needed
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.compressed.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(entry.name.length, 28);
    header.writeUInt32LE(entry.offset, 42);
    central.push(header, entry.name);
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(built.length, 8);
  eocd.writeUInt16LE(built.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, eocd]);
}
