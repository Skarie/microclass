#!/usr/bin/env bash
#
# 微课堂 V2 —— 构建 fnOS 学生端应用包（.fpk）
#
# 形态：**学生端网关**。包里只有
#   - 学生版前端构建产物（VITE_APP_EDITION=student，隐藏教学/管理界面）
#   - ops/fpk/server/proxy.mjs（零依赖：托管静态资源 + 把 /api/* 反代到 Docker 生产）
# 因此应用不持有数据库：账号、学习记录、题库只有 Docker 生产那一份，天然共用。
#
# 产物：build/fpk/microclass.fpk（用 appcenter-cli install-fpk 安装）。
# 真正的打包（fnpack build）只在 fnOS 上有，见 README。
#
# 用法：
#   bash ops/fpk/build.sh                 # 组装 staging 目录
#   bash ops/fpk/build.sh --with-fnpack   # 组装并在本机调用 fnpack build
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_NAME="microclass"
# 用相对路径读取版本：Git Bash/MSYS 下 ${ROOT} 是 /d/... 形式，Windows 版 node
# 无法解析，先 cd 再用 ./package.json 才能同时兼容 Linux 与 Windows。
VERSION="$(cd "${ROOT}" && node -p "require('./package.json').version")"
STAGE="${ROOT}/build/fpk"
PKG="${STAGE}/${APP_NAME}"

echo "==> 微课堂 fnOS 学生端打包 v${VERSION}"
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

echo "==> 1/5 构建学生版前端（VITE_APP_EDITION=student）"
cd "${ROOT}"
VITE_APP_EDITION=student npm run build

echo "==> 2/5 复制清单、生命周期脚本与图标"
cp -r "${ROOT}/ops/fpk/cmd" "${PKG}/cmd"
cp -r "${ROOT}/ops/fpk/config" "${PKG}/config"
mkdir -p "${PKG}/app/ui"
cp -r "${ROOT}/ops/fpk/app/ui/." "${PKG}/app/ui/"
cp "${ROOT}/ops/fpk/manifest" "${PKG}/manifest"
cp "${ROOT}/ops/fpk/ICON.PNG" "${PKG}/ICON.PNG"
cp "${ROOT}/ops/fpk/ICON_256.PNG" "${PKG}/ICON_256.PNG"
chmod +x "${PKG}/cmd/"*
sed -i.bak "s/^version .*/version               = ${VERSION}/" "${PKG}/manifest" && rm -f "${PKG}/manifest.bak"

echo "==> 3/5 复制前端产物与网关"
cp -r "${ROOT}/apps/web/dist" "${PKG}/app/server/web"
cp "${ROOT}/ops/fpk/server/proxy.mjs" "${PKG}/app/server/proxy.mjs"
if [ ! -f "${PKG}/app/server/web/index.html" ]; then
  echo "✗ 前端产物缺少 index.html" >&2
  exit 1
fi
# 学生端不应把管理端代码之外的产物带进来：确认没有 API dist / 依赖目录
[ -d "${PKG}/app/server/node_modules" ] && echo "⚠ 意外带入 node_modules" >&2

echo "==> 4/5 生成校验信息"
( cd "${PKG}" && find app cmd config manifest -type f -exec sha256sum {} + > CHECKSUMS.sha256 )

echo "==> 5/5 汇总"
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
    echo "  # 上传并解压到 fnOS 后：cd <解压目录> && fnpack build -d ${APP_NAME}"
fi
