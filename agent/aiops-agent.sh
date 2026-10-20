#!/bin/bash
# ============================================================
#  AIOps Agent —— 采集 K8s 集群状态并上报到智能运维管理平台
#  本脚本由平台自动生成，集群标识与 Token 已内置
#  依赖：kubectl、jq、curl（K8s 方式推荐镜像 alpine/k8s；裸机方式直接装在宿主机）
# ============================================================
set -u

PLATFORM="__PLATFORM__"
CLUSTER_CODE="__CLUSTER_CODE__"
TOKEN="__TOKEN__"

if [ -z "$PLATFORM" ] || [ -z "$CLUSTER_CODE" ] || [ -z "$TOKEN" ]; then
  echo "[aiops-agent] 缺少 PLATFORM / CLUSTER_CODE / TOKEN" >&2
  exit 1
fi

for bin in kubectl jq curl; do
  command -v "$bin" >/dev/null 2>&1 || { echo "[aiops-agent] 缺少依赖：$bin" >&2; exit 1; }
done

echo "[aiops-agent] 采集集群 ${CLUSTER_CODE} ..."

# ---------- 集群版本 ----------
ver="$(kubectl version -o json 2>/dev/null | jq -r '.serverVersion.gitVersion // ""' 2>/dev/null)"
[ -z "$ver" ] && ver="unknown"

# ---------- 节点列表 ----------
nodes_raw="$(kubectl get nodes -o json 2>/dev/null)"
if [ -z "$nodes_raw" ]; then
  echo "[aiops-agent] 无法获取节点列表（检查 RBAC 权限）" >&2
  exit 1
fi

# ---------- 每节点 Pod 数 ----------
pod_map="$(kubectl get pods -A -o json 2>/dev/null \
  | jq -c '[.items[] | select(.spec.nodeName != null)] | group_by(.spec.nodeName) | map({key: .[0].spec.nodeName, value: length}) | from_entries' 2>/dev/null)"
[ -z "$pod_map" ] && pod_map='{}'

# ---------- 节点资源使用率 ----------
# A) kubectl top（需 metrics-server，口径最标准）
top_raw="$(kubectl top nodes --no-headers 2>/dev/null || true)"
top_map="$(printf '%s\n' "$top_raw" | awk 'NF>=5 { gsub("%","",$3); gsub("%","",$5); printf "%s\t%s\t%s\n", $1, $3, $5 }' \
  | jq -R -s -c 'split("\n") | map(select(length>0) | split("\t")) | map({key: .[0], value: {cpu: (.[1]|tonumber), mem: (.[2]|tonumber)}}) | from_entries' 2>/dev/null)"
[ -z "$top_map" ] && top_map='{}'

# B) 直读 kubelet /stats/summary（不依赖 metrics-server，且能拿到磁盘）
stat_lines=""
for nname in $(printf '%s' "$nodes_raw" | jq -r '.items[].metadata.name' 2>/dev/null); do
  cap_cpu="$(printf '%s' "$nodes_raw" | jq -r --arg n "$nname" '.items[] | select(.metadata.name==$n) | .status.capacity.cpu // "0"' 2>/dev/null)"
  cap_mem="$(printf '%s' "$nodes_raw" | jq -r --arg n "$nname" '.items[] | select(.metadata.name==$n) | .status.capacity.memory // "0"' 2>/dev/null)"
  st="$(kubectl get --raw "/api/v1/nodes/${nname}/proxy/stats/summary" 2>/dev/null || true)"
  [ -z "$st" ] && continue
  line="$(printf '%s' "$st" | jq -r --arg n "$nname" --arg cap "$cap_cpu" --arg capmem "$cap_mem" '
    (.node // {}) as $nd |
    ($cap | if test("m$") then ((rtrimstr("m")|tonumber)/1000) else (tonumber) end) as $cores |
    (($nd.cpu.usageNanoCores // 0)|tonumber) as $nc |
    (($nd.memory.workingSetBytes // 0)|tonumber) as $mu |
    ($capmem | if test("Ki$") then ((rtrimstr("Ki")|tonumber)*1024)
              elif test("Mi$") then ((rtrimstr("Mi")|tonumber)*1048576)
              elif test("Gi$") then ((rtrimstr("Gi")|tonumber)*1073741824)
              elif test("Ti$") then ((rtrimstr("Ti")|tonumber)*1099511627776)
              elif test("k$")  then ((rtrimstr("k")|tonumber)*1000)
              elif test("M$")  then ((rtrimstr("M")|tonumber)*1000000)
              elif test("G$")  then ((rtrimstr("G")|tonumber)*1000000000)
              else (tonumber) end) as $mc0 |
    (if $mc0 > 0 then $mc0 else ((($nd.memory.usageBytes // 0)|tonumber) + (($nd.memory.availableBytes // 0)|tonumber)) end) as $mc |
    (($nd.fs.usedBytes // 0)|tonumber) as $du |
    (($nd.fs.capacityBytes // 0)|tonumber) as $dc |
    [ $n,
      (if $cores > 0 then (($nc / ($cores * 1000000000)) * 100 | floor) else 0 end),
      (if $mc > 0 then (($mu / $mc) * 100 | floor) else 0 end),
      (if $dc > 0 then (($du / $dc) * 100 | floor) else 0 end)
    ] | @tsv' 2>/dev/null)"
  [ -n "$line" ] && stat_lines="${stat_lines}${line}
"
done

stat_map='{}'
if [ -n "$stat_lines" ]; then
  stat_map="$(printf '%s' "$stat_lines" | jq -R -s -c 'split("\n") | map(select(length>0) | split("\t")) | map({key: .[0], value: {cpu: (.[1]|tonumber), mem: (.[2]|tonumber), disk: (.[3]|tonumber)}}) | from_entries' 2>/dev/null)"
  [ -z "$stat_map" ] && stat_map='{}'
fi

# 合并：kubelet 打底，kubectl top 覆盖 cpu/mem（disk 保留 kubelet 的）
top_map="$(jq -n -c --argjson a "$stat_map" --argjson b "$top_map" '$a * $b' 2>/dev/null)"
[ -z "$top_map" ] && top_map='{}'

# ---------- 组装 nodes ----------
nodes_json="$(printf '%s' "$nodes_raw" | jq -c --argjson pc "$pod_map" --argjson tm "$top_map" '
  [ .items[] |
    . as $n |
    ($n.metadata.labels // {}) as $l |
    (if ($l["node-role.kubernetes.io/control-plane"] != null or $l["node-role.kubernetes.io/master"] != null) then "master" else "worker" end) as $role |
    ((($n.status.conditions // []) | map(select(.type == "Ready")) | .[0].status // "Unknown")) as $rdy |
    (if $rdy == "True" then "Ready" else "NotReady" end) as $status |
    ((($n.status.conditions // []) | map(select(.status == "True" and (.type == "MemoryPressure" or .type == "DiskPressure" or .type == "PIDPressure" or .type == "NetworkUnavailable"))) | map(.type))) as $conds |
    ((($n.status.addresses // []) | map(select(.type == "InternalIP")) | .[0].address // "")) as $ip |
    (($n.status.capacity.cpu // "0")) as $cpu |
    (($n.status.capacity.memory // "0Ki")) as $mem |
    ($n.metadata.name) as $name |
    {
      name: $name,
      role: $role,
      status: $status,
      ip: $ip,
      kubeletVersion: ($n.status.nodeInfo.kubeletVersion // ""),
      os: ($n.status.nodeInfo.osImage // ""),
      cpuCores: ($cpu | if test("m$") then ((rtrimstr("m") | tonumber) / 1000 | floor) else (tonumber) end),
      memTotalMb: ($mem | if test("Ki$") then ((rtrimstr("Ki") | tonumber) / 1024 | floor) elif test("Mi$") then (rtrimstr("Mi") | tonumber) elif test("Gi$") then ((rtrimstr("Gi") | tonumber) * 1024 | floor) else 0 end),
      cpuUsage: (($tm[$name].cpu) // 0),
      memUsage: (($tm[$name].mem) // 0),
      diskUsage: (($tm[$name].disk) // 0),
      podCount: (($pc[$name]) // 0),
      load1: 0,
      conditions: $conds
    }
  ]')"
[ -z "$nodes_json" ] && nodes_json='[]'

# ---------- 组件状态（自动发现） ----------
api_status="Healthy"
kubectl get --raw='/readyz' >/dev/null 2>&1 || api_status="Unhealthy"

# 1) 控制面：优先按 Pod 名探测，静态 Pod/二进制部署则按端点判断
cp_probe() {
  local name="$1" sel="$2"
  local pods ready total
  pods="$(printf '%s' "$KS_JSON" | jq -c --arg sel "$sel" '[.items[] | select(.metadata.name | test($sel))]' 2>/dev/null)"
  total="$(printf '%s' "$pods" | jq 'length' 2>/dev/null || echo 0)"
  if [ "$total" -gt 0 ]; then
    ready="$(printf '%s' "$pods" | jq '[.[] | select((.status.conditions // []) | map(select(.type == "Ready" and .status == "True")) | length > 0)] | length' 2>/dev/null || echo 0)"
    if [ "$ready" = "$total" ]; then
      printf '{"name":"%s","category":"control-plane","status":"Healthy","message":"就绪 %s/%s"}' "$name" "$ready" "$total"
    else
      printf '{"name":"%s","category":"control-plane","status":"Degraded","message":"就绪 %s/%s"}' "$name" "$ready" "$total"
    fi
  else
    printf '{"name":"%s","category":"control-plane","status":"NotFound","message":"未以 Pod 形式运行（静态 Pod / 二进制部署）"}' "$name"
  fi
}

# 2) 采集 kube-system 全部 Pod（一次调用，后续复用）
KS_JSON="$(kubectl get pods -n kube-system -o json 2>/dev/null || echo '{"items":[]}')"

# 3) 自动发现：kube-system 下所有工作负载（按 workload 名前缀聚合 Pod）
auto_comps="$(printf '%s' "$KS_JSON" | jq -c '
  [ .items[] |
    . as $p |
    ($p.metadata.ownerReferences // []) as $own |
    (if ($own | length) > 0 then
       ($own[0].name | sub("-\\d+$"; ""))
     else
       ($p.metadata.name | sub("-[a-z0-9]{5,10}-[a-z0-9]{5}$"; "") | sub("-[a-z0-9]{5}$"; ""))
     end) as $base |
    { base: $base,
      ns: $p.metadata.namespace,
      name: $p.metadata.name,
      ready: (([$p.status.conditions // [] | .[] | select(.type == "Ready" and .status == "True")] | length) > 0),
      phase: ($p.status.phase // "Unknown"),
      restarts: (($p.status.containerStatuses // []) | map(.restartCount // 0) | add // 0),
      node: ($p.spec.nodeName // ""),
      image: (($p.spec.containers // []) | map(.image) | .[0] // "")
    }
  ] |
  group_by(.base) |
  map({
    name: .[0].base,
    category: (if (.[0].ns == "kube-system") then "system" else .[0].ns end),
    total: length,
    ready: (map(select(.ready)) | length),
    restarts: (map(.restarts) | add),
    nodes: (map(.node) | unique),
    image: .[0].image,
    phase: (.[0].phase)
  }) |
  map({
    name: .name,
    category: .category,
    status: (if .ready == .total then "Healthy" elif .ready > 0 then "Degraded" else "Unhealthy" end),
    message: ("就绪 " + (.ready|tostring) + "/" + (.total|tostring)
              + (if .restarts > 0 then " · 重启 " + (.restarts|tostring) + " 次" else "" end)
              + (if (.nodes|length) > 0 then " · " + (.nodes|join(",")) else "" end))
  })')"
[ -z "$auto_comps" ] && auto_comps='[]'

# 4) 控制面组件（合并到列表）
cp_list="$(printf '[%s,%s,%s,%s]' \
  "$(cp_probe 'kube-apiserver' '^kube-apiserver')" \
  "$(cp_probe 'etcd' '^etcd')" \
  "$(cp_probe 'kube-scheduler' '^kube-scheduler')" \
  "$(cp_probe 'kube-controller-manager' '^kube-controller-manager')")"

# 5) API Server 就绪状态作为一项独立组件
api_comp="$(printf '{"name":"kube-apiserver-readyz","category":"control-plane","status":"%s","message":"%s"}' \
  "$api_status" "$(if [ "$api_status" = "Healthy" ]; then echo "readyz 正常"; else echo "readyz 异常"; fi)")"

# 6) 合并：自动发现 + 控制面 + readyz
comps_json="$(jq -n -c --argjson auto "$auto_comps" --argjson cp "$cp_list" --argjson api "$api_comp" \
  '($cp + [$api] + $auto) | unique_by(.name)')"
[ -z "$comps_json" ] && comps_json='[]'


# ---------- Pod 状态 ----------
pods_json="$(kubectl get pods -A -o json 2>/dev/null | jq -c '
  [ .items[] |
    . as $p |
    ([($p.status.containerStatuses // [])[] | .restartCount] | add // 0) as $restarts |
    (([($p.status.containerStatuses // [])[] | select(.ready == true)] | length)) as $readyN |
    (($p.spec.containers // []) | length) as $totalN |
    ([($p.status.containerStatuses // [])[] | select(.state.waiting != null) | .state.waiting.reason] | .[0] // "") as $waiting |
    ([($p.status.containerStatuses // [])[] | select(.state.terminated != null) | .state.terminated.reason] | .[0] // "") as $term |
    (if $waiting != "" then $waiting else $term end) as $reason |
    (if $waiting == "CrashLoopBackOff" then "CrashLoopBackOff"
     elif $waiting == "ImagePullBackOff" then "ImagePullBackOff"
     elif $waiting == "ErrImagePull" then "ErrImagePull"
     elif $reason == "OOMKilled" then "OOMKilled"
     elif $p.status.phase == "Pending" then "Pending"
     elif $p.status.phase == "Failed" then "Failed"
     elif $p.status.phase == "Succeeded" then "Succeeded"
     else "Running" end) as $status |
    {
      namespace: $p.metadata.namespace,
      name: $p.metadata.name,
      node: ($p.spec.nodeName // ""),
      phase: ($p.status.phase // "Unknown"),
      ready: (($readyN | tostring) + "/" + ($totalN | tostring)),
      restarts: $restarts,
      status: $status,
      reason: $reason
    }
  ] | .[0:500]')"
[ -z "$pods_json" ] && pods_json='[]'

# ---------- 上报 ----------
payload="$(jq -n -c --arg code "$CLUSTER_CODE" --arg token "$TOKEN" --arg ver "$ver" \
  --argjson nodes "$nodes_json" --argjson comps "$comps_json" --argjson pods "$pods_json" \
  '{clusterCode: $code, token: $token, clusterInfo: {version: $ver}, nodes: $nodes, components: $comps, pods: $pods}')"

resp="$(curl -fsS -m 25 -X POST "$PLATFORM/api/agent/report" \
  -H 'Content-Type: application/json' -d "$payload" 2>&1)"
rc=$?

if [ $rc -ne 0 ]; then
  echo "[aiops-agent] 上报失败：$resp" >&2
  exit 1
fi

echo "[aiops-agent] 上报成功：$(printf '%s' "$nodes_json" | jq 'length') 个节点，$(printf '%s' "$comps_json" | jq 'length') 个组件，$(printf '%s' "$pods_json" | jq 'length') 个 Pod -> $resp"
