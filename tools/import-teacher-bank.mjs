#!/usr/bin/env node
/**
 * 教师版题库「整册覆盖」导入 CLI。
 *
 * 数据量大（12k 题 / 2k 张图）时走容器内直跑，不经过 HTTP 上传：
 *
 *   # 只统计（不写库、不落图）
 *   node tools/import-teacher-bank.mjs /bank/数学/七年级上册（新） --dry --subject=数学 --book=七年级上册（新）
 *   # 正式导入
 *   node tools/import-teacher-bank.mjs /bank/数学/七年级上册（新） --subject=数学 --book=七年级上册（新）
 *
 * 源目录可以是「题库_教师版」根目录（内含 `<学科>/<册次>/…`）、`<学科>/<册次>`，
 * 也可以直接是册次目录。数据库位置沿用服务端同一套环境变量
 * （`MC_DATA_DIR` / `MC_MIGRATIONS_DIR`），启动时先跑迁移。
 *
 * 退出码：0 成功 / 2 参数错误 / 3 运行前置条件缺失 / 4 课程未匹配（整册跳过）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const USAGE = `用法：node tools/import-teacher-bank.mjs <源目录> [--dry] [--subject=数学] [--book=七年级上册（新）]
  --dry                 只统计不写库（题图也不落盘）
  --subject=学科         学科，默认 数学
  --book=册次            册次，默认 七年级上册（新）
  --max-samples=N        JSON 里 samples 保留条数，默认 20
  --data-dir=PATH        覆盖 MC_DATA_DIR
  --app-root=PATH        应用根目录（默认取本仓库根 / 容器内 /app）`;

/** 解析 `--k=v` 与 `--k v` 两种写法 */
function parseArgs(argv) {
  const opts = {
    _: [],
    dryRun: false,
    subject: '数学',
    book: '七年级上册（新）',
    maxSamples: 20,
    dataDir: '',
    appRoot: '',
  };
  const valueKeys = new Set(['subject', 'book', 'max-samples', 'data-dir', 'app-root']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      opts._.push(arg);
      continue;
    }
    const [rawKey, inline] = arg.slice(2).split('=', 2);
    const key = rawKey;
    if (key === 'dry' || key === 'dry-run') {
      opts.dryRun = true;
      continue;
    }
    if (!valueKeys.has(key)) throw new Error(`未知参数：--${key}`);
    let value = inline;
    if (value === undefined) {
      i += 1;
      value = argv[i];
    }
    if (value === undefined || value === '') throw new Error(`参数 --${key} 缺少取值`);
    if (key === 'subject') opts.subject = value;
    else if (key === 'book') opts.book = value;
    else if (key === 'max-samples') opts.maxSamples = Number.parseInt(value, 10);
    else if (key === 'data-dir') opts.dataDir = value;
    else opts.appRoot = value;
  }
  if (!Number.isInteger(opts.maxSamples) || opts.maxSamples < 0) throw new Error('--max-samples 必须是非负整数');
  return opts;
}

/** 载入编译后的服务端模块（与 ops/scripts 里其它脚本同一约定） */
async function loadModules(appRoot) {
  const mod = (rel) => import(pathToFileURL(path.join(appRoot, 'apps', 'api', 'dist', rel)).href);
  const entry = path.join(appRoot, 'apps', 'api', 'dist', 'services', 'teacherBankImportService.js');
  if (!fs.existsSync(entry)) {
    throw new Error(`找不到编译产物 ${entry}，请先执行 npm run build（容器内镜像已包含 dist）`);
  }
  const { loadConfig } = await mod('config/env.js');
  const { openDb } = await mod('db/client.js');
  const { runMigrations } = await mod('db/migrations.js');
  const { QuestionMediaStore } = await mod('services/questionMediaStore.js');
  const { runTeacherBankImport } = await mod('services/teacherBankImportService.js');
  return { loadConfig, openDb, runMigrations, QuestionMediaStore, runTeacherBankImport };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const sourceDir = opts._[0];
  if (!sourceDir) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (!fs.existsSync(sourceDir)) {
    process.stderr.write(`✗ 源目录不存在：${sourceDir}\n`);
    return 3;
  }
  if (opts.dataDir !== '') process.env.MC_DATA_DIR = opts.dataDir;
  const appRoot = path.resolve(
    opts.appRoot || process.env.MC_APP_ROOT || path.resolve(fileURLToPath(import.meta.url), '..', '..'),
  );
  const { loadConfig, openDb, runMigrations, QuestionMediaStore, runTeacherBankImport } = await loadModules(appRoot);

  const config = loadConfig();
  const db = openDb(config.dataDir);
  try {
    const migrated = runMigrations(db, config.migrationsDir);
    if (migrated.applied.length > 0) {
      process.stderr.write(`✓ 应用迁移 ${migrated.applied.map((m) => m.version).join(', ')}\n`);
    }
    const report = runTeacherBankImport(db, new QuestionMediaStore(config.dataDir), {
      subject: opts.subject,
      book: opts.book,
      sourceDir,
      dryRun: opts.dryRun,
      maxSamples: opts.maxSamples,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.stderr.write(
      `✓ ${report.dryRun ? 'dry-run' : '导入完成'}：课程 ${report.course ?? '（未匹配）'}，` +
        `小节 ${report.sections}，复用 ${report.banksMatched}，新建 ${report.banksCreated}，` +
        `题目 ${report.questions}，带图 ${report.questionsWithImages}，缺图 ${report.missingImages}` +
        `${report.dryRun ? '' : `，写入 ${report.imported}`}\n`,
    );
    return report.unmatchedCourses.length > 0 ? 4 : 0;
  } finally {
    db.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`✗ 导入失败：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
