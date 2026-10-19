#!/usr/bin/env bash
# ============================================================
#  智能运维平台（集群监控版）一键部署脚本
#  适用：openEuler / CentOS / RHEL / Ubuntu / Debian (systemd)
#
#  用法：
#    sudo bash deploy.sh                  # 用已有的 MySQL
#    sudo bash deploy.sh --docker-db      # 自动起 MySQL 容器 + 部署应用
#    sudo bash deploy.sh --help
# ============================================================
set -euo pipefail

APP_DIR=${APP_DIR:-/app}
SVC=aiops
PORT=${PORT:-8899}
HOST=${HOST:-127.0.0.1}

DB_HOST=${DB_HOST:-127.0.0.1}
DB_PORT=${DB_PORT:-3306}
DB_NAME=${DB_NAME:-aiops}
DB_USER=${DB_USER:-aiops}
DB_PASS=${DB_PASS:-}

# --- Docker DB 模式默认值 ---
DOCKER_DB=0
NO_SYSTEMD=0
DB_CONTAINER=${DB_CONTAINER:-aiops-db}
DB_IMAGE=${DB_IMAGE:-mysql:8.4}
DATA_DIR=${DATA_DIR:-/data}
DB_MOUNT=${DB_MOUNT:-$DATA_DIR/mysql}
DB_DOCKER_PORT=${DB_DOCKER_PORT:-3307}
DB_ROOT_PASS=${DB_ROOT_PASS:-}
DB_ENV_FILE=${DB_ENV_FILE:-/etc/aiops-db.env}
APP_ENV_FILE=${APP_ENV_FILE:-/etc/aiops.env}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'USAGE'
用法: sudo bash deploy.sh [选项]

选项:
  --docker-db          自动启动 MySQL 容器并让应用连它
  --no-systemd         不创建 systemd 服务（调试用，前台提示启动命令）
  --port <n>           应用端口（默认 8899）
  --db-port <n>        数据库端口（docker 模式默认 3307）
  --app-dir <path>     应用目录（默认 /app）
  -h, --help           显示帮助

环境变量:
  DB_PASS              应用数据库密码（docker 模式不填则自动生成）
  DB_ROOT_PASS         docker 模式 root 密码（不填则自动生成）
  DB_CONTAINER         容器名（默认 aiops-db）
  DB_IMAGE             镜像（默认 mysql:8.4）
  DATA_DIR             数据目录（默认 /data，数据库落在 $DATA_DIR/mysql）

示例:
  sudo bash deploy.sh --docker-db
  sudo DB_PASS='mypass' bash deploy.sh --docker-db --port 9000
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --docker-db)   DOCKER_DB=1; shift ;;
    --no-systemd)  NO_SYSTEMD=1; shift ;;
    --port)        PORT="$2"; shift 2 ;;
    --db-port)     DB_DOCKER_PORT="$2"; DB_PORT="$2"; shift 2 ;;
    --app-dir)     APP_DIR="$2"; shift 2 ;;
    -h|--help)     usage; exit 0 ;;
    *) echo "未知参数: $1（用 --help 查看用法）"; exit 1 ;;
  esac
done

gen_pass() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 18 | tr -d '/+=' | cut -c1-20
  else
    tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 20
  fi
}

echo "==> [1/6] 检查环境"
command -v node >/dev/null 2>&1 || { echo "缺少 node，请先安装 Node.js 18+"; exit 1; }
NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
[ "$NODE_MAJOR" -ge 18 ] || { echo "Node 版本过低（当前 $(node -v)），需要 18+"; exit 1; }
echo "    Node $(node -v) ✓"

if [ "$DOCKER_DB" = "1" ]; then
  command -v docker >/dev/null 2>&1 || { echo "缺少 docker，无法使用 --docker-db"; exit 1; }
  docker info >/dev/null 2>&1 || { echo "docker 未运行或无权限"; exit 1; }
  echo "    Docker $(docker --version | awk '{print $3}' | tr -d ',') ✓"
fi

command -v mysql >/dev/null 2>&1 && echo "    mysql 客户端 ✓" || echo "    未找到 mysql 客户端（建库需手工）"

# ---------- Docker 数据库 ----------
if [ "$DOCKER_DB" = "1" ]; then
  echo "==> [2/6] 准备 Docker 数据库"

  # 生成密码（若未提供）
  if [ -z "$DB_PASS" ]; then
    DB_PASS="$(gen_pass)"
    echo "    已自动生成应用数据库密码（见 $DB_ENV_FILE）"
  fi
  if [ -z "$DB_ROOT_PASS" ]; then
    DB_ROOT_PASS="$(gen_pass)"
  fi

  # 写 env 文件（0600，避免密码进 shell history / ps）
  umask 077
  cat > "$DB_ENV_FILE" <<EOF
MARIADB_ROOT_PASSWORD=$DB_ROOT_PASS
MARIADB_DATABASE=$DB_NAME
MARIADB_USER=$DB_USER
MARIADB_PASSWORD=$DB_PASS
EOF
  chmod 600 "$DB_ENV_FILE"

  if docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
    echo "    容器 $DB_CONTAINER 已存在，直接复用"
    if [ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER")" != "true" ]; then
      docker start "$DB_CONTAINER" >/dev/null
      echo "    已启动现有容器"
    else
      echo "    容器运行中"
    fi
    # 复用容器时，确保应用用户密码与本次一致
    if [ -n "${DB_PASS:-}" ]; then
      docker exec "$DB_CONTAINER" mariadb -uroot -p"$DB_ROOT_PASS" <<SQL >/dev/null 2>&1 || true
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'%' IDENTIFIED BY '$DB_PASS';
ALTER USER '$DB_USER'@'%' IDENTIFIED BY '$DB_PASS';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'%';
FLUSH PRIVILEGES;
SQL
    fi
  else
    echo "    拉取镜像 $DB_IMAGE（如已存在会跳过）"
    docker pull "$DB_IMAGE" >/dev/null 2>&1 || true

    mkdir -p "$DB_MOUNT"
    echo "    创建容器 $DB_CONTAINER（端口 127.0.0.1:$DB_DOCKER_PORT，数据 $DB_MOUNT）"
    docker run -d --name "$DB_CONTAINER" \
      --env-file "$DB_ENV_FILE" \
      -p "127.0.0.1:$DB_DOCKER_PORT:3306" \
      -v "$DB_MOUNT:/var/lib/mysql" \
      --restart unless-stopped \
      "$DB_IMAGE" >/dev/null
  fi

  echo "    等待数据库就绪…"
  READY=0
  for i in $(seq 1 60); do
    if docker exec "$DB_CONTAINER" mysqladmin ping -h 127.0.0.1 -uroot -p"$DB_ROOT_PASS" --silent >/dev/null 2>&1; then
      READY=1; break
    fi
    if docker exec "$DB_CONTAINER" mariadb -u"$DB_USER" -p"$DB_PASS" -e "SELECT 1" >/dev/null 2>&1; then
      READY=1; break
    fi
    sleep 1
  done
  if [ "$READY" != "1" ]; then
    echo "    数据库未能就绪，查看日志：docker logs $DB_CONTAINER"
    exit 1
  fi
  echo "    数据库就绪 ✓（${i} 秒）"

  DB_HOST=127.0.0.1
  DB_PORT="$DB_DOCKER_PORT"
else
  echo "==> [2/6] 使用现有数据库"
  if [ -z "$DB_PASS" ]; then
    read -rsp "请输入数据库密码（用户 $DB_USER）: " DB_PASS
    echo
  fi
fi

# ---------- 连接验证 + 建库 ----------
echo "==> [3/6] 验证数据库连接"
if command -v mysql >/dev/null 2>&1; then
  if mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASS" -e "SELECT 1" >/dev/null 2>&1; then
    echo "    连接成功 ✓"
    mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASS" \
      -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" \
      && echo "    数据库 $DB_NAME 就绪 ✓（表会在首次启动时自动创建）"
  else
    if [ "$DOCKER_DB" = "1" ]; then
      echo "    宿主机连接失败，改用容器内验证"
      docker exec "$DB_CONTAINER" mariadb -u"$DB_USER" -p"$DB_PASS" \
        -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" \
        && echo "    数据库 $DB_NAME 就绪 ✓"
    else
      echo "    连接失败，请检查 DB_HOST/DB_PORT/DB_USER/DB_PASS"
      exit 1
    fi
  fi
else
  echo "    跳过（无 mysql 客户端）"
  if [ "$DOCKER_DB" = "1" ]; then
    docker exec "$DB_CONTAINER" mariadb -u"$DB_USER" -p"$DB_PASS" \
      -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" >/dev/null 2>&1 || true
  fi
fi

# ---------- 部署文件 ----------
echo "==> [4/6] 部署文件到 $APP_DIR"
mkdir -p "$APP_DIR"
if [ "$SCRIPT_DIR" != "$APP_DIR" ]; then
  cp -r "$SCRIPT_DIR"/{server-mysql.js,package.json,lib,agent,public,node_modules} "$APP_DIR"/ 2>/dev/null || true
fi
if [ ! -d "$APP_DIR/node_modules/mysql2" ]; then
  echo "    node_modules 缺失，尝试 npm install"
  (cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund)
fi
echo "    文件就绪 ✓"

# ---------- 环境变量 ----------
echo "==> [5/6] 写入环境变量与服务定义"
umask 077
cat > "$APP_ENV_FILE" <<EOF
PORT=$PORT
HOST=$HOST
DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASS=$DB_PASS
EOF
chmod 600 "$APP_ENV_FILE"

if [ "$NO_SYSTEMD" = "1" ]; then
  echo "    已跳过 systemd（--no-systemd）"
  echo ""
  echo "手动启动："
  echo "  set -a; . $APP_ENV_FILE; set +a; node $APP_DIR/server-mysql.js"
  cat <<EOF

============================================================
 部署完成（未注册服务）

 启动命令：
   set -a; . $APP_ENV_FILE; set +a; node $APP_DIR/server-mysql.js
 访问：http://<服务器IP>:$PORT/
 账号：admin / 123456
============================================================
EOF
  exit 0
fi

cat > /etc/systemd/system/$SVC.service <<EOF
[Unit]
Description=AIOps Platform (Cluster Monitor)
After=network.target mysql.service mariadb.service docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_ENV_FILE
ExecStart=$(command -v node) $APP_DIR/server-mysql.js
Restart=always
RestartSec=3
StandardOutput=append:/var/log/aiops.log
StandardError=append:/var/log/aiops.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable $SVC >/dev/null 2>&1
systemctl restart $SVC
sleep 3

# ---------- 验证 ----------
echo "==> [6/6] 验证"
if systemctl is-active --quiet $SVC; then
  echo "    服务运行中 ✓"
  if command -v curl >/dev/null 2>&1; then
    code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://$HOST:$PORT/" || echo "000")
    echo "    HTTP 探测: $code"
  fi
else
  echo "    服务启动失败，查看日志："
  journalctl -u $SVC -n 30 --no-pager
  exit 1
fi

cat <<EOF

============================================================
 部署完成

 访问地址：http://<服务器IP>:$PORT/
 默认账号：admin / 123456  （首次启动自动创建，请立即修改）

 数据库：$DB_USER@$DB_HOST:$DB_PORT/$DB_NAME
$( [ "$DOCKER_DB" = "1" ] && echo " 容器：  $DB_CONTAINER（数据目录 $DB_MOUNT）" )
$( [ "$DOCKER_DB" = "1" ] && echo " 密码：  见 $DB_ENV_FILE" )

 常用命令：
   systemctl status $SVC
   systemctl restart $SVC
   journalctl -u $SVC -f
   tail -f /var/log/aiops.log
$( [ "$DOCKER_DB" = "1" ] && echo "   docker logs -f $DB_CONTAINER" )

 配置文件：$APP_ENV_FILE
 程序目录：$APP_DIR
============================================================
EOF
