#!/bin/bash
#
# 在 compose 网络内起一次性容器跑 PG 集成测试（解决宿主机 SSH 隧道被 direct-tcpip 拒绝的问题）。
#
# 原理：容器与 microclass-db 同网络，直接连 `db:5432`，不需要任何端口映射或隧道。
#
# 用法（在 NAS 上，root）：
#   # 1) 准备源码（用已构建镜像的同一份源码包）
#   rm -rf /vol1/1000/mc-pg-test && mkdir -p /vol1/1000/mc-pg-test
#   tar xzf /tmp/docker-src.tar.gz -C /vol1/1000/mc-pg-test --strip-components=1
#   # 2) 建测试库（幂等）
#   docker exec microclass-db psql -U microclass -d postgres -c 'CREATE DATABASE microclass_test' || true
#   # 3) 跑
#   MC_PG_TEST_URL="postgres://microclass:<密码>@db:5432/microclass_test" \
#     bash ops/scripts/pg/run-pg-tests.sh
#
# 说明：首次跑会 `npm ci`（约 20–60s，取决于网络）；之后可复用同一源码目录。
set -euo pipefail

NETWORK="${MC_PG_NETWORK:-microclass-prod_default}"
SRC="${MC_PG_TEST_SRC:-/vol1/1000/mc-pg-test}"
DSN="${MC_PG_TEST_URL:?需要设置 MC_PG_TEST_URL（容器内可直连 db:5432）}"
PATTERN="${MC_PG_TEST_PATTERN:-apps/api/test/pg-*.test.ts}"

[ -f "$SRC/package.json" ] || {
    echo "✗ 源码目录不完整：$SRC（先按脚本头部注释解压源码包）" >&2
    exit 1
}

docker network inspect "$NETWORK" >/dev/null 2>&1 || {
    echo "✗ 网络 $NETWORK 不存在（先 docker compose up -d 起过 api）" >&2
    exit 1
}

echo "=== 在容器内跑 PG 集成测试（网络 $NETWORK）==="
# 源码只读挂载到 /src，容器内拷到可写层再装依赖：
# 直接在宿主机卷上 npm ci 会因 esbuild 等 postinstall 需要执行权限而 EACCES。
docker run --rm \
    --network "$NETWORK" \
    -v "$SRC":/src:ro \
    -e "MC_PG_TEST_URL=$DSN" \
    -e CI=true \
    node:22-alpine \
    sh -c "mkdir -p /app && cp -a /src/. /app/ && cd /app && npm ci --no-audit --no-fund >/dev/null && npx vitest run $PATTERN"
