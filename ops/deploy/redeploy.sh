#!/bin/bash
# 按 .image-tag 记录的版本重建 microclass 容器，并校验实际运行的镜像标签。
#
# 用法：bash redeploy.sh [版本号]   # 不传则读 <部署目录>/.image-tag
set -eu

DEPLOY_DIR="${MC_DEPLOY_DIR:-/vol1/1000/microclass-deploy}"
COMPOSE_FILE="${MC_COMPOSE_FILE:-compose.evo4.yml}"

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

echo "== 目标版本：$VERSION"
export MC_VERSION="$VERSION"
docker compose -f "$COMPOSE_FILE" up -d --force-recreate --no-deps api 2>&1 | tail -4

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
echo "== 部署完成：microclass:$VERSION"
curl -sS -m 5 http://127.0.0.1:8091/ 2>/dev/null | grep -oE '<title>[^<]*</title>' | head -1
