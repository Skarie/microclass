#!/bin/bash
#
# PostgreSQL 每日逻辑备份：pg_dump -Fc → /vol1/1000/microclass-backup/pg/，保留 7 份。
#
# 为什么必须有这个脚本：PG 数据目录在 /vol1（机械盘，与备份同盘），
# 同盘风险只能靠「多留几份 + 后续外置/异机备份」缓解；系统盘另有风险，所以不要放回 NVMe 指望它当备份。
#
# 安装（root，先手动跑一次确认；确认后再加 cron）：
#   install -m 755 ops/deploy/pg-backup.sh /vol1/1000/microclass-deploy/pg-backup.sh
#   0 3 * * * /vol1/1000/microclass-deploy/pg-backup.sh >> /var/log/microclass-pg-backup.log 2>&1
#
# 可调：
#   MC_PG_BACKUP_DIR   备份目录（默认 /vol1/1000/microclass-backup/pg）
#   MC_PG_BACKUP_KEEP  保留份数（默认 7）
#   MC_PG_CONTAINER    PG 容器名（默认 microclass-db）
#   MC_PG_DB/USER      库名/用户（默认 microclass/microclass）
set -uo pipefail

PG_CONTAINER="${MC_PG_CONTAINER:-microclass-db}"
PG_DB="${MC_PG_DB:-microclass}"
PG_USER="${MC_PG_USER:-microclass}"
BACKUP_DIR="${MC_PG_BACKUP_DIR:-/vol1/1000/microclass-backup/pg}"
KEEP="${MC_PG_BACKUP_KEEP:-7}"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/microclass-$TS.dump"
LOG="$BACKUP_DIR/backup.log"

log() {
    echo "[$(date '+%F %T')] $*" | tee -a "$LOG"
}

mkdir -p "$BACKUP_DIR" || {
    log "✗ 无法创建备份目录 $BACKUP_DIR"
    exit 1
}

if ! docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
    log "✗ 容器 $PG_CONTAINER 不存在，跳过"
    exit 1
fi
if ! docker exec "$PG_CONTAINER" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
    log "✗ PG 未就绪（pg_isready 失败），跳过"
    exit 1
fi

start=$(date +%s)
if ! docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -Fc "$PG_DB" > "$OUT" 2>/tmp/pg-backup.err; then
    rm -f "$OUT"
    log "✗ pg_dump 失败：$(tail -2 /tmp/pg-backup.err | tr '\n' ' ')"
    exit 1
fi

size=$(stat -c %s "$OUT" 2>/dev/null || echo 0)
if [ "$size" -lt 1000000 ]; then
    log "✗ 备份文件异常小（$size 字节），保留但请人工检查：$OUT"
    exit 1
fi
log "✓ 备份完成 $(basename "$OUT") $((size / 1024 / 1024))MB，用时 $(( $(date +%s) - start ))s"

# 只保留最近 N 份（按文件名里的时间戳排序）
mapfile -t OLD < <(ls -1t "$BACKUP_DIR"/microclass-*.dump 2>/dev/null | tail -n +$((KEEP + 1)))
if [ "${#OLD[@]}" -gt 0 ]; then
    for f in "${OLD[@]}"; do
        rm -f "$f" && log "  清理旧备份 $(basename "$f")"
    done
fi

log "当前保留：$(ls -1 "$BACKUP_DIR"/microclass-*.dump 2>/dev/null | wc -l) 份"
log "⚠ 与数据同盘（/vol1），请另行做外置/异机备份"
