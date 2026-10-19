# 智能运维平台（集群监控版）部署手册

> 版本：v1.0.0
> 更新：2026-10-19
> 仓库：https://github.com/saodisengyyds/aiops-platform
> 适用：openEuler / CentOS / RHEL / Ubuntu / Debian（systemd 或 Docker）

---

## 目录

1. [系统要求](#一系统要求)
2. [目录约定](#二目录约定)
3. [部署方式一：Docker Compose（推荐）](#三部署方式一docker-compose推荐)
4. [部署方式二：deploy.sh 一键脚本](#四部署方式二deploysh-一键脚本)
5. [部署方式三：裸机手动部署](#五部署方式三裸机手动部署)
6. [配置项详解](#六配置项详解)
7. [Nginx 反向代理](#七nginx-反向代理)
8. [集群接入（Agent）](#八集群接入agent)
9. [数据持久化与备份](#九数据持久化与备份)
10. [日常运维](#十日常运维)
11. [故障排查](#十一故障排查)
12. [安全加固](#十二安全加固)
13. [迁移与升级](#十三迁移与升级)
14. [附录](#十四附录)

---

## 一、系统要求

| 项目 | 最低 | 推荐 | 说明 |
|---|---|---|---|
| CPU | 1 核 | 2 核 | |
| 内存 | 1 GB | 2 GB | MySQL 占 256 MB buffer pool |
| 磁盘 | 2 GB | 10 GB | 镜像 + 数据 |
| 系统 | CentOS 7+ / Ubuntu 20.04+ / openEuler 20+ | — | 需 systemd |
| Node.js | 18+ | 22 LTS | 裸机部署需要 |
| Docker | 20.10+ | 24+ | 容器部署需要 |
| 数据库 | MySQL 5.7+ | MySQL 8.4 | 或使用容器内置 |

### 架构说明

镜像与 CPU 架构绑定：

```bash
uname -m
# x86_64  → 需要 amd64 镜像
# aarch64 → 需要 arm64 镜像
```

检查镜像架构：

```bash
docker image inspect aiops:1.0.0 --format '{{.Architecture}}'
```

**依赖说明**：应用只有一个 npm 依赖 `mysql2`，纯 JavaScript 实现（0 个 `.node` 原生模块），因此源码可跨架构直接复用。

---

## 二、目录约定

本平台采用固定的目录布局：

```
宿主机
├── /app                    应用目录
│   ├── docker-compose.yml  Compose 编排
│   ├── .env                环境变量（含密码，权限 600）
│   ├── Dockerfile
│   ├── server-mysql.js     后端
│   └── public/             前端静态资源
│
└── /data                   数据目录
    └── mysql/              MySQL 数据文件
        ├── aiops/          业务库
        ├── ibdata1
        ├── binlog.000001
        └── ...
```

**为什么这样分：**

- `/app` 可随时重新部署、覆盖、回滚，不影响数据
- `/data` 独立备份、迁移，直接 `tar` / `rsync` 即可
- 两者分离，升级时只动 `/app`

创建目录：

```bash
mkdir -p /app /data
```

---

## 三、部署方式一：Docker Compose（推荐）

### 3.1 前置检查

```bash
docker --version          # 需要 20.10+
docker compose version    # 需要 v2
```

### 3.2 获取代码

```bash
cd /app
git clone https://github.com/saodisengyyds/aiops-platform.git .
```

或使用离线包：

```bash
cd /app
tar -xzf aiops-deploy.tar.gz --strip-components=1
```

### 3.3 构建镜像

**在本机构建**（推荐，架构自动匹配）：

```bash
cd /app
docker build -t aiops:1.0.0 .
```

**指定架构构建**：

```bash
# x86_64
docker buildx build --platform linux/amd64 -t aiops:1.0.0 --load .

# ARM64
docker buildx build --platform linux/arm64 -t aiops:1.0.0 --load .
```

**从离线包导入**：

```bash
docker load < aiops-image-1.0.0-amd64.tar.gz
docker images | grep aiops
```

### 3.4 配置环境变量

```bash
cd /app
cp .env.example .env
chmod 600 .env
vi .env
```

**必须修改的两项：**

```bash
MYSQL_ROOT_PASSWORD=你的root密码
DB_PASS=你的应用密码
```

完整配置见 [第六章](#六配置项详解)。

### 3.5 启动

```bash
cd /app
docker compose up -d
```

启动顺序由 `depends_on: condition: service_healthy` 保证：**MySQL 健康后才启动应用**。

### 3.6 验证

```bash
# 容器状态（两个都应为 healthy）
docker compose ps

# 应用日志
docker compose logs -f app

# HTTP 探测
curl -I http://127.0.0.1:8899/
```

预期输出：

```
NAME         IMAGE          STATUS                    PORTS
aiops-app    aiops:1.0.0    Up (healthy)              0.0.0.0:8899->8899/tcp
aiops-db     mysql:8.4      Up (healthy)              127.0.0.1:3307->3306/tcp
```

应用日志应包含：

```
已播种集群监控数据（3 集群 / 11 节点 / 15 组件 / 5 规则 / 3 通知渠道）
智能运维管理平台（MySQL 版）已启动: http://0.0.0.0:8899
数据库: aiops@db:3306/aiops
```

### 3.7 访问

```
http://<服务器IP>:8899/
```

默认账号：

```
admin / 123456
```

**首次登录后立即修改密码。**

---

## 四、部署方式二：deploy.sh 一键脚本

适合已有数据库、或想自动完成全部步骤的场景。

### 4.1 方式 A：自动起 MySQL 容器

```bash
cd /app
sudo bash deploy.sh --docker-db
```

脚本自动完成：

1. 检查 Node / Docker / mysql 客户端
2. 生成随机数据库密码 → `/etc/aiops-db.env`（权限 600）
3. 拉取 `mysql:8.4` 镜像
4. 创建容器 `aiops-db`，端口 `127.0.0.1:3307`，数据目录 `/data/mysql`
5. 等待数据库健康（轮询 `mysqladmin ping`，最长 60 秒）
6. 建库、验证连接
7. 部署应用到 `/app`
8. 写入 `/etc/aiops.env` + systemd 服务
9. 启动并探测 HTTP

### 4.2 方式 B：使用已有数据库

```bash
cd /app
sudo DB_HOST=127.0.0.1 \
     DB_PORT=3306 \
     DB_NAME=aiops \
     DB_USER=aiops \
     DB_PASS='你的密码' \
     bash deploy.sh
```

若数据库和用户还没建：

```sql
mysql -uroot -p <<'SQL'
CREATE DATABASE aiops DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'aiops'@'127.0.0.1' IDENTIFIED BY '你的密码';
GRANT ALL PRIVILEGES ON aiops.* TO 'aiops'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
```

> 表结构不用手工建，首次启动自动执行 30 条 `CREATE TABLE IF NOT EXISTS` 并播种数据。

### 4.3 命令行参数

| 参数 | 说明 | 默认 |
|---|---|---|
| `--docker-db` | 自动启动 MySQL 容器 | 关闭 |
| `--no-systemd` | 不注册 systemd 服务（调试） | 关闭 |
| `--port <n>` | 应用端口 | 8899 |
| `--db-port <n>` | 数据库端口 | 3307（docker 模式） |
| `--app-dir <path>` | 应用目录 | `/app` |
| `-h, --help` | 显示帮助 | — |

### 4.4 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `DB_PASS` | 应用数据库密码 | docker 模式自动生成 |
| `DB_ROOT_PASS` | MySQL root 密码 | 自动生成 |
| `DB_CONTAINER` | 容器名 | `aiops-db` |
| `DB_IMAGE` | MySQL 镜像 | `mysql:8.4` |
| `DATA_DIR` | 数据目录 | `/data` |
| `DB_MOUNT` | 数据挂载点 | `$DATA_DIR/mysql` |
| `DB_ENV_FILE` | 数据库密码文件 | `/etc/aiops-db.env` |
| `APP_ENV_FILE` | 应用配置文件 | `/etc/aiops.env` |
| `APP_DIR` | 应用目录 | `/app` |

### 4.5 常用示例

```bash
# 换应用端口
sudo bash deploy.sh --docker-db --port 9000

# 换数据库端口
sudo bash deploy.sh --docker-db --db-port 3308

# 指定密码
sudo DB_PASS='MyAppPass' DB_ROOT_PASS='MyRootPass' bash deploy.sh --docker-db

# 只准备环境，不注册服务
sudo bash deploy.sh --docker-db --no-systemd

# 部署到自定义目录
sudo bash deploy.sh --docker-db --app-dir /opt/aiops
```

---

## 五、部署方式三：裸机手动部署

不用 Docker，直接跑 Node 进程。

### 5.1 安装依赖

```bash
# Node.js 18+（推荐 22 LTS）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs

# 或 CentOS / openEuler
sudo dnf module install -y nodejs:22
```

验证：

```bash
node -v   # v22.x
npm -v
```

### 5.2 部署代码

```bash
mkdir -p /app /data
cd /app
git clone https://github.com/saodisengyyds/aiops-platform.git .
npm install --omit=dev
```

### 5.3 准备数据库

```sql
mysql -uroot -p <<'SQL'
CREATE DATABASE aiops DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'aiops'@'127.0.0.1' IDENTIFIED BY '你的密码';
GRANT ALL PRIVILEGES ON aiops.* TO 'aiops'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
```

### 5.4 配置 systemd

```bash
sudo tee /etc/aiops.env >/dev/null <<'EOF'
PORT=8899
HOST=127.0.0.1
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=aiops
DB_USER=aiops
DB_PASS=你的密码
DB_POOL=30
EOF
sudo chmod 600 /etc/aiops.env

sudo tee /etc/systemd/system/aiops.service >/dev/null <<'EOF'
[Unit]
Description=AIOps Platform (Cluster Monitor)
After=network.target mysql.service mariadb.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/app
EnvironmentFile=/etc/aiops.env
ExecStart=/usr/bin/node /app/server-mysql.js
Restart=always
RestartSec=3
StandardOutput=append:/var/log/aiops.log
StandardError=append:/var/log/aiops.log

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now aiops
```

### 5.5 验证

```bash
systemctl status aiops
curl -I http://127.0.0.1:8899/
```

---

## 六、配置项详解

### 6.1 `.env`（Docker Compose）

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `MYSQL_ROOT_PASSWORD` | **是** | — | MySQL root 密码（仅容器内） |
| `DB_PASS` | **是** | — | 应用数据库密码（应用与 MySQL 共用） |
| `DB_NAME` | 否 | `aiops` | 数据库名 |
| `DB_USER` | 否 | `aiops` | 数据库用户 |
| `DB_POOL` | 否 | `30` | 连接池大小 |
| `APP_HOST_PORT` | 否 | `8899` | 应用对外端口 |
| `DB_HOST_PORT` | 否 | `3307` | 数据库映射端口（只绑 127.0.0.1） |
| `APP_IMAGE` | 否 | `aiops:1.0.0` | 应用镜像 |
| `PUBLIC_URL` | 否 | 空 | 平台对外地址（Agent 命令用） |
| `SESSION_TTL` | 否 | `28800000` | 会话有效期（毫秒，8 小时） |
| `DATA_DIR` | 否 | `/data` | 数据目录（MySQL 落 `$DATA_DIR/mysql`） |

### 6.2 应用环境变量（裸机 / systemd）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 8899 | 监听端口 |
| `HOST` | 127.0.0.1 | 监听地址（`0.0.0.0` 可外部直连） |
| `DB_HOST` | 127.0.0.1 | 数据库地址 |
| `DB_PORT` | 3306 | 数据库端口 |
| `DB_NAME` | aiops | 数据库名 |
| `DB_USER` | aiops | 数据库用户 |
| `DB_PASS` | 空 | 数据库密码（**必填**） |
| `DB_POOL` | 30 | 连接池大小 |
| `SESSION_TTL` | 28800000 | 会话有效期（毫秒） |
| `PUBLIC_URL` | 自动探测 | 平台对外地址 |
| `CAPTCHA_OFF` | 未设 | 设 `1` 关闭验证码（**仅调试**） |

### 6.3 MySQL 启动参数

`docker-compose.yml` 中已设置：

```yaml
command:
  - --character-set-server=utf8mb4        # 中文不乱码
  - --collation-server=utf8mb4_unicode_ci
  - --default-time-zone=+08:00            # 北京时间
  - --max-connections=200
  - --innodb-buffer-pool-size=256M
```

> 内存小于 2 GB 时，把 `innodb-buffer-pool-size` 调到 `128M`。

---

## 七、Nginx 反向代理

生产环境建议 `HOST=127.0.0.1`，通过 Nginx 对外。

```nginx
upstream aiops_backend {
    server 127.0.0.1:8899;
    keepalive 32;
}

server {
    listen 80;
    server_name aiops.example.com;

    # Gzip
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript
               text/xml application/xml image/svg+xml;

    # 静态资源缓存 7 天
    location ~* \.(css|js|jpg|jpeg|png|gif|ico|svg|woff|woff2)$ {
        proxy_pass http://aiops_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        expires 7d;
        add_header Cache-Control "public, no-transform";
    }

    # 动态请求
    location / {
        proxy_pass http://aiops_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }
}
```

启用：

```bash
sudo cp aiops.conf /etc/nginx/conf.d/
sudo nginx -t && sudo systemctl reload nginx
```

**重要**：使用反代时，在 `/etc/aiops.env` 或 `.env` 加：

```bash
PUBLIC_URL=https://aiops.example.com
```

否则生成的 Agent 安装命令会写入内部地址。

### HTTPS（Let's Encrypt）

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d aiops.example.com
```

---

## 八、集群接入（Agent）

平台是展示端，需在被监控集群部署 Agent 上报数据。

### 8.1 接入流程

1. 登录平台 → 集群监控 → 集群总览
2. 点击「接入集群」，填写：
   - 名称（如「生产集群-北京」）
   - 标识（如 `prod-bj`，唯一）
   - 环境（prod / test / dr）
   - 地域
3. 保存后点击该集群的「安装 Agent」
4. 复制弹出的命令，在**目标集群**执行

### 8.2 方式一：K8s CronJob

```bash
curl -fsSL 'https://<平台地址>/api/agent/install.sh?code=***<集群标识>&token=***<Token>' -o install.sh
bash install.sh
```

在**有 kubectl 权限**的机器执行。会创建：

| 资源 | 名称 | 说明 |
|---|---|---|
| Namespace | `aiops-agent` | |
| ServiceAccount | `aiops-agent` | |
| ConfigMap | `aiops-agent` | 采集脚本 |
| ClusterRole | `aiops-agent-reader` | 只读权限 |
| ClusterRoleBinding | `aiops-agent-reader` | |
| CronJob | `aiops-agent` | 每分钟采集 |

**依赖**：集群能拉取 `alpine/k8s:1.29.4` 镜像。

验证：

```bash
kubectl -n aiops-agent get cronjob
kubectl -n aiops-agent get jobs
kubectl -n aiops-agent logs -l job-name=aiops-agent-manual --tail=50
```

**卸载**：

```bash
kubectl delete namespace aiops-agent
kubectl delete clusterrolebinding aiops-agent-reader
kubectl delete clusterrole aiops-agent-reader
```

### 8.3 方式二：裸机 systemd（不依赖 Pod 网络）

```bash
curl -fsSL 'https://<平台地址>/api/agent/install-bare.sh?code=***<集群标识>&token=***<Token>' -o agent.sh
sudo bash agent.sh
```

**前提**：目标机器有 `kubectl`、`jq`、`curl`。

```bash
which kubectl jq curl

# 缺依赖
sudo dnf install -y jq curl      # openEuler / CentOS / RHEL
sudo apt-get install -y jq curl  # Ubuntu / Debian
```

安装到 `/opt/aiops-agent`，systemd 常驻。

验证：

```bash
systemctl status aiops-agent
journalctl -u aiops-agent -n 50 --no-pager
```

**卸载**：

```bash
sudo bash agent.sh uninstall
```

### 8.4 验证接入成功

```bash
# 平台侧数据库
mysql -uaiops -p'密码' -h127.0.0.1 -P3307 aiops \
  -e "SELECT code, status, last_seen FROM clusters;"
```

- `status` 应为 `healthy`
- `last_seen` 应有值（非 NULL）

页面上：集群总览 → 该集群卡片显示节点数、Pod 数、CPU/内存。

约 1 分钟内数据出现。

### 8.5 Agent 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| `last_seen` 一直 NULL | Agent 从未成功上报 | 检查 Agent 日志、网络 |
| `TLS handshake timeout` | kubectl 连不上 API Server | 检查 kubeconfig、6443 端口、证书 |
| `FailedCreatePodSandBox` + `calico` | Calico 证书问题 | 改用**裸机方式** |
| `ImagePullBackOff` | 拉不到 `alpine/k8s` | 换镜像源或改用裸机方式 |
| Job 一直 `0/1` | Pod 未启动 | `kubectl describe pod` 看事件 |

---

## 九、数据持久化与备份

### 9.1 数据位置

```
/data/mysql/          ← MySQL 全部数据文件
├── aiops/            业务库（表 + 数据）
├── ibdata1           共享表空间
├── binlog.000001     二进制日志
├── ca.pem            证书
└── ...
```

直接查看：

```bash
ls -la /data/mysql/
du -sh /data/mysql
```

### 9.2 逻辑备份（推荐）

```bash
# 单次备份
docker compose exec -T db mysqldump -uaiops -p"$DB_PASS" \
  --single-transaction --routines aiops \
  > /data/backup/aiops-$(date +%F).sql
```

**定时备份**（每天凌晨 3 点，保留 14 天）：

```bash
sudo mkdir -p /data/backup
sudo tee /etc/cron.d/aiops-backup >/dev/null <<'EOF'
0 3 * * * root mkdir -p /data/backup && docker compose -f /app/docker-compose.yml exec -T db mysqldump -uaiops -p"$DB_PASS" --single-transaction aiops > /data/backup/aiops-$(date +\%F).sql 2>/dev/null; find /data/backup -name 'aiops-*.sql' -mtime +14 -delete
EOF
```

> 注意：cron 里读不到 `.env` 的 `DB_PASS`，建议把密码写进 `/etc/aiops-backup.env` 并 `source`。

### 9.3 物理备份（停库拷贝）

```bash
docker compose stop db
tar -czf /data/backup/mysql-data-$(date +%F).tar.gz -C /data mysql
docker compose start db
```

### 9.4 恢复

```bash
# 逻辑备份恢复
docker compose exec -T db mysql -uaiops -p"$DB_PASS" aiops < /data/backup/aiops-2026-10-19.sql

# 物理备份恢复
docker compose down
rm -rf /data/mysql
tar -xzf /data/backup/mysql-data-2026-10-19.tar.gz -C /data
docker compose up -d
```

### 9.5 权限提示

MySQL 容器以 `mysql` 用户运行，`/data/mysql` 的属主会被改成容器内 UID（通常是 `999`）。这是正常的。

若宿主机启用了 **SELinux**，挂载需加 `:Z`：

```yaml
volumes:
  - ${DATA_DIR:-/data}/mysql:/var/lib/mysql:Z
```

---

## 十、日常运维

### 10.1 Docker Compose

```bash
cd /app

docker compose ps                    # 状态
docker compose logs -f app           # 应用日志
docker compose logs -f db            # 数据库日志
docker compose restart app           # 重启应用
docker compose down                  # 停止（保留数据）
docker compose up -d                 # 启动
docker compose up -d --force-recreate app   # 重建应用
```

### 10.2 数据库操作

```bash
# 进入 MySQL CLI
docker compose exec db mysql -uaiops -p aiops

# 常用查询
docker compose exec -T db mysql -uaiops -p"$DB_PASS" aiops -e "SHOW TABLES;"
docker compose exec -T db mysql -uaiops -p"$DB_PASS" aiops -e "SELECT code,name,status,last_seen FROM clusters;"
docker compose exec -T db mysql -uaiops -p"$DB_PASS" aiops -e "SELECT COUNT(*) FROM cluster_nodes;"
```

### 10.3 systemd（deploy.sh / 裸机部署）

```bash
systemctl status aiops
systemctl restart aiops
systemctl stop aiops
journalctl -u aiops -f
tail -f /var/log/aiops.log
```

### 10.4 修改配置

**Docker Compose：**

```bash
cd /app
vi .env                  # 改配置
docker compose up -d     # 重新生效
```

**systemd：**

```bash
sudo vi /etc/aiops.env
sudo systemctl restart aiops
```

### 10.5 资源监控

```bash
# 容器资源
docker stats aiops-app aiops-db --no-stream

# 磁盘
df -h /data
du -sh /data/mysql

# 数据库连接数
docker compose exec -T db mysql -uaiops -p"$DB_PASS" \
  -e "SHOW STATUS LIKE 'Threads_connected';"
```

---

## 十一、故障排查

### 11.1 应用起不来

```bash
# 1) 容器状态
docker compose ps

# 2) 应用日志
docker compose logs --tail=50 app

# 3) 手动前台运行（看完整报错）
cd /app
set -a; . .env; set +a
docker run --rm -it --network aiops-platform_aiops-net \
  -e DB_HOST=db -e DB_PASS="$DB_PASS" aiops:1.0.0
```

**常见错误：**

| 错误 | 原因 | 解决 |
|---|---|---|
| `Node 版本过低` | Node < 18 | 升级 Node |
| `ECONNREFUSED` | 数据库没起 / 端口错 | `docker compose ps` 检查 db |
| `Access denied for user` | 密码不匹配 | 检查 `DB_PASS` 与 `MYSQL_PASSWORD` 是否一致 |
| `EADDRINUSE` | 端口被占用 | `ss -tlnp \| grep 8899`，改 `APP_HOST_PORT` |
| `exec format error` | 镜像架构不匹配 | 用 `--platform` 重新构建 |

### 11.2 页面能开但登录失败

```bash
# 检查用户表
docker compose exec -T db mysql -uaiops -p"$DB_PASS" aiops \
  -e "SELECT username, name, role FROM sys_users;"
```

若为空，说明首次启动时播种失败。检查应用日志是否有建表错误。

### 11.3 集群显示 unknown / 无数据

```bash
# 1) 查 last_seen
docker compose exec -T db mysql -uaiops -p"$DB_PASS" aiops \
  -e "SELECT code, status, last_seen FROM clusters;"

# 2) last_seen 为 NULL → Agent 从未上报

# 3) 平台侧是否收到过请求
docker compose logs app | grep "agent/report"
# 或 nginx 日志
grep 'api/agent/report' /var/log/nginx/access.log | tail

# 4) 目标集群检查 Agent
kubectl -n aiops-agent logs -l job-name=aiops-agent-manual --tail=50
systemctl status aiops-agent
journalctl -u aiops-agent -n 50
```

### 11.4 数据库起不来

```bash
docker compose logs --tail=50 db

# 数据卷损坏（会丢数据，慎用）
docker compose down
sudo rm -rf /data/mysql
docker compose up -d
```

### 11.5 端口冲突

```bash
ss -tlnp | grep -E '8899|3307'
```

换端口：

```bash
# .env
APP_HOST_PORT=9000
DB_HOST_PORT=3308

docker compose up -d
```

### 11.6 内存不足

MySQL 默认 buffer pool 256 MB。内存 < 2 GB 时调整：

```yaml
command:
  - --innodb-buffer-pool-size=128M
```

### 11.7 中文乱码

检查：

```bash
docker compose exec -T db mysql -uaiops -p"$DB_PASS" \
  -e "SHOW VARIABLES LIKE 'character_set%';"
```

应为 `utf8mb4`。若不对，确认 compose 里 `--character-set-server=utf8mb4` 已生效。

---

## 十二、安全加固

### 12.1 必做清单

- [ ] **修改默认密码** `admin/123456`
- [ ] 数据库密码使用强密码（≥16 位，含大小写数字符号）
- [ ] `.env` 权限 `600`：`chmod 600 /app/.env`
- [ ] 应用 `HOST=127.0.0.1`，只通过 Nginx 对外
- [ ] 数据库端口只绑 `127.0.0.1`（compose 已默认）
- [ ] 启用 HTTPS
- [ ] 配置每日备份
- [ ] 防火墙只放行 80/443

### 12.2 防火墙

```bash
# firewalld（CentOS / openEuler）
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload

# ufw（Ubuntu）
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 12.3 密码生成

```bash
openssl rand -base64 24 | tr -d '/+='
```

### 12.4 生产环境禁止

- 不要设 `CAPTCHA_OFF=1`
- 不要把 `DB_HOST_PORT` 绑到 `0.0.0.0`
- 不要把 `.env` 提交到 Git（`.gitignore` 已排除）

---

## 十三、迁移与升级

### 13.1 整机迁移

**源机器：**

```bash
# 1) 逻辑备份
docker compose exec -T db mysqldump -uaiops -p"$DB_PASS" \
  --single-transaction --routines aiops > /tmp/aiops-data.sql

# 2) 打包应用与配置
tar -czf /tmp/aiops-app.tar.gz -C /app .
```

**目标机器：**

```bash
mkdir -p /app /data
cd /app

# 1) 解压应用
tar -xzf aiops-app.tar.gz

# 2) 构建镜像
docker build -t aiops:1.0.0 .

# 3) 启动（先建表）
docker compose up -d

# 4) 导入数据
docker compose exec -T db mysql -uaiops -p"$DB_PASS" aiops < /tmp/aiops-data.sql

# 5) 重启应用
docker compose restart app
```

### 13.2 物理迁移（大数据量）

```bash
# 源机器
docker compose stop
tar -czf /tmp/aiops-full.tar.gz -C / app data

# 目标机器
tar -xzf /tmp/aiops-full.tar.gz -C /
cd /app && docker compose up -d
```

### 13.3 升级

```bash
cd /app

# 1) 备份
docker compose exec -T db mysqldump -uaiops -p"$DB_PASS" --single-transaction aiops \
  > /data/backup/pre-upgrade-$(date +%F).sql
tar -czf /data/backup/app-$(date +%F).tar.gz -C /app .

# 2) 拉新代码
git pull

# 3) 重新构建
docker build -t aiops:1.0.0 .

# 4) 重启
docker compose up -d --force-recreate app

# 5) 验证
docker compose ps
curl -I http://127.0.0.1:8899/
```

表结构变更幂等（`CREATE TABLE IF NOT EXISTS` + 增量 `ALTER`），启动时自动完成。

---

## 十四、附录

### 14.1 数据表（30 张）

**核心表：**

| 表 | 说明 |
|---|---|
| `sys_users` | 用户 |
| `sys_groups` | 组织分组 |
| `roles` | 角色 |
| `departments` | 部门 |
| `sys_sessions` | 会话 |
| `clusters` | 集群 |
| `cluster_nodes` | 集群节点 |
| `cluster_pods` | Pod |
| `cluster_components` | 组件 |
| `node_metrics` | 节点指标时序 |
| `alerts` | 告警 |
| `alert_rules` | 告警规则 |
| `notify_channels` | 通知渠道 |
| `notify_logs` | 通知记录 |
| `audit_logs` | 操作日志 |

### 14.2 默认播种数据

首次启动自动创建：

- 管理员账号 `admin / 123456`
- 3 个示例集群（生产-北京 / 测试-上海 / 灾备-广州）
- 11 个节点 / 15 个组件 / 5 条告警规则 / 3 个通知渠道

### 14.3 功能范围

当前版本**仅保留集群监控**：

| 页面 | 功能 |
|---|---|
| 集群总览 | KPI 大卡 + 集群健康卡片 |
| 节点监控 | 节点状态、CPU/内存/磁盘 |
| 告警中心 | 活动告警列表 |
| 告警规则 | 阈值规则配置 |
| 通知渠道 | 企微 / 钉钉 / 邮件 / Webhook |

其余模块（工单、资产、知识库、用户管理等）已移除。

### 14.4 常用命令速查

```bash
# ---------- Docker ----------
cd /app && docker compose up -d              # 启动
cd /app && docker compose down               # 停止
cd /app && docker compose ps                 # 状态
cd /app && docker compose logs -f app        # 日志
docker stats aiops-app aiops-db --no-stream  # 资源

# ---------- 数据库 ----------
docker compose exec db mysql -uaiops -p aiops

# ---------- 数据目录 ----------
ls -la /data/mysql
du -sh /data/mysql
df -h /data

# ---------- 备份 ----------
docker compose exec -T db mysqldump -uaiops -p"$DB_PASS" \
  --single-transaction aiops > /data/backup/aiops-$(date +%F).sql

# ---------- systemd ----------
systemctl status aiops
journalctl -u aiops -f

# ---------- 健康检查 ----------
curl -I http://127.0.0.1:8899/
```

### 14.5 技术支持信息收集

出问题时提供：

```bash
uname -a && node -v && docker --version
docker compose ps
docker compose logs --tail=100 app
docker compose logs --tail=50 db
sed 's/=.*/=***/' /app/.env
ss -tlnp | grep -E '8899|3307'
df -h /data
du -sh /data/mysql
```

---

**手册结束**

> 仓库：https://github.com/saodisengyyds/aiops-platform
> 问题反馈：GitHub Issues
