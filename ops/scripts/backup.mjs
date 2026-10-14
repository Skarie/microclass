#!/usr/bin/env node
/**
 * 微课堂备份：把数据目录（SQLite + 上传文件 + 会话密钥）打成带时间戳的归档。
 *
 * 关键点：SQLite 运行在 WAL 模式下，直接复制 .db 文件会丢数据，
 * 因此用 `VACUUM INTO` 生成一致性快照（SQLite 3.27+，Node 的 node:sqlite 自带）。
 *
 * 用法：
 *   node ops/scripts/backup.mjs [--data-dir <dir>] [--out <dir>] [--keep 7]
 * 默认数据目录：$MC_DATA_DIR 或 <repo>/data；默认输出：<数据目录>/backups
 * （与数据同卷，Docker 与 fnOS 场景下都能随卷持久化）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith('--') ? fallback : value;
}

const dataDir = path.resolve(arg('data-dir', process.env.MC_DATA_DIR ?? path.join(REPO_ROOT, 'data')));
const outDir = path.resolve(arg('out', path.join(dataDir, 'backups')));
const keep = Math.max(1, Number.parseInt(arg('keep', '7'), 10) || 7);
const dbFile = path.join(dataDir, 'microclass.db');

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

if (!fs.existsSync(dbFile)) {
  console.error(`✗ 找不到数据库：${dbFile}`);
  console.error('  请用 --data-dir 指定数据目录，或检查 MC_DATA_DIR。');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const name = `microclass-${stamp()}`;
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-backup-'));
const target = path.join(staging, name);
fs.mkdirSync(target, { recursive: true });

console.log(`==> 数据目录：${dataDir}`);

// 1. 一致性快照
const snapshot = path.join(target, 'microclass.db');
const db = new DatabaseSync(dbFile, { readOnly: false });
try {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  db.prepare('VACUUM INTO ?').run(snapshot);
} finally {
  db.close();
}
const sizeMb = (fs.statSync(snapshot).size / 1024 / 1024).toFixed(2);
console.log(`==> 数据库快照：microclass.db（${sizeMb} MB）`);

// 2. 上传文件与会话密钥（存在才复制）
for (const item of ['uploads', '.secret']) {
  const from = path.join(dataDir, item);
  if (!fs.existsSync(from)) continue;
  fs.cpSync(from, path.join(target, item), { recursive: true });
  console.log(`==> 已包含：${item}`);
}

// 3. 清单：便于恢复时核对来源与版本
fs.writeFileSync(
  path.join(target, 'MANIFEST.json'),
  JSON.stringify(
    {
      app: 'microclass',
      createdAt: new Date().toISOString(),
      sourceDataDir: dataDir,
      node: process.version,
      files: fs.readdirSync(target),
    },
    null,
    2,
  ),
);

// 4. 打包（系统 tar 在 Windows 10+ 与 Linux 均可用）
const archive = path.join(outDir, `${name}.tar.gz`);
execFileSync('tar', ['-czf', archive, '-C', staging, name], { stdio: 'inherit' });
fs.rmSync(staging, { recursive: true, force: true });
console.log(`==> 归档完成：${archive}（${(fs.statSync(archive).size / 1024 / 1024).toFixed(2)} MB）`);

// 5. 保留策略
const archives = fs
  .readdirSync(outDir)
  .filter((f) => /^microclass-\d{8}-\d{6}\.tar\.gz$/.test(f))
  .sort()
  .reverse();
for (const old of archives.slice(keep)) {
  fs.rmSync(path.join(outDir, old), { force: true });
  console.log(`==> 清理旧备份：${old}`);
}
console.log(`==> 当前保留 ${Math.min(archives.length, keep)} 份备份于 ${outDir}`);
