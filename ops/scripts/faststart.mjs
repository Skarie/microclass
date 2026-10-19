#!/usr/bin/env node
/**
 * 批量把 MP4 重封装成 faststart（moov 前置）。
 *
 * 为什么要它：mp4 的 moov 若在文件尾部，浏览器必须下完整个文件才能开始播放 ——
 * 150MB 的片子就是"点进去要等很久"。`-c copy` 只挪索引、不重新编码，单片几秒。
 *
 * 用法：
 *   node ops/scripts/faststart.mjs --root /app/data/uploads/videos [--limit 20] [--dry-run]
 *   容器里跑：docker exec microclass-api node /app/ops/scripts/faststart.mjs --root ...
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const ROOT = argOf('root', '');
const LIMIT = Number(argOf('limit', '0')) || 0;
const DRY = args.includes('--dry-run');
if (!ROOT || !fs.existsSync(ROOT)) {
  console.error('需要 --root <视频目录>');
  process.exit(1);
}

const NEEDLE = Buffer.from('moov');
/** moov 在不在前 1MB 里：在 → 已经 faststart */
function moovAtHead(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(Math.min(fs.fstatSync(fd).size, 1024 * 1024));
    fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.includes(NEEDLE);
  } finally {
    fs.closeSync(fd);
  }
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(mp4|m4v)$/i.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const todo = [];
for (const f of files) {
  if (!moovAtHead(f)) todo.push(f);
}
console.log(`扫描 ${files.length} 个视频，需要重封装 ${todo.length} 个${DRY ? '（dry-run）' : ''}`);

let done = 0;
let failed = 0;
let bytes = 0;
for (const file of LIMIT > 0 ? todo.slice(0, LIMIT) : todo) {
  if (DRY) {
    console.log(`  需处理: ${path.relative(ROOT, file)}`);
    continue;
  }
  const tmp = `${file}.faststart.tmp.mp4`;
  const t0 = Date.now();
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-c', 'copy', '-movflags', '+faststart', tmp], {
      stdio: 'pipe',
    });
    const size = fs.statSync(file).size;
    fs.renameSync(tmp, file); // 重封装成功才替换原文件
    bytes += size;
    done += 1;
    console.log(
      `  ✔ ${path.relative(ROOT, file)}  ${Math.round(size / 1048576)}MB  ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
  } catch (e) {
    failed += 1;
    try {
      fs.existsSync(tmp) && fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    console.error(`  ✘ ${path.relative(ROOT, file)}: ${String(e.message).slice(0, 120)}`);
  }
}
console.log(`完成：重封装 ${done} 个（${Math.round(bytes / 1048576)}MB），失败 ${failed} 个`);
