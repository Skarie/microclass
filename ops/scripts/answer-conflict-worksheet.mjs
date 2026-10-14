#!/usr/bin/env node
/**
 * 「同题不同答案」人工核对工作表（只读）。
 *
 * 自动能做的（同义写法合并）已经由 `resolve-equivalent` 处理；剩下的都是**真的不同答案**，
 * 需要老师判断。这个脚本把它们导出成 CSV + Markdown，并给出**客观提示**帮老师快速定位：
 *   - 票数并列：谁也不占多数
 *   - 空数不一致：有一方把多个空写成一个（照题干空数判断）
 *   - 数值不同：多半是某一来源算错或印错（**多数票也可能是错的**，要按题目条件验算）
 *   - 一方是另一方的超集：多出来的写法可能是错的，也可能只是更宽松
 *
 * 注意：提示只是"这条为什么可疑"，**不替老师决定答案**。
 *
 * 用法（容器内）：
 *   node /app/ops/scripts/answer-conflict-worksheet.mjs --out /tmp
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const appRoot = process.env.MC_APP_ROOT || valueOf('--app-root', '/app');
const outDir = valueOf('--out', '/tmp');

const mod = async (rel) => import(pathToFileURL(path.join(appRoot, 'apps/api/dist', rel)).href);
const { loadConfig } = await mod('config/env.js');
const { openDb } = await mod('db/client.js');
const { answersEquivalent, splitAnswerTokens } = await mod('domain/answerNormalize.js');

const config = loadConfig();
if (valueOf('--data-dir', '')) config.dataDir = valueOf('--data-dir');
const db = openDb(config.dataDir);

/** 题干里的空数（导入模板用连续下划线表示空） */
const blankCountOf = (stem) => (String(stem).match(/_{2,}/g) ?? []).length;

function tipFor(variants, counts, stem) {
  const tips = [];
  const blankCounts = new Set(variants.map((v) => splitAnswerTokens(v).length));
  const stemBlanks = blankCountOf(stem);
  if (blankCounts.size > 1) {
    tips.push(`空数不一致（${[...blankCounts].join('/')}）${stemBlanks > 0 ? `，题干有 ${stemBlanks} 个空` : ''}`);
  }
  const top = counts[0];
  if (counts.filter((n) => n === top).length > 1) tips.push('票数并列');
  const nums = variants.map((v) => Number(String(v).replace(/[^\d.-]/g, ''))).filter((n) => Number.isFinite(n));
  if (nums.length >= 2 && new Set(nums).size > 1 && tips.length === 0)
    tips.push('数值不同：按题目条件验算（多数票不一定对）');
  if (tips.length === 0) tips.push('两种写法差异明显，需看题干判断');
  return tips.join('；');
}

const groups = db.all("SELECT content_hash, group_size, sample_stem FROM question_conflicts WHERE status = 'pending'");
const rows = [];
for (const g of groups) {
  const answers = db.all(
    'SELECT answer, COUNT(*) AS n FROM questions WHERE content_hash = ? GROUP BY answer ORDER BY n DESC',
    [g.content_hash],
  );
  if (answers.length < 2) continue;
  const variants = answers.map((a) => a.answer);
  if (variants.every((v) => answersEquivalent(variants[0] ?? '', v))) continue; // 等价的已由批量合并处理
  const banks = db.all(
    `SELECT DISTINCT COALESCE(b.name, '') AS name FROM questions q LEFT JOIN banks b ON b.id = q.bank_id
     WHERE q.content_hash = ? LIMIT 3`,
    [g.content_hash],
  );
  rows.push({
    hash: g.content_hash,
    groupSize: g.group_size,
    stem: String(g.sample_stem ?? '').replace(/\s+/g, ' '),
    answers: answers.map((a) => ({ answer: a.answer, n: a.n })),
    banks: banks
      .map((b) => b.name)
      .filter(Boolean)
      .join(' / '),
    tip: tipFor(
      variants,
      answers.map((a) => a.n),
      g.sample_stem ?? '',
    ),
  });
}
rows.sort((a, b) => b.groupSize - a.groupSize);

const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
const csv = [
  ['序号', '组内题数', '题干', '答案与票数', '题库', '客观提示', '冲突指纹'].map(esc).join(','),
  ...rows.map((r, i) =>
    [i + 1, r.groupSize, r.stem, r.answers.map((a) => `${a.answer} ×${a.n}`).join('  |  '), r.banks, r.tip, r.hash]
      .map(esc)
      .join(','),
  ),
].join('\n');

const md = [
  `# 同题不同答案 —— 人工核对工作表（${rows.length} 组）`,
  '',
  '自动能合并的同义写法已处理完；下面这些是**真的不同答案**，需要判断信哪个（或确认都合理后忽略）。',
  '',
  '| # | 题数 | 题干 | 答案与票数 | 客观提示 |',
  '| --- | --- | --- | --- | --- |',
  ...rows.map(
    (r, i) =>
      `| ${i + 1} | ${r.groupSize} | ${r.stem.slice(0, 60).replace(/\|/g, '\\|')} | ${r.answers
        .map((a) => `${a.answer} ×${a.n}`)
        .join(' <br> ')
        .replace(/\|/g, '\\|')} | ${r.tip} |`,
  ),
].join('\n');

const csvPath = path.join(outDir, 'conflict-review.csv');
const mdPath = path.join(outDir, 'conflict-review.md');
fs.writeFileSync(csvPath, `\uFEFF${csv}\n`); // 带 BOM，Excel 打开不乱码
fs.writeFileSync(mdPath, `${md}\n`);

console.log(`待人工核对 ${rows.length} 组（${rows.reduce((s, r) => s + r.groupSize, 0)} 题）`);
console.log(`已写：${csvPath}`);
console.log(`已写：${mdPath}`);
const byTip = new Map();
for (const r of rows) byTip.set(r.tip, (byTip.get(r.tip) ?? 0) + 1);
console.log('\n按提示分布：');
for (const [tip, n] of [...byTip.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(n).padStart(3)} 组  ${tip}`);
db.close();
