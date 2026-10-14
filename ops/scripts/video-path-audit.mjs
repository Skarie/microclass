/**
 * 视频路径体检（只读）：
 *   1) 课时记录的 media_root/video_path 解出来是否存在；
 *   2) 不存在的，能不能在媒体目录里按「归一化文件名/相对路径」找到候选（说明只是路径记错）；
 *   3) 媒体目录里有多少视频文件**没有任何课时引用**（孤儿文件）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const appRoot = process.env.MC_APP_ROOT || '/app';
const mod = async (rel) => import(pathToFileURL(path.join(appRoot, 'apps/api/dist', rel)).href);
const { loadConfig } = await mod('config/env.js');
const { openDb } = await mod('db/client.js');
const config = loadConfig();
const db = openDb(config.dataDir);

const roots = new Map(
  JSON.parse(db.get("SELECT value AS v FROM settings WHERE key = 'media_roots'").v).map((r) => [r.id, r.path]),
);
console.log('媒体根：');
for (const [id, p] of roots) console.log(`  ${id} → ${p}${fs.existsSync(p) ? '' : '（不存在）'}`);

/** 归一化文件名：去空白/标点/大小写，便于模糊匹配 */
const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s_\-·．.、,，:：;；'"“”‘’()（）\[\]【】]/g, '');

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.mov', '.flv', '.wmv', '.m4v', '.webm', '.ts', '.rmvb']);

// 1) 扫描媒体目录里的视频文件
const filesByRoot = new Map();
let fileCount = 0;
let bytes = 0;
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
        let size = 0;
        try {
          size = fs.statSync(full).size;
        } catch {
          /* 忽略 */
        }
        list.push({ full, rel: path.relative(root, full), size });
        fileCount += 1;
        bytes += size;
      }
    }
  };
  walk(root, 0);
  filesByRoot.set(id, list);
  console.log(`  扫描 ${id}：${list.length} 个视频文件`);
}
console.log(`\n媒体目录合计：${fileCount} 个视频 / ${(bytes / 1073741824).toFixed(1)} GB`);

// 2) 逐课时判断存在性
const lessons = db.all(
  "SELECT id, title, media_root, video_path, group_name, course_id FROM lessons WHERE video_path <> ''",
);
let exist = 0;
const missing = [];
const referenced = new Set();
for (const l of lessons) {
  const root = roots.get(l.media_root);
  const abs = root ? path.join(root, String(l.video_path)) : String(l.video_path);
  if (fs.existsSync(abs)) {
    exist += 1;
    referenced.add(abs);
  } else {
    missing.push({ ...l, abs });
  }
}
console.log(`\n课时记录：${lessons.length}｜文件存在：${exist}｜**路径失效：${missing.length}**`);

// 3) 失效的能否按文件名/相对路径找回
const byRootNorm = new Map();
for (const [id, list] of filesByRoot) {
  const m = new Map();
  for (const f of list) {
    const key = norm(path.basename(f.rel));
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(f);
  }
  byRootNorm.set(id, m);
}
let recoverable = 0;
const samples = [];
const unrecoverable = [];
for (const l of missing) {
  const m = byRootNorm.get(l.media_root);
  const key = norm(path.basename(String(l.video_path)));
  const hits = (m?.get(key) ?? []).filter((h) => h.rel !== l.video_path);
  if (hits.length === 1) {
    recoverable += 1;
    if (samples.length < 12)
      samples.push({
        id: l.id,
        title: String(l.title).slice(0, 24),
        old: l.video_path,
        neu: hits[0].rel,
        mb: (hits[0].size / 1048576).toFixed(0),
      });
  } else {
    unrecoverable.push({ ...l, hits: hits.length });
  }
}
console.log(`按文件名唯一命中（可自动修回）：${recoverable} 个`);
console.log(`仍然找不到：${unrecoverable.length} 个`);

console.log('\n--- 可自动修回样本 ---');
for (const s of samples) console.log(`  #${s.id} ${s.title}｜${s.old}\n      → ${s.neu}（${s.mb} MB）`);

console.log('\n--- 找不到的样本（前 12 个，按课程分组）---');
const byCourse = new Map();
for (const u of unrecoverable) byCourse.set(u.course_id, (byCourse.get(u.course_id) ?? 0) + 1);
for (const u of unrecoverable.slice(0, 12))
  console.log(`  #${u.id} [课程${u.course_id}] ${String(u.title).slice(0, 30)}｜${String(u.video_path).slice(0, 70)}`);
console.log(
  '  按课程分布（course_id: 个数）：',
  JSON.stringify([...byCourse.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)),
);

// 4) 孤儿文件
const orphan = [];
for (const [id, list] of filesByRoot)
  for (const f of list)
    if (!referenced.has(f.full)) orphan.push({ root: id, rel: f.rel, mb: (f.size / 1048576).toFixed(0) });
console.log(`\n没有任何课时引用的视频文件：${orphan.length} 个`);
for (const o of orphan.slice(0, 10)) console.log(`  [${o.root}] ${o.rel}（${o.mb} MB）`);
db.close();
