#!/bin/bash
#
# 微课堂生产看门狗：健康检查连续失败就重启容器（兜底「进程活着但整站无响应」）。
#
# 背景：2026-11-26 00:06 生产整站无响应（宿主机 curl 8s 超时、容器 unhealthy），
# 但进程没退出、容器没崩 —— docker 自带 healthcheck 只会标记 unhealthy，不会重启。
#
# 设计：**连续 2 次**失败才重启，避免磁盘抖动造成的单次超时误杀；
#       重启后再验一次，仍失败就只记日志、不继续重启（防止重启风暴）。
#
# 安装（root）：
#   install -m 755 ops/deploy/watchdog.sh /vol1/1000/microclass-deploy/watchdog.sh
#   ( crontab -l 2>/dev/null; \
#     echo '*/2 * * * * /vol1/1000/microclass-deploy/watchdog.sh >> /var/log/microclass-watchdog.log 2>&1' \
#   ) | crontab -
#
# 维护锁：切库 / 迁移 / 手工停服等维护窗口里，健康检查必然失败，
# 看门狗若照常重启就会把维护动作打断（甚至把刚停的容器又拉起来）。
#   touch /vol1/1000/microclass-deploy/.maintenance     # 进入维护
#   rm    /vol1/1000/microclass-deploy/.maintenance     # 结束维护
# 维护期间脚本**只记一行日志并退出**：不动容器，并清空失败计数（结束后重新累积）。
#
# 可调环境变量（写进 crontab 行即可）：
#   MC_WATCHDOG_URL        健康检查地址，默认 http://127.0.0.1:8091/api/v1/healthz
#   MC_WATCHDOG_CONTAINER  容器名，默认 microclass-api
#   MC_WATCHDOG_TIMEOUT    curl 超时秒数，默认 5
#   MC_MAINTENANCE=1       等价于维护锁文件存在（临时手工跑时用）
#   MC_MAINTENANCE_FILE    维护锁路径，默认 <部署目录>/.maintenance
set -u

URL="${MC_WATCHDOG_URL:-http://127.0.0.1:8091/api/v1/healthz}"
CONTAINER="${MC_WATCHDOG_CONTAINER:-microclass-api}"
TIMEOUT="${MC_WATCHDOG_TIMEOUT:-5}"
STATE="${MC_WATCHDOG_STATE:-/tmp/microclass-watchdog.state}"
LOCK=/tmp/microclass-watchdog.lock
MAINT="${MC_MAINTENANCE_FILE:-/vol1/1000/microclass-deploy/.maintenance}"

log() { echo "[$(date '+%F %T')] $*"; }

# 维护中？（环境变量开关优先，其次锁文件）
maintenance() {
    [ "${MC_MAINTENANCE:-0}" = "1" ] && return 0
    [ -f "${MAINT}" ] && return 0
    return 1
}

# 同一时刻只允许一个实例（cron 2 分钟一次，重启期间可能重叠）
exec 9>"${LOCK}" || exit 0
if command -v flock >/dev/null 2>&1; then
    flock -n 9 || { log "上一轮仍在运行，跳过"; exit 0; }
fi

# 维护锁：健康检查在维护窗口内必然失败，直接退出（不计数、不重启）
if maintenance; then
    log "维护中（${MAINT} 存在或 MC_MAINTENANCE=1），跳过重启"
    rm -f "${STATE}"
    exit 0
fi

check() { curl -fsS -m "${TIMEOUT}" -o /dev/null "${URL}"; }

if check; then
    [ -f "${STATE}" ] && log "健康检查恢复，清除失败计数"
    rm -f "${STATE}"
    exit 0
fi

# 记录连续失败次数（第一次失败只记数，不动容器）
fails=0
[ -f "${STATE}" ] && fails="$(cat "${STATE}" 2>/dev/null || echo 0)"
case "${fails}" in ''|*[!0-9]*) fails=0 ;; esac
fails=$((fails + 1))
printf '%s' "${fails}" > "${STATE}"
log "健康检查失败（连续 ${fails} 次，超时 ${TIMEOUT}s）：${URL}"

if [ "${fails}" -lt 2 ]; then
    exit 0
fi

# 重启前再确认一次：维护窗口可能在「连续失败」与「真要重启」之间刚开始
if maintenance; then
    log "维护中（${MAINT} 存在或 MC_MAINTENANCE=1），跳过重启"
    rm -f "${STATE}"
    exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
    log "✗ 找不到 docker，无法重启 ${CONTAINER}"
    exit 1
fi
if ! docker inspect "${CONTAINER}" >/dev/null 2>&1; then
    log "✗ 容器 ${CONTAINER} 不存在，跳过（不新建容器）"
    exit 1
fi

log "→ 重启容器 ${CONTAINER}"
docker restart "${CONTAINER}" >/dev/null 2>&1
rm -f "${STATE}"

sleep 20
if check; then
    log "✓ 重启后健康检查通过"
    exit 0
fi
log "✗ 重启后仍不健康，已记录日志并停止自动重启（请人工介入：docker logs --tail 200 ${CONTAINER}）"
exit 1
