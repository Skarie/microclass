#!/usr/bin/env node
/**
 * 文件行数守卫：新文件单文件硬上限 300 行，已有超限技术债只能减、不能增。
 *
 * 背景：项目此前出现过 3000 行的单文件组件，样式、状态、请求全搅在一起，
 * 拆分时连锁出现样式回归。为了让「单文件百行级」成为可执行的规则而不是口号：
 *   - 新代码：单文件 > 300 行直接失败（目标 100~200 行）；
 *   - 历史文件：超过 300 行的登记在 tools/file-size-baseline.json，
 *     只允许变小不允许变大；拆小了记得从基线里删掉；
 *   - 一个文件一个职责：组件/服务再大就按「界面块 / 领域动作」继续拆。
 *
 * 用法：node tools/check-file-size.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const HARD_LIMIT = 300;
const TARGET = 200;
const BASELINE_FILE = 'tools/file-size-baseline.json';
const DIRS = ['apps/api/src', 'apps/web/src', 'packages'];
const EXTS = new Set(['.ts', '.vue', '.css']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      walk(p, out);
    } else if (EXTS.has(path.extname(e.name))) {
      out.push(p.replaceAll('\\', '/'));
    }
  }
  return out;
}

const baseline = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : {};
const files = [...new Set(DIRS.flatMap((d) => walk(d)))];

const newViolations = [];
const grewViolations = [];
const shrinkable = [];

for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').length;
  const budget = baseline[file];
  if (budget === undefined) {
    if (lines > HARD_LIMIT) newViolations.push({ file, lines });
  } else if (lines > budget) {
    grewViolations.push({ file, lines, budget });
  } else if (lines <= HARD_LIMIT) {
    shrinkable.push({ file, lines, budget });
  }
}

if (newViolations.length) {
  console.error(`\n✖ 新增文件超过 ${HARD_LIMIT} 行（目标是 ${TARGET} 行左右）：`);
  for (const v of newViolations) {
    console.error(`  ${v.lines} 行  ${v.file}`);
  }
  console.error('  拆法：界面按「一块可独立刷新的区域」拆组件；逻辑按职责抽 composable / service；纯函数放 utils。');
}

if (grewViolations.length) {
  console.error('\n✖ 已有超限文件又变大了（技术债只能减不能增）：');
  for (const v of grewViolations) {
    console.error(`  ${v.file}：${v.budget} → ${v.lines} 行`);
  }
}

if (shrinkable.length) {
  console.log(`\nℹ 以下文件已降到 ${HARD_LIMIT} 行以内，可以把它们从 ${BASELINE_FILE} 删掉：`);
  for (const v of shrinkable) console.log(`  ${v.file}（${v.budget} → ${v.lines} 行）`);
}

if (newViolations.length || grewViolations.length) {
  process.exit(1);
}

const debt = Object.keys(baseline).length;
console.log(`✔ 文件行数守卫通过（${files.length} 个文件；待偿还的技术债 ${debt} 个）`);
