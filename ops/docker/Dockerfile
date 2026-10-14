# 多阶段构建：构建阶段安装依赖并编译前后端，运行阶段仅保留产物与生产依赖。
#
# 使用方式（在仓库根目录执行）：
#   docker build -f ops/docker/Dockerfile --build-arg MC_VERSION=2.0.0 -t microclass:2.0.0 .
# 注意：构建阶段需要访问 npm registry；国内环境可加 --build-arg NPM_REGISTRY=https://registry.npmmirror.com

# ---------- builder ----------
FROM node:22-bookworm-slim AS builder
WORKDIR /build

ARG NPM_REGISTRY=
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi

# 依赖清单（利用缓存层）
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm install --no-audit --no-fund

# 源码
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
COPY ops/scripts ops/scripts
COPY db db

# 编译：shared → api → web（web 产物由 API 同源托管）
RUN npm run build -w @microclass/shared \
 && npm run build -w @microclass/api \
 && npm run build -w @microclass/web

# 只保留生产依赖，减小运行镜像体积
RUN npm prune --omit=dev --no-audit --no-fund

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime

# 版本号在构建时注入，/api/v1/version 直接返回
ARG MC_VERSION=2.0.0
# 是否安装 ffmpeg：用于抽取视频时长与封面（参考飞牛轻课堂的做法）。
# 镜像会增加约 80MB；不需要可 --build-arg INSTALL_FFMPEG=0 精简。
ARG INSTALL_FFMPEG=1
# 国内网络下建议指定 Debian 镜像源主机名（只替换主机，保留 debian/debian-security 路径）：
#   --build-arg APT_MIRROR_HOST=mirrors.aliyun.com
ARG APT_MIRROR_HOST=
ENV NODE_ENV=production \
    MC_ENV=production \
    MC_HOST=0.0.0.0 \
    MC_PORT=8091 \
    MC_DATA_DIR=/app/data \
    MC_MIGRATIONS_DIR=/app/db/migrations \
    MC_WEB_DIST=/app/apps/web/dist \
    MC_VERSION=${MC_VERSION} \
    TZ=Asia/Shanghai

RUN if [ "$INSTALL_FFMPEG" = "1" ]; then \
      if [ -n "$APT_MIRROR_HOST" ]; then \
        sed -i "s|deb.debian.org|$APT_MIRROR_HOST|g" /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
      fi; \
      apt-get update \
      && apt-get install -y --no-install-recommends ffmpeg \
      && rm -rf /var/lib/apt/lists/*; \
    fi

# 非 root 运行
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid app --create-home app

WORKDIR /app
# 用 COPY --chown 直接落成 app 属主：避免对 node_modules（数万个文件）做递归 chown，
# 在 NAS 的机械盘上递归改属主会额外耗费数分钟。
COPY --chown=app:app --from=builder /build/node_modules ./node_modules

# workspace 包在构建机上是符号链接，运行镜像里必须落成真实目录，
# 否则 node_modules/@microclass/shared 指向不存在的 /build/packages/shared。
RUN rm -rf node_modules/@microclass/shared && mkdir -p node_modules/@microclass/shared
COPY --chown=app:app --from=builder /build/packages/shared/package.json ./node_modules/@microclass/shared/package.json
COPY --chown=app:app --from=builder /build/packages/shared/dist ./node_modules/@microclass/shared/dist

COPY --chown=app:app --from=builder /build/apps/api/dist ./apps/api/dist
COPY --chown=app:app --from=builder /build/apps/api/package.json ./apps/api/
COPY --chown=app:app --from=builder /build/apps/web/dist ./apps/web/dist
COPY --chown=app:app --from=builder /build/db ./db
# 运维脚本（备份/恢复/题库导入）随镜像发布，容器内可直接 docker exec 运行：
#   docker exec microclass-api node /app/ops/scripts/import-bank-manifest.mjs /tmp/pack
COPY --chown=app:app --from=builder /build/ops/scripts ./ops/scripts
COPY --chown=app:app package.json ./

RUN mkdir -p /app/data && chown app:app /app/data

USER app
EXPOSE 8091

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MC_PORT||8091)+'/api/v1/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/server.js"]
