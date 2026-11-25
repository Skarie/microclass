#!/bin/bash
#
# 预发/压测前的机械盘 IO 门槛：`/vol1` util 超过阈值就退出（或等待）。
#
# 背景：2026-11-26 两次生产卡顿都是「同步 SQLite + /vol1 机械盘被压满」，
# 而压盘来源之一是预发实例读生产库副本 / PG 重装。预发跑之前先看盘，别把生产拖下水。
#
# 用法：
#   bash ops/scripts/pg/guard-io.sh              # util > 70% 直接退出 1
#   MC_IO_MAX=60 bash ops/scripts/pg/guard-io.sh # 自定义阈值
#   MC_IO_WAIT=1 bash ops/scripts/pg/guard-io.sh # 超阈值时等待（最多 10 分钟）
#
# 退出码：0 = 可以跑；1 = 盘忙（或没有 iostat）。
set -uo pipefail

DEV="${MC_IO_DEV:-/vol1}"
MAX="${MC_IO_MAX:-70}"
WAIT="${MC_IO_WAIT:-0}"
DEADLINE=$((SECONDS + 600))

util_now() {
    # iostat -x 采样一次；取与 $DEV 同盘的设备（/vol1 在 md0/dm-0 上）的最大 util
    iostat -x 1 1 2>/dev/null | awk -v dev="$DEV" '
        $0 ~ "^Device" { next }
        /^(md|dm|sd|nvme)/ { u = $NF; if (u + 0 > m) m = u + 0 }
        END { printf "%.0f", m + 0 }'
}

if ! command -v iostat >/dev/null 2>&1; then
    echo "⚠ 没有 iostat（sysstat），无法检查 $DEV 的 IO 压力；请人工确认后再跑预发" >&2
    exit 1
fi

while :; do
    u=$(util_now)
    printf '[%s] %s util=%s%%（阈值 %s%%）\n' "$(date '+%F %T')" "$DEV" "${u:-0}" "$MAX" >&2
    if [ "${u:-0}" -le "$MAX" ]; then
        echo "✓ 磁盘压力可接受，继续" >&2
        exit 0
    fi
    if [ "$WAIT" != "1" ] || [ "$SECONDS" -ge "$DEADLINE" ]; then
        echo "✗ $DEV 当前 util=${u}%（> ${MAX}%），为避免拖慢生产，本次预发取消" >&2
        exit 1
    fi
    sleep 20
done
