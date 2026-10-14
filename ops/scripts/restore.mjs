#!/usr/bin/env node
/**
 * 微课堂恢复：从备份归档还原数据目录。
 *
 * 安全策略：
 *   1. 恢复前先校验归档内的 SQLite 快照（PRAGMA integrity_check）；
 *   2. 目标目录非空时必须显式 --force；
 *   3. 恢复前把现有数据目录改名保留为 <数据目录>.pre-restore-<时间戳>，可回滚。
 *
 * 恢复前请先停止服务（本地 npm start / Docker container / fnOS 应用），
 * 否则运行中的进程会持有旧数据库句柄。
 *
 * 用法：
 *   node ops/scripts/restore.mjs --from backups/microclass-20260912-010000.tar.gz [--data-dir <dir>] [--force]
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

const archive = arg('from', '');
const force = process.argv.includes('--force');
const dataDir = path.resolve(arg('data-dir', process.env.MC_DATA_DIR ?? path.join(REPO_ROOT, 'data')));

if (!archive) {
  console.error('用法：node ops/scripts/restore.mjs --from <backup.tar.gz> [--data-dir <dir>] [--force]');
  process.exit(1);
}
const archivePath = path.resolve(archive);
if (!fs.existsSync(archivePath)) {
  console.error(`✗ 归档不存在：${archivePath}`);
  process.exit(1);
}

const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-restore-'));
console.log(`==> 解包：${archivePath}`);
execFileSync('tar', ['-xzf', archivePath, '-C', staging], { stdio: 'inherit' });

const entries = fs.readdirSync(staging);
const rootName = entries.find((e) => fs.statSync(path.join(staging, e)).isDirectory());
if (!rootName) {
  console.error('✗ 归档结构异常：未找到顶层目录');
  process.exit(1);
}
const payload = path.join(staging, rootName);
const dbFile = path.join(payload, 'microclass.db');
if (!fs.existsSync(dbFile)) {
  console.error('✗ 归档中缺少 microclass.db');
  process.exit(1);
}

// 1. 完整性校验：坏归档宁可不用，也不要覆盖现有数据
console.log('==> 校验数据库完整性');
const db = new DatabaseSync(dbFile, { readOnly: true });
try {
  const row = db.prepare('PRAGMA integrity_check').get();
  const result = row ? Object.values(row)[0] : 'unknown';
  if (result !== 'ok') {
    console.error(`✗ 完整性检查未通过：${String(result)}`);
    process.exit(1);
  }
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => Object.values(r)[0]);
  const version = tables.includes('schema_migrations')
    ? db
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all()
        .map((r) => Object.values(r)[0])
        .join(',')
    : '（无迁移记录）';
  console.log(`   integrity_check = ok，表 ${tables.length} 张，迁移版本：${version}`);
} finally {
  db.close();
}

// 2. 目标目录保护
if (fs.existsSync(dataDir) && fs.readdirSync(dataDir).length > 0 && !force) {
  console.error(`✗ 目标数据目录非空：${dataDir}`);
  console.error('  如确认覆盖，请追加 --force（现有数据会先改名保留）。');
  process.exit(1);
}

let backupDir = '';
if (fs.existsSync(dataDir)) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
  backupDir = `${dataDir}.pre-restore-${stamp}`;
  fs.renameSync(dataDir, backupDir);
  console.log(`==> 现有数据已保留为：${backupDir}`);
}
fs.mkdirSync(dataDir, { recursive: true });

// 3. 落位
for (const item of fs.readdirSync(payload)) {
  if (item === 'MANIFEST.json') continue;
  fs.cpSync(path.join(payload, item), path.join(dataDir, item), { recursive: true });
}
fs.rmSync(staging, { recursive: true, force: true });

console.log(`==> 恢复完成：${dataDir}`);
console.log('   请启动服务，服务会自动把数据库迁移到当前版本（幂等）。');
if (backupDir) console.log(`   如需回滚：删除 ${dataDir} 后把 ${backupDir} 改回原名。`);
