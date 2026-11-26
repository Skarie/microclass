#!/bin/bash
# 按 .image-tag 记录的版本重建 microclass 容器，并校验实际运行的镜像标签。
#
# 用法：bash redeploy.sh [版本号]   # 不传则读 <部署目录>/.image-tag
#
# 加固（2026-11-27，生产事故「network … not found」）：
#   1. compose 调用**统一带 -p microclass-prod**。宿主机上还留着历史项目 `microclass`，
#      一旦容器名被它占住（同名 microclass-api），不带 -p 时 compose 会踩到那张旧网络；
#   2. 启动失败且日志出现 `network … not found` / `container name … already in use` 时，
#      自动 `down --remove-orphans`（**绝不带 -v**，数据卷必须保留）后重试一次；
#   3. 重试仍失败会把 compose 日志尾部打出来，便于直接定位。
set -eu

DEPLOY_DIR="${MC_DEPLOY_DIR:-/vol1/1000/microclass-deploy}"
COMPOSE_FILE="${MC_COMPOSE_FILE:-compose.evo4.yml}"
PROJECT="${MC_COMPOSE_PROJECT:-microclass-prod}"
COMPOSE=(docker compose -p "$PROJECT" -f "$COMPOSE_FILE")

cd "$DEPLOY_DIR"
if [ "${1:-}" != "" ]; then
  VERSION="$1"
elif [ -f .image-tag ]; then
  VERSION="$(cat .image-tag)"
else
  VERSION="$(docker images microclass --format '{{.Tag}}' | sort -V | tail -1)"
fi
[ -n "$VERSION" ] || { echo "无法确定要部署的版本" >&2; exit 2; }

docker image inspect "microclass:$VERSION" >/dev/null 2>&1 || {
  echo "镜像 microclass:$VERSION 不存在，请先构建" >&2
  exit 2
}

echo "== 目标版本：$VERSION（项目 $PROJECT）"
export MC_VERSION="$VERSION"

# 起容器：失败时判断是不是「网络/容器名」这类可自愈的编排问题
up_api() {
  "${COMPOSE[@]}" up -d --force-recreate --no-deps api 2>&1 | tee /tmp/microclass-up.log | tail -4
  return "${PIPESTATUS[0]}"
}

if ! up_api; then
  if grep -qE 'network .* not found|container name .* is already in use|already exists' /tmp/microclass-up.log; then
    echo "== 检测到编排层故障（network 丢失 / 容器名冲突），重建项目容器（保留数据卷）"
    "${COMPOSE[@]}" down --remove-orphans 2>&1 | tail -3
    up_api
  else
    echo "== 启动失败（非网络问题），见 /tmp/microclass-up.log" >&2
    tail -20 /tmp/microclass-up.log >&2
    exit 1
  fi
fi

for i in $(seq 1 40); do
  code=$(curl -sS -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:8091/api/v1/readyz 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then echo "  readyz=200（第 ${i} 秒）"; break; fi
  sleep 1
done

ACTUAL="$(docker inspect microclass-api --format '{{.Config.Image}}')"
echo "== 运行镜像：$ACTUAL"
if [ "$ACTUAL" != "microclass:$VERSION" ]; then
  echo "镜像标签不一致：期望 microclass:$VERSION，实际 $ACTUAL" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 部署预热：把「冷页代价」留在部署窗口里，让用户第一次访问就是热的。
#
# 为什么需要：SQLite 在机械盘上冷页很贵 —— 实测 2.4.1 部署后首次
# `/api/v1/banks/catalog` 要 54.6 s（mmap 256MB 下走普通 read，逐页缺页），
# 期间事件循环被占住，用户会以为站点挂了。这里在宣布成功前先把几个重接口
# 各打一遍（顺序执行，避免并发把盘打满），把页缓存焐热。
#
# 失败只告警不阻断：预热是优化，不是部署正确性的前提。
# ---------------------------------------------------------------------------
warm() {
  local path="$1"
  local t
  t=$(curl -sS -o /dev/null -w '%{time_total}' -m 180 "http://127.0.0.1:8091${path}" 2>/dev/null || echo "fail")
  if [ "$t" = "fail" ]; then
    echo "  ⚠ 预热失败（忽略）：${path}"
  else
    printf '  预热 %-34s %s s\n' "$path" "$t"
  fi
}

echo "== 部署预热（冷页代价在部署窗口内消化）"
warm /api/v1/banks/catalog
warm "/api/v1/banks/catalog-sections?view=book"
warm /api/v1/courses
warm /api/v1/settings
warm /api/v1/announcements

# 预热后再跑一次快速探针，确认热态下的响应时间
probe() {
  local path="$1"
  curl -sS -o /dev/null -w "%{http_code}/%{time_total}s" -m 10 "http://127.0.0.1:8091${path}" 2>/dev/null || echo "000/fail"
}
echo "  热态探针：healthz=$(probe /api/v1/healthz) courses=$(probe /api/v1/courses)"

echo "== 部署完成：microclass:$VERSION"
curl -sS -m 5 http://127.0.0.1:8091/ 2>/dev/null | grep -oE '<title>[^<]*</title>' | head -1
