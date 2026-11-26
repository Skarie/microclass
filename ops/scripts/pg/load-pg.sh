#!/bin/bash
#
# P0 迁移 · 装载与校验：把 export-tsv 的产物装进 PostgreSQL，并逐表核对行数。
#
# 前置：
#   1) 已用 gen-schema.mjs 生成 schema.pg.sql
#   2) 已用 export-tsv.mjs 导出到 EXPORT_DIR（含 manifest.json）
#   3) 目标 PG 容器可执行 psql（本脚本用 docker exec，不依赖宿主机 psql）
#
# 用法：
#   bash load-pg.sh <pg容器名> <数据库名> <schema.pg.sql> <post-schema.pg.sql> <导出目录>
#
# 幂等：每次都会 DROP/CREATE 目标库后重装（迁移窗口内使用；不要指向生产库）。
set -euo pipefail

PG_CONTAINER="${1:?需要 PG 容器名}"
PG_DB="${2:?需要数据库名}"
SCHEMA_SQL="${3:?需要 schema.pg.sql}"
POST_SQL="${4:?需要 post-schema.pg.sql}"
EXPORT_DIR="${5:?需要导出目录}"
PG_USER=${PG_USER:-postgres}
NODE_BIN=${MC_NODE_BIN:-/vol1/@appcenter/nodejs_v22/bin/node}
[ -x "$NODE_BIN" ] || NODE_BIN=node

psql_srv() { docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -v ON_ERROR_STOP=1 "$@"; }

echo "=== 1) 重建数据库 $PG_DB ==="
psql_srv -d postgres -c "DROP DATABASE IF EXISTS \"$PG_DB\" WITH (FORCE);"
psql_srv -d postgres -c "CREATE DATABASE \"$PG_DB\";"

echo
echo "=== 2) 建表（schema.pg.sql）==="
docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 < "$SCHEMA_SQL" >/dev/null
echo "✓ 表与索引已建"

echo
echo "=== 3) 补充特性 + 触发器（post-schema.pg.sql）==="
docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 < "$POST_SQL" >/dev/null
echo "✓ citext 与 3 个触发器已就绪"

echo
echo "=== 4) 装载 TSV ==="
# 导出产物通常是 root 创建的 0600：docker cp 进容器后 postgres(999) 读不了，
# COPY 会报 "could not open file ... Permission denied"（2026-11-27 切流踩过）。放开只读权限。
chmod -R a+rX "$EXPORT_DIR" 2>/dev/null || true
docker exec "$PG_CONTAINER" mkdir -p /tmp/pg-export
docker cp "$EXPORT_DIR/." "$PG_CONTAINER:/tmp/pg-export/" >/dev/null
start_all=$(date +%s)
for f in "$EXPORT_DIR"/*.tsv; do
    table=$(basename "$f" .tsv)
    start=$(date +%s)
    # 装载期间关掉外键/触发器（数据是同一快照，装载完再开）
    docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 \
        -c "SET session_replication_role = replica; COPY \"$table\" FROM '/tmp/pg-export/$table.tsv' WITH (FORMAT text);" >/dev/null
    rows=$(psql_srv -d "$PG_DB" -tAc "SELECT count(*) FROM \"$table\";")
    printf '  %-24s %8s 行  %ss\n' "$table" "$rows" "$(( $(date +%s) - start ))"
done
echo "装载总用时 $(( $(date +%s) - start_all ))s"

echo
echo "=== 5) 重置自增序列 ==="
psql_srv -d "$PG_DB" <<'SQL' >/dev/null
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.column_name = 'id' AND c.is_identity = 'YES'
  LOOP
    EXECUTE format(
      'SELECT setval(pg_get_serial_sequence(%L, %L), COALESCE((SELECT max(id) FROM %I), 1))',
      r.table_name, 'id', r.table_name
    );
  END LOOP;
END $$;
SQL
echo "✓ 序列已对齐 max(id)"

echo
echo "=== 6) 行数校验（对比 manifest.json）==="
"$NODE_BIN" -e '
const fs = require("node:fs");
const dir = process.argv[1];
const manifest = JSON.parse(fs.readFileSync(dir + "/manifest.json", "utf8"));
const lines = ["SELECT " + Object.keys(manifest.tables).map((t) => `(SELECT count(*) FROM "${t}") AS "${t}"`).join(", ") + ";"];
fs.writeFileSync("/tmp/pg-counts.sql", lines.join("\n"));
' "$EXPORT_DIR"
docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -tA -F$'\t' -f /dev/stdin < /tmp/pg-counts.sql > /tmp/pg-counts.tsv
"$NODE_BIN" -e '
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[1] + "/manifest.json", "utf8"));
const counts = fs.readFileSync("/tmp/pg-counts.tsv", "utf8").trim().split("\n")[0].split("\t").map(Number);
const names = Object.keys(manifest.tables);
let bad = 0;
names.forEach((t, i) => {
  const expect = manifest.tables[t].rows;
  const got = counts[i];
  if (expect !== got) { bad += 1; console.log(`  ✗ ${t}: sqlite=${expect} pg=${got}`); }
});
console.log(bad === 0 ? `✓ ${names.length} 张表行数全部一致` : `✗ ${bad} 张表不一致`);
process.exit(bad === 0 ? 0 : 1);
' "$EXPORT_DIR"
