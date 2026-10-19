# ============================================================
#  智能运维平台（集群监控版）— 应用镜像
#
#  构建（本机架构）：
#    docker build -t aiops:1.0.0 .
#  使用镜像源加速：
#    docker build --build-arg NODE_IMAGE=hub.qusiqi.eu.org/library/node:22-alpine -t aiops:1.0.0 .
#  构建指定架构（需 QEMU 支持）：
#    docker buildx build --platform linux/amd64 -t aiops:1.0.0 --load .
# ============================================================

ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE}

LABEL org.opencontainers.image.title="AIOps Platform" \
      org.opencontainers.image.description="智能运维管理平台（集群监控版）" \
      org.opencontainers.image.version="1.0.0"

# 时区（告警时间、日志时间需要）
ENV TZ=Asia/Shanghai
RUN apk add --no-cache tzdata \
    && cp /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone

WORKDIR /app

# 依赖：mysql2 为纯 JS，在目标架构上正常安装
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# 应用代码
COPY server-mysql.js ./
COPY lib ./lib
COPY agent ./agent
COPY public ./public

# 非 root 运行
RUN addgroup -S aiops && adduser -S -G aiops aiops \
    && chown -R aiops:aiops /app
USER aiops

# 运行时默认值（可被 -e / --env-file 覆盖）
ENV NODE_ENV=production \
    PORT=8899 \
    HOST=0.0.0.0 \
    DB_HOST=db \
    DB_PORT=3306 \
    DB_NAME=aiops \
    DB_USER=aiops \
    DB_POOL=30

EXPOSE 8899

# 健康检查：容器内自探活
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8899)+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server-mysql.js"]
