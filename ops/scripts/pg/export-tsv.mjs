/**
 * SQLite → TSV 导出（P0 迁移用，PG COPY TEXT 格式）。
 *
 * 为什么导出成 TSV 再用 psql \copy：
 *   - NAS 上不需要给 Node 装 pg 驱动（少一个依赖、少一处版本风险）；
 *   - COPY 是 PG 最快的批量装载路径（39.6 万题几分钟内）；
 *   - 导出产物可留档、可重复装载（幂等重试）。
 *
 * 用法：node export-tsv.mjs <sqlite.db> <输出目录>
 * 产物：<目录>/<table>.tsv + <目录>/manifest.json（每表行数 + 列顺序）
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import path from 'node:path';

const dbPath = process.argv[2];
const outDir = process.argv[3] ?? '/tmp/pg-export';
if (!dbPath) {
  console.error('用法: node export-tsv.mjs <sqlite.db> <outDir>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const db = new DatabaseSync(dbPath, { readOnly: true });
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => r.name);

/** COPY TEXT 格式转义：反斜杠、制表、换行、回车 */
function esc(value) {
  if (value === null || value === undefined) return '\\N';
  let s;
  if (typeof value === 'bigint') s = value.toString();
  else if (typeof value === 'number') s = Number.isInteger(value) ? String(value) : String(value);
  else if (value instanceof Uint8Array) s = '\\x' + Buffer.from(value).toString('hex');
  else s = String(value);
  return s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

const manifest = { source: dbPath, tables: {} };
const startedAll = Date.now();

for (const table of tables) {
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
  const file = path.join(outDir, `${table}.tsv`);
  const ws = createWriteStream(file);
  const started = Date.now();
  let rows = 0;

  // 分页扫描：避免一次性把 39.6 万题读进内存
  const pageSize = 20000;
  let lastRowid = -1;
  const hasRowid = cols.includes('id');
  for (;;) {
    const page = hasRowid
      ? db
          .prepare(`SELECT * FROM "${table}" WHERE id > ? ORDER BY id LIMIT ${pageSize}`)
          .all(lastRowid)
      : db.prepare(`SELECT * FROM "${table}" LIMIT ${pageSize} OFFSET ${rows}`).all();
    if (page.length === 0) break;
    const buf = [];
    for (const row of page) {
      buf.push(cols.map((c) => esc(row[c])).join('\t'));
      rows += 1;
    }
    if (!ws.write(buf.join('\n') + '\n')) {
      await new Promise((r) => ws.once('drain', r));
    }
    if (hasRowid) lastRowid = page[page.length - 1].id;
    else if (page.length < pageSize) break;
  }
  await new Promise((r) => ws.end(r));

  manifest.tables[table] = { columns: cols, rows, file };
  console.log(
    `${table.padEnd(24)} ${String(rows).padStart(8)} 行  ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\n合计 ${Object.values(manifest.tables).reduce((a, t) => a + t.rows, 0)} 行，用时 ${((Date.now() - startedAll) / 1000).toFixed(1)}s`);
console.log(`产物目录: ${outDir}`);
db.close();
