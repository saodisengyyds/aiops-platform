# ============================================================
#  智能运维平台（集群监控版）— 应用镜像
#
#  构建（本机架构）：
#    docker build -t aiops:1.0.0 .
#  构建（指定 x86_64）：
#    docker buildx build --platform linux/amd64 -t aiops:1.0.0 --load .
#
#  说明：mysql2 是纯 JS 实现（0 个 .node 原生模块），
#       因此 node_modules 可跨架构复用，无需在目标架构上执行 npm install。
# ============================================================
FROM node:22-alpine

LABEL org.opencontainers.image.title="AIOps Platform" \
      org.opencontainers.image.description="智能运维管理平台（集群监控版）" \
      org.opencontainers.image.version="1.0.0"

# 时区（告警时间、日志时间需要）
ENV TZ=Asia/Shanghai
RUN apk add --no-cache tzdata \
    && cp /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone

WORKDIR /app

# 依赖：直接复制预装好的 node_modules（纯 JS，跨架构安全）
COPY package.json package-lock.json ./
COPY node_modules ./node_modules

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
