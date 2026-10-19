# 智能运维平台（集群监控版）部署手册

> 版本：2026-10-19
> 适用：openEuler / CentOS / RHEL / Ubuntu / Debian（systemd）
> 部署包：`aiops-deploy.tar.gz`（1.9 MB，451 个文件）

---

## 一、系统要求

| 项目 | 最低要求 | 说明 |
|---|---|---|
| 操作系统 | CentOS 7+ / openEuler 20+ / Ubuntu 20.04+ / Debian 11+ | 需要 systemd |
| Node.js | **18 或更高** | 实测 v24.21.0 |
| 数据库 | MySQL 5.7+ / MariaDB 10.3+ | 或使用 Docker 模式 |
| 内存 | 1 GB | 推荐 2 GB |
| 磁盘 | 500 MB | 含依赖 |
| 端口 | 8899（应用）、3306/3307（数据库） | 可自定义 |

### 依赖说明

本项目**只有一个 npm 依赖 `mysql2`**，纯 JavaScript 实现，**无原生二进制模块**，因此部署包可直接跨 x86_64 / ARM64 复制，无需 `npm install`。

---

## 二、部署包结构

```
aiops/
├── server-mysql.js        后端服务（240 KB）
├── public/                前端静态资源（2.4 MB）
│   ├── index.html
│   ├── app-vue.js
│   ├── vue-style.css
│   ├── vendor/            Vue 3 / Element Plus / 图标
│   └── login-*.svg|jpg    登录页素材
├── lib/
│   └── xlsx.js            Excel 导入导出（零依赖）
├── agent/
│   └── aiops-agent.sh     集群采集脚本模板
├── node_modules/          依赖（仅 mysql2，5.2 MB）
├── package.json
├── package-lock.json
└── deploy.sh              一键部署脚本（10 KB）
```

---

## 三、快速部署（推荐）

### 3.1 方式 A：Docker 数据库（最省事）

适合：新机器、没有现成数据库、想快速验证。

```bash
# 1) 上传部署包
scp aiops-deploy.tar.gz root@<目标IP>:/opt/

# 2) 解压
cd /opt
tar -xzf aiops-deploy.tar.gz
cd aiops

# 3) 一条命令完成全部部署
sudo bash deploy.sh --docker-db
```

脚本自动完成：

1. 检查 Node / Docker / mysql 客户端
2. 生成随机数据库密码，写入 `/etc/aiops-db.env`（权限 600）
3. 拉取 `mariadb:11.4` 镜像（已存在则跳过）
4. 创建容器 `aiops-db`，绑定 `127.0.0.1:3307`，数据卷 `aiops-db-data`
5. 轮询等待数据库就绪（最长 60 秒）
6. 建库、验证连接
7. 部署应用到 `/opt/aiops`
8. 写入 `/etc/aiops.env` 与 systemd 服务
9. 启动服务并探测 HTTP

**完成后访问：** `http://<服务器IP>:8899/`
**默认账号：** `admin` / `123456`（务必立即修改）

### 3.2 方式 B：使用已有数据库

```bash
cd /opt/aiops
sudo DB_HOST=127.0.0.1 \
     DB_PORT=3306 \
     DB_NAME=aiops \
     DB_USER=aiops \
     DB_PASS='你的密码' \
     bash deploy.sh
```

**如果数据库和用户还没建：**

```sql
mysql -uroot -p <<'SQL'
CREATE DATABASE aiops DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'aiops'@'127.0.0.1' IDENTIFIED BY '你的密码';
GRANT ALL PRIVILEGES ON aiops.* TO 'aiops'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
```

> 表结构不用手工建。程序首次启动会自动执行 30 条 `CREATE TABLE IF NOT EXISTS`，并播种默认数据。

---


---

## 三之二、Docker 镜像部署（推荐用于生产）

应用与数据库都提供官方镜像，一条 `docker compose up -d` 即可完成整套部署。

### 3.2.1 镜像说明

| 镜像 | 大小 | 说明 |
|---|---|---|
| `aiops:1.0.0` | 262 MB | 应用镜像（Node 22 Alpine + 全部代码与依赖） |
| `mysql:8.4` | 1.11 GB | 数据库（官方镜像，自动拉取） |

**应用镜像特点：**
- 基于 `node:22-alpine`，体积小
- 非 root 用户运行（`aiops:aiops`）
- 内置健康检查（`HEALTHCHECK`）
- 时区已设为 `Asia/Shanghai`
- 依赖已内置，**无需联网 npm install**

### 3.2.2 快速启动

```bash
# 1) 准备目录
mkdir -p /opt/aiops && cd /opt/aiops

# 2) 复制编排文件（来自部署包）
cp /path/to/aiops/{Dockerfile,docker-compose.yml,.env.example} .

# 3) 生成配置并改密码
cp .env.example .env
vi .env          # 必改：MYSQL_ROOT_PASSWORD、DB_PASS

# 4) 启动
docker compose up -d

# 5) 查看状态
docker compose ps
```

启动顺序由 `depends_on: condition: service_healthy` 保证：**数据库健康后才启动应用**。

### 3.2.3 从离线镜像包导入（内网环境）

```bash
# 在联网机器上导出（已为你生成）
docker save aiops:1.0.0 | gzip > aiops-image-1.0.0.tar.gz

# 内网机器导入
docker load < aiops-image-1.0.0.tar.gz
docker images | grep aiops
```

数据库镜像同理：

```bash
# 联网机器
docker save mysql:8.4 | gzip > mysql-8.4.tar.gz

# 内网机器
docker load < mysql-8.4.tar.gz
```

### 3.2.4 或者直接构建

```bash
cd /opt/aiops
docker build -t aiops:1.0.0 .
```

构建约 30 秒，产物 262 MB。

### 3.2.5 .env 配置项

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `MYSQL_ROOT_PASSWORD` | **是** | — | MySQL root 密码 |
| `DB_PASS` | **是** | — | 应用数据库密码 |
| `DB_NAME` | 否 | `aiops` | 数据库名 |
| `DB_USER` | 否 | `aiops` | 数据库用户 |
| `DB_POOL` | 否 | `30` | 连接池大小 |
| `APP_HOST_PORT` | 否 | `8899` | 应用对外端口 |
| `DB_HOST_PORT` | 否 | `3307` | 数据库映射到宿主机端口（只绑 127.0.0.1） |
| `APP_IMAGE` | 否 | `aiops:1.0.0` | 镜像名 |
| `PUBLIC_URL` | 否 | 空 | 平台对外地址（Agent 安装命令用） |
| `SESSION_TTL` | 否 | `28800000` | 会话有效期（毫秒，8 小时） |

### 3.2.6 常用命令

```bash
# 启动 / 停止 / 重启
docker compose up -d
docker compose down
docker compose restart

# 查看状态与日志
docker compose ps
docker compose logs -f app
docker compose logs -f db

# 进入数据库
docker compose exec db mysql -uaiops -p aiops

# 重建应用（改了镜像后）
docker compose up -d --force-recreate app

# 完全清理（含数据卷，会丢数据！）
docker compose down -v
```

### 3.2.7 数据持久化

数据保存在 Docker named volume `aiops-db-data`，`docker compose down` **不会**删除数据。

```bash
# 查看卷
docker volume ls | grep aiops

# 备份（推荐）
docker compose exec -T db mysqldump -uaiops -p"$DB_PASS" --single-transaction aiops > aiops-$(date +%F).sql

# 恢复
docker compose exec -T db mysql -uaiops -p"$DB_PASS" aiops < aiops-2026-10-19.sql
```

### 3.2.8 反向代理

容器内应用监听 `0.0.0.0:8899`，映射到宿主机 `${APP_HOST_PORT}`。生产环境建议：

```yaml
# docker-compose.yml 中改为只绑本机
ports:
  - "127.0.0.1:${APP_HOST_PORT:-8899}:8899"
```

再通过 nginx 对外（配置见第六章）。

### 3.2.9 镜像部署 vs 裸机部署

| 对比项 | Docker 镜像 | 裸机 deploy.sh |
|---|---|---|
| 环境依赖 | 只需 Docker | 需 Node 18+ |
| 部署速度 | 快（一条命令） | 中 |
| 隔离性 | 强 | 弱 |
| 升级 | 换镜像重启 | 覆盖文件重启 |
| 体积 | 262 MB + 1.11 GB | 8 MB |
| 适用 | 生产、多实例 | 单机、资源受限 |


## 四、deploy.sh 参数详解

### 4.1 命令行选项

| 选项 | 说明 | 默认 |
|---|---|---|
| `--docker-db` | 自动启动 MariaDB 容器并让应用连它 | 关闭 |
| `--no-systemd` | 不注册 systemd 服务（调试用） | 关闭 |
| `--port <n>` | 应用监听端口 | 8899 |
| `--db-port <n>` | 数据库端口 | 3306（docker 模式 3307） |
| `--app-dir <path>` | 安装目录 | `/opt/aiops` |
| `-h, --help` | 显示帮助 | — |

### 4.2 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `DB_PASS` | 应用数据库密码 | docker 模式自动生成 |
| `DB_ROOT_PASS` | docker 模式 root 密码 | 自动生成 |
| `DB_CONTAINER` | 容器名 | `aiops-db` |
| `DB_IMAGE` | MariaDB 镜像 | `mariadb:11.4` |
| `DB_VOLUME` | 数据卷名 | `aiops-db-data` |
| `DB_ENV_FILE` | 数据库密码文件 | `/etc/aiops-db.env` |
| `APP_ENV_FILE` | 应用配置文件 | `/etc/aiops.env` |
| `APP_DIR` | 安装目录 | `/opt/aiops` |

### 4.3 常用示例

```bash
# 换应用端口
sudo bash deploy.sh --docker-db --port 9000

# 换数据库端口（本机 3307 被占用时）
sudo bash deploy.sh --docker-db --db-port 3308

# 指定自定义密码
sudo DB_PASS='MyAppPass123' DB_ROOT_PASS='MyRootPass123' bash deploy.sh --docker-db

# 只准备环境，不注册服务（调试）
sudo bash deploy.sh --docker-db --no-systemd

# 部署到自定义目录
sudo bash deploy.sh --docker-db --app-dir /data/aiops
```

---

## 五、应用运行时配置

配置文件：`/etc/aiops.env`（权限 600）

```bash
PORT=8899                    # 应用端口
HOST=127.0.0.1               # 监听地址（0.0.0.0 可外部直连，建议配合 nginx）
DB_HOST=127.0.0.1
DB_PORT=3307
DB_NAME=aiops
DB_USER=aiops
DB_PASS=***
```

### 5.1 可追加的配置项

| 变量 | 默认 | 说明 |
|---|---|---|
| `DB_POOL` | 30 | 数据库连接池大小 |
| `SESSION_TTL` | 28800000（8 小时） | 登录会话有效期（毫秒） |
| `PUBLIC_URL` | 自动探测 | Agent 安装脚本里写入的平台地址；反向代理场景**建议显式设置** |
| `CAPTCHA_OFF` | 未设 | 设为 `1` 关闭图形验证码（仅调试） |

修改后重启生效：

```bash
sudo systemctl restart aiops
```

---

## 六、Nginx 反向代理（生产推荐）

`HOST=127.0.0.1` 时应用只监听本机，需通过 nginx 对外提供服务。

```nginx
upstream aiops_backend {
    server 127.0.0.1:8899;
    keepalive 32;
}

server {
    listen 80;
    server_name aiops.example.com;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;

    # 静态资源缓存 7 天
    location ~* \.(css|js|jpg|jpeg|png|gif|ico|svg|woff|woff2)$ {
        proxy_pass http://aiops_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        expires 7d;
        add_header Cache-Control "public, no-transform";
    }

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

> 使用反向代理时，建议在 `/etc/aiops.env` 加一行：
> `PUBLIC_URL=https://aiops.example.com`
> 否则生成的 Agent 安装命令里会写入内部地址。

---

## 七、集群接入（Agent 部署）

平台本身只是展示端，需要被监控集群上的 Agent 上报数据。

### 7.1 接入流程

1. 登录平台 → 集群监控 → 集群总览
2. 点击「接入集群」，填写名称 / 标识 / 环境 / 地域
3. 保存后点击该集群的「安装 Agent」
4. 复制弹出的命令，在**目标集群**执行

### 7.2 方式一：K8s CronJob（推荐）

```bash
curl -fsSL 'https://<平台地址>/api/agent/install.sh?code=<集群标识>&token=<Token>' -o install.sh
bash install.sh
```

在**有 kubectl 权限**的机器上执行。会创建：

- Namespace `aiops-agent`
- ServiceAccount / ConfigMap / ClusterRole / ClusterRoleBinding
- CronJob（每分钟采集一次）

**依赖**：集群能拉取 `alpine/k8s:1.29.4` 镜像。

> 若集群网络受限（Calico 异常、拉不到镜像），改用方式二。

### 7.3 方式二：裸机 systemd（不依赖 Pod 网络）

```bash
curl -fsSL 'https://<平台地址>/api/agent/install-bare.sh?code=<集群标识>&token=<Token>' -o agent.sh
sudo bash agent.sh
```

**前提**：目标机器有 `kubectl`、`jq`、`curl`。

```bash
# 检查依赖
which kubectl jq curl

# 缺依赖时
sudo dnf install -y jq curl        # openEuler / CentOS / RHEL
sudo apt-get install -y jq curl    # Ubuntu / Debian
```

安装到 `/opt/aiops-agent`，以 systemd 服务常驻。

**卸载**：
```bash
sudo bash agent.sh uninstall
```

### 7.4 验证接入成功

```bash
# 平台侧：集群状态应为 healthy，last_seen 有值
# 页面：集群总览 → 对应集群卡片显示节点数、Pod 数、CPU/内存
```

约 1 分钟内数据出现。

---

## 八、日常运维

### 8.1 服务管理

```bash
sudo systemctl status aiops          # 状态
sudo systemctl restart aiops         # 重启
sudo systemctl stop aiops            # 停止
sudo systemctl enable aiops          # 开机自启
journalctl -u aiops -f               # 实时日志
tail -f /var/log/aiops.log           # 应用日志
```

### 8.2 数据库管理（Docker 模式）

```bash
docker ps --filter name=aiops-db              # 容器状态
docker logs -f aiops-db                       # 数据库日志
docker exec -it aiops-db mariadb -uaiops -p'密码' aiops   # 进入 CLI
docker restart aiops-db                       # 重启数据库
```

### 8.3 数据备份

```bash
# 备份（建议加到 crontab 每日执行）
docker exec aiops-db mariadb-dump -uaiops -p'密码' \
  --single-transaction --routines aiops \
  > /backup/aiops-$(date +%F).sql

# 恢复
docker exec -i aiops-db mariadb -uaiops -p'密码' aiops < /backup/aiops-2026-10-19.sql
```

**定时备份示例**（每天凌晨 3 点）：

```bash
sudo tee /etc/cron.d/aiops-backup >/dev/null <<'EOF'
0 3 * * * root mkdir -p /backup && docker exec aiops-db mariadb-dump -uaiops -p'密码' --single-transaction aiops > /backup/aiops-$(date +\%F).sql && find /backup -name 'aiops-*.sql' -mtime +14 -delete
EOF
```

### 8.4 升级

```bash
# 1) 备份数据库
docker exec aiops-db mariadb-dump -uaiops -p'密码' --single-transaction aiops > /backup/pre-upgrade.sql

# 2) 备份程序目录
tar -czf /backup/aiops-app-$(date +%F).tar.gz /opt/aiops

# 3) 解压新包覆盖（保留配置）
cd /opt && tar -xzf aiops-deploy.tar.gz
sudo cp -r aiops/{server-mysql.js,public,lib,agent} /opt/aiops/

# 4) 重启
sudo systemctl restart aiops
```

> 表结构变更是幂等的（`CREATE TABLE IF NOT EXISTS` + 增量 `ALTER`），启动时自动完成。

---

## 九、故障排查

### 9.1 服务起不来

```bash
# 1) 看服务状态
systemctl status aiops -l

# 2) 看应用日志
tail -50 /var/log/aiops.log

# 3) 手动前台启动（能看到完整报错）
set -a; . /etc/aiops.env; set +a
node /opt/aiops/server-mysql.js
```

**常见原因：**

- `Node 版本过低` → 升级到 18+
- `ECONNREFUSED 数据库` → 数据库没起 / 端口错 / 防火墙
- `Access denied for user` → 密码不对或用户 host 不匹配（`'aiops'@'%'` vs `'aiops'@'127.0.0.1'`）
- `EADDRINUSE` → 端口被占用，`ss -tlnp | grep 8899`

### 9.2 页面能开但登录失败

```bash
# 检查用户表是否有 admin
mysql -uaiops -p'密码' -h127.0.0.1 -P3307 aiops -e "SELECT username, name, role FROM sys_users;"
```

若为空，说明播种没执行（首次启动失败过）。删库重建或手工插入。

### 9.3 集群显示 unknown / 无数据

```bash
# 1) 查 last_seen
mysql -uaiops -p'密码' -h127.0.0.1 -P3307 aiops \
  -e "SELECT code, status, last_seen FROM clusters;"

# 2) last_seen 为 NULL → Agent 从未成功上报

# 3) 平台侧确认是否收到过请求
#    nginx 日志里搜 /api/agent/report
grep 'api/agent/report' /var/log/nginx/access.log | tail

# 4) 目标集群检查 Agent
kubectl -n aiops-agent get jobs                    # K8s 方式
kubectl -n aiops-agent logs -l job-name=aiops-agent-manual --tail=50
systemctl status aiops-agent                       # 裸机方式
journalctl -u aiops-agent -n 50 --no-pager
```

**已知问题：**

- **Calico 证书错误**（`x509: certificate signed by unknown authority`）→ Pod 沙箱创建失败，改用**裸机方式**
- **镜像拉不到**（`ImagePullBackOff`）→ 换国内镜像源或改用裸机方式

### 9.4 数据库容器起不来

```bash
docker logs aiops-db --tail=50

# 数据卷损坏（会丢数据，慎用）
docker rm -f aiops-db
docker volume rm aiops-db-data
sudo bash /opt/aiops/deploy.sh --docker-db
```

### 9.5 端口冲突

```bash
ss -tlnp | grep -E '8899|3306|3307'
```

换端口：

```bash
sudo bash deploy.sh --docker-db --port 9000 --db-port 3308
```

---

## 十、安全加固清单

- [ ] **立即修改默认密码** `admin/123456`
- [ ] 数据库密码使用强密码（≥16 位，含大小写数字符号）
- [ ] `/etc/aiops.env` 与 `/etc/aiops-db.env` 权限保持 `600`
- [ ] 应用 `HOST=127.0.0.1`，只通过 nginx 对外
- [ ] 数据库端口只绑 `127.0.0.1`，不对外暴露
- [ ] 启用 HTTPS（Let's Encrypt 或企业证书）
- [ ] 配置数据库每日备份 + 保留 14 天
- [ ] 防火墙只放行 80/443
- [ ] 定期 `apt upgrade` / `dnf update` 更新系统
- [ ] 生产环境不要设 `CAPTCHA_OFF=1`

---

## 十一、迁移与备份恢复

### 11.1 完整迁移到新机器

**源机器：**

```bash
# 1) 导出数据库
docker exec aiops-db mariadb-dump -uaiops -p'密码' --single-transaction --routines aiops > aiops-data.sql

# 2) 打包程序
tar -czf aiops-full.tar.gz /opt/aiops /etc/aiops.env
```

**目标机器：**

```bash
# 1) 解压
cd /opt && tar -xzf aiops-deploy.tar.gz && cd aiops

# 2) 部署（不启动，先导数据）
sudo bash deploy.sh --docker-db --no-systemd

# 3) 导入数据
docker exec -i aiops-db mariadb -uaiops -p'密码' aiops < aiops-data.sql

# 4) 启动应用
set -a; . /etc/aiops.env; set +a
node /opt/aiops/server-mysql.js
```

或直接用 `deploy.sh` 正常部署后再导入数据（表已建好，导入时加 `--force` 忽略已存在）。

### 11.2 仅迁移数据

```bash
# 导出
mysqldump -uaiops -p'密码' --single-transaction aiops > aiops.sql

# 导入（目标库先启动一次让表建好）
mysql -uaiops -p'密码' aiops < aiops.sql
```

---

## 十二、附录

### 12.1 自动创建的数据表（30 张）

核心表：

- `sys_users` / `sys_groups` / `roles` / `departments` — 用户与权限
- `clusters` / `cluster_nodes` / `cluster_pods` / `cluster_components` — 集群监控
- `alerts` / `alert_rules` / `notify_channels` / `notify_logs` — 告警
- `node_metrics` — 节点指标时序
- `audit_logs` — 操作日志
- `sys_sessions` — 会话

### 12.2 默认播种数据

首次启动自动创建：

- 管理员账号 `admin / 123456`
- 3 个示例集群 / 11 个节点 / 15 个组件
- 5 条告警规则 / 3 个通知渠道

### 12.3 功能范围

当前版本**仅保留集群监控**：

- 集群总览（KPI + 集群卡片）
- 节点监控
- 告警中心
- 告警规则
- 通知渠道

其余模块（工单、资产、知识库、用户管理等）已移除。

### 12.4 技术支持信息收集

出问题时提供以下信息：

```bash
# 系统信息
uname -a && node -v && docker --version

# 服务状态
systemctl status aiops --no-pager
tail -100 /var/log/aiops.log

# 配置（脱敏）
sed 's/=.*/=***/' /etc/aiops.env

# 数据库
docker ps --filter name=aiops-db
docker logs aiops-db --tail=50

# 端口
ss -tlnp | grep -E '8899|3306|3307'
```

---

**手册结束**
