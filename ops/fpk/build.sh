#!/usr/bin/env bash
#
# 微课堂 V2 —— 构建 fnOS FPK 应用包
#
# 产物：build/fpk/microclass.fpk（用 appcenter-cli install-fpk 安装，或上传到
#       fnOS 应用中心手动安装）。脚本只依赖 node/npm/tar，可在任意机器执行；
#       真正的打包（fnpack build）需要 fnOS 上的 fnpack，见 README。
#
# 用法：
#   bash ops/fpk/build.sh              # 组装 staging 目录
#   bash ops/fpk/build.sh --with-fnpack  # 组装并在本机调用 fnpack build
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_NAME="microclass"
VERSION="$(node -p "require('${ROOT}/package.json').version")"
STAGE="${ROOT}/build/fpk"
PKG="${STAGE}/${APP_NAME}"

echo "==> 微课堂 FPK 打包 v${VERSION}"
rm -rf "${STAGE}"
mkdir -p "${PKG}/app/server"

# 预检：Node 版本与依赖（干净检出的机器上先装依赖，避免直接编译失败）
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR}" -lt 22 ]; then
  echo "✗ 需要 Node >= 22.5（当前 $(node -v)）" >&2
  exit 1
fi
if [ ! -d "${ROOT}/node_modules" ]; then
  echo "==> 安装依赖（首次构建需要；可用 NPM_REGISTRY 指定镜像）"
  ( cd "${ROOT}" && npm install --no-audit --no-fund ${NPM_REGISTRY:+--registry="${NPM_REGISTRY}"} )
fi

echo "==> 1/6 构建后端与前端"
cd "${ROOT}"
npm run build

echo "==> 2/6 复制清单、生命周期脚本与图标"
cp -r "${ROOT}/ops/fpk/cmd" "${PKG}/cmd"
cp -r "${ROOT}/ops/fpk/config" "${PKG}/config"
mkdir -p "${PKG}/app/ui"
cp -r "${ROOT}/ops/fpk/app/ui/." "${PKG}/app/ui/"
cp "${ROOT}/ops/fpk/manifest" "${PKG}/manifest"
cp "${ROOT}/ops/fpk/ICON.PNG" "${PKG}/ICON.PNG"
cp "${ROOT}/ops/fpk/ICON_256.PNG" "${PKG}/ICON_256.PNG"
chmod +x "${PKG}/cmd/"*
sed -i.bak "s/^version .*/version               = ${VERSION}/" "${PKG}/manifest" && rm -f "${PKG}/manifest.bak"

echo "==> 3/6 复制后端产物（dist + 迁移 + 前端静态资源）"
cp -r "${ROOT}/apps/api/dist" "${PKG}/app/server/dist"
cp -r "${ROOT}/packages/shared/dist" "${PKG}/app/server/shared-dist"
cp -r "${ROOT}/db/migrations" "${PKG}/app/server/migrations"
cp -r "${ROOT}/apps/web/dist" "${PKG}/app/server/web"

# 后端以 @microclass/shared 的包名引用共享代码：把编译产物放到 node_modules 下
mkdir -p "${PKG}/app/server/node_modules/@microclass/shared"
cp -r "${ROOT}/packages/shared/dist/." "${PKG}/app/server/node_modules/@microclass/shared/"
cat > "${PKG}/app/server/node_modules/@microclass/shared/package.json" <<'JSON'
{
  "name": "@microclass/shared",
  "version": "2.0.0",
  "type": "module",
  "main": "./index.js",
  "types": "./index.d.ts",
  "exports": { ".": { "types": "./index.d.ts", "default": "./index.js" } }
}
JSON
rm -rf "${PKG}/app/server/shared-dist"

echo "==> 4/6 安装生产依赖（只装 fastify 运行时依赖，不含开发工具）"
cat > "${PKG}/app/server/package.json" <<JSON
{
  "name": "${APP_NAME}-server",
  "version": "${VERSION}",
  "private": true,
  "type": "module",
  "dependencies": $(node -p "JSON.stringify(require('${ROOT}/apps/api/package.json').dependencies)")
}
JSON
# 用 workspace 的 lockfile 保证版本一致：先装到临时目录再取运行时依赖树
TMP_DEPS="${STAGE}/deps"
mkdir -p "${TMP_DEPS}"
cp "${ROOT}/package-lock.json" "${TMP_DEPS}/package-lock.json" 2>/dev/null || true
( cd "${PKG}/app/server" && npm install --omit=dev --no-audit --no-fund --ignore-scripts >/dev/null )
rm -rf "${TMP_DEPS}"

# 体积控制：剔除纯文档与测试目录
find "${PKG}/app/server/node_modules" -maxdepth 2 -type d \( -name test -o -name tests -o -name docs \) -prune -exec rm -rf {} + 2>/dev/null || true

echo "==> 5/6 生成校验信息"
( cd "${PKG}" && find app cmd config manifest -type f -exec sha256sum {} + > CHECKSUMS.sha256 )

echo "==> 6/6 汇总"
du -sh "${PKG}" || true
echo "staging 已就绪：${PKG}"

if [ "${1:-}" = "--with-fnpack" ]; then
    echo "==> 调用 fnpack build"
    ( cd "${STAGE}" && fnpack build "${APP_NAME}" )
    ls -lh "${STAGE}"/*.fpk
else
    echo
    echo "接下来在 fnOS 上打包（fnpack 只随 fnOS 提供）："
    echo "  tar -czf microclass-src.tar.gz -C ${STAGE} ${APP_NAME}"
    echo "  # 上传并解压到 fnOS 后："
    echo "  cd <解压目录> && fnpack build ${APP_NAME}"
fi
