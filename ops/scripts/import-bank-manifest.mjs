#!/usr/bin/env node
/**
 * 题库导入器：把「题库包」（build-bank-manifest.mjs 的产物）灌进微课堂数据库。
 *
 * 题库包结构：
 *   <packDir>/manifest.json   { banks: [ { name, lessonId, chapter, point, questions: [...] } ] }
 *   <packDir>/images/         <sha1>.<ext>（内容寻址，题面里用 /api/v1/question-media/<file> 引用）
 *
 * 设计要点：
 * - **幂等**：以 `lesson_id` 作为题库的幂等键（一门课时一个题库）。重复执行不会产生重复题目，
 *   已有题目的题库默认跳过；确需覆盖时加 `--replace`（先插入新题、成功后再删旧题，失败不丢数据）。
 * - **图片**：调用 QuestionMediaStore 按文件头重新识别类型并落盘（与网页上传走同一条路径），
 *   若落盘文件名与包内文件名不一致（例如 .png 实际是 JPEG），自动改写题面里的引用。
 * - **安全**：只写数据库与 `uploads/question-media`，删除操作仅限 `--replace` 命中的题库原本的题目。
 *
 * 用法（容器内）：
 *   docker cp <packDir> microclass-api:/tmp/pack
 *   docker exec microclass-api node /tmp/import-bank-manifest.mjs /tmp/pack --dry-run
 *   docker exec microclass-api node /tmp/import-bank-manifest.mjs /tmp/pack
 * 参数：
 *   --dry-run          只统计不落库（图片仍会按内容寻址去重落盘）
 *   --replace          覆盖已有题库的题目（课时题库按课时、章节/试卷题库按名字定位）
 *   --limit N          最多处理 N 个题库（灰度用）
 *   --lesson-id ID     只处理指定课时（可重复）
 *   --course-id ID     只处理指定课程
 *   --kind KIND        只处理某一类题库：lesson / chapter / paper
 *   --no-backfill      已有题库不再补标准化元数据（默认会补：subject/book/chapter/point/指纹）
 *   --app-root PATH    应用根目录（默认 /app；本地验证可指向仓库根）
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/* ---------- 参数解析 ---------- */
const takesValue = new Set(['--limit', '--lesson-id', '--course-id', '--kind', '--app-root']);
const opts = {
  _: [],
  limit: 0,
  lessonIds: [],
  courseId: null,
  kind: '',
  dryRun: false,
  replace: false,
  noBackfill: false,
  appRoot: null,
};
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      opts._.push(a);
      continue;
    }
    if (!takesValue.has(a)) {
      if (a === '--dry-run') opts.dryRun = true;
      else if (a === '--replace') opts.replace = true;
      else if (a === '--no-backfill') opts.noBackfill = true;
      else {
        console.error(`未知参数：${a}`);
        process.exit(2);
      }
      continue;
    }
    const v = argv[i + 1];
    if (!v) {
      console.error(`参数 ${a} 缺少取值`);
      process.exit(2);
    }
    i += 1;
    if (a === '--limit') opts.limit = Number(v);
    else if (a === '--lesson-id') opts.lessonIds.push(Number(v));
    else if (a === '--course-id') opts.courseId = Number(v);
    else if (a === '--kind') opts.kind = v;
    else opts.appRoot = v;
  }
}

const packDir = opts._[0];
if (!packDir) {
  console.error('用法：node import-bank-manifest.mjs <packDir> [--dry-run] [--replace] [--limit N] [--lesson-id ID]');
  process.exit(2);
}
const appRoot = process.env.MC_APP_ROOT || opts.appRoot || '/app';
const packAbs = path.resolve(packDir);
const manifestFile = path.join(packAbs, 'manifest.json');
if (!fs.existsSync(manifestFile)) {
  console.error(`找不到题库包清单：${manifestFile}`);
  process.exit(2);
}
if (!Number.isFinite(opts.limit) || opts.limit < 0) {
  console.error('--limit 必须是非负整数');
  process.exit(2);
}
const imagesDir = path.join(packAbs, 'images');

/* ---------- 载入服务端模块 ---------- */
const mod = async (rel) => import(pathToFileURL(path.join(appRoot, 'apps/api/dist', rel)).href);
const { loadConfig } = await mod('config/env.js');
const { openDb } = await mod('db/client.js');
const { BankRepository } = await mod('db/repositories/bankRepository.js');
const { QuestionRepository } = await mod('db/repositories/questionRepository.js');
const { QuestionMediaStore } = await mod('services/questionMediaStore.js');
const { AuditRepository } = await mod('db/repositories/auditRepository.js');
const { questionFingerprint: fingerprint } = await mod('domain/question.js');

const config = loadConfig();
const db = openDb(config.dataDir);
const banks = new BankRepository(db);
const questions = new QuestionRepository(db);
const media = new QuestionMediaStore(config.dataDir);
const audit = new AuditRepository(db);

/** 迁移版本自检：0007（难度）与 0008（标准化元数据）列必须存在 */
{
  const cols = db.all('PRAGMA table_info(questions)').map((c) => c.name);
  for (const col of ['difficulty', 'subject', 'content_hash']) {
    if (!cols.includes(col)) {
      console.error(`questions.${col} 列不存在：请先执行迁移（node apps/api/dist/db/run-migrations.js）`);
      process.exit(3);
    }
  }
  const bankCols = db.all('PRAGMA table_info(banks)').map((c) => c.name);
  if (!bankCols.includes('kind')) {
    console.error('banks.kind 列不存在：请先执行迁移（node apps/api/dist/db/run-migrations.js）');
    process.exit(3);
  }
}

const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const stats = {
  packDir: packAbs,
  dataDir: config.dataDir,
  dryRun: opts.dryRun,
  replace: opts.replace,
  kind: opts.kind || '(全部)',
  banksTotal: manifest.banks.length,
  banksProcessed: 0,
  banksImported: 0,
  banksSkipped: 0,
  banksReplaced: 0,
  questionsInserted: 0,
  questionsBackfilled: 0,
  imagesPacked: 0,
  imagesSaved: 0,
  imagesDeduped: 0,
  imagesRejected: 0,
  refsRewritten: 0,
  missingLessons: [],
  errors: [],
};

/* ---------- 1. 图片入库 ---------- */
const renaming = new Map(); // 包内文件名 → 线上 URL（仅两者不同的记录）
const relPaths = new Map(); // 线上文件名 → 相对 uploads 的存储路径（写进 image_path，兼容旧视图/导出）
if (fs.existsSync(imagesDir)) {
  for (const file of fs.readdirSync(imagesDir)) {
    const abs = path.join(imagesDir, file);
    if (!fs.statSync(abs).isFile()) continue;
    stats.imagesPacked += 1;
    const saved = media.save(fs.readFileSync(abs));
    if (!saved) {
      stats.imagesRejected += 1;
      continue;
    }
    if (saved.deduped) stats.imagesDeduped += 1;
    else stats.imagesSaved += 1;
    relPaths.set(saved.file, saved.relPath);
    if (saved.file !== file) renaming.set(file, saved.url);
  }
}
const rewrite = (text) => {
  if (!text || renaming.size === 0) return text;
  return text.replace(/\/api\/v1\/question-media\/([0-9a-f]{40}\.[a-z]+)/gi, (full, name) => {
    const to = renaming.get(name);
    if (!to) return full;
    stats.refsRewritten += 1;
    return to;
  });
};

/* ---------- 2. 题目入库 ---------- */
const findLesson = (id) => db.get('SELECT id, title, course_id FROM lessons WHERE id = ?', [id]);

/**
 * 题库条目的标准化元数据（迁移 0008 的列）。
 * 老包的 manifest 里可能没有 subject/book/stage —— 从 source 路径（`学科/书册/章节/知识点`）
 * 与 matchedBook 兜底推导，保证「题库包格式升级」不会让元数据留空。
 */
const stageOf = (s) => {
  const t = String(s ?? '');
  if (/小学/.test(t)) return '小学';
  if (/初中/.test(t)) return '初中';
  if (/高中/.test(t)) return '高中';
  if (/[一二三四五六]年级/.test(t)) return '小学';
  if (/[七八九]年级/.test(t)) return '初中';
  if (/必修|选修/.test(t)) return '高中';
  return '';
};
const bankMeta = (bank) => {
  const source = String(bank.source ?? '');
  const book = bank.book || bank.matchedBook || '';
  return {
    kind: bank.kind || 'lesson',
    subject: bank.subject || source.split('/')[0] || '',
    book,
  };
};
const bankStage = (bank) => bank.stage || stageOf(bank.book || bank.matchedBook || '');

/** 单条题目的入库行（含元数据与内容指纹） */
function questionRow(q, i, bank, bankId) {
  const stem = rewrite(q.stem) ?? '';
  const options = (q.options ?? []).map((o) => rewrite(o) ?? '');
  const first = /!\[\]\((\/api\/v1\/question-media\/([0-9a-f]{40}\.[a-z]+))\)/i.exec(stem);
  return {
    bankId,
    lessonId: bank.lessonId ?? null,
    type: q.type,
    stem,
    options,
    answer: q.answer ?? '',
    analysis: rewrite(q.analysis) ?? '',
    difficulty: q.difficulty ?? '',
    // image_path 的语义是「相对 uploads 的存储路径」（旧视图 /question-images/:id 与 Word 导出都按它取图），
    // 因此这里写 question-media/xx/<sha>.<ext>，而不是题面里的 URL
    imagePath: first?.[2] ? relPaths.get(first[2]) : undefined,
    sort: i,
    // 标准化元数据（题库级 + 题目级 + 内容指纹）
    subject: bankMeta(bank).subject,
    stage: bankStage(bank),
    book: bankMeta(bank).book,
    chapter: bank.chapter ?? '',
    point: bank.point ?? '',
    sourcePath: bank.source ?? '',
    sourceNo: q.sourceId ?? '',
    contentHash: fingerprint(stem, options),
    // 体检用的预计算列：题干/选项/解析里是否引用题图（避免每次体检 LIKE 全表扫描）
    hasImage: [stem, ...options, String(rewrite(q.analysis) ?? '')].some((t) => t.includes('question-media')),
  };
}

/**
 * 标准化回填：题库已存在（有题）时，把「题面/答案没变、只是缺元数据」的历史数据补齐。
 * 按 sort 顺序与包内题目一一对应（导入时 sort = 数组下标），只补元数据，不动题面与答案。
 */
function backfillBank(bankId, bank) {
  banks.setMetadata(bankId, bankMeta(bank));
  const rows = db.all(
    'SELECT id, stem, options, content_hash, subject FROM questions WHERE bank_id = ? ORDER BY sort, id',
    [bankId],
  );
  const paired = rows.length === bank.questions.length;
  let updated = 0;
  db.transaction(() => {
    rows.forEach((r, i) => {
      let options = [];
      try {
        const parsed = JSON.parse(String(r.options ?? '[]'));
        if (Array.isArray(parsed)) options = parsed.map((o) => String(o));
      } catch {
        /* 保持空数组 */
      }
      const source = paired ? bank.questions[i] : undefined;
      db.run(
        `UPDATE questions SET subject = ?, stage = ?, book = ?, chapter = ?, point = ?, source_path = ?,
           source_no = ?, content_hash = ?, has_image = ? WHERE id = ?`,
        [
          bankMeta(bank).subject,
          bankStage(bank),
          bankMeta(bank).book,
          bank.chapter ?? '',
          bank.point ?? '',
          bank.source ?? '',
          source?.sourceId ?? '',
          r.content_hash || fingerprint(r.stem, options),
          /question-media/.test([r.stem, ...options, source?.analysis ?? ''].map((t) => String(t ?? '')).join('\n'))
            ? 1
            : 0,
          r.id,
        ],
      );
      updated += 1;
    });
  });
  return updated;
}

const details = [];

/**
 * 写库重试：SQLite 在 WAL 下多写者会偶发 `database is locked`（NAS 慢盘上单个事务可能超过 busy_timeout）。
 * 命中锁错误就等一会儿重试，其它错误原样抛出。
 */
const sleepSync = (ms) => {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
};
function withRetry(fn, attempts = 5) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return fn();
    } catch (err) {
      last = err;
      if (!/database is locked|SQLITE_BUSY/i.test(String(err?.message ?? err))) throw err;
      sleepSync(1000 * (i + 1));
    }
  }
  throw last;
}

for (const bank of manifest.banks) {
  if (opts.limit > 0 && stats.banksProcessed >= opts.limit) break;
  if (opts.courseId !== null && bank.courseId !== opts.courseId) continue;
  if (opts.kind && (bank.kind ?? 'lesson') !== opts.kind) continue;
  if (opts.lessonIds.length > 0 && !opts.lessonIds.includes(bank.lessonId)) continue;

  // 课时配套题库：以课时为幂等键；章节题库 / 整卷试卷（没有课时归属）：以题库名为幂等键
  if (bank.lessonId === null || bank.lessonId === undefined) {
    const existing = banks.findByName(bank.name);
    const existingCount = existing ? banks.questionCount(existing.id) : 0;
    stats.banksProcessed += 1;
    if (existing && existingCount > 0 && !opts.replace) {
      stats.banksSkipped += 1;
      if (!opts.noBackfill) stats.questionsBackfilled += backfillBank(existing.id, bank);
      details.push({ name: bank.name, bankId: existing.id, skipped: true, existingCount });
      continue;
    }
    if (opts.dryRun) {
      stats.questionsInserted += bank.questions.length;
      details.push({ name: bank.name, bankId: existing?.id ?? null, questions: bank.questions.length, dryRun: true });
      continue;
    }
    try {
      withRetry(() => {
        const meta = bankMeta(bank);
        let bankId = existing?.id ?? null;
        if (bankId === null) bankId = banks.create({ name: bank.name, lessonId: null, ...meta });
        else banks.setMetadata(bankId, meta);
        const rows = bank.questions.map((q, i) => questionRow(q, i, bank, bankId));
        const oldIds = existingCount > 0 ? questions.listByBank(bankId).map((q) => q.id) : [];
        const inserted = questions.insertMany(rows);
        if (oldIds.length > 0) {
          db.transaction(() => {
            for (const id of oldIds) db.run('DELETE FROM questions WHERE id = ?', [id]);
          });
          stats.banksReplaced += 1;
        }
        stats.banksImported += 1;
        stats.questionsInserted += inserted;
        details.push({ name: bank.name, bankId, questions: inserted, total: banks.questionCount(bankId) });
      });
    } catch (err) {
      stats.errors.push(`${bank.name}：${err instanceof Error ? err.message : String(err)}`);
    }
    continue;
  }

  const lesson = findLesson(bank.lessonId);
  if (!lesson) {
    stats.missingLessons.push(`${bank.name}（lesson ${bank.lessonId} 已不存在）`);
    continue;
  }
  stats.banksProcessed += 1;

  const existing = banks.list({ lessonId: bank.lessonId });
  let bankId = existing[0]?.id ?? null;
  const existingCount = bankId === null ? 0 : banks.questionCount(bankId);

  if (bankId !== null && existingCount > 0 && !opts.replace) {
    stats.banksSkipped += 1;
    if (!opts.noBackfill) stats.questionsBackfilled += backfillBank(bankId, bank);
    details.push({ lessonId: bank.lessonId, bankId, name: bank.name, skipped: true, existingCount });
    continue;
  }

  const rows = bank.questions.map((q, i) => questionRow(q, i, bank, 0));

  if (opts.dryRun) {
    stats.questionsInserted += rows.length;
    details.push({ lessonId: bank.lessonId, bankId, name: bank.name, questions: rows.length, dryRun: true });
    continue;
  }

  try {
    withRetry(() => {
      // 先插入新题（insertMany 自带事务，整体成功或整体失败），成功后再删旧题：中途失败不丢数据
      const meta = bankMeta(bank);
      if (bankId === null) bankId = banks.create({ name: bank.name, lessonId: bank.lessonId, ...meta });
      else banks.setMetadata(bankId, meta);
      const oldIds = existingCount > 0 ? questions.listByBank(bankId).map((q) => q.id) : [];
      const inserted = questions.insertMany(rows.map((r) => ({ ...r, bankId })));
      // 删除也必须**批量在一个事务里**：逐条删会一事一提交，在 NAS 的慢盘上 5000 多道题要十几分钟
      if (oldIds.length > 0) {
        db.transaction(() => {
          for (const id of oldIds) db.run('DELETE FROM questions WHERE id = ?', [id]);
        });
        stats.banksReplaced += 1;
      }
      stats.banksImported += 1;
      stats.questionsInserted += inserted;
      details.push({
        lessonId: bank.lessonId,
        bankId,
        name: bank.name,
        questions: inserted,
        total: banks.questionCount(bankId),
      });
    });
  } catch (err) {
    stats.errors.push(`${bank.name}：${err instanceof Error ? err.message : String(err)}`);
  }
}

/* ---------- 3. 审计与输出 ---------- */
if (!opts.dryRun && stats.questionsInserted > 0) {
  audit.write({
    actorId: null,
    actorName: '系统导入',
    action: 'question_bank.import',
    targetType: 'bank',
    targetId: null,
    detail: JSON.stringify({
      pack: path.basename(packAbs),
      banks: stats.banksImported,
      questions: stats.questionsInserted,
      backfilled: stats.questionsBackfilled,
      images: stats.imagesSaved,
      replace: opts.replace,
    }),
    ip: null,
    requestId: null,
  });
}

const mediaStats = media.stats();
/**
 * 导入器是直接写 SQL 的，绕过了仓储层的写路径 → 顺手把这次涉及的题库题量重算一遍
 * （`banks.question_count` 是迁移 0019 的预计算列，题库列表/目录树靠它，不能靠现场扫表）。
 */
const recount = (() => {
  try {
    const fixed = questions.fixBankQuestionCounts();
    return fixed;
  } catch (e) {
    console.warn(`题库题量重算失败（可事后跑 POST /banks/fix-question-counts）：${e.message}`);
    return -1;
  }
})();
console.log(
  [
    '',
    `题库包：${packAbs}${opts.dryRun ? '（dry-run，题目不落库）' : ''}`,
    `数据目录：${config.dataDir}｜类型过滤：${stats.kind}`,
    `题库：清单 ${stats.banksTotal}｜处理 ${stats.banksProcessed}｜新建/写入 ${stats.banksImported}｜跳过（已有题）${stats.banksSkipped}｜覆盖重建 ${stats.banksReplaced}`,
    `题目：写入 ${stats.questionsInserted} 道｜标准化回填 ${stats.questionsBackfilled} 道`,
    `题量预计算列：修正 ${recount} 个题库`,
    `图片：包内 ${stats.imagesPacked} 张 → 新增 ${stats.imagesSaved}｜已存在 ${stats.imagesDeduped}｜不支持 ${stats.imagesRejected}｜引用改写 ${stats.refsRewritten}`,
    `图片仓库现有 ${mediaStats.files} 张（${(mediaStats.bytes / 1024 / 1024).toFixed(1)} MB）`,
    `课时缺失 ${stats.missingLessons.length}｜错误 ${stats.errors.length}`,
    stats.missingLessons.length > 0 ? `  缺失示例：${stats.missingLessons.slice(0, 3).join('；')}` : '',
    stats.errors.length > 0 ? `  错误示例：${stats.errors.slice(0, 3).join('；')}` : '',
    '',
  ]
    .filter(Boolean)
    .join('\n'),
);
if (details.length > 0 && details.length <= 20) {
  for (const d of details) console.log(`  · ${d.name} → ${d.questions ?? d.existingCount} 题`);
}
// 结果写回包目录；包目录只读时（走只读挂载 /import 导入）落回数据目录，别让导入白跑
const resultName = opts.dryRun ? 'import-dryrun.json' : 'import-result.json';
const payload = JSON.stringify({ stats, details }, null, 2);
try {
  fs.writeFileSync(path.join(packAbs, resultName), payload);
} catch {
  const fallbackDir = path.join(config.dataDir, 'bank-import-results');
  fs.mkdirSync(fallbackDir, { recursive: true });
  const fallback = path.join(fallbackDir, `${path.basename(packAbs)}-${resultName}`);
  fs.writeFileSync(fallback, payload);
  console.log(`（包目录只读，结果写到 ${fallback}）`);
}
process.exit(stats.errors.length > 0 ? 1 : 0);
