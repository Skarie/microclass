#!/usr/bin/env node
/**
 * 「同题不同答案」台账体检报告（只读，不改数据）。
 *
 * 把待核对组按**可用的处理方式**分类，回答"这些冲突到底该怎么办"：
 *   A 同义写法 —— 组内写法数学等价（`(2,0)` 与 `\left(2,0\right)`、`\frac{2}{5}` 与 `0.4`、
 *                `7|七` 与 `7`）→ 可以一键合并成「两种写法都算对」（`POST /question-conflicts/resolve-equivalent`）
 *   B 真不同   —— 组内答案确实是不同的值（`1260` 与 `12600`、`圆心` 与 `圆心上`）
 *                → 必须人工判断；**不要盲目按多数票**（真机实例里多数票就是错的）
 *
 * 用法（容器内）：
 *   node /app/ops/scripts/answer-conflict-report.mjs
 *   node /app/ops/scripts/answer-conflict-report.mjs --samples 20
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const appRoot = process.env.MC_APP_ROOT || valueOf('--app-root', '/app');
const samples = Number(valueOf('--samples', '12'));

const mod = async (rel) => import(pathToFileURL(path.join(appRoot, 'apps/api/dist', rel)).href);
const { loadConfig } = await mod('config/env.js');
const { openDb } = await mod('db/client.js');
const { answersEquivalent, mergeAnswerText } = await mod('domain/answerNormalize.js');

const config = loadConfig();
if (valueOf('--data-dir', '')) config.dataDir = valueOf('--data-dir');
const db = openDb(config.dataDir);

const groups = db.all("SELECT content_hash, group_size, sample_stem FROM question_conflicts WHERE status = 'pending'");
const equivalent = [];
const different = [];
for (const g of groups) {
  const answers = db.all(
    'SELECT answer, COUNT(*) AS n FROM questions WHERE content_hash = ? GROUP BY answer ORDER BY n DESC',
    [g.content_hash],
  );
  if (answers.length < 2) continue;
  const variants = answers.map((a) => a.answer);
  const first = variants[0] ?? '';
  const item = {
    hash: g.content_hash,
    stem: String(g.sample_stem ?? '')
      .replace(/\s+/g, ' ')
      .slice(0, 70),
    total: g.group_size,
    variants,
    counts: answers.map((a) => a.n),
  };
  if (variants.every((v) => answersEquivalent(first, v))) {
    equivalent.push({ ...item, merged: variants.reduce((acc, v) => mergeAnswerText(acc, v), first) });
  } else {
    different.push(item);
  }
}

const qn = (list) => list.reduce((s, x) => s + (x.total ?? 0), 0);
console.log(`待核对 ${groups.length} 组（${qn([...equivalent, ...different])} 题）`);
console.log(`  A 同义写法（可一键合并）: ${equivalent.length} 组 / ${qn(equivalent)} 题`);
console.log(`  B 真不同（需人工判断）  : ${different.length} 组 / ${qn(different)} 题`);

console.log(`\n--- A 同义写法样本（前 ${samples} 组）---`);
for (const x of equivalent.slice(0, samples)) {
  console.log(`  ${x.stem}`);
  console.log(`    ${x.variants.map((v, i) => `${JSON.stringify(v)}×${x.counts[i]}`).join('  |  ')}`);
  console.log(`    → 合并为 ${JSON.stringify(x.merged)}`);
}

console.log(`\n--- B 真不同样本（前 ${samples} 组，必须人工；票数仅供参考）---`);
for (const x of different.slice(0, samples)) {
  console.log(`  ${x.stem}`);
  console.log(`    ${x.variants.map((v, i) => `${JSON.stringify(v)}×${x.counts[i]}`).join('  |  ')}`);
}

console.log(
  '\n提示：A 类可在「冲突题核对」页点「合并同义写法」（或 POST /question-conflicts/resolve-equivalent?dryRun=0）。',
);
db.close();
