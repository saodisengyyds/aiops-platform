# 智能运维管理平台（集群监控版）

基于 Node.js + MySQL 的轻量级 AIOps 平台，专注 Kubernetes 集群监控。

前端 Vue 3 + Element Plus，后端零框架依赖（仅 `mysql2`），可单机部署或 Docker 一键启动。

---

## 功能范围

本版本**仅保留集群监控**：

- **集群总览** — KPI 大屏 + 集群健康卡片（节点/Pod/告警/CPU/内存）
- **节点监控** — 节点状态、角色、CPU/内存/磁盘使用率
- **告警中心** — 活动告警列表，按集群/等级筛选
- **告警规则** — 阈值规则配置（CPU/内存/磁盘/节点状态）
- **通知渠道** — 企业微信 / 钉钉 / 邮件 / Webhook

> 工单、资产、知识库、用户管理等模块已移除。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js 18+，原生 `http` 模块，`mysql2` 连接池 |
| 前端 | Vue 3 + Element Plus（CDN 本地化，无构建步骤） |
| 数据库 | MySQL 5.7+ / 8.x / MariaDB 10.3+ |
| 部署 | systemd 裸机 / Docker / Docker Compose |

**特点：**
- 单文件后端（`server-mysql.js`），无框架、无 ORM
- 前端无打包工具，直接静态托管
- 表结构自动创建（30 张），首次启动自动播种演示数据
- 仅一个 npm 依赖，纯 JS 无原生模块，可跨架构复制

---

## 快速开始

### 方式一：Docker Compose（推荐）

```bash
git clone https://github.com/saodisengyyds/aiops-platform.git
cd aiops-platform

cp .env.example .env
vi .env                     # 必改 MYSQL_ROOT_PASSWORD 和 DB_PASS

docker compose up -d
docker compose ps
```

访问 `http://<服务器IP>:8899/`

### 方式二：裸机部署

```bash
# 依赖
# Node.js 18+、MySQL 5.7+

git clone https://github.com/saodisengyyds/aiops-platform.git
cd aiops-platform
npm install --omit=dev

# 建库
mysql -uroot -p <<'SQL'
CREATE DATABASE aiops DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'aiops'@'127.0.0.1' IDENTIFIED BY '你的密码';
GRANT ALL PRIVILEGES ON aiops.* TO 'aiops'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

# 启动
DB_HOST=127.0.0.1 DB_PORT=3306 DB_NAME=aiops \
DB_USER=aiops DB_PASS='你的密码' \
node server-mysql.js
```

### 方式三：构建镜像

```bash
docker build -t aiops:1.0.0 .
docker run -d --name aiops-app \
  -e DB_HOST=<数据库地址> \
  -e DB_NAME=aiops \
  -e DB_USER=aiops \
  -e DB_PASS='密码' \
  -p 8899:8899 \
  aiops:1.0.0
```

---

## 默认账号

```
admin / 123456
```

**首次登录后请立即修改。**

---

## 集群接入

平台是展示端，需要在被监控集群部署 Agent 上报数据。

### K8s CronJob 方式

```bash
curl -fsSL 'https://<平台地址>/api/agent/install.sh?code=<集群标识>&token=<Token>' -o install.sh
bash install.sh
```

在平台「集群总览 → 接入集群」创建后，点「安装 Agent」可获取完整命令。

### 裸机 systemd 方式（不依赖 Pod 网络）

```bash
curl -fsSL 'https://<平台地址>/api/agent/install-bare.sh?code=<集群标识>&token=<Token>' -o agent.sh
sudo bash agent.sh
```

依赖：`kubectl`、`jq`、`curl`。

> 若集群 Calico 异常或拉不到镜像，用这个方式。

---

## 配置项

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 8899 | 应用端口 |
| `HOST` | 127.0.0.1 | 监听地址（Docker 内为 0.0.0.0） |
| `DB_HOST` | 127.0.0.1 | 数据库地址 |
| `DB_PORT` | 3306 | 数据库端口 |
| `DB_NAME` | aiops | 数据库名 |
| `DB_USER` | aiops | 数据库用户 |
| `DB_PASS` | 无 | 数据库密码（**必填**） |
| `DB_POOL` | 30 | 连接池大小 |
| `SESSION_TTL` | 28800000 | 会话有效期（毫秒） |
| `PUBLIC_URL` | 自动探测 | 平台对外地址（Agent 命令用） |
| `CAPTCHA_OFF` | 未设 | 设 `1` 关闭验证码（仅调试） |

---

## 项目结构

```
.
├── server-mysql.js        后端（单文件，240KB）
├── public/                前端静态资源
│   ├── index.html
│   ├── app-vue.js         Vue 3 应用
│   ├── vue-style.css
│   └── vendor/            Vue / Element Plus / 图标
├── lib/xlsx.js            Excel 导入导出（零依赖）
├── agent/aiops-agent.sh   采集脚本模板
├── Dockerfile
├── docker-compose.yml
├── deploy.sh              一键部署脚本
├── .env.example
└── DEPLOY.md              完整部署手册
```

---

## 数据库

首次启动自动创建 30 张表，核心表：

- `sys_users` / `sys_groups` / `roles` / `departments` — 用户与权限
- `clusters` / `cluster_nodes` / `cluster_pods` / `cluster_components` — 集群监控
- `alerts` / `alert_rules` / `notify_channels` / `notify_logs` — 告警
- `node_metrics` — 节点指标时序
- `audit_logs` — 操作日志

自动播种：管理员账号、3 个示例集群、11 个节点、5 条告警规则、3 个通知渠道。

---

## 部署手册

完整的部署、运维、故障排查文档见 [DEPLOY.md](DEPLOY.md)，包含：

- 系统要求与依赖说明
- Docker / 裸机两种部署方式
- Nginx 反向代理配置
- Agent 接入与验证
- 日常运维命令
- 故障排查（含 Calico、镜像拉取等实际问题）
- 安全加固清单
- 迁移与备份恢复

---

## 安全建议

- [ ] 立即修改默认密码 `admin/123456`
- [ ] 数据库密码使用强密码（≥16 位）
- [ ] `.env` 权限设为 `600`
- [ ] 应用 `HOST=127.0.0.1`，通过 nginx 对外
- [ ] 数据库端口只绑 `127.0.0.1`
- [ ] 启用 HTTPS
- [ ] 配置数据库每日备份

---

## License

MIT
