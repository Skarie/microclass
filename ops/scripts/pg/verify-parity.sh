#!/bin/bash
#
# P0 校验：SQLite 与 PostgreSQL 的**内容一致性**（不只是行数）+ 关键查询耗时对比。
#
# 一致性用「逐表聚合指纹」：COUNT + SUM(id) + SUM(LENGTH(文本列))。
# 这三项同时相等，基本可以排除漏行/错列/编码截断；比只比 count 强得多，又比全表 hash 便宜。
set -uo pipefail

SQLITE_DB="${1:?需要 sqlite 路径}"
PG_CONTAINER="${2:-mc-pg}"
PG_DB="${3:-microclass}"
NODE_BIN=${MC_NODE_BIN:-/vol1/@appcenter/nodejs_v22/bin/node}
PG_USER=${PG_USER:-postgres}
OUT=/tmp/parity

mkdir -p "$OUT"

# 表名|文本表达式（SQLite 与 PG 都支持的写法）
CHECKS='questions|stem
questions|answer
banks|name
lessons|title
courses|name
knowledge|content
users|username
categories|name
bank_folders|name
announcements|title'

echo "=== 1) SQLite 聚合指纹 ==="
: > "$OUT/sqlite.txt"
while IFS='|' read -r t expr; do
    [ -z "$t" ] && continue
    "$NODE_BIN" -e '
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(process.argv[1], { readOnly: true });
      const [t, expr] = [process.argv[2], process.argv[3]];
      const r = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(id),0) sid, COALESCE(SUM(LENGTH(COALESCE(${expr},\x27\x27))),0) slen FROM "${t}"`).get();
      console.log(`${t}\t${expr}\t${r.c}\t${r.sid}\t${r.slen}`);
    ' "$SQLITE_DB" "$t" "$expr" 2>/dev/null >> "$OUT/sqlite.txt"
done <<< "$CHECKS"
cat "$OUT/sqlite.txt"

echo
echo "=== 2) PostgreSQL 聚合指纹 ==="
SQL=""
while IFS='|' read -r t expr; do
    [ -z "$t" ] && continue
    SQL+="SELECT '$t|$expr', COUNT(*), COALESCE(SUM(id),0), COALESCE(SUM(LENGTH(COALESCE($expr,''))),0) FROM \"$t\";"$'\n'
done <<< "$CHECKS"
echo "$SQL" > "$OUT/parity.sql"
docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -tA -F$'\t' < "$OUT/parity.sql" \
  | awk -F'\t' '{split($1,a,"|"); print a[1]"\t"a[2]"\t"$2"\t"$3"\t"$4}' > "$OUT/pg.txt"
cat "$OUT/pg.txt"

echo
echo "=== 3) 差异 ==="
if diff -u "$OUT/sqlite.txt" "$OUT/pg.txt" > "$OUT/diff.txt"; then
    echo "✓ 10 组聚合指纹完全一致（行数 + id 和 + 文本长度和）"
else
    echo "✗ 存在差异："
    cat "$OUT/diff.txt"
fi

echo
echo "=== 4) 关键查询耗时对比（同一台机器、同一份数据）==="
run_sqlite() {
    "$NODE_BIN" -e '
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(process.argv[1], { readOnly: true });
      const sql = process.argv[2];
      const t0 = process.hrtime.bigint();
      const rows = db.prepare(sql).all();
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      console.log(`${ms.toFixed(1)}ms (${rows.length} 行)`);
    ' "$SQLITE_DB" "$1" 2>/dev/null
}
run_pg() {
    docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -tA -c "\timing on" -c "$1" 2>/dev/null \
      | grep -oE 'Time: [0-9.]+ ms' | head -1 | sed 's/Time: //'
}

echo "--- 课程列表（53 门 + 课时统计）---"
echo "  SQLite: $(run_sqlite 'SELECT c.id, c.title, COUNT(l.id) FROM courses c LEFT JOIN lessons l ON l.course_id=c.id GROUP BY c.id ORDER BY c.id')"
echo "  PG    : $(run_pg "SELECT c.id, c.title, COUNT(l.id) FROM courses c LEFT JOIN lessons l ON l.course_id=c.id GROUP BY c.id ORDER BY c.id")"

echo "--- 某课时题目（走索引）---"
echo "  SQLite: $(run_sqlite 'SELECT id, stem FROM questions WHERE lesson_id=56 LIMIT 50')"
echo "  PG    : $(run_pg 'SELECT id, stem FROM questions WHERE lesson_id=56 LIMIT 50')"

echo "--- 题库列表（13k 库，按课程过滤）---"
echo "  SQLite: $(run_sqlite 'SELECT b.id, b.name FROM banks b WHERE b.course_id=1 ORDER BY b.name LIMIT 50')"
echo "  PG    : $(run_pg 'SELECT b.id, b.name FROM banks b WHERE b.course_id=1 ORDER BY b.name LIMIT 50')"

echo "--- 全库体检聚合（最重的那条）---"
HEALTH_SQL='SELECT COUNT(*) FROM questions WHERE 1=1'
echo "  SQLite: $(run_sqlite "$HEALTH_SQL")"
echo "  PG    : $(run_pg "$HEALTH_SQL")"
