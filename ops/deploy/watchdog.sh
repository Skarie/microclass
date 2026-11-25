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
# 可调环境变量（写进 crontab 行即可）：
#   MC_WATCHDOG_URL        健康检查地址，默认 http://127.0.0.1:8091/api/v1/healthz
#   MC_WATCHDOG_CONTAINER  容器名，默认 microclass-api
#   MC_WATCHDOG_TIMEOUT    curl 超时秒数，默认 5
set -u

URL="${MC_WATCHDOG_URL:-http://127.0.0.1:8091/api/v1/healthz}"
CONTAINER="${MC_WATCHDOG_CONTAINER:-microclass-api}"
TIMEOUT="${MC_WATCHDOG_TIMEOUT:-5}"
STATE="${MC_WATCHDOG_STATE:-/tmp/microclass-watchdog.state}"
LOCK=/tmp/microclass-watchdog.lock

log() { echo "[$(date '+%F %T')] $*"; }

# 同一时刻只允许一个实例（cron 2 分钟一次，重启期间可能重叠）
exec 9>"${LOCK}" || exit 0
if command -v flock >/dev/null 2>&1; then
    flock -n 9 || { log "上一轮仍在运行，跳过"; exit 0; }
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
