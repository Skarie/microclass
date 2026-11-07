#!/bin/bash
# 在 NAS（EVO4）上从源码包构建镜像，并把版本号写进部署目录供 redeploy.sh 使用。
#
# 用法：bash build-image.sh [源码包] [版本号]
#   默认：/tmp/docker-src.tar.gz  和 package.json 里的版本号
#
# 产物：microclass:<版本号>，同时写入 <部署目录>/.image-tag
set -eu

SRC_TAR="${1:-/tmp/docker-src.tar.gz}"
DEPLOY_DIR="${MC_DEPLOY_DIR:-/vol1/1000/microclass-deploy}"
REPO_SRC="${1:-}"

if [ ! -f "$SRC_TAR" ]; then
  echo "找不到源码包：$SRC_TAR" >&2
  exit 2
fi

BASE=/vol1/1000/microclass-build
SRC="$BASE/src"
mkdir -p "$BASE"
if [ -d "$SRC" ]; then
  rm -rf "$BASE/src.prev"
  mv "$SRC" "$BASE/src.prev"
fi
mkdir -p "$SRC"
tar -xzf "$SRC_TAR" -C "$SRC"

# 版本号：命令行优先，其次源码包里的 package.json，最后回退 0.0.0
VERSION="${2:-$(node -p "require('$SRC/package.json').version" 2>/dev/null || echo 0.0.0)}"

echo "=== 构建 microclass:$VERSION（日志：$BASE/build-$VERSION.log）"
cd "$SRC"
docker build -f ops/docker/Dockerfile \
  --build-arg "MC_VERSION=$VERSION" \
  --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
  --build-arg APT_MIRROR_HOST=mirrors.aliyun.com \
  -t "microclass:$VERSION" . 2>&1 | tee "$BASE/build-$VERSION.log" | tail -5

mkdir -p "$DEPLOY_DIR"
printf '%s' "$VERSION" > "$DEPLOY_DIR/.image-tag"
echo "=== 构建完成，部署版本标记：$DEPLOY_DIR/.image-tag → $VERSION"
docker images microclass --format '{{.Repository}}:{{.Tag}}  {{.Size}}  {{.CreatedSince}}'
