/**
 * 视频路径找回（默认只预演，`--apply` 才写库）。
 *
 * 用法（容器内）：
 *   node /app/ops/scripts/repair-video-paths.mjs                 # 预演：报告能修多少、怎么修
 *   node /app/ops/scripts/repair-video-paths.mjs --apply         # 落库
 *   node /app/ops/scripts/repair-video-paths.mjs --apply --out /tmp   # 落库并把清单写到 /tmp
 *
 * 判定规则见 `apps/api/src/domain/videoPath.ts`：只有**唯一命中**才自动改，
 * 同名文件有多个候选的一律不动（宁可留给人看，也别指错视频）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const apply = argv.includes('--apply');
const outDir = valueOf('--out', '');
const appRoot = process.env.MC_APP_ROOT || valueOf('--app-root', '/app');

const mod = async (rel) => import(pathToFileURL(path.join(appRoot, 'apps/api/dist', rel)).href);
const { loadConfig } = await mod('config/env.js');
const { openDb } = await mod('db/client.js');
const { pickVideoCandidate } = await mod('domain/videoPath.js');

const config = loadConfig();
if (valueOf('--data-dir', '')) config.dataDir = valueOf('--data-dir');
const db = openDb(config.dataDir);
db.exec('PRAGMA busy_timeout = 120000;');

const roots = new Map(
  JSON.parse(db.get("SELECT value AS v FROM settings WHERE key = 'media_roots'").v).map((r) => [r.id, r.path]),
);
const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.mov', '.flv', '.wmv', '.m4v', '.webm', '.ts', '.rmvb']);

/** 每个媒体根下的视频文件索引（相对路径 + 绝对路径） */
const index = new Map();
for (const [id, root] of roots) {
  const list = [];
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (VIDEO_EXT.has(path.extname(e.name).toLowerCase())) {
        list.push({ rel: path.relative(root, full).split(path.sep).join('/'), full });
      }
    }
  };
  walk(root, 0);
  index.set(id, list);
}

const lessons = db.all("SELECT id, title, media_root, video_path FROM lessons WHERE video_path <> ''");
const fixes = [];
const unfixable = [];
const reasonCount = new Map();
for (const l of lessons) {
  const root = roots.get(l.media_root);
  const rel = String(l.video_path).split(path.sep).join('/');
  const abs = root ? path.join(root, String(l.video_path)) : String(l.video_path);
  if (fs.existsSync(abs)) continue;

  const parts = rel.split('/');
  const name = parts.pop() ?? '';
  const dir = parts.join('/');
  const match = pickVideoCandidate(dir, name, index.get(l.media_root) ?? []);
  if (match) {
    fixes.push({ id: l.id, title: String(l.title).slice(0, 30), from: rel, to: match.rel, reason: match.reason });
    reasonCount.set(match.reason, (reasonCount.get(match.reason) ?? 0) + 1);
  } else {
    unfixable.push({ id: l.id, title: String(l.title).slice(0, 30), path: rel });
  }
}

console.log(`${apply ? '【落库】' : '【预演】'} 视频路径找回`);
console.log(`  课时总数（有视频记录）: ${lessons.length}`);
console.log(`  可自动修回            : ${fixes.length}`);
for (const [r, n] of [...reasonCount.entries()].sort((a, b) => b[1] - a[1])) {
  const label =
    { 'same-dir': '同目录同名', 'same-dir-deep': '记录目录下更深一层同名', 'global-unique': '全根唯一同名' }[r] ?? r;
  console.log(`      ${label}: ${n}`);
}
console.log(`  仍找不到（保留原样）  : ${unfixable.length}`);

console.log('\n--- 修回样本（前 10 条）---');
for (const f of fixes.slice(0, 10)) console.log(`  #${f.id} ${f.title}\n      ${f.from}\n   →  ${f.to}`);

if (unfixable.length > 0) {
  console.log('\n--- 仍找不到（前 10 条，需要人工看盘）---');
  for (const u of unfixable.slice(0, 10)) console.log(`  #${u.id} ${u.title}｜${u.path}`);
}

if (apply && fixes.length > 0) {
  // 注意：Db 封装只暴露 run/get/all/transaction（没有 prepare）——用 db.run + transaction
  const done = db.transaction(() => {
    let n = 0;
    for (const f of fixes) {
      n += db.run('UPDATE lessons SET video_path = ? WHERE id = ? AND video_path = ?', [f.to, f.id, f.from]).changes;
    }
    return n;
  });
  console.log(`\n已更新 ${done} 条课时视频路径`);
  if (done !== fixes.length) console.log(`⚠️ 预期更新 ${fixes.length} 条，实际 ${done} 条（可能有并发改动）`);
}

if (outDir) {
  const lines = ['id,title,原路径,新路径,依据'];
  for (const f of fixes)
    lines.push([f.id, `"${f.title.replace(/"/g, '""')}"`, `"${f.from}"`, `"${f.to}"`, f.reason].join(','));
  const p = path.join(outDir, 'video-path-fixes.csv');
  fs.writeFileSync(p, `\uFEFF${lines.join('\n')}\n`);
  const lines2 = ['id,title,路径'];
  for (const u of unfixable) lines2.push([u.id, `"${u.title.replace(/"/g, '""')}"`, `"${u.path}"`].join(','));
  const p2 = path.join(outDir, 'video-path-unfixable.csv');
  fs.writeFileSync(p2, `\uFEFF${lines2.join('\n')}\n`);
  console.log(`清单已写：${p}、${p2}`);
}

db.close();
