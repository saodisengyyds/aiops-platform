#!/bin/bash
# ============================================================
#  AIOps Agent 卸载脚本（独立版，无需安装脚本）
#
#  用法：
#    sudo bash uninstall-agent.sh          # 卸载
#    sudo bash uninstall-agent.sh --check  # 只检查，不卸载
#    sudo bash uninstall-agent.sh --force  # 跳过确认
# ============================================================
set -uo pipefail

SVC=aiops-agent
DIR=/opt/aiops-agent

# ---------- 参数 ----------
CHECK_ONLY=0
FORCE=0
for a in "$@"; do
  case "$a" in
    --check)  CHECK_ONLY=1 ;;
    --force)  FORCE=1 ;;
    -h|--help)
      sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "未知参数: $a"; exit 1 ;;
  esac
done

# ---------- 检查函数 ----------
check_state() {
  local found=0

  echo "==> 检查当前状态"
  echo ""

  # 1) timer
  if systemctl list-unit-files 2>/dev/null | grep -q "^${SVC}\.timer"; then
    echo "  [存在] ${SVC}.timer  ($(systemctl is-enabled ${SVC}.timer 2>/dev/null || echo unknown) / $(systemctl is-active ${SVC}.timer 2>/dev/null || echo unknown))"
    found=1
  else
    echo "  [无]   ${SVC}.timer"
  fi

  # 2) service
  if systemctl list-unit-files 2>/dev/null | grep -q "^${SVC}\.service"; then
    echo "  [存在] ${SVC}.service ($(systemctl is-enabled ${SVC}.service 2>/dev/null || echo unknown))"
    found=1
  else
    echo "  [无]   ${SVC}.service"
  fi

  # 3) 单元文件
  for f in /etc/systemd/system/${SVC}.service /etc/systemd/system/${SVC}.timer; do
    if [ -f "$f" ]; then echo "  [存在] $f"; found=1
    else echo "  [无]   $f"; fi
  done

  # 4) 程序目录
  if [ -d "$DIR" ]; then
    echo "  [存在] $DIR  ($(du -sh "$DIR" 2>/dev/null | cut -f1))"
    found=1
  else
    echo "  [无]   $DIR"
  fi

  # 5) 残留进程（排除自身和 grep）
  local pids=""
  for p in $(pgrep -f "aiops-agent" 2>/dev/null || true); do
    [ "$p" = "$$" ] && continue
    [ "$p" = "$PPID" ] && continue
    cmd=$(tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null || true)
    case "$cmd" in
      *uninstall-agent*|*uninstall.sh*) continue ;;
    esac
    pids="$pids $p"
  done
  pids=$(echo "$pids" | xargs 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "  [存在] 进程: $pids"
    found=1
  else
    echo "  [无]   残留进程"
  fi

  echo ""
  if [ "$found" = "1" ]; then
    echo "结论：检测到 Agent 残留，可以卸载"
    return 0
  else
    echo "结论：未检测到 Agent，无需卸载"
    return 1
  fi
}

# ---------- 主流程 ----------
echo "============================================================"
echo " AIOps Agent 卸载"
echo "============================================================"
echo ""

if ! check_state; then
  exit 0
fi

if [ "$CHECK_ONLY" = "1" ]; then
  echo ""
  echo "（--check 模式，未执行卸载）"
  exit 0
fi

# 确认
if [ "$FORCE" != "1" ]; then
  echo ""
  read -r -p "确认卸载？[y/N] " ans
  case "$ans" in
    y|Y|yes|YES) ;;
    *) echo "已取消"; exit 0 ;;
  esac
fi

echo ""
echo "==> [1/5] 停止并禁用服务"
systemctl disable --now "${SVC}.timer"   2>/dev/null || true
systemctl disable --now "${SVC}.service" 2>/dev/null || true
systemctl stop    "${SVC}.timer"   2>/dev/null || true
systemctl stop    "${SVC}.service" 2>/dev/null || true
echo "    完成"

echo "==> [2/5] 删除 systemd 单元文件"
rm -f "/etc/systemd/system/${SVC}.service"
rm -f "/etc/systemd/system/${SVC}.timer"
systemctl daemon-reload 2>/dev/null || true
systemctl reset-failed "${SVC}.service" 2>/dev/null || true
systemctl reset-failed "${SVC}.timer"   2>/dev/null || true
echo "    完成"

echo "==> [3/5] 清理残留进程"
pkill -f "aiops-agent" 2>/dev/null || true
sleep 1
echo "    完成"

echo "==> [4/5] 删除程序目录"
rm -rf "$DIR"
echo "    完成"

echo "==> [5/5] 验证"
echo ""
FAIL=0
if systemctl list-unit-files 2>/dev/null | grep -q "^${SVC}\.timer"; then
  echo "  ⚠️ ${SVC}.timer 仍存在"; FAIL=1
else
  echo "  ✅ ${SVC}.timer 已删除"
fi
if systemctl list-unit-files 2>/dev/null | grep -q "^${SVC}\.service"; then
  echo "  ⚠️ ${SVC}.service 仍存在"; FAIL=1
else
  echo "  ✅ ${SVC}.service 已删除"
fi
if [ -d "$DIR" ]; then
  echo "  ⚠️ $DIR 仍存在"; FAIL=1
else
  echo "  ✅ $DIR 已删除"
fi
if pgrep -f "aiops-agent" >/dev/null 2>&1; then
  echo "  ⚠️ 仍有进程运行"; FAIL=1
else
  echo "  ✅ 无残留进程"
fi

echo ""
if [ "$FAIL" = "0" ]; then
  cat <<'EOF'
============================================================
 卸载完成，环境已清理干净
============================================================
EOF
  exit 0
else
  cat <<'EOF'
============================================================
 卸载完成，但有残留（见上方 ⚠️）
 可尝试手动检查：
   systemctl status aiops-agent.timer
   systemctl status aiops-agent.service
   ls -la /opt/aiops-agent
============================================================
EOF
  exit 1
fi
