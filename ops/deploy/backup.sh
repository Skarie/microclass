#!/bin/bash
#
# 统一备份入口（cron 调这个）：PostgreSQL 逻辑备份 + SQLite 卷备份 + 失败即非零退出。
#
# 背景：2026-11 起数据层在向 PostgreSQL 迁移（见 docs/postgres-migration.md）。
# 切流前生产仍是 SQLite（数据在 microclass_data 卷里），所以两份都要备；
# 切流后 SQLite 只作历史归档，PG 成为主备份对象。
#
# 安装（root）：
#   install -m 755 ops/deploy/backup.sh /vol1/1000/microclass-deploy/backup.sh
#   30 3 * * * /vol1/1000/microclass-deploy/backup.sh >> /var/log/microclass-backup.log 2>&1
set -uo pipefail

DEPLOY_DIR="${MC_DEPLOY_DIR:-/vol1/1000/microclass-deploy}"
BACKUP_ROOT="${MC_BACKUP_DIR:-/vol1/1000/microclass-backup}"
TS="$(date +%Y%m%d-%H%M%S)"
LOG="$BACKUP_ROOT/backup.log"
rc=0

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }
mkdir -p "$BACKUP_ROOT"

log "=== 开始备份 ==="

# 1) PostgreSQL（存在才备）
if docker inspect microclass-db >/dev/null 2>&1; then
    if bash "$DEPLOY_DIR/pg-backup.sh" >> "$LOG" 2>&1; then
        log "✓ PG 备份成功"
    else
        log "✗ PG 备份失败（详见 $BACKUP_ROOT/pg/backup.log）"
        rc=1
    fi
else
    log "（没有 microclass-db 容器，跳过 PG）"
fi

# 2) SQLite 数据卷（生产当前主库）
#    直接把卷目录里的 db 打成一个 tar，避免停容器；WAL 可能有一秒级误差，够用于灾难恢复。
if docker volume inspect microclass_data >/dev/null 2>&1; then
    VOLPATH=$(docker volume inspect microclass_data --format '{{.Mountpoint}}')
    OUT="$BACKUP_ROOT/sqlite-volume-$TS.tar.gz"
    if tar czf "$OUT" -C "$VOLPATH" --exclude='media-cache' --exclude='backups' . 2>/tmp/backup-err.txt; then
        log "✓ SQLite 卷备份 $(basename "$OUT") $(( $(stat -c %s "$OUT") / 1024 / 1024 ))MB"
    else
        log "✗ SQLite 卷备份失败：$(tail -2 /tmp/backup-err.txt | tr '\n' ' ')"
        rc=1
    fi
    # 只保留 7 份
    ls -1t "$BACKUP_ROOT"/sqlite-volume-*.tar.gz 2>/dev/null | tail -n +8 | while read -r f; do
        rm -f "$f" && log "  清理旧 SQLite 备份 $(basename "$f")"
    done
else
    log "✗ 找不到 microclass_data 卷"
    rc=1
fi

log "=== 结束（rc=$rc）==="
exit "$rc"
