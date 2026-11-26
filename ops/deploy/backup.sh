#!/bin/bash
#
# 统一备份入口（cron 调这个）：PostgreSQL 逻辑备份 + SQLite 卷备份 + 失败即非零退出 + 阈值告警。
#
# 背景：2026-11 起数据层已切到 PostgreSQL（见 docs/postgres-migration.md）。
# PG 是主备份对象（保留 7 份，由 pg-backup.sh 负责）；SQLite 卷已降为历史归档，
# 只保留 3 份（MC_SQLITE_BACKUP_KEEP）即可——卷 tar 实测 2.7GB/份，保留 7 份会把 /vol1 推过告警线。
#
# 安装（root）：
#   install -m 755 ops/deploy/backup.sh /vol1/1000/microclass-deploy/backup.sh
#   30 3 * * * /vol1/1000/microclass-deploy/backup.sh >> /var/log/microclass-backup.log 2>&1
#
# 可调：
#   MC_BACKUP_DIR          备份根目录（默认 /vol1/1000/microclass-backup）
#   MC_SQLITE_BACKUP_KEEP  SQLite 卷 tar 保留份数（默认 3）
#   MC_DISK_PATH           磁盘告警检查的挂载点（默认 /vol1）
#   MC_DISK_WARN_PCT       磁盘使用率告警阈值（默认 85）
#   MC_DUMP_MIN_BYTES      最新 PG dump 最小字节数（默认 50000000 = 50MB）
#   MC_DUMP_SHRINK_PCT     最新 dump 比上一份缩水告警阈值（默认 30%）
#
# 自检（只跑告警检查、不备份）：
#   bash ops/deploy/backup.sh --check-alerts
set -uo pipefail

DEPLOY_DIR="${MC_DEPLOY_DIR:-/vol1/1000/microclass-deploy}"
BACKUP_ROOT="${MC_BACKUP_DIR:-/vol1/1000/microclass-backup}"
PG_DIR="${MC_PG_BACKUP_DIR:-$BACKUP_ROOT/pg}"
SQLITE_KEEP="${MC_SQLITE_BACKUP_KEEP:-3}"
DISK_PATH="${MC_DISK_PATH:-/vol1}"
DISK_WARN_PCT="${MC_DISK_WARN_PCT:-85}"
DUMP_MIN_BYTES="${MC_DUMP_MIN_BYTES:-50000000}"
DUMP_SHRINK_PCT="${MC_DUMP_SHRINK_PCT:-30}"
TS="$(date +%Y%m%d-%H%M%S)"
LOG="$BACKUP_ROOT/backup.log"
rc=0

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }
mkdir -p "$BACKUP_ROOT"

# 告警检查：只写 warning，不改变备份退出码；cron 的 stdout 落到 /var/log/microclass-backup.log。
check_alerts() {
    local usage latest prev lsize psize drop
    usage=$(df -P "$DISK_PATH" 2>/dev/null | awk 'NR==2 {gsub(/%/, "", $5); print $5}')
    if [ -n "${usage:-}" ] && [ "$usage" -ge "$DISK_WARN_PCT" ]; then
        log "⚠ WARN: $DISK_PATH 使用率 ${usage}% ≥ ${DISK_WARN_PCT}%（备份与数据同盘），请清理或做外置/异机备份"
    fi
    mapfile -t DUMPS < <(ls -1t "$PG_DIR"/microclass-*.dump 2>/dev/null)
    if [ "${#DUMPS[@]}" -eq 0 ]; then
        log "⚠ WARN: $PG_DIR 下没有任何 microclass-*.dump，请检查备份是否在跑"
        return 0
    fi
    latest="${DUMPS[0]}"
    lsize=$(stat -c %s "$latest" 2>/dev/null || echo 0)
    if [ "$lsize" -lt "$DUMP_MIN_BYTES" ]; then
        log "⚠ WARN: 最新 dump 仅 $((lsize / 1024 / 1024))MB（< $((DUMP_MIN_BYTES / 1024 / 1024))MB），请人工检查：$latest"
    fi
    if [ "${#DUMPS[@]}" -ge 2 ]; then
        prev="${DUMPS[1]}"
        psize=$(stat -c %s "$prev" 2>/dev/null || echo 0)
        if [ "$psize" -gt 0 ] && [ "$lsize" -lt "$psize" ]; then
            drop=$(((psize - lsize) * 100 / psize))
            if [ "$drop" -gt "$DUMP_SHRINK_PCT" ]; then
                log "⚠ WARN: 最新 dump 比上一份缩小 ${drop}%（> ${DUMP_SHRINK_PCT}%）：$latest"
            fi
        fi
    fi
    return 0
}

if [ "${1:-}" = "--check-alerts" ]; then
    check_alerts
    exit 0
fi

log "=== 开始备份 ==="

# 1) PostgreSQL（存在才备，保留 7 份由 pg-backup.sh 负责）
if docker inspect microclass-db >/dev/null 2>&1; then
    if bash "$DEPLOY_DIR/pg-backup.sh" >> "$LOG" 2>&1; then
        log "✓ PG 备份成功"
    else
        log "✗ PG 备份失败（详见 $PG_DIR/backup.log）"
        rc=1
    fi
else
    log "（没有 microclass-db 容器，跳过 PG）"
fi

# 2) SQLite 数据卷（历史归档 + uploads 等文件）
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
    # 只保留最近 N 份（默认 3；PG 才是主备份，卷 tar 单份 2.7GB）
    ls -1t "$BACKUP_ROOT"/sqlite-volume-*.tar.gz 2>/dev/null | tail -n +$((SQLITE_KEEP + 1)) | while read -r f; do
        rm -f "$f" && log "  清理旧 SQLite 备份 $(basename "$f")"
    done
    log "当前保留 SQLite 卷备份：$(ls -1 "$BACKUP_ROOT"/sqlite-volume-*.tar.gz 2>/dev/null | wc -l) 份（上限 $SQLITE_KEEP）"
else
    log "✗ 找不到 microclass_data 卷"
    rc=1
fi

# 3) 阈值告警（磁盘 / dump 过小 / dump 缩水）
check_alerts

log "=== 结束（rc=$rc）==="
exit "$rc"
