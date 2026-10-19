/**
 * 智能运维管理平台 — 后端（MySQL 版）
 * Node.js + mysql2，无其他运行时依赖
 *
 * 能力：RBAC、组织分组、菜单可见性配置、工单状态机与转派、
 *       设备分类、设备型号库、供应商、资产、知识库、操作日志/审计
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { buildXlsx, parseXlsx } = require('./lib/xlsx');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8899);
const HOST = process.env.HOST || '127.0.0.1';

const DB_CFG = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'aiops',
  password: process.env.DB_PASS || 'aiops123',
  database: process.env.DB_NAME || 'aiops',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL || 30),
  charset: 'utf8mb4',
  dateStrings: true,
};

const PWD_FIELD = 'pwd';
let pool = null;

/* ============================== 权限清单 ============================== */

const PERMISSIONS = {
  'ticket.view.all': '查看全部工单',
  'ticket.view.own': '查看本人工单',
  'ticket.create': '新建工单',
  'ticket.edit': '编辑工单',
  'ticket.accept': '受理工单',
  'ticket.resolve': '解决工单',
  'ticket.reject': '退回工单',
  'ticket.close': '关闭工单',
  'ticket.reopen': '重新打开工单',
  'ticket.transfer': '转派工单',
  'ticket.delete': '删除工单',
  'asset.view': '查看资产',
  'asset.manage': '管理资产',
  'asset.audit': '资产审核',
  'category.manage': '设备分类管理',
  'ticket.category.manage': '事件分类管理',
  'cluster.view': '查看集群监控',
  'cluster.manage': '管理集群（接入/删除）',
  'alert.view': '查看告警',
  'pod.view': '查看 Pod',
  'alert.manage': '告警规则与处理',
  'supplier.view': '查看供应商',
  'supplier.manage': '管理供应商',
  'model.view': '查看设备型号库',
  'model.manage': '管理设备型号库',
  'kb.view': '查看知识库',
  'kb.manage': '管理知识库',
  'kb.category.manage': '知识库分类管理',
  'group.manage': '组织与分组管理',
  'dispatch.manage': '转派规则配置',
  'menu.manage': '菜单权限配置',
  'audit.view': '查看操作日志',
  'user.manage': '用户与权限管理',
  'role.manage': '角色管理',
};

const ROLE_SEED = {
  admin: {
    name: '系统管理员', desc: '平台最高权限：用户、组织、菜单权限、转派规则全部可管',
    group: '系统管理员', perms: ['*'],
  },
  tech: {
    name: '技术支持组', desc: '二线支持：受理/解决/关闭工单，可转派，维护资产、供应商、型号与知识库',
    group: '技术支持组',
    perms: [
      'ticket.view.all', 'ticket.create', 'ticket.edit', 'ticket.accept', 'ticket.resolve',
      'ticket.reject', 'ticket.close', 'ticket.reopen', 'ticket.transfer',
      'asset.view', 'asset.manage', 'asset.audit', 'category.manage',
      'supplier.view', 'supplier.manage', 'model.view', 'model.manage', 'kb.view', 'kb.manage',
      'cluster.view', 'cluster.manage', 'alert.view', 'alert.manage', 'pod.view',
    ],
  },
  ops: {
    name: '一线运维组', desc: '一线运维：受理本组工单、处理与转派给技术支持组',
    group: '一线运维组',
    perms: [
      'ticket.view.all', 'ticket.create', 'ticket.edit', 'ticket.accept', 'ticket.resolve',
      'ticket.close', 'ticket.reopen', 'ticket.transfer',
      'asset.view', 'asset.manage', 'supplier.view', 'model.view', 'kb.view', 'kb.manage',
      'cluster.view', 'alert.view', 'pod.view',
    ],
  },
  user: {
    name: '普通用户', desc: '报障人：提交工单、查看本人工单、关闭与重开',
    group: '业务用户组',
    perms: ['ticket.view.own', 'ticket.create', 'ticket.close', 'ticket.reopen', 'asset.view', 'kb.view'],
  },
};

/* 角色运行时表：启动时从数据库加载；库空则由 ROLE_SEED 播种。
   保持与旧常量相同的对象形状，使 rolePerms / publicUser 等引用无需改动。 */
let ROLES = {};

/** 菜单清单（含所属父级，用于前端渲染与权限配置） */
const MENUS = [
  { key: 'dashboard', label: '首页', icon: 'HomeFilled', parent: null, perm: null },
  { key: 'tickets', label: '工单管理', icon: 'Tickets', parent: null, perm: null },
  { key: 'ticketcats', label: '事件分类', icon: 'Grid', parent: null, perm: 'ticket.category.manage' },
  {
    key: 'monitor', label: '集群监控', icon: 'Monitor', parent: null, perm: 'cluster.view',
  },
  { key: 'clusters', label: '集群总览', icon: 'Monitor', parent: 'monitor', perm: 'cluster.view' },
  { key: 'nodes', label: '节点监控', icon: 'Cpu', parent: 'monitor', perm: 'cluster.view' },
  { key: 'alerts', label: '告警中心', icon: 'BellFilled', parent: 'monitor', perm: 'alert.view' },
  { key: 'alertrules', label: '告警规则', icon: 'SetUp', parent: 'monitor', perm: 'alert.manage' },
  { key: 'notify', label: '通知渠道', icon: 'Bell', parent: 'monitor', perm: 'alert.manage' },
  { key: 'assets', label: '资产管理', icon: 'Box', parent: null, perm: 'asset.view' },
  { key: 'assets.list', label: '资产台账', icon: 'Box', parent: 'assets', perm: 'asset.view' },
  { key: 'categories', label: '设备分类', icon: 'Grid', parent: 'assets', perm: 'model.view' },
  { key: 'assetaudit', label: '资产审核', icon: 'DocumentChecked', parent: 'assets', perm: 'asset.audit' },
  { key: 'models', label: '设备型号库', icon: 'Files', parent: 'assets', perm: 'model.view' },
  { key: 'suppliers', label: '供应商管理', icon: 'OfficeBuilding', parent: 'assets', perm: 'supplier.view' },
  { key: 'kb', label: '知识库管理', icon: 'Notebook', parent: null, perm: 'kb.view' },
  { key: 'kbcat', label: '知识库分类', icon: 'Grid', parent: 'kb', perm: 'kb.category.manage' },
  { key: 'users', label: '用户与权限', icon: 'UserFilled', parent: null, perm: 'user.manage' },
  { key: 'org', label: '组织与转派', icon: 'Share', parent: null, perm: 'group.manage' },
  { key: 'menus', label: '菜单权限', icon: 'Menu', parent: null, perm: 'menu.manage' },
  { key: 'audit', label: '操作日志', icon: 'Document', parent: null, perm: 'audit.view' },
];

function rolePerms(role) {
  const r = ROLES[role];
  if (!r) return [];
  return r.perms.includes('*') ? Object.keys(PERMISSIONS) : r.perms.slice();
}
function hasPerm(user, perm) {
  if (!user) return false;
  if (!perm) return true;
  // 有效权限 = 角色权限 ∪ 组被授予的权限（菜单权限表中显式开放）
  const list = user.perms || rolePerms(user.role);
  return list.includes(perm);
}

/** 组级授权：菜单权限表里对该组显式「显示」的菜单，其 perm 视为授予该组。
    管理员在「菜单权限」页给某组勾选后，该组即获得对应操作权限。 */
async function groupMenuPerms(groupId) {
  if (!groupId) return [];
  try {
    const [rows] = await pool.query('SELECT menu_key FROM menu_perms WHERE group_id = ? AND visible = 1', [groupId]);
    const out = [];
    for (const r of rows) {
      const m = MENUS.find((x) => x.key === r.menu_key);
      if (m && m.perm) out.push(m.perm);
    }
    return out;
  } catch (e) { return []; }
}

/** 计算用户有效权限并挂到 user 上，供 hasPerm 使用 */
async function withPerms(u) {
  if (!u) return u;
  const base = rolePerms(u.role);
  const extra = await groupMenuPerms(u.group_id);
  u.perms = Array.from(new Set(base.concat(extra)));
  return u;
}

/* ============================== 工单状态机 ============================== */

const STATUS_TEXT = { pending: '待受理', processing: '受理中', resolved: '已解决', closed: '已关闭' };
const OPEN_STATUS = new Set(['pending', 'processing']);

const FLOW = {
  pending: [
    { action: 'accept', to: 'processing', label: '受理', perm: 'ticket.accept' },
    { action: 'transfer', label: '转派', perm: 'ticket.transfer', transfer: true },
    { action: 'cancel', to: 'closed', label: '取消工单', perm: 'ticket.create', owner: true },
  ],
  processing: [
    { action: 'resolve', to: 'resolved', label: '标记已解决', perm: 'ticket.resolve' },
    { action: 'transfer', label: '转派', perm: 'ticket.transfer', transfer: true },
    { action: 'reject', to: 'pending', label: '退回', perm: 'ticket.reject' },
  ],
  resolved: [
    { action: 'close', to: 'closed', label: '关闭工单', perm: 'ticket.close' },
    { action: 'reopen', to: 'processing', label: '重新打开', perm: 'ticket.reopen' },
  ],
  closed: [
    { action: 'reopen', to: 'processing', label: '重新打开', perm: 'ticket.reopen' },
  ],
};

const isOverdue = (t) => OPEN_STATUS.has(t.status) && new Date(t.dueAt).getTime() < Date.now();

function availableActions(user, t) {
  return (FLOW[t.status] || [])
    .filter((a) => hasPerm(user, a.perm))
    .filter((a) => (a.owner ? t.creator === user.name : true))
    .map((a) => ({ action: a.action, label: a.label, to: a.to || null, transfer: !!a.transfer }));
}

/* ============================== 建表 ============================== */

const DDL = [
  `CREATE TABLE IF NOT EXISTS sys_groups (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(64) NOT NULL UNIQUE,
    descr VARCHAR(255) DEFAULT '',
    leader VARCHAR(64) DEFAULT '',
    color VARCHAR(16) DEFAULT '#2563eb',
    sort INT DEFAULT 0,
    tier INT DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS sys_users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(64) NOT NULL UNIQUE,
    pwd VARCHAR(128) NOT NULL,
    name VARCHAR(64) NOT NULL,
    role VARCHAR(32) NOT NULL,
    group_id INT NULL,
    org VARCHAR(191) DEFAULT '',
    dept VARCHAR(64) DEFAULT '',
    phone VARCHAR(32) DEFAULT '',
    active TINYINT(1) DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_role (role), INDEX idx_group (group_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS device_categories (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(64) NOT NULL UNIQUE,
    descr VARCHAR(255) DEFAULT '',
    sort INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS kb_categories (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(64) NOT NULL UNIQUE,
    descr VARCHAR(255) DEFAULT '',
    sort INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS roles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    role_key VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(64) NOT NULL,
    descr VARCHAR(255) DEFAULT '',
    group_name VARCHAR(64) DEFAULT '',
    perms TEXT,
    builtin TINYINT(1) DEFAULT 0,
    sort INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS departments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(64) NOT NULL UNIQUE,
    descr VARCHAR(255) DEFAULT '',
    sort INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS suppliers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(191) NOT NULL UNIQUE,
    short_name VARCHAR(64) NOT NULL,
    status VARCHAR(16) DEFAULT 'active',
    province VARCHAR(32) DEFAULT '',
    city VARCHAR(32) DEFAULT '',
    contact VARCHAR(64) DEFAULT '',
    phone VARCHAR(32) DEFAULT '',
    address VARCHAR(255) DEFAULT '',
    note VARCHAR(255) DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS device_models (
    id INT PRIMARY KEY AUTO_INCREMENT,
    category VARCHAR(64) NOT NULL,
    vendor VARCHAR(64) NOT NULL,
    model VARCHAR(128) NOT NULL,
    descr VARCHAR(255) DEFAULT '',
    unit VARCHAR(16) DEFAULT '台',
    status VARCHAR(16) DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS assets (
    id INT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(128) NOT NULL,
    type VARCHAR(64) DEFAULT '其他',
    ip VARCHAR(64) DEFAULT '-',
    location VARCHAR(191) DEFAULT '-',
    owner VARCHAR(64) DEFAULT '-',
    status VARCHAR(16) DEFAULT 'running',
    purchase_date DATETIME NULL,
    note VARCHAR(255) DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS res_fields (
    id INT PRIMARY KEY AUTO_INCREMENT,
    category VARCHAR(64) NOT NULL,
    field_key VARCHAR(64) NOT NULL,
    label VARCHAR(64) NOT NULL,
    ftype VARCHAR(16) DEFAULT 'text',
    required TINYINT(1) DEFAULT 0,
    in_list TINYINT(1) DEFAULT 0,
    options_source VARCHAR(128) DEFAULT '',
    sort INT DEFAULT 0,
    UNIQUE KEY uk_cat_key (category, field_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS res_records (
    id INT PRIMARY KEY AUTO_INCREMENT,
    category VARCHAR(64) NOT NULL,
    data LONGTEXT,
    audit_status VARCHAR(16) DEFAULT 'pending',
    audit_by VARCHAR(64) DEFAULT '',
    audit_at DATETIME NULL,
    audit_note VARCHAR(255) DEFAULT '',
    deleted_at DATETIME NULL,
    created_by VARCHAR(64) DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cat (category),
    INDEX idx_cat_audit (category, audit_status),
    INDEX idx_deleted (deleted_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS res_categories (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(64) NOT NULL UNIQUE,
    kind VARCHAR(16) DEFAULT 'asset',
    sort INT DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS asset_software (
    id INT PRIMARY KEY AUTO_INCREMENT,
    asset_id INT NOT NULL,
    name VARCHAR(128) NOT NULL,
    version VARCHAR(64) DEFAULT '',
    vendor VARCHAR(128) DEFAULT '',
    category VARCHAR(64) DEFAULT '其他',
    install_path VARCHAR(191) DEFAULT '',
    note VARCHAR(255) DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_asset (asset_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS tickets (
    id INT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(32) NOT NULL,
    title VARCHAR(255) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    priority VARCHAR(16) DEFAULT 'normal',
    category VARCHAR(64) DEFAULT '其他',
    big_category VARCHAR(64) DEFAULT '',
    mid_category VARCHAR(64) DEFAULT '',
    small_category VARCHAR(64) DEFAULT '',
    creator VARCHAR(64) DEFAULT '',
    assignee VARCHAR(64) DEFAULT '待分配',
    group_id INT NULL,
    asset VARCHAR(64) DEFAULT '-',
    is_coop TINYINT(1) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    due_at DATETIME NULL,
    descr TEXT,
    INDEX idx_status (status), INDEX idx_group (group_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS ticket_comments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    ticket_id INT NOT NULL,
    by_name VARCHAR(64) DEFAULT '',
    content TEXT,
    at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ticket (ticket_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS ticket_flow (
    id INT PRIMARY KEY AUTO_INCREMENT,
    ticket_id INT NOT NULL,
    action VARCHAR(32) NOT NULL,
    from_status VARCHAR(16) NULL,
    to_status VARCHAR(16) NULL,
    by_name VARCHAR(64) DEFAULT '',
    role VARCHAR(32) DEFAULT '',
    at DATETIME DEFAULT CURRENT_TIMESTAMP,
    note VARCHAR(255) DEFAULT '',
    transfer_from VARCHAR(128) DEFAULT '',
    transfer_to VARCHAR(128) DEFAULT '',
    INDEX idx_ticket (ticket_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS kb (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(64) DEFAULT '未分类',
    tags VARCHAR(255) DEFAULT '',
    content TEXT,
    author VARCHAR(64) DEFAULT '',
    views INT DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS dispatch_rules (
    id INT PRIMARY KEY AUTO_INCREMENT,
    category VARCHAR(64) NOT NULL,
    group_id INT NOT NULL,
    priority VARCHAR(16) DEFAULT 'normal',
    note VARCHAR(255) DEFAULT ''
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    at DATETIME DEFAULT CURRENT_TIMESTAMP,
    username VARCHAR(64) DEFAULT '',
    name VARCHAR(64) DEFAULT '',
    role VARCHAR(32) DEFAULT '',
    action VARCHAR(32) DEFAULT '',
    module VARCHAR(32) DEFAULT '',
    target VARCHAR(191) DEFAULT '',
    detail VARCHAR(255) DEFAULT '',
    ip VARCHAR(64) DEFAULT '',
    INDEX idx_at (at), INDEX idx_user (username)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS ticket_categories (
    id INT PRIMARY KEY AUTO_INCREMENT,
    parent_id INT DEFAULT 0,
    level TINYINT NOT NULL,
    name VARCHAR(64) NOT NULL,
    sort INT DEFAULT 0,
    UNIQUE KEY uk_parent_name (parent_id, name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS menu_perms (
    group_id INT NOT NULL,
    menu_key VARCHAR(32) NOT NULL,
    visible TINYINT(1) DEFAULT 1,
    PRIMARY KEY (group_id, menu_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS clusters (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(64) NOT NULL UNIQUE,
    code VARCHAR(64) NOT NULL UNIQUE,
    env VARCHAR(16) DEFAULT 'prod',
    region VARCHAR(64) DEFAULT '',
    version VARCHAR(32) DEFAULT '',
    agent_token VARCHAR(64) NOT NULL,
    status VARCHAR(16) DEFAULT 'unknown',
    last_seen DATETIME NULL,
    note VARCHAR(255) DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS cluster_nodes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    cluster_id INT NOT NULL,
    name VARCHAR(128) NOT NULL,
    role VARCHAR(32) DEFAULT 'worker',
    status VARCHAR(16) DEFAULT 'unknown',
    ip VARCHAR(64) DEFAULT '',
    kubelet_version VARCHAR(32) DEFAULT '',
    os VARCHAR(64) DEFAULT '',
    cpu_cores INT DEFAULT 0,
    mem_total_mb INT DEFAULT 0,
    cpu_usage DECIMAL(6,2) DEFAULT 0,
    mem_usage DECIMAL(6,2) DEFAULT 0,
    disk_usage DECIMAL(6,2) DEFAULT 0,
    pod_count INT DEFAULT 0,
    conditions VARCHAR(255) DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_cluster_node (cluster_id, name),
    INDEX idx_cluster (cluster_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS cluster_components (
    id INT PRIMARY KEY AUTO_INCREMENT,
    cluster_id INT NOT NULL,
    name VARCHAR(64) NOT NULL,
    category VARCHAR(32) DEFAULT 'control-plane',
    status VARCHAR(16) DEFAULT 'unknown',
    message VARCHAR(255) DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_cluster_comp (cluster_id, name),
    INDEX idx_cluster (cluster_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS node_metrics (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    cluster_id INT NOT NULL,
    node_name VARCHAR(128) NOT NULL,
    at DATETIME NOT NULL,
    cpu_usage DECIMAL(6,2) DEFAULT 0,
    mem_usage DECIMAL(6,2) DEFAULT 0,
    disk_usage DECIMAL(6,2) DEFAULT 0,
    net_rx_kbps DECIMAL(12,2) DEFAULT 0,
    net_tx_kbps DECIMAL(12,2) DEFAULT 0,
    load1 DECIMAL(8,2) DEFAULT 0,
    INDEX idx_node_at (cluster_id, node_name, at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS cluster_pods (
    id INT PRIMARY KEY AUTO_INCREMENT,
    cluster_id INT NOT NULL,
    namespace VARCHAR(128) DEFAULT 'default',
    name VARCHAR(191) NOT NULL,
    node VARCHAR(128) DEFAULT '',
    phase VARCHAR(32) DEFAULT 'Unknown',
    ready VARCHAR(32) DEFAULT '0/0',
    restarts INT DEFAULT 0,
    status VARCHAR(32) DEFAULT 'Running',
    reason VARCHAR(128) DEFAULT '',
    cpu_milli INT DEFAULT 0,
    mem_mb INT DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_cluster_pod (cluster_id, namespace, name),
    INDEX idx_cluster (cluster_id), INDEX idx_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS alert_rules (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(128) NOT NULL,
    metric VARCHAR(64) NOT NULL,
    scope VARCHAR(16) DEFAULT 'node',
    operator VARCHAR(8) DEFAULT '>',
    threshold DECIMAL(10,2) DEFAULT 90,
    duration_sec INT DEFAULT 300,
    severity VARCHAR(16) DEFAULT 'high',
    category VARCHAR(64) DEFAULT '',
    mid_category VARCHAR(64) DEFAULT '',
    small_category VARCHAR(64) DEFAULT '',
    enabled TINYINT(1) DEFAULT 1,
    auto_ticket TINYINT(1) DEFAULT 1,
    dedup_window_sec INT DEFAULT 300,
    note VARCHAR(255) DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS notify_channels (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(128) NOT NULL,
    type VARCHAR(16) NOT NULL,
    config TEXT,
    enabled TINYINT(1) DEFAULT 1,
    on_fire TINYINT(1) DEFAULT 1,
    on_resolve TINYINT(1) DEFAULT 0,
    min_severity VARCHAR(16) DEFAULT 'normal',
    note VARCHAR(255) DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS notify_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    channel_id INT NULL,
    channel_name VARCHAR(128) DEFAULT '',
    channel_type VARCHAR(16) DEFAULT '',
    alert_id INT NULL,
    event VARCHAR(16) DEFAULT 'firing',
    status VARCHAR(16) DEFAULT 'ok',
    error VARCHAR(255) DEFAULT '',
    at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_at (at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS alerts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    cluster_id INT NOT NULL,
    rule_id INT NULL,
    rule_name VARCHAR(128) DEFAULT '',
    target VARCHAR(191) DEFAULT '',
    metric VARCHAR(64) DEFAULT '',
    value DECIMAL(10,2) DEFAULT 0,
    threshold DECIMAL(10,2) DEFAULT 0,
    severity VARCHAR(16) DEFAULT 'high',
    status VARCHAR(16) DEFAULT 'firing',
    message VARCHAR(255) DEFAULT '',
    ticket_id INT NULL,
    dedup_key VARCHAR(191) DEFAULT '',
    count INT DEFAULT 1,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    fired_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME NULL,
    INDEX idx_cluster (cluster_id), INDEX idx_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

/* ============================== 种子数据 ============================== */

async function seedIfEmpty() {
  const [[{ c: gcount }]] = await pool.query('SELECT COUNT(*) AS c FROM sys_groups');
  if (gcount > 0) return;

  const P = '123456';
  const groups = [
    ['系统管理员', '平台管理与权限维护', '系统管理员', '#dc2626', 1, 0],
    ['技术支持组', '二线技术支持，处理复杂故障与系统变更', '李强', '#2563eb', 2, 2],
    ['一线运维组', '一线运维值守，负责日常故障响应与初步处理', '赵磊', '#0d9488', 3, 1],
    ['业务用户组', '业务部门报障人', '王芳', '#6b7280', 4, 0],
  ];
  for (const g of groups) {
    await pool.query('INSERT INTO sys_groups (name, descr, leader, color, sort, tier) VALUES (?,?,?,?,?,?)', g);
  }
  const gid = {};
  for (const [id, name] of (await pool.query('SELECT id, name FROM sys_groups'))[0].map((r) => [r.id, r.name])) gid[name] = id;

  const users = [
    ['admin', P, '系统管理员', 'admin', '系统管理员', '中烟信息', '信息中心', '13800000001'],
    ['liqiang', P, '李强', 'tech', '技术支持组', '中烟信息', '技术支持组', '13800000002'],
    ['chenming', P, '陈明', 'tech', '技术支持组', '中烟信息', '技术支持组', '13800000003'],
    ['zhaolei', P, '赵磊', 'ops', '一线运维组', '中烟信息', '一线运维组', '13800000004'],
    ['sunna', P, '孙娜', 'ops', '一线运维组', '中烟信息', '一线运维组', '13800000005'],
    ['wangfang', P, '王芳', 'user', '业务用户组', '中烟机械', '财务部', '13800000006'],
    ['liuyang', P, '刘洋', 'user', '业务用户组', '中烟机械', '行政部', '13800000007'],
  ];
  for (const u of users) {
    await pool.query(
      'INSERT INTO sys_users (username, pwd, name, role, group_id, org, dept, phone) VALUES (?,?,?,?,?,?,?,?)',
      [u[0], u[1], u[2], u[3], gid[u[4]], u[5], u[6], u[7]]
    );
  }

  const cats = [
    ['服务器', '物理服务器与虚拟化宿主机', 1],
    ['网络设备', '交换机、路由器、无线控制器', 2],
    ['安全设备', '防火墙、堡垒机、入侵检测', 3],
    ['存储设备', 'SAN/NAS 存储与备份一体机', 4],
    ['终端设备', '台式机、笔记本、打印机', 5],
    ['机房设施', 'UPS、精密空调、配电', 6],
    ['软件系统', '操作系统、数据库、中间件', 7],
  ];
  for (const c of cats) await pool.query('INSERT INTO device_categories (name, descr, sort) VALUES (?,?,?)', c);

  const sups = [
    ['太极计算机股份有限公司', '太极', 'active', '北京市', '北京市', '', ''],
    ['深信服科技股份有限公司', '深信服', 'active', '北京市', '', '', ''],
    ['神州数码系统集成服务有限公司', '神州数码', 'active', '北京市', '北京市', '李雪恩', '13901010101'],
    ['北京云锦汇智信息技术有限公司', '云锦汇智', 'disabled', '北京市', '', '王伟', '13901010101'],
    ['北京中烟信息技术有限公司', '北京中烟信息', 'active', '北京市', '北京市', '联系人', '01036305800'],
    ['浪潮电子信息产业股份有限公司', '浪潮', 'active', '山东省', '济南市', '张海', '13901010102'],
    ['新华三技术有限公司', '新华三', 'active', '浙江省', '杭州市', '刘波', '13901010103'],
  ];
  for (const s of sups) {
    await pool.query('INSERT INTO suppliers (name, short_name, status, province, city, contact, phone) VALUES (?,?,?,?,?,?,?)', s);
  }

  const models = [
    ['服务器', '华为', '2288H V5', '2U 机架服务器', '台'],
    ['服务器', '浪潮', 'NF5280M6', '2U 机架服务器', '台'],
    ['网络设备', '新华三', 'S5560X-54C-EI', '三层万兆交换机', '台'],
    ['网络设备', '华为', 'S5731-S48T4X', '千兆接入交换机', '台'],
    ['安全设备', '深信服', 'AF-2000-FH2250B', '下一代防火墙', '台'],
    ['存储设备', '华为', 'OceanStor 5310', '中端全闪存储', '台'],
    ['终端设备', '联想', 'ThinkCentre M720t', '商用台式机', '台'],
    ['机房设施', '山特', 'C10KS', '10KVA UPS', '台'],
  ];
  for (const m of models) {
    await pool.query('INSERT INTO device_models (category, vendor, model, descr, unit) VALUES (?,?,?,?,?)', m);
  }

  const assets = [
    ['srv-app-03', '应用服务器 A', '服务器', '10.20.3.13', 'A 座机房 3 排 2 柜', '李强', 'running'],
    ['srv-db-01', '数据库主服务器', '服务器', '10.20.3.21', 'A 座机房 3 排 4 柜', '陈明', 'running'],
    ['sw-core-01', '核心交换机', '网络设备', '10.20.0.1', 'A 座机房 1 排 1 柜', '赵磊', 'warning'],
    ['fw-edge-01', '边界防火墙', '安全设备', '10.20.0.254', 'A 座机房 1 排 2 柜', '赵磊', 'running'],
    ['app-oa', 'OA 办公系统', '软件系统', '10.20.5.10', '虚拟化集群 vCenter-01', '陈明', 'warning'],
    ['app-fin', '财务管理系统', '软件系统', '10.20.5.22', '虚拟化集群 vCenter-01', '陈明', 'running'],
    ['mail-01', '邮件服务器', '服务器', '10.20.3.31', 'A 座机房 3 排 6 柜', '李强', 'running'],
    ['storage-01', '集中存储阵列', '存储设备', '10.20.2.10', 'A 座机房 2 排 1 柜', '李强', 'running'],
    ['ups-01', '机房 UPS 电源', '机房设施', '10.20.1.5', 'A 座机房配电间', '孙娜', 'offline'],
    ['pc-new-07', '新员工办公电脑', '终端设备', '10.20.30.77', 'B 座 7 楼办公区', '孙娜', 'running'],
  ];
  for (const a of assets) {
    await pool.query('INSERT INTO assets (code, name, type, ip, location, owner, status) VALUES (?,?,?,?,?,?,?)', a);
  }

  const raw = [
    ['服务器磁盘空间告警', 'pending', 'high', '服务器', '张伟', '李强', 'srv-app-03', 1, -2, '技术支持组'],
    ['OA 系统登录异常', 'processing', 'urgent', '软件系统', '王芳', '陈明', 'app-oa', 0, -1, '技术支持组'],
    ['三楼打印机无法联网', 'resolved', 'normal', '网络设备', '刘洋', '赵磊', 'printer-3f', 2, -5, '一线运维组'],
    ['邮箱容量已满需扩容', 'closed', 'low', '软件系统', '孙娜', '陈明', 'mail-01', 1, -9, '技术支持组'],
    ['数据库连接池耗尽', 'processing', 'urgent', '软件系统', '周杰', '李强', 'db-main', 3, -3, '技术支持组'],
    ['核心交换机端口故障', 'pending', 'high', '网络设备', '吴敏', '赵磊', 'sw-core-01', 2, -1, '一线运维组'],
    ['VPN 账号开通申请', 'pending', 'normal', '其他', '王芳', '孙娜', '-', 0, -0.5, '一线运维组'],
    ['财务报表导出失败', 'processing', 'high', '软件系统', '冯磊', '陈明', 'app-fin', 4, -2, '技术支持组'],
    ['新员工电脑环境配置', 'resolved', 'normal', '终端设备', '刘洋', '赵磊', 'pc-new-07', 1, -6, '一线运维组'],
    ['监控告警误报排查', 'pending', 'low', '其他', '何丽', '孙娜', 'zabbix', 0, -0.2, '一线运维组'],
    ['数据库备份任务失败', 'processing', 'high', '软件系统', '马超', '陈明', 'db-backup', 2, -4, '技术支持组'],
    ['会议室投影仪维修', 'closed', 'low', '终端设备', '曹阳', '孙娜', 'proj-802', 3, -12, '一线运维组'],
  ];
  const now = Date.now();
  const day = 86400000;
  const fmt = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    const created = now + t[8] * day;
    const due = created + day * (t[7] + 1);
    const [r] = await pool.query(
      `INSERT INTO tickets (code, title, status, priority, category, creator, assignee, group_id, asset, is_coop, created_at, due_at, descr)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ['WO' + String(20260001 + i), t[0], t[1], t[2], t[3], t[4], t[5], gid[t[9]], t[6], (i === 7 || i === 9) ? 1 : 0,
        fmt(created), fmt(due), '用户反馈：' + t[0] + '。请相关同事及时跟进处理，处理完成后回填解决方案。']
    );
    const tid = r.insertId;
    await pool.query(
      'INSERT INTO ticket_flow (ticket_id, action, from_status, to_status, by_name, role, at, note) VALUES (?,?,?,?,?,?,?,?)',
      [tid, 'create', null, 'pending', t[4], 'user', fmt(created), '提交工单']
    );
    if (t[1] !== 'pending') {
      const acc = created + 3600e3 * 2;
      await pool.query(
        'INSERT INTO ticket_flow (ticket_id, action, from_status, to_status, by_name, role, at, note) VALUES (?,?,?,?,?,?,?,?)',
        [tid, 'accept', 'pending', 'processing', t[5], 'ops', fmt(acc), '已受理，开始处理']
      );
      if (t[1] === 'resolved' || t[1] === 'closed') {
        await pool.query(
          'INSERT INTO ticket_flow (ticket_id, action, from_status, to_status, by_name, role, at, note) VALUES (?,?,?,?,?,?,?,?)',
          [tid, 'resolve', 'processing', 'resolved', t[5], 'ops', fmt(acc + 3600e3 * 5), '问题已处理完成']
        );
      }
      if (t[1] === 'closed') {
        await pool.query(
          'INSERT INTO ticket_flow (ticket_id, action, from_status, to_status, by_name, role, at, note) VALUES (?,?,?,?,?,?,?,?)',
          [tid, 'close', 'resolved', 'closed', t[4], 'user', fmt(acc + 3600e3 * 9), '确认解决，关闭工单']
        );
      }
    }
  }

  const kb = [
    ['VPN 客户端安装与连接指南', '操作指南', 'VPN,远程办公', '一、下载客户端\n请从内网软件中心下载对应平台安装包。\n\n二、安装与配置\n1. 安装完成后打开客户端；\n2. 服务器地址填写 vpn.example.com；\n3. 使用域账号登录，首次登录需修改初始密码。'],
    ['服务器日常巡检规范', '运维规范', '巡检,服务器', '每日巡检项：\n1. CPU / 内存 / 磁盘使用率（阈值：磁盘 < 85%）；\n2. 系统日志中是否有 OOM、磁盘 IO 错误；\n3. 关键服务进程是否存在；\n4. 备份任务执行结果。'],
    ['数据库连接池耗尽排查思路', '故障处理', '数据库,故障', '现象：应用报 "Cannot get a connection, pool exhausted"。\n\n排查步骤：\n1. 查看当前活动连接数与最大连接数；\n2. 定位长时间未释放的慢 SQL；\n3. 检查应用侧是否存在连接泄漏。'],
    ['交换机端口故障处理流程', '故障处理', '网络,交换机', '1. 确认端口指示灯状态与告警信息；\n2. 在管理端执行 show interface 查看错包统计；\n3. 更换跳线或改接备用端口验证；\n4. 若为硬件故障，走备件更换流程。'],
    ['一线到二线升级（转派）规范', '运维规范', '转派,流程', '1. 一线运维组接到工单后 30 分钟内响应；\n2. 涉及核心系统、数据库、需变更操作的，转派至技术支持组；\n3. 转派必须填写转派原因与已做的排查动作。'],
    ['备份任务失败常见原因', '故障处理', '备份,数据库', '1. 备份目录空间不足；\n2. 数据库账号密码变更未同步；\n3. 备份窗口与业务高峰期冲突导致超时；\n4. 网络存储挂载掉线。'],
  ];
  const authors = ['李强', '陈明', '赵磊', '孙娜'];
  for (let i = 0; i < kb.length; i++) {
    await pool.query(
      'INSERT INTO kb (title, category, tags, content, author, views) VALUES (?,?,?,?,?,?)',
      [kb[i][0], kb[i][1], kb[i][2], kb[i][3], authors[i % 4], 30 + i * 17]
    );
  }

  const rules = [
    ['网络设备', '一线运维组', 'high', '网络类先由一线运维组响应'],
    ['终端设备', '一线运维组', 'normal', '终端问题一线处理'],
    ['服务器', '技术支持组', 'high', '服务器问题直接给技术支持组'],
    ['软件系统', '技术支持组', 'high', '业务系统问题二线处理'],
    ['存储设备', '技术支持组', 'high', '存储问题二线处理'],
  ];
  for (const r of rules) {
    await pool.query('INSERT INTO dispatch_rules (category, group_id, priority, note) VALUES (?,?,?,?)', [r[0], gid[r[1]], r[2], r[3]]);
  }
}

/* ---------- 工单三级分类：独立播种（现有库也能补） ---------- */
async function seedTicketCatsIfEmpty() {
  const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM ticket_categories');
  if (c > 0) return;
  const TICKET_CATS = [
    ['行业调控系统', [
      ['软件', ['登录异常', '数据同步失败', '报表导出错误', '权限配置']],
      ['硬件', ['服务器宕机', '存储故障', '网络中断', '终端故障']],
    ]],
    ['二维码系统', [
      ['软件', ['扫码识别失败', '数据上传异常', '接口超时', '权限配置']],
      ['硬件', ['扫码枪故障', '打印机故障', '服务器故障', '网络中断']],
    ]],
    ['电子标签系统', [
      ['软件', ['标签生成失败', '数据同步异常', '接口对接', '权限配置']],
      ['硬件', ['读写器故障', '天线故障', '服务器故障', '网络中断']],
    ]],
  ];
  for (const [bigName, mids] of TICKET_CATS) {
    const [rb] = await pool.query('INSERT INTO ticket_categories (parent_id, level, name, sort) VALUES (0, 1, ?, 1)', [bigName]);
    for (let mi = 0; mi < mids.length; mi++) {
      const [midName, smalls] = mids[mi];
      const [rm] = await pool.query('INSERT INTO ticket_categories (parent_id, level, name, sort) VALUES (?, 2, ?, ?)', [rb.insertId, midName, mi + 1]);
      for (let si = 0; si < smalls.length; si++) {
        await pool.query('INSERT INTO ticket_categories (parent_id, level, name, sort) VALUES (?, 3, ?, ?)', [rm.insertId, smalls[si], si + 1]);
      }
    }
  }
  console.log('已播种工单三级分类');
}

/* ---------- 集群监控：独立播种（现有库也能补） ---------- */
async function seedMonitorIfEmpty() {
  const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM clusters');
  if (c > 0) return;

  const mk = (code) => 'agt_' + code + '_' + Math.random().toString(36).slice(2, 10);
  const clusters = [
    ['生产集群-北京', 'prod-bj', 'prod', '北京', 'v1.29.4', mk('bj')],
    ['测试集群-上海', 'test-sh', 'test', '上海', 'v1.28.9', mk('sh')],
    ['灾备集群-广州', 'dr-gz', 'dr', '广州', 'v1.27.8', mk('gz')],
  ];
  for (const c of clusters) {
    await pool.query('INSERT INTO clusters (name, code, env, region, version, agent_token, status, last_seen) VALUES (?,?,?,?,?,?,?,NOW())',
      [c[0], c[1], c[2], c[3], c[4], c[5], 'healthy']);
  }
  const [crows] = await pool.query('SELECT id, code FROM clusters');
  const cid = {};
  crows.forEach((r) => { cid[r.code] = r.id; });

  const nodes = [
    ['prod-bj', 'k8s-master-01', 'master', 'Ready', '10.30.1.11', 'v1.29.4', 'Ubuntu 22.04', 16, 32768, 38.5, 61.2, 42.0, 45],
    ['prod-bj', 'k8s-master-02', 'master', 'Ready', '10.30.1.12', 'v1.29.4', 'Ubuntu 22.04', 16, 32768, 35.1, 58.7, 40.3, 42],
    ['prod-bj', 'k8s-master-03', 'master', 'Ready', '10.30.1.13', 'v1.29.4', 'Ubuntu 22.04', 16, 32768, 33.8, 55.1, 39.8, 40],
    ['prod-bj', 'k8s-node-01', 'worker', 'Ready', '10.30.1.21', 'v1.29.4', 'Ubuntu 22.04', 32, 65536, 72.4, 81.3, 68.5, 128],
    ['prod-bj', 'k8s-node-02', 'worker', 'Ready', '10.30.1.22', 'v1.29.4', 'Ubuntu 22.04', 32, 65536, 91.2, 88.6, 74.1, 142],
    ['prod-bj', 'k8s-node-03', 'worker', 'NotReady', '10.30.1.23', 'v1.29.4', 'Ubuntu 22.04', 32, 65536, 5.2, 12.4, 71.0, 0],
    ['test-sh', 'k8s-master-01', 'master', 'Ready', '10.40.1.11', 'v1.28.9', 'Ubuntu 22.04', 8, 16384, 22.1, 41.5, 35.2, 28],
    ['test-sh', 'k8s-node-01', 'worker', 'Ready', '10.40.1.21', 'v1.28.9', 'Ubuntu 22.04', 16, 32768, 48.3, 66.2, 52.7, 76],
    ['test-sh', 'k8s-node-02', 'worker', 'Ready', '10.40.1.22', 'v1.28.9', 'Ubuntu 22.04', 16, 32768, 44.9, 63.8, 91.5, 71],
    ['dr-gz', 'k8s-master-01', 'master', 'Ready', '10.50.1.11', 'v1.27.8', 'Ubuntu 22.04', 8, 16384, 18.4, 33.2, 30.1, 19],
    ['dr-gz', 'k8s-node-01', 'worker', 'Ready', '10.50.1.21', 'v1.27.8', 'Ubuntu 22.04', 16, 32768, 29.7, 45.6, 44.8, 52],
  ];
  for (const n of nodes) {
    await pool.query(
      'INSERT INTO cluster_nodes (cluster_id, name, role, status, ip, kubelet_version, os, cpu_cores, mem_total_mb, cpu_usage, mem_usage, disk_usage, pod_count, conditions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [cid[n[0]], n[1], n[2], n[3], n[4], n[5], n[6], n[7], n[8], n[9], n[10], n[11], n[12], n[3] === 'Ready' ? '' : 'Ready=False,MemoryPressure']
    );
  }

  const comps = [
    ['prod-bj', 'kube-apiserver', 'control-plane', 'Healthy', ''],
    ['prod-bj', 'etcd', 'control-plane', 'Healthy', ''],
    ['prod-bj', 'kube-scheduler', 'control-plane', 'Healthy', ''],
    ['prod-bj', 'kube-controller-manager', 'control-plane', 'Healthy', ''],
    ['prod-bj', 'coredns', 'addon', 'Healthy', ''],
    ['prod-bj', 'calico', 'network', 'Degraded', '节点 k8s-node-03 上的 calico-node 未就绪'],
    ['test-sh', 'kube-apiserver', 'control-plane', 'Healthy', ''],
    ['test-sh', 'etcd', 'control-plane', 'Healthy', ''],
    ['test-sh', 'kube-scheduler', 'control-plane', 'Healthy', ''],
    ['test-sh', 'kube-controller-manager', 'control-plane', 'Healthy', ''],
    ['test-sh', 'coredns', 'addon', 'Healthy', ''],
    ['dr-gz', 'kube-apiserver', 'control-plane', 'Healthy', ''],
    ['dr-gz', 'etcd', 'control-plane', 'Healthy', ''],
    ['dr-gz', 'kube-scheduler', 'control-plane', 'Healthy', ''],
    ['dr-gz', 'kube-controller-manager', 'control-plane', 'Healthy', ''],
  ];
  for (const c of comps) {
    await pool.query('INSERT INTO cluster_components (cluster_id, name, category, status, message) VALUES (?,?,?,?,?)',
      [cid[c[0]], c[1], c[2], c[3], c[4]]);
  }

  const rules = [
    ['节点 CPU 使用率过高', 'cpu_usage', 'node', '>', 90, 300, 'high', '行业调控系统', '硬件', '服务器宕机', 1],
    ['节点内存使用率过高', 'mem_usage', 'node', '>', 85, 300, 'high', '行业调控系统', '硬件', '服务器宕机', 1],
    ['节点磁盘使用率过高', 'disk_usage', 'node', '>', 90, 600, 'high', '行业调控系统', '硬件', '存储故障', 1],
    ['节点 NotReady', 'node_status', 'node', '>=', 1, 60, 'urgent', '行业调控系统', '硬件', '服务器宕机', 1],
    ['节点负载过高', 'load1', 'node', '>', 16, 300, 'normal', '行业调控系统', '硬件', '服务器宕机', 1],
  ];
  for (const r of rules) {
    await pool.query(
      'INSERT INTO alert_rules (name, metric, scope, operator, threshold, duration_sec, severity, category, mid_category, small_category, enabled, auto_ticket) VALUES (?,?,?,?,?,?,?,?,?,?,1,1)',
      r);
  }
  // 默认通知渠道（默认关闭，填好配置再启用）
  const chans = [
    ['企业微信-运维群', 'wecom', JSON.stringify({ webhook: '' }), 0, 'normal'],
    ['钉钉-运维群', 'dingtalk', JSON.stringify({ webhook: '', secret: '' }), 0, 'normal'],
    ['邮件-运维组', 'email', JSON.stringify({ host: 'smtp.example.com', port: 465, secure: true, user: '', pass: '', from: 'aiops@example.com', to: 'ops@example.com', fromName: 'AIOps告警' }), 0, 'high'],
  ];
  for (const c of chans) {
    await pool.query('INSERT INTO notify_channels (name, type, config, enabled, min_severity) VALUES (?,?,?,?,?)', c);
  }

  // Pod 测试数据（含异常）
  const podsSeed = [
    // 生产集群-北京（含多个异常）
    ['prod-bj', 'default', 'web-7d9f8c-abc12', 'k8s-node-01', 'Running', '1/1', 0, 'Running', ''],
    ['prod-bj', 'default', 'web-7d9f8c-def34', 'k8s-node-02', 'Running', '1/1', 1, 'Running', ''],
    ['prod-bj', 'default', 'api-server-5f7b9-x9k2m', 'k8s-node-01', 'Running', '0/1', 15, 'CrashLoopBackOff', 'CrashLoopBackOff'],
    ['prod-bj', 'default', 'worker-6c8d4-p3n7q', 'k8s-node-02', 'Running', '0/1', 9, 'CrashLoopBackOff', 'CrashLoopBackOff'],
    ['prod-bj', 'kube-system', 'coredns-6d8c4-abcde', 'k8s-node-01', 'Running', '1/1', 0, 'Running', ''],
    ['prod-bj', 'kube-system', 'calico-node-7xk2m', 'k8s-node-03', 'Running', '0/1', 4, 'CrashLoopBackOff', 'CrashLoopBackOff'],
    ['prod-bj', 'kube-system', 'kube-proxy-h8n4p', 'k8s-node-01', 'Running', '1/1', 0, 'Running', ''],
    ['prod-bj', 'monitoring', 'prometheus-0', 'k8s-node-02', 'Running', '1/1', 2, 'Running', ''],
    ['prod-bj', 'monitoring', 'grafana-9d7f6-zz11x', '', 'Pending', '0/1', 0, 'Pending', 'Unschedulable: 0/6 nodes available'],
    ['prod-bj', 'default', 'batch-job-2m4k8-qq88w', 'k8s-node-01', 'Succeeded', '0/1', 0, 'Succeeded', ''],
    ['prod-bj', 'default', 'legacy-app-old-1', 'k8s-node-02', 'Running', '0/1', 0, 'ImagePullBackOff', 'Back-off pulling image "registry.local/legacy:v1.2"'],
    // 测试集群-上海（1 个异常）
    ['test-sh', 'default', 'demo-app-5c8d9-m1n2b', 'k8s-node-01', 'Running', '1/1', 0, 'Running', ''],
    ['test-sh', 'default', 'demo-app-5c8d9-v3x4z', 'k8s-node-02', 'Running', '1/1', 0, 'Running', ''],
    ['test-sh', 'default', 'test-api-7f9b2-o5p6q', 'k8s-node-01', 'Running', '1/1', 3, 'Running', ''],
    ['test-sh', 'monitoring', 'test-agent-1', 'k8s-node-02', 'Running', '0/1', 7, 'OOMKilled', 'OOMKilled'],
    ['test-sh', 'kube-system', 'coredns-6d8c4-tst01', 'k8s-node-01', 'Running', '1/1', 0, 'Running', ''],
    // 灾备集群-广州（全正常）
    ['dr-gz', 'default', 'dr-app-8e2c1-a1b2c', 'k8s-node-01', 'Running', '1/1', 0, 'Running', ''],
    ['dr-gz', 'kube-system', 'coredns-6d8c4-dr001', 'k8s-node-01', 'Running', '1/1', 0, 'Running', ''],
    ['dr-gz', 'default', 'backup-agent-3k5m9-d4e5f', 'k8s-node-01', 'Running', '1/1', 1, 'Running', ''],
  ];
  for (const pd of podsSeed) {
    await pool.query(
      'INSERT INTO cluster_pods (cluster_id, namespace, name, node, phase, ready, restarts, status, reason) VALUES (?,?,?,?,?,?,?,?,?)',
      [cid[pd[0]], pd[1], pd[2], pd[3], pd[4], pd[5], pd[6], pd[7], pd[8]]
    );
  }

  console.log('已播种集群监控数据（3 集群 / 11 节点 / 15 组件 / 5 规则 / 3 通知渠道）');
}

/* ---------- Pod 测试数据：独立播种（现有库也能补） ---------- */
async function seedPodsIfEmpty() {
  const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM cluster_pods');
  if (c > 0) return;
  const [cl] = await pool.query('SELECT id, code FROM clusters');
  const cid = {};
  cl.forEach((r) => { cid[r.code] = r.id; });
  if (!cid['prod-bj']) return;
  const podsSeed = [
    ['prod-bj', 'default', 'web-7d9f8c-abc12', 'k8s-node-01', 'Running', '1/1', 0, 'Running', ''],
    ['prod-bj', 'default', 'web-7d9f8c-def34', 'k8s-node-02', 'Running', '1/1', 1, 'Running', ''],
    ['prod-bj', 'default', 'api-server-5f7b9-x9k2m', 'k8s-node-01', 'Running', '0/1', 15, 'CrashLoopBackOff', 'CrashLoopBackOff'],
    ['prod-bj', 'default', 'worker-6c8d4-p3n7q', 'k8s-node-02', 'Running', '0/1', 9, 'CrashLoopBackOff', 'CrashLoopBackOff'],
    ['prod-bj', 'kube-system', 'coredns-6d8c4-abcde', 'k8s-node-01', 'Running', '1/1', 0, 'Running', ''],
    ['prod-bj', 'kube-system', 'calico-node-7xk2m', 'k8s-node-03', 'Running', '0/1', 4, 'CrashLoopBackOff', 'CrashLoopBackOff'],
    ['prod-bj', 'kube-system', 'kube-proxy-h8n4p', 'k8s-node-01', 'Running', '1/1', 0, 'Running', ''],
    ['prod-bj', 'monitoring', 'prometheus-0', 'k8s-node-02', 'Running', '1/1', 2, 'Running', ''],
    ['prod-bj', 'monitoring', 'grafana-9d7f6-zz11x', '', 'Pending', '0/1', 0, 'Pending', 'Unschedulable: 0/6 nodes available'],
    ['prod-bj', 'default', 'batch-job-2m4k8-qq88w', 'k8s-node-01', 'Succeeded', '0/1', 0, 'Succeeded', ''],
    ['prod-bj', 'default', 'legacy-app-old-1', 'k8s-node-02', 'Running', '0/1', 0, 'ImagePullBackOff', 'Back-off pulling image "registry.local/legacy:v1.2"'],
    ['test-sh', 'default', 'demo-app-5c8d9-m1n2b', 'k8s-node-01', 'Running', '1/1', 0, 'Running', ''],
    ['test-sh', 'default', 'demo-app-5c8d9-v3x4z', 'k8s-node-02', 'Running', '1/1', 0, 'Running', ''],
    ['test-sh', 'default', 'test-api-7f9b2-o5p6q', 'k8s-node-01', 'Running', '1/1', 3, 'Running', ''],
    ['test-sh', 'monitoring', 'test-agent-1', 'k8s-node-02', 'Running', '0/1', 7, 'OOMKilled', 'OOMKilled'],
    ['test-sh', 'kube-system', 'coredns-6d8c4-tst01', 'k8s-node-01', 'Running', '1/1', 0, 'Running', ''],
    ['dr-gz', 'default', 'dr-app-8e2c1-a1b2c', 'k8s-node-01', 'Running', '1/1', 0, 'Running', ''],
    ['dr-gz', 'kube-system', 'coredns-6d8c4-dr001', 'k8s-node-01', 'Running', '1/1', 0, 'Running', ''],
    ['dr-gz', 'default', 'backup-agent-3k5m9-d4e5f', 'k8s-node-01', 'Running', '1/1', 1, 'Running', ''],
  ];
  for (const pd of podsSeed) {
    if (!cid[pd[0]]) continue;
    await pool.query(
      'INSERT INTO cluster_pods (cluster_id, namespace, name, node, phase, ready, restarts, status, reason) VALUES (?,?,?,?,?,?,?,?,?)',
      [cid[pd[0]], pd[1], pd[2], pd[3], pd[4], pd[5], pd[6], pd[7], pd[8]]
    );
  }
  console.log('已播种 Pod 测试数据（19 个，含 5 个异常）');
}

/* ---------- 通知渠道：独立播种 ---------- */
async function seedNotifyIfEmpty() {
  const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM notify_channels');
  if (c > 0) return;
  const chans = [
    ['企业微信-运维群', 'wecom', JSON.stringify({ webhook: '' }), 0, 'normal'],
    ['钉钉-运维群', 'dingtalk', JSON.stringify({ webhook: '', secret: '' }), 0, 'normal'],
    ['邮件-运维组', 'email', JSON.stringify({ host: 'smtp.example.com', port: 465, secure: true, user: '', pass: '', from: 'aiops@example.com', to: 'ops@example.com', fromName: 'AIOps告警' }), 0, 'high'],
  ];
  for (const c of chans) {
    await pool.query('INSERT INTO notify_channels (name, type, config, enabled, min_severity) VALUES (?,?,?,?,?)', c);
  }
  console.log('已播种通知渠道（3 个，默认关闭）');
}

/* ============================== 图形验证码 ==============================
   自绘 SVG，无需第三方库；验证码存内存并带过期时间，一次性使用。
======================================================================== */
const CAPTCHAS = new Map();
const CAPTCHA_TTL = 5 * 60 * 1000;      // 5 分钟有效
const CAPTCHA_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 去掉易混字符

function newCaptcha() {
  let code = '';
  for (let i = 0; i < 4; i++) code += CAPTCHA_CHARS[Math.floor(Math.random() * CAPTCHA_CHARS.length)];
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  CAPTCHAS.set(id, { code, exp: Date.now() + CAPTCHA_TTL });
  return { id, code };
}

function captchaSvg(code) {
  const W = 132, H = 44;
  const rnd = (a, b) => a + Math.random() * (b - a);
  let bg = `<rect width="${W}" height="${H}" fill="#0b1220"/>`;
  // 干扰线
  let lines = '';
  for (let i = 0; i < 5; i++) {
    lines += `<line x1="${rnd(0, W).toFixed(1)}" y1="${rnd(0, H).toFixed(1)}" x2="${rnd(0, W).toFixed(1)}" y2="${rnd(0, H).toFixed(1)}" stroke="hsl(${(i * 67) % 360},80%,60%)" stroke-width="1" opacity="0.45"/>`;
  }
  // 噪点
  let dots = '';
  for (let i = 0; i < 28; i++) {
    dots += `<circle cx="${rnd(0, W).toFixed(1)}" cy="${rnd(0, H).toFixed(1)}" r="1" fill="#67e8f9" opacity="0.5"/>`;
  }
  // 字符
  let text = '';
  const colors = ['#22d3ee', '#38bdf8', '#a78bfa', '#f472b6', '#34d399'];
  for (let i = 0; i < code.length; i++) {
    const x = 18 + i * 27 + rnd(-3, 3);
    const y = 31 + rnd(-4, 4);
    const rot = rnd(-24, 24).toFixed(1);
    const col = colors[i % colors.length];
    text += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${col}" font-size="${rnd(22, 27).toFixed(0)}" font-family="Consolas,monospace" font-weight="700" transform="rotate(${rot} ${x.toFixed(1)} ${y.toFixed(1)})">${code[i]}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${bg}${lines}${dots}${text}</svg>`;
}

/* 定期清理过期验证码 */
const captchaSweeper = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of CAPTCHAS) if (!v || v.exp < now) CAPTCHAS.delete(k);
}, 5 * 60 * 1000);
if (captchaSweeper.unref) captchaSweeper.unref();

/* 校验验证码（一次性：校验后立即失效）*/
function checkCaptcha(id, code) {
  const c = CAPTCHAS.get(String(id || ''));
  if (!c) return false;
  CAPTCHAS.delete(String(id || ''));
  if (c.exp < Date.now()) return false;
  return String(code || '').trim().toUpperCase() === c.code;
}

/* ============================== 会话 ============================== */

const SESSIONS = new Map();
const SESSION_TTL = Number(process.env.SESSION_TTL || 8 * 3600 * 1000);
/* Agent 采集镜像：可通过 AGENT_IMAGE 覆盖（国内可用镜像源） */
const AGENT_IMAGE = process.env.AGENT_IMAGE || 'alpine/k8s:1.29.4';

/* 会话持久化：内存 Map 作一级缓存 + sys_sessions 表作持久层。
   本环境的后台进程会被定期回收（见 keepalive 日志，约每分钟一次），
   纯内存 Map 会导致每次重启后所有登录态丢失、用户被强制登出。 */
function sqlDatetime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* 知识库分类播种：扫描 kb 表已有分类，补齐到 kb_categories */
async function seedKbCategories() {
  try {
    const [rows] = await pool.query('SELECT DISTINCT category FROM kb WHERE category IS NOT NULL AND category <> ""');
    for (const r of rows) {
      await pool.query('INSERT IGNORE INTO kb_categories (name, sort) VALUES (?, 0)', [r.category]);
    }
  } catch (e) { console.warn('[KB] 播种分类失败:', e.message); }
}

/* 资源分类字段定义（依据《配置信息属性.xlsm》）*/
/* 元素: [key, label, type, required, inList, optionsSource] */
const RES_FIELD_SEED = {
  '物理服务器': {
    kind: 'asset',
    fields: [
      ['unit', '单位名称', 'text', 0, 0, '@units'],
      ['unit_code', '单位代码', 'text', 0, 0, ''],
      ['parent_unit', '上级单位', 'text', 0, 0, ''],
      ['code', '资产编号', 'text', 0, 1, ''],
      ['serial', '序列号', 'text', 0, 0, ''],
      ['brand', '设备品牌', 'text', 0, 0, '设备型号库.brand'],
      ['model', '设备型号', 'text', 0, 0, '设备型号库.model'],
      ['cpu_cores', 'CPU核数', 'number', 0, 1, ''],
      ['gpu_cores', 'GPU核数', 'number', 0, 0, ''],
      ['mem', '内存容量', 'number', 0, 1, ''],
      ['disk', '存储容量', 'number', 0, 1, ''],
      ['biz_system', '所属业务系统', 'text', 0, 0, ''],
      ['room', '机房名称', 'text', 0, 1, ''],
      ['deploy_pos', '部署位置', 'text', 0, 0, ''],
      ['cloud_name', '云平台管理名称', 'text', 0, 0, ''],
      ['cloud_ip', '云平台管理IP', 'text', 0, 0, ''],
      ['ip', '主机IP', 'text', 0, 1, ''],
      ['bmc_ip', 'BMC/HDM_IP', 'text', 0, 0, ''],
      ['biz_system_1', '所属业务系统', 'text', 0, 0, ''],
      ['uplink_ip', '上联设备IP', 'text', 0, 0, ''],
      ['status', '运行状态', 'text', 0, 1, ''],
      ['owner', '责任人', 'text', 0, 1, ''],
      ['purchase_date', '采购日期', 'date', 0, 0, ''],
      ['enable_date', '启用日期', 'date', 0, 0, ''],
      ['warranty_end', '过保日期', 'date', 0, 0, ''],
    ],
  },
  '存储设备': {
    kind: 'asset',
    fields: [
      ['unit', '单位名称', 'text', 0, 0, '@units'],
      ['unit_code', '单位代码', 'text', 0, 0, ''],
      ['parent_unit', '上级单位', 'text', 0, 0, ''],
      ['code', '资产编号', 'text', 0, 1, ''],
      ['serial', '序列号', 'text', 0, 0, ''],
      ['brand', '设备品牌', 'text', 0, 0, '设备型号库.brand'],
      ['model', '设备型号', 'text', 0, 0, '设备型号库.model'],
      ['total_capacity', '存储总容量', 'number', 0, 1, ''],
      ['free_capacity', '存储可用容量', 'number', 0, 1, ''],
      ['raid', 'RAID配置', 'text', 0, 1, ''],
      ['pool_name', '存储池名称', 'text', 0, 0, ''],
      ['room', '机房名称', 'text', 0, 1, ''],
      ['deploy_pos', '部署位置', 'text', 0, 0, ''],
      ['cloud_name', '云平台管理名称', 'text', 0, 0, ''],
      ['cloud_ip', '云平台管理IP', 'text', 0, 0, ''],
      ['mgmt_ip', '设备管理IP', 'text', 0, 0, ''],
      ['fcv_ip', 'FCV登录IP', 'text', 0, 0, ''],
      ['biz_system', '所属业务系统', 'text', 0, 0, ''],
      ['uplink_ip', '上联设备IP', 'text', 0, 0, ''],
      ['status', '运行状态', 'text', 0, 1, ''],
      ['owner', '责任人', 'text', 0, 1, ''],
      ['purchase_date', '采购日期', 'date', 0, 0, ''],
      ['enable_date', '启用日期', 'date', 0, 0, ''],
      ['warranty_end', '过保日期', 'date', 0, 0, ''],
    ],
  },
  '网络设备': {
    kind: 'asset',
    fields: [
      ['unit', '单位名称', 'text', 0, 0, '@units'],
      ['unit_code', '单位代码', 'text', 0, 0, ''],
      ['parent_unit', '上级单位', 'text', 0, 0, ''],
      ['code', '资产编号', 'text', 0, 1, ''],
      ['serial', '序列号', 'text', 0, 0, ''],
      ['brand', '设备品牌', 'text', 0, 0, '设备型号库.brand'],
      ['model', '设备型号', 'text', 0, 0, '设备型号库.model'],
      ['port_count', '端口数量', 'number', 0, 1, ''],
      ['firmware', '固件版本', 'text', 0, 1, ''],
      ['config_file', '配置文件', 'text', 0, 0, ''],
      ['console_ip', 'ConsleIP', 'text', 0, 0, ''],
      ['mgmt_ip', '管理IP', 'text', 0, 1, ''],
      ['region', '所属区域', 'text', 0, 0, ''],
      ['biz_system', '所属业务系统', 'text', 0, 0, ''],
      ['uplink_ip', '上联设备IP', 'text', 0, 0, ''],
      ['room', '机房名称', 'text', 0, 1, ''],
      ['deploy_pos', '部署位置', 'text', 0, 0, ''],
      ['status', '运行状态', 'text', 0, 1, ''],
      ['owner', '责任人', 'text', 0, 1, ''],
      ['purchase_date', '采购日期', 'date', 0, 0, ''],
      ['enable_date', '启用日期', 'date', 0, 0, ''],
      ['warranty_end', '过保日期', 'date', 0, 0, ''],
    ],
  },
  '虚拟机': {
    kind: 'asset',
    fields: [
      ['unit', '单位名称', 'text', 0, 0, '@units'],
      ['unit_code', '单位代码', 'text', 0, 0, ''],
      ['parent_unit', '上级单位', 'text', 0, 0, ''],
      ['biz_system', '业务系统名称', 'text', 0, 0, ''],
      ['biz_node', '业务节点', 'text', 0, 0, ''],
      ['ip', '虚拟机IP', 'text', 0, 1, ''],
      ['vm_name', '虚拟机名称', 'text', 0, 1, ''],
      ['os_name', '操作系统名称', 'text', 0, 1, '软件信息库.sw_name'],
      ['os_version', '操作系统版本', 'text', 0, 1, ''],
      ['purpose', '主要用途', 'text', 0, 0, ''],
      ['cpu', 'CPU', 'number', 0, 1, ''],
      ['mem', '内存', 'number', 0, 1, ''],
      ['disk', '硬盘', 'number', 0, 1, ''],
      ['uplink_ip', '上联设备IP', 'text', 0, 0, ''],
      ['cloud_name', '云平台管理名称', 'text', 0, 0, ''],
      ['cloud_ip', '云平台管理IP', 'text', 0, 0, ''],
      ['snapshot', '快照/备份', 'text', 0, 0, ''],
      ['status', '运行状态', 'text', 0, 1, ''],
      ['owner', '责任人', 'text', 0, 1, ''],
      ['create_date', '创建日期', 'date', 0, 0, ''],
      ['enable_date', '启用日期', 'date', 0, 0, ''],
    ],
  },
  '设备-软件关联': {
    kind: 'asset',
    fields: [
      ['unit', '单位名称', 'text', 0, 0, '@units'],
      ['unit_code', '单位代码', 'text', 0, 0, ''],
      ['parent_unit', '上级单位', 'text', 0, 0, ''],
      ['biz_system', '业务系统名称', 'text', 0, 0, ''],
      ['biz_node', '业务节点', 'text', 0, 0, ''],
      ['host_ip', '主机/设备IP地址', 'text', 0, 1, ''],
      ['sw_category', '软件分类名称', 'text', 0, 1, '软件分类.lvl1'],
      ['sw_subcategory', '子类类别', 'text', 0, 0, '软件分类.lvl2'],
      ['sw_name', '软件名称', 'text', 0, 1, '软件信息库.sw_name'],
      ['sw_version', '软件版本', 'text', 0, 1, '软件信息库.sw_ver'],
      ['gi_release', '工互发布版本号', 'text', 0, 0, ''],
      ['deploy_node', '软件部署的服务器节点名称', 'text', 0, 0, ''],
      ['service_addr', '对外服务地址', 'text', 0, 1, ''],
      ['service_func', '对外提供的服务功能', 'text', 0, 0, ''],
      ['access_port', '访问方式与端口', 'text', 0, 0, ''],
      ['status', '运行状态', 'text', 0, 1, ''],
      ['owner', '责任人', 'text', 0, 1, ''],
      ['create_date', '创建日期', 'date', 0, 0, ''],
      ['enable_date', '启用日期', 'date', 0, 0, ''],
      ['warranty_end', '过保日期', 'date', 0, 0, ''],
      ['maint_vendor', '维保服务商', 'text', 0, 0, ''],
      ['rel_system', '关联系统名称', 'text', 0, 0, ''],
      ['rel_vendor', '关联系统供应商名称', 'text', 0, 0, ''],
    ],
  },
  '端侧设备配置': {
    kind: 'asset',
    fields: [
      ['unit', '单位名称', 'text', 0, 0, '@units'],
      ['unit_code', '单位代码', 'text', 0, 0, ''],
      ['parent_unit', '上级单位', 'text', 0, 0, ''],
      ['biz_system', '业务系统名称', 'text', 0, 0, ''],
      ['line_name', '产线名称', 'text', 0, 0, ''],
      ['dev_category', '设备类别', 'text', 0, 1, ''],
      ['dev_name', '设备名称', 'text', 0, 1, ''],
      ['brand', '设备品牌', 'text', 0, 1, '设备型号库.brand'],
      ['model', '设备型号', 'text', 0, 1, '设备型号库.model'],
      ['ip', 'IP地址', 'text', 0, 1, ''],
      ['purpose', '用途', 'text', 0, 0, ''],
      ['serial', '序列号', 'text', 0, 0, ''],
      ['purchase_date', '采购日期', 'date', 0, 0, ''],
      ['enable_date', '启用日期', 'date', 0, 0, ''],
      ['warranty_end', '过保日期', 'date', 0, 0, ''],
      ['dev_vendor', '设备供应商', 'text', 0, 0, ''],
      ['hw_maint_vendor', '硬件维护服务商', 'text', 0, 0, ''],
      ['components', '组件/配件', 'text', 0, 0, ''],
      ['status', '运行状态', 'text', 0, 1, ''],
      ['owner', '责任人', 'text', 0, 1, ''],
    ],
  },
  '工互传输注册信息': {
    kind: 'asset',
    fields: [
      ['unit', '单位名称（备案单位）', 'text', 0, 0, '@units'],
      ['unit_code', '单位代码', 'text', 0, 0, ''],
      ['parent_unit', '上级单位', 'text', 0, 0, ''],
      ['biz_system', '业务系统名称', 'text', 0, 0, ''],
      ['gi_app_name', '工互注册应用名称', 'text', 0, 1, ''],
      ['app_id', '应用ID', 'text', 0, 1, ''],
      ['edge_vip', '边侧VIP_IP', 'text', 0, 1, ''],
      ['edge_transfer_url', '边侧数据传输登录地址', 'text', 0, 0, ''],
      ['channel_key', '传输通道应用key', 'text', 0, 0, ''],
      ['channel_secret', '传输通道Secret', 'text', 0, 0, ''],
      ['kafka_addr', '边侧kafka连接地址', 'text', 0, 0, ''],
      ['contact', '联系人', 'text', 0, 1, ''],
      ['contact_phone', '联系电话', 'text', 0, 1, ''],
      ['implementer', '应用系统实施方', 'text', 0, 0, ''],
    ],
  },
  '软件信息库': {
    kind: 'library',
    fields: [
      ['sw_code', '软件信息编码', 'text', 0, 1, ''],
      ['sw_cat1', '软件类别', 'text', 0, 0, ''],
      ['sw_cat2', '软件子类类别', 'text', 0, 1, ''],
      ['sw_name', '软件名称', 'text', 0, 1, ''],
      ['sw_ver', '软件版本号', 'text', 0, 1, ''],
      ['gi_release', '工互发布版本号', 'text', 0, 0, ''],
      ['release_date', '发布日期', 'date', 0, 1, ''],
      ['vendor', '开发商', 'text', 0, 1, ''],
    ],
  },
  '设备型号库': {
    kind: 'library',
    fields: [
      ['model_code', '设备型号库编码', 'text', 0, 1, ''],
      ['dev_type', '设备类型', 'text', 0, 1, ''],
      ['dev_name', '设备名称', 'text', 0, 1, ''],
      ['brand', '设备品牌', 'text', 0, 1, ''],
      ['model', '设备型号', 'text', 0, 1, ''],
      ['spec_no', '规格号/产品号', 'text', 0, 1, ''],
      ['key_config', '关键配置', 'text', 0, 0, ''],
      ['manual', '知识手册', 'text', 0, 0, ''],
      ['attachment', '附件', 'text', 0, 0, ''],
    ],
  },
  '软件分类': {
    kind: 'library',
    fields: [
      ['lvl1', '一级', 'text', 0, 1, ''],
      ['lvl2', '二级', 'text', 0, 1, ''],
      ['lvl3', '三级', 'text', 0, 1, ''],
      ['biz_system', '业务系统名称', 'text', 0, 1, ''],
    ],
  },
};
/* 资源分类（页签）——后端权威定义 */
const RES_CATEGORIES = ['物理服务器', '存储设备', '网络设备', '虚拟机', '端侧设备配置', '设备-软件关联', '工互传输注册信息'];

/* 审核状态：一线新增 → 待审核；二线审核 → 已通过 / 已驳回 */
const AUDIT_STATUS = { pending: '待审核', approved: '已通过', rejected: '已驳回' };
const AUDIT_TAG = { pending: 'warning', approved: 'success', rejected: 'danger' };

/* 资产审核流：按当前审核状态给出可执行动作（服务端权威） */
const ASSET_AUDIT_FLOW = {
  pending: [
    { action: 'approve', to: 'approved', label: '审核通过', perm: 'asset.audit' },
    { action: 'reject', to: 'rejected', label: '驳回', perm: 'asset.audit' },
  ],
  approved: [],
  rejected: [],
};

function assetAuditActions(user, a) {
  const st = a.audit_status || 'pending';
  const list = ASSET_AUDIT_FLOW[st] || [];
  return list.filter((t) => hasPerm(user, t.perm)).map((t) => ({ action: t.action, label: t.label }));
}

/* 字段单位（依据用户确认：容量=GB，CPU/GPU=核）*/
const FIELD_UNITS = {
  mem: 'GB', disk: 'GB', total_capacity: 'GB', free_capacity: 'GB',
  '内存': 'GB', '硬盘': 'GB', '内存容量': 'GB', '存储容量': 'GB',
  cpu_cores: '核', gpu_cores: '核', cpu: '核', 'CPU核数': '核', 'GPU核数': '核', 'CPU': '核',
  port_count: '个', '端口数量': '个',
};

/* 给 res_fields 补 unit 列并回填（幂等）*/
async function migrateResFieldUnit() {
  try {
    const [cols] = await pool.query("SHOW COLUMNS FROM res_fields LIKE 'res_unit'");
    if (!cols.length) {
      await pool.query("ALTER TABLE res_fields ADD COLUMN res_unit VARCHAR(16) DEFAULT ''");
      console.log('[RES] 已添加 res_unit 列');
    }
    for (const [k, u] of Object.entries(FIELD_UNITS)) {
      await pool.query('UPDATE res_fields SET res_unit = ? WHERE field_key = ?', [u, k]);
    }
  } catch (e) { console.warn('[RES] 单位迁移失败:', e.message); }
}

/* 资源分类 + 字段定义播种（幂等：库空则写入，已存在则按 category 补齐新字段） */
async function seedResFields() {
  try {
    let n = 0;
    for (const [cat, def] of Object.entries(RES_FIELD_SEED)) {
      await pool.query(
        'INSERT INTO res_categories (name, kind, sort) VALUES (?,?,?) ON DUPLICATE KEY UPDATE kind = VALUES(kind)',
        [cat, def.kind, n++ * 10]
      );
      let i = 0;
      for (const [key, label, ftype, req, inlist, src] of def.fields) {
        await pool.query(
          'INSERT INTO res_fields (category, field_key, label, ftype, required, in_list, options_source, sort) VALUES (?,?,?,?,?,?,?,?) ' +
          'ON DUPLICATE KEY UPDATE label = VALUES(label), ftype = VALUES(ftype), in_list = VALUES(in_list), options_source = VALUES(options_source), sort = VALUES(sort)',
          [cat, key, label, ftype, req, inlist, src || '', i++]
        );
      }
    }
    const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM res_fields');
    console.log(`[RES] 字段定义已就绪，共 ${c} 条`);
  } catch (e) { console.warn('[RES] 字段播种失败:', e.message); }
}

/* 资产扩展字段迁移（幂等）：容量/核数/机房/审核状态/软删除 */
async function migrateAssetAudit() {
  const cols = [
    ['res_category', "VARCHAR(32) DEFAULT '物理服务器'"],
    ['unit', "VARCHAR(128) DEFAULT ''"],
    ['res_unit', "VARCHAR(16) DEFAULT ''"],
    ['mem_gb', 'INT DEFAULT 0'],
    ['disk_gb', 'INT DEFAULT 0'],
    ['cpu_cores', 'INT DEFAULT 0'],
    ['room', "VARCHAR(128) DEFAULT ''"],
    ['audit_status', "VARCHAR(16) DEFAULT 'pending'"],
    ['audit_by', "VARCHAR(64) DEFAULT ''"],
    ['audit_at', 'DATETIME NULL'],
    ['audit_note', "VARCHAR(255) DEFAULT ''"],
    ['deleted_at', 'DATETIME NULL'],
  ];
  try {
    for (const [name, def] of cols) {
      const [c] = await pool.query(`SHOW COLUMNS FROM assets LIKE '${name}'`);
      if (!c.length) {
        await pool.query(`ALTER TABLE assets ADD COLUMN ${name} ${def}`);
        console.log(`[ASSET] 已添加列 ${name}`);
      }
    }
    // 历史数据：按 type 归类到资源分类；已存在的记录默认视为已通过（避免误挂待审核）
    await pool.query("UPDATE assets SET res_category = '存储设备' WHERE type = '存储设备' AND (res_category IS NULL OR res_category = '物理服务器')");
    await pool.query("UPDATE assets SET res_category = '网络设备' WHERE type = '网络设备' AND (res_category IS NULL OR res_category = '物理服务器')");
    await pool.query("UPDATE assets SET res_category = '虚拟机' WHERE type = '应用系统' AND (res_category IS NULL OR res_category = '物理服务器')");
    await pool.query("UPDATE assets SET audit_status = 'approved' WHERE created_at < NOW() AND (audit_status IS NULL OR audit_status = 'pending')");
  } catch (e) { console.warn('[ASSET] 审核字段迁移失败:', e.message); }
}

/* 角色权限迁移：roles 表已存在时，ROLE_SEED 的改动不会自动生效。
   这里按 role_key 幂等补齐新增权限（一线 asset.manage、二线 asset.audit）。 */
async function migrateRolePerms() {
  try {
    const want = { ops: ['asset.manage'], tech: ['asset.audit'] };
    const [rows] = await pool.query('SELECT id, role_key, perms FROM roles WHERE builtin = 1');
    for (const r of rows) {
      const add = want[r.role_key];
      if (!add) continue;
      let perms = [];
      try { perms = JSON.parse(r.perms || '[]'); } catch (e) { perms = []; }
      let changed = false;
      for (const p of add) { if (!perms.includes(p)) { perms.push(p); changed = true; } }
      if (changed) {
        await pool.query('UPDATE roles SET perms = ? WHERE id = ?', [JSON.stringify(perms), r.id]);
        console.log(`[ROLE] ${r.role_key} 补齐权限: ${add.join(',')}`);
      }
    }
  } catch (e) { console.warn('[ROLE] 权限迁移失败:', e.message); }
}

/* 资产责任人关联：assets.owner_id -> sys_users.id。
   历史数据 owner 存的是姓名，这里按姓名回填一次（幂等）。 */
async function migrateAssetOwner() {
  try {
    const [cols] = await pool.query("SHOW COLUMNS FROM assets LIKE 'owner_id'");
    if (!cols.length) {
      await pool.query('ALTER TABLE assets ADD COLUMN owner_id INT NULL');
      console.log('[ASSET] 已添加 owner_id 列');
    }
    // 按姓名回填（仅回填仍为空的）
    const [users] = await pool.query('SELECT id, name FROM sys_users');
    const byName = new Map(users.map((u) => [u.name, u.id]));
    const [rows] = await pool.query("SELECT id, owner FROM assets WHERE owner_id IS NULL AND owner IS NOT NULL AND owner <> '' AND owner <> '-'");
    let n = 0;
    for (const a of rows) {
      const uid = byName.get(a.owner);
      if (uid) { await pool.query('UPDATE assets SET owner_id = ? WHERE id = ?', [uid, a.id]); n++; }
    }
    if (n) console.log(`[ASSET] 已回填 ${n} 条资产责任人关联`);
  } catch (e) { console.warn('[ASSET] 责任人迁移失败:', e.message); }
}

/* 资产软件播种：给若干示例设备写入软件清单（仅当该资产尚无任何软件） */
async function seedAssetSoftware() {
  try {
    const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM asset_software');
    if (c > 0) return; // 已有数据则不覆盖
    const seed = [
      ['srv-app-03', [
        ['Nginx', '1.24.0', 'F5', '中间件'],
        ['JDK', '17.0.9', 'Oracle', '运行时'],
        ['Tomcat', '10.1.16', 'Apache', '中间件'],
        ['Prometheus Node Exporter', '1.7.0', 'Prometheus', '监控'],
      ]],
      ['srv-db-01', [
        ['MySQL', '8.0.35', 'Oracle', '数据库'],
        ['Redis', '7.2.3', 'Redis', '数据库'],
        ['Percona Toolkit', '3.5.5', 'Percona', '工具'],
      ]],
      ['app-oa', [
        ['OA 协同办公系统', 'v5.2.1', '自研', '业务系统'],
        ['Nginx', '1.24.0', 'F5', '中间件'],
      ]],
      ['app-fin', [
        ['财务管理系统', 'v3.8.0', '自研', '业务系统'],
        ['JDK', '11.0.21', 'Oracle', '运行时'],
        ['MySQL Client', '8.0.35', 'Oracle', '工具'],
      ]],
      ['mail-01', [
        ['Postfix', '3.7.4', 'Wietse Venema', '邮件'],
        ['Dovecot', '2.3.20', 'Dovecot', '邮件'],
      ]],
      ['pc-new-07', [
        ['Chrome', '131.0.6778', 'Google', '办公'],
        ['WPS Office', '12.1.0', '金山', '办公'],
        ['企业微信', '4.1.26', '腾讯', '办公'],
      ]],
    ];
    let n = 0;
    for (const [code, softs] of seed) {
      const [ar] = await pool.query('SELECT id FROM assets WHERE code = ?', [code]);
      if (!ar.length) continue;
      for (const [name, version, vendor, category] of softs) {
        await pool.query(
          'INSERT INTO asset_software (asset_id, name, version, vendor, category) VALUES (?,?,?,?,?)',
          [ar[0].id, name, version, vendor, category]
        );
        n++;
      }
    }
    if (n) console.log(`[ASSET] 已播种 ${n} 条软件记录`);
  } catch (e) { console.warn('[ASSET] 软件播种失败:', e.message); }
}

/* 角色：从数据库加载到运行时对象 */
async function loadRoles() {
  const [rows] = await pool.query('SELECT * FROM roles ORDER BY sort, id');
  const obj = {};
  for (const r of rows) {
    let perms = [];
    try { perms = JSON.parse(r.perms || '[]'); } catch (e) { perms = []; }
    obj[r.role_key] = {
      id: r.id, name: r.name, desc: r.descr, group: r.group_name,
      perms, builtin: r.builtin === 1, sort: r.sort,
    };
  }
  ROLES = obj;
}

/* 角色播种：库为空时写入内置四个角色（管理员/技术支持/一线运维/普通用户） */
async function seedRoles() {
  const seeds = Object.entries(ROLE_SEED).map(([k, v], i) => ({
    key: k, name: v.name, desc: v.desc || '', group: v.group || '',
    perms: v.perms || [], sort: (i + 1) * 10,
  }));
  for (const r of seeds) {
    await pool.query(
      'INSERT IGNORE INTO roles (role_key, name, descr, group_name, perms, builtin, sort) VALUES (?,?,?,?,?,?,?)',
      [r.key, r.name, r.desc, r.group, JSON.stringify(r.perms), 1, r.sort]
    );
  }
  await loadRoles();
}

/* 部门播种：扫描 sys_users 已有 dept 值，补齐到 departments */
async function seedDepartments() {
  try {
    const [rows] = await pool.query("SELECT DISTINCT dept FROM sys_users WHERE dept IS NOT NULL AND dept <> ''");
    for (const r of rows) {
      await pool.query('INSERT IGNORE INTO departments (name, sort) VALUES (?, 0)', [r.dept]);
    }
  } catch (e) { console.warn('[DEPT] 播种部门失败:', e.message); }
}

/* 启动时从库里恢复未过期会话，避免重启把在线用户踢下线 */
async function loadSessions() {
  try {
    const [rows] = await pool.query('SELECT token, username, expires_at FROM sys_sessions');
    let n = 0;
    for (const r of rows) {
      const exp = new Date(r.expires_at).getTime();
      if (exp > Date.now()) { SESSIONS.set(r.token, { username: r.username, exp }); n++; }
    }
    if (n) console.log(`[SESSION] 已从数据库恢复 ${n} 个会话`);
  } catch (e) { console.warn('[SESSION] 恢复会话失败:', e.message); }
}

/* 定期清扫：清内存过期项 + 删库中过期行 */
const sessionSweeper = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of SESSIONS) {
    if (!v || v.exp < now) SESSIONS.delete(k);
  }
  if (pool) pool.query('DELETE FROM sys_sessions WHERE expires_at < NOW()').catch(() => {});
}, 10 * 60 * 1000);
if (sessionSweeper.unref) sessionSweeper.unref();

async function currentUser(req) {
  const h = req.headers['authorization'] || '';
  const token = String(h.replace(/^Bearer\s+/i, '')).trim() || req.headers['x-token'] || '';
  if (!token) return null;

  let sess = SESSIONS.get(token);
  // 缓存未命中（含进程刚重启）：回源数据库
  if (!sess) {
    try {
      const [rs] = await pool.query('SELECT username, expires_at FROM sys_sessions WHERE token = ?', [token]);
      const r = rs[0];
      if (!r) return null;
      const exp = new Date(r.expires_at).getTime();
      if (exp < Date.now()) return null;
      sess = { username: r.username, exp };
      SESSIONS.set(token, sess); // 回填缓存
    } catch (_) { return null; }
  }
  if (!sess || sess.exp < Date.now()) { SESSIONS.delete(token); return null; }
  const [rows] = await pool.query('SELECT * FROM sys_users WHERE username = ?', [sess.username]);
  const u = rows[0];
  if (!u || u.active === 0) return null;
  return await withPerms(u);
}

/* ============================== 审计日志 ============================== */

/* 第二梯队优化：审计日志改为「内存缓冲 + 批量落库」。
   原实现每条审计都同步 INSERT，在高并发写入路径上增加一次往返；
   改为入队即返回，后台每 1s（或满 100 条）批量 INSERT。
   退出前强制 flush，尽量不丢日志。 */
const AUDIT_QUEUE = [];
const AUDIT_BATCH = 100;
let auditFlushing = false;

function enqueueAudit(row) {
  AUDIT_QUEUE.push(row);
  if (AUDIT_QUEUE.length >= AUDIT_BATCH) flushAudit();
}

async function flushAudit() {
  if (auditFlushing || !AUDIT_QUEUE.length || !pool) return;
  auditFlushing = true;
  const batch = AUDIT_QUEUE.splice(0, AUDIT_QUEUE.length);
  try {
    const vals = [];
    const args = [];
    for (const r of batch) {
      vals.push('(?,?,?,?,?,?,?,?)');
      args.push(r.username, r.name, r.role, r.action, r.module, r.target, r.detail, r.ip);
    }
    await pool.query(
      `INSERT INTO audit_logs (username, name, role, action, module, target, detail, ip) VALUES ${vals.join(',')}`,
      args
    );
  } catch (_) { /* 日志失败不影响主流程 */ }
  auditFlushing = false;
}

const auditTimer = setInterval(flushAudit, 1000);
if (auditTimer.unref) auditTimer.unref();

async function flushAuditSync() {
  clearInterval(auditTimer);
  auditFlushing = false;
  await flushAudit();
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { flushAuditSync().finally(() => process.exit(0)); });
}

async function audit(user, action, module, target, detail, req) {
  try {
    const ip = (req && (req.headers['x-forwarded-for'] || req.socket.remoteAddress)) || '';
    enqueueAudit({
      username: user ? user.username : '',
      name: user ? user.name : '',
      role: user ? user.role : '',
      action, module,
      target: String(target || '').slice(0, 191),
      detail: String(detail || '').slice(0, 255),
      ip: String(ip).slice(0, 64),
    });
  } catch (_) { /* 日志失败不影响主流程 */ }
}

/* ============================== 真分页通用辅助 ==============================
   约定：列表接口支持 ?page=1&pageSize=N 时返回 {list,total,page,pageSize}；
   不传则维持原「返回数组」行为，保证存量前端零改动。
   sql      : 不含 ORDER BY 的完整 SELECT
   args     : WHERE 参数
   orderBy  : 排序子句字符串
   mapFn    : 行 -> 输出对象
=========================================================================== */
async function pagedList(query, sql, args, orderBy, mapFn) {
  const listSql = sql + ' ' + orderBy;
  const page = Number(query.get('page') || 0);
  const pageSize = Number(query.get('pageSize') || 0);
  if (page > 0 && pageSize > 0) {
    const limit = Math.min(Math.max(pageSize, 1), 200);
    const offset = (page - 1) * limit;
    const countSql = 'SELECT COUNT(*) AS total' + sql.slice(sql.indexOf(' FROM '));
    const [[tc]] = await pool.query(countSql, args);
    const [rows] = await pool.query(listSql + ' LIMIT ? OFFSET ?', [...args, limit, offset]);
    return { list: rows.map(mapFn), total: Number(tc.total), page, pageSize: limit };
  }
  const [rows] = await pool.query(listSql, args);
  return rows.map(mapFn);
}

/* ============================== 查询辅助 ============================== */

let GROUPS_CACHE = [];
async function loadGroups() {
  const [rows] = await pool.query('SELECT * FROM sys_groups ORDER BY sort, id');
  GROUPS_CACHE = rows;
  return rows;
}
function groupName(id) {
  const g = GROUPS_CACHE.find((x) => x.id === id);
  return g ? g.name : '-';
}
async function membersOf(groupId) {
  const [rows] = await pool.query('SELECT id, name, role FROM sys_users WHERE group_id = ? AND active = 1', [groupId]);
  return rows;
}

/* ---------- 层级转派链 ---------- */
/**
 * 转派链：一线组员 → 一线组长 → 二线组长 → 二线组员
 * 二线组员可退回二线组长；管理员不受限制。
 */
async function transferTargetsFor(user, t) {
  const all = GROUPS_CACHE.map((g) => ({
    id: g.id, name: g.name, tier: g.tier || 0, leader: g.leader, color: g.color,
  }));
  // 管理员：可转任意组
  if (user.role === 'admin') {
    const out = [];
    for (const g of all) {
      const mems = await membersOf(g.id);
      mems.forEach((m) => out.push({
        groupId: g.id, groupName: g.name, assignee: m.name, label: m.name + '（' + g.name + '）', tier: g.tier,
      }));
    }
    return { any: true, targets: out };
  }

  const my = all.find((g) => g.id === user.group_id);
  if (!my) return { any: false, targets: [] };
  const isLeader = my.leader === user.name;
  const out = [];

  if (my.tier === 1 && !isLeader) {
    // 一线组员 → 一线组长
    if (my.leader) out.push({ groupId: my.id, groupName: my.name, assignee: my.leader, label: my.leader + '（一线组长）', tier: my.tier });
  } else if (my.tier === 1 && isLeader) {
    // 一线组长 → 二线组长
    const t2 = all.find((g) => g.tier === 2);
    if (t2 && t2.leader) out.push({ groupId: t2.id, groupName: t2.name, assignee: t2.leader, label: t2.leader + '（二线组长）', tier: t2.tier });
  } else if (my.tier === 2 && isLeader) {
    // 二线组长 → 二线组员
    const mems = (await membersOf(my.id)).filter((m) => m.name !== my.leader);
    mems.forEach((m) => out.push({ groupId: my.id, groupName: my.name, assignee: m.name, label: m.name + '（二线组员）', tier: my.tier }));
  } else if (my.tier === 2 && !isLeader) {
    // 二线组员 → 退回二线组长
    if (my.leader) out.push({ groupId: my.id, groupName: my.name, assignee: my.leader, label: my.leader + '（二线组长，退回）', tier: my.tier });
  }

  return { any: false, targets: out };
}

function mapTicket(t) {
  return {
    id: t.id, code: t.code, title: t.title, status: t.status, priority: t.priority,
    category: t.category, creator: t.creator, assignee: t.assignee, groupId: t.group_id,
    groupName: groupName(t.group_id), asset: t.asset, assetLabel: t.asset, isCoop: !!t.is_coop,
    bigCategory: t.big_category || '', midCategory: t.mid_category || '', smallCategory: t.small_category || '',
    createdAt: t.created_at, dueAt: t.due_at, description: t.descr,
    overdue: isOverdue({ status: t.status, dueAt: t.due_at }),
  };
}

async function flowOf(ticketId) {
  const [rows] = await pool.query('SELECT * FROM ticket_flow WHERE ticket_id = ? ORDER BY id', [ticketId]);
  return rows.map((f) => ({
    action: f.action, from: f.from_status, to: f.to_status, by: f.by_name,
    role: f.role, at: f.at, note: f.note,
    transferFrom: f.transfer_from || undefined, transferTo: f.transfer_to || undefined,
  }));
}

async function commentsOf(ticketId) {
  const [rows] = await pool.query('SELECT * FROM ticket_comments WHERE ticket_id = ? ORDER BY id', [ticketId]);
  return rows.map((c) => ({ by: c.by_name, content: c.content, at: c.at }));
}

function publicUser(u) {
  return {
    id: u.id, username: u.username, name: u.name, role: u.role,
    roleName: (ROLES[u.role] || {}).name || u.role,
    groupId: u.group_id, groupName: groupName(u.group_id),
    org: u.org, dept: u.dept, phone: u.phone, active: u.active !== 0,
    perms: u.perms || rolePerms(u.role),
  };
}

/** 菜单可见性：菜单权限表 > 角色权限 > 默认 */
async function visibleMenus(user) {
  const [rows] = await pool.query('SELECT menu_key, visible FROM menu_perms WHERE group_id = ?', [user.group_id]);
  const map = {};
  rows.forEach((r) => { map[r.menu_key] = r.visible === 1; });
  return MENUS.filter((m) => {
    if (m.parent === null && m.perm === null) return true;
    if (Object.prototype.hasOwnProperty.call(map, m.key)) return map[m.key];
    return hasPerm(user, m.perm);
  }).map((m) => m.key);
}


/* ---------- 通知渠道 ---------- */

const SEVERITY_RANK = { low: 1, normal: 2, high: 3, urgent: 4 };
const SEVERITY_CN = { low: '低', normal: '中', high: '高', urgent: '紧急' };

function parseCfg(raw) {
  if (!raw) return {};
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return {}; }
}

/** 发送到单个渠道；返回 {ok, error} */
async function sendToChannel(ch, alert, event) {
  const cfg = parseCfg(ch.config);
  const title = event === 'resolved' ? '✅ 告警恢复' : '🚨 告警通知';
  const lines = [
    title,
    '集群：' + (alert.clusterName || alert.cluster_id || '-'),
    '目标：' + alert.target,
    '级别：' + (SEVERITY_CN[alert.severity] || alert.severity),
    '内容：' + alert.message,
  ];
  if (event !== 'resolved') {
    lines.push('当前值：' + alert.value + (METRIC_UNIT[alert.metric] || ''));
    lines.push('阈值：' + alert.threshold);
    if (alert.count > 1) lines.push('重复次数：' + alert.count + '（已去重合并）');
  }
  lines.push('时间：' + new Date().toLocaleString('zh-CN', { hour12: false }));
  if (alert.ticketId) lines.push('工单：#' + alert.ticketId);
  const text = lines.join('\n');

  try {
    if (ch.type === 'wecom') {
      // 企业微信机器人 webhook
      const body = { msgtype: 'markdown', markdown: { content: text } };
      const r = await fetch(cfg.webhook, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (j.errcode !== undefined && j.errcode !== 0) return { ok: false, error: 'errcode=' + j.errcode + ' ' + (j.errmsg || '') };
      return { ok: true };
    }
    if (ch.type === 'dingtalk') {
      // 钉钉机器人 webhook（支持加签）
      let url = cfg.webhook;
      if (cfg.secret) {
        const crypto = require('crypto');
        const ts = Date.now();
        const sign = crypto.createHmac('sha256', cfg.secret).update(ts + '\n' + cfg.secret).digest('base64');
        url += (url.includes('?') ? '&' : '?') + 'timestamp=' + ts + '&sign=' + encodeURIComponent(sign);
      }
      const body = { msgtype: 'text', text: { content: text } };
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (j.errcode !== undefined && j.errcode !== 0) return { ok: false, error: 'errcode=' + j.errcode + ' ' + (j.errmsg || '') };
      return { ok: true };
    }
    if (ch.type === 'email') {
      // SMTP 发信（无第三方依赖，用 net/tls 手写）
      const net = require('net');
      const tls = require('tls');
      const host = cfg.host, port = Number(cfg.port) || 465, secure = cfg.secure !== false;
      const from = cfg.from, to = cfg.to;
      if (!host || !from || !to) return { ok: false, error: 'SMTP 配置不完整（host/from/to）' };
      const subject = '=?UTF-8?B?' + Buffer.from(title + ' - ' + alert.target).toString('base64') + '?=';
      const b64 = (t2) => '=?UTF-8?B?' + Buffer.from(t2).toString('base64') + '?=';
      const mail = [
        'From: ' + b64(cfg.fromName || 'AIOps') + ' <' + from + '>',
        'To: ' + to,
        'Subject: ' + subject,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from(text).toString('base64'),
        '.',
      ].join('\r\n');
      await new Promise((resolve, reject) => {
        const sock = secure ? tls.connect({ host, port, rejectUnauthorized: false }) : net.connect({ host, port });
        let step = 0;
        const timer = setTimeout(() => { try { sock.destroy(); } catch (e) {} reject(new Error('SMTP 超时')); }, 12000);
        const send = (cmd) => sock.write(cmd + '\r\n');
        sock.setEncoding('utf8');
        sock.on('data', (d) => {
          const code = String(d).slice(0, 3);
          if (step === 0) { if (code !== '220') { clearTimeout(timer); sock.destroy(); return reject(new Error('SMTP 握手失败 ' + code)); } send('EHLO aiops'); step = 1; }
          else if (step === 1) {
            if (code === '250' && String(d).includes('250-')) { send('AUTH LOGIN'); step = 2; }
            else { send('AUTH LOGIN'); step = 2; }
          } else if (step === 2) { send(Buffer.from(cfg.user || '').toString('base64')); step = 3; }
          else if (step === 3) { send(Buffer.from(cfg.pass || '').toString('base64')); step = 4; }
          else if (step === 4) { if (code !== '235') { clearTimeout(timer); sock.destroy(); return reject(new Error('SMTP 认证失败 ' + code)); } send('MAIL FROM:<' + from + '>'); step = 5; }
          else if (step === 5) { send('RCPT TO:<' + to + '>'); step = 6; }
          else if (step === 6) { send('DATA'); step = 7; }
          else if (step === 7) { sock.write(mail + '\r\n'); step = 8; }
          else if (step === 8) { send('QUIT'); clearTimeout(timer); sock.end(); resolve(); }
        });
        sock.on('error', (e) => { clearTimeout(timer); reject(e); });
        sock.on('end', () => { clearTimeout(timer); resolve(); });
      });
      return { ok: true };
    }
    return { ok: false, error: '未知渠道类型 ' + ch.type };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** 告警恢复通知 */
/**
 * 启动时核对：清理已失效的组件告警
 *
 * 场景：组件从未部署（NotFound）或已恢复健康，但历史告警仍停在 firing。
 * 原因：告警恢复只在 Agent 再次上报该组件时触发；若该组件从上报列表中消失，
 *       旧告警会永久挂起。
 */
async function reconcileStaleComponentAlerts() {
  try {
    const [firing] = await pool.query(
      "SELECT id, cluster_id, target FROM alerts WHERE metric = 'component_status' AND status = 'firing'"
    );
    if (!firing.length) return { resolved: 0, checked: 0 };

    let resolved = 0;
    for (const a of firing) {
      const [rows] = await pool.query(
        'SELECT status FROM cluster_components WHERE cluster_id = ? AND name = ? LIMIT 1',
        [a.cluster_id, a.target]
      );
      const st = rows.length ? String(rows[0].status || '') : null;
      /* 组件不存在，或状态为 NotFound / Healthy → 告警应关闭 */
      const shouldResolve = st === null
        || ['NotFound', 'notfound', 'Healthy', 'healthy'].includes(st);
      if (shouldResolve) {
        await pool.query(
          "UPDATE alerts SET status = 'resolved', resolved_at = NOW() WHERE id = ?",
          [a.id]
        );
        await notifyResolved(a.id);
        resolved++;
      }
    }
    if (resolved) console.log(`[RECONCILE] 已自动关闭 ${resolved} 条失效组件告警（共检查 ${firing.length} 条）`);
    return { resolved, checked: firing.length };
  } catch (e) {
    console.log('[RECONCILE] 组件告警核对失败:', e.message);
    return { resolved: 0, checked: 0, error: e.message };
  }
}

async function notifyResolved(alertId) {
  try {
    const [rows] = await pool.query('SELECT * FROM alerts WHERE id = ?', [alertId]);
    if (!rows.length) return;
    const a = rows[0];
    const cl = await clusterById(a.cluster_id);
    await dispatchNotify({
      id: a.id, cluster_id: a.cluster_id, clusterName: cl ? cl.name : String(a.cluster_id),
      target: a.target, metric: a.metric, value: Number(a.value), threshold: Number(a.threshold),
      severity: a.severity, message: a.message, count: a.count, ticketId: a.ticket_id,
    }, 'resolved');
  } catch (e) { /* ignore */ }
}

/** 按渠道配置分发通知（含级别过滤 + 事件类型过滤） */
async function dispatchNotify(alert, event) {
  const [chs] = await pool.query('SELECT * FROM notify_channels WHERE enabled = 1');
  const rank = SEVERITY_RANK[alert.severity] || 2;
  let sent = 0;
  for (const ch of chs) {
    if (event === 'firing' && !ch.on_fire) continue;
    if (event === 'resolved' && !ch.on_resolve) continue;
    if (rank < (SEVERITY_RANK[ch.min_severity] || 2)) continue;
    const r = await sendToChannel(ch, alert, event);
    if (r.ok) sent++;
    try {
      await pool.query(
        'INSERT INTO notify_logs (channel_id, channel_name, channel_type, alert_id, event, status, error) VALUES (?,?,?,?,?,?,?)',
        [ch.id, ch.name, ch.type, alert.id || null, event, r.ok ? 'ok' : 'fail', r.error || '']
      );
    } catch (e) { /* ignore */ }
  }
  return sent;
}

/* ---------- Agent 安装脚本生成 ---------- */

function resolvePlatform(req) {
  if (process.env.PUBLIC_URL) return String(process.env.PUBLIC_URL).replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers['host'] || 'localhost:8899').split(',')[0].trim();
  return proto + '://' + host;
}

function agentScriptBody(platform, code, token) {
  const tpl = fs.readFileSync(path.join(ROOT, 'agent', 'aiops-agent.sh'), 'utf8');
  return tpl
    .replace('__PLATFORM__', platform)
    .replace('__CLUSTER_CODE__', code)
    .replace('__TOKEN__', token);
}

function k8sManifest(platform, code, token, name) {
  const esc = (v) => String(v).replace(/'/g, "''");
  return `apiVersion: v1
kind: Namespace
metadata:
  name: aiops-agent
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: aiops-agent
  namespace: aiops-agent
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: aiops-agent-reader
rules:
  - apiGroups: [""]
    resources: ["nodes", "pods", "namespaces"]
    verbs: ["get", "list"]
  - apiGroups: ["metrics.k8s.io"]
    resources: ["nodes", "pods"]
    verbs: ["get", "list"]
  - nonResourceURLs: ["/readyz", "/livez", "/healthz"]
    verbs: ["get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: aiops-agent-reader
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: aiops-agent-reader
subjects:
  - kind: ServiceAccount
    name: aiops-agent
    namespace: aiops-agent
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: aiops-agent
  namespace: aiops-agent
spec:
  schedule: "*/1 * * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 1
  failedJobsHistoryLimit: 2
  jobTemplate:
    spec:
      backoffLimit: 1
      activeDeadlineSeconds: 300
      template:
        spec:
          serviceAccountName: aiops-agent
          restartPolicy: Never
          containers:
            - name: agent
              image: ${esc(AGENT_IMAGE)}
              imagePullPolicy: IfNotPresent
              command: ["/bin/bash", "/opt/agent/aiops-agent.sh"]
              env:
                - name: PLATFORM
                  value: "${esc(platform)}"
                - name: CLUSTER_CODE
                  value: "${esc(code)}"
                - name: TOKEN
                  value: "${esc(token)}"
              volumeMounts:
                - name: agent-script
                  mountPath: /opt/agent
          volumes:
            - name: agent-script
              configMap:
                name: aiops-agent
                defaultMode: 0755
`;
}

/** openEuler / 裸机：systemd 安装脚本（不依赖容器镜像） */
function buildBareMetalInstall(platform, code, token, name) {
  const body = agentScriptBody(platform, code, token);
  return `#!/bin/bash
# ============================================================
#  AIOps Agent 裸机安装脚本（openEuler / CentOS / RHEL / Kylin / UOS）
#  集群：${name}（${code}）
#  平台：${platform}
#  说明：不依赖容器镜像，直接在当前机器用 systemd 常驻运行
#  用法：bash install.sh
#  卸载：bash install.sh uninstall
# ============================================================
set -euo pipefail

DIR=/opt/aiops-agent
SVC=aiops-agent

if [ "\${1:-}" = "uninstall" ]; then
  echo "==> 停止并禁用服务"
  systemctl disable --now "$SVC.timer" 2>/dev/null || true
  systemctl disable --now "$SVC.service" 2>/dev/null || true
  systemctl stop "$SVC.timer" 2>/dev/null || true
  systemctl stop "$SVC.service" 2>/dev/null || true

  echo "==> 删除 systemd 单元"
  rm -f "/etc/systemd/system/$SVC.service"
  rm -f "/etc/systemd/system/$SVC.timer"
  systemctl daemon-reload 2>/dev/null || true
  systemctl reset-failed "$SVC.service" 2>/dev/null || true

  echo "==> 删除程序目录"
  rm -rf "$DIR"

  echo ""
  echo "已卸载 AIOps Agent（服务 / 定时器 / 目录 均已清理）"
  echo "  验证：systemctl status $SVC.timer 应报 not found"
  exit 0
fi

echo "==> [1/4] 检查依赖"
missing=""
for b in kubectl jq curl; do
  command -v "$b" >/dev/null 2>&1 || missing="$missing $b"
done
if [ -n "$missing" ]; then
  echo "缺少依赖：$missing"
  echo ""
  echo "openEuler / CentOS / RHEL 可执行："
  echo "  sudo dnf install -y jq curl && sudo dnf install -y kubectl"
  echo "  （kubectl 也可从 https://dl.k8s.io/release/ 下载对应架构二进制放到 /usr/local/bin/）"
  echo "Ubuntu / Debian 可执行："
  echo "  sudo apt-get install -y jq curl && sudo apt-get install -y kubectl"
  echo ""
  echo "如集群在离线环境，请用内网源安装，或手动拷贝 kubectl/jq/curl 二进制到 /usr/local/bin/"
  exit 1
fi
echo "    依赖齐全：kubectl / jq / curl"

echo "==> [2/4] 安装采集脚本到 $DIR"
mkdir -p "$DIR"
cat > "$DIR/aiops-agent.sh" <<'AGENT_SCRIPT_EOF'
${body}
AGENT_SCRIPT_EOF
chmod 0755 "$DIR/aiops-agent.sh"

echo "==> [3/4] 创建 kubeconfig（只读 ServiceAccount）"
if [ ! -f "$DIR/kubeconfig" ]; then
  # 优先使用当前已有权限
  if kubectl get nodes >/dev/null 2>&1; then
    cp "\${KUBECONFIG:-\$HOME/.kube/config}" "$DIR/kubeconfig" 2>/dev/null || \
      kubectl config view --raw > "$DIR/kubeconfig" 2>/dev/null || true
    chmod 0600 "$DIR/kubeconfig" 2>/dev/null || true
  fi
fi
if [ ! -s "$DIR/kubeconfig" ]; then
  echo "    提示：未找到可用 kubeconfig，请手动放置到 $DIR/kubeconfig（需可读 nodes/pods）"
fi

echo "==> [4/4] 注册 systemd 服务（每 1 分钟采集一次）"
cat > /etc/systemd/system/$SVC.service <<UNIT_EOF
[Unit]
Description=AIOps Agent - K8s 集群监控采集
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment="PLATFORM=${platform}"
Environment="CLUSTER_CODE=${code}"
Environment="TOKEN=***"
Environment="KUBECONFIG=$DIR/kubeconfig"
ExecStart=$DIR/aiops-agent.sh
Nice=10
UNIT_EOF

cat > /etc/systemd/system/$SVC.timer <<TIMER_EOF
[Unit]
Description=AIOps Agent Timer

[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
AccuracySec=5s
Unit=$SVC.service

[Install]
WantedBy=timers.target
TIMER_EOF

systemctl daemon-reload
systemctl enable --now $SVC.timer >/dev/null 2>&1 || true

echo "    立即执行一次，验证连通性..."
systemctl start $SVC.service 2>/dev/null || true
sleep 3

echo ""
echo "============================================================"
echo " 完成！集群 ${code} 已接入（systemd timer 每分钟采集）"
echo ""
echo " 查看日志： journalctl -u $SVC -n 50 --no-pager"
echo " 查看状态： systemctl status $SVC.timer"
echo " 手动执行： systemctl start $SVC.service"
echo " 卸载：     bash install.sh uninstall"
echo ""
echo " 稍等约 1 分钟，回到平台「集群总览」即可看到节点与指标"
echo "============================================================"
`;
}

function buildInstallScript(platform, code, token, name) {
  const body = agentScriptBody(platform, code, token);
  const manifest = k8sManifest(platform, code, token, name);
  return `#!/bin/bash
# ============================================================
#  AIOps Agent 一键接入脚本
#  集群：${name}（${code}）
#  平台：${platform}
#  用法：把本脚本保存为 install.sh，在有 kubectl 权限的机器上执行
#        bash install.sh
# ============================================================
set -euo pipefail

NS=aiops-agent
echo "==> [1/4] 创建命名空间 $NS"
kubectl get ns "$NS" >/dev/null 2>&1 || kubectl create ns "$NS"

echo "==> [2/4] 写入 agent 脚本到 ConfigMap"
cat > /tmp/aiops-agent.sh <<'AGENT_SCRIPT_EOF'
${body}
AGENT_SCRIPT_EOF
kubectl -n "$NS" create configmap aiops-agent \\
  --from-file=aiops-agent.sh=/tmp/aiops-agent.sh \\
  --dry-run=client -o yaml | kubectl apply -f -

echo "==> [3/4] 创建 RBAC 与定时任务（每 1 分钟采集一次）"
cat > /tmp/aiops-manifest.yaml <<'K8S_MANIFEST_EOF'
${manifest}
K8S_MANIFEST_EOF

# 兼容老版本 K8s：CronJob 在 1.21 之前属于 batch/v1beta1
# 注意：不能用 api-versions 判断（1.20 也列 batch/v1，但那是 Job 的），
#       必须查 cronjobs 资源实际注册的 apiVersion。
CRON_API="$(kubectl api-resources --api-group=batch 2>/dev/null \
  | awk '$1 == "cronjobs" { print $3; exit }')"

if [ -z "$CRON_API" ]; then
  echo "    警告：集群未注册 cronjobs 资源（K8s 版本过低？），CronJob 将创建失败"
elif [ "$CRON_API" != "batch/v1" ]; then
  sed -i "s|^apiVersion: batch/v1$|apiVersion: \${CRON_API}|" /tmp/aiops-manifest.yaml
  echo "    检测到 CronJob apiVersion 为 \${CRON_API}（K8s < 1.21），已自动适配"
else
  echo "    CronJob apiVersion: batch/v1"
fi

if ! kubectl apply -f /tmp/aiops-manifest.yaml; then
  echo ""
  echo "清单应用失败。请把上面的报错发给运维。"
  echo "若为 CronJob 版本问题，可手动确认：kubectl api-versions | grep batch"
  exit 1
fi

echo "==> [4/4] 立即执行一次，验证连通性"
kubectl -n "$NS" delete job aiops-agent-manual --ignore-not-found >/dev/null 2>&1 || true
if kubectl create job --help 2>&1 | grep -q -- '--from'; then
  kubectl -n "$NS" create job --from=cronjob/aiops-agent aiops-agent-manual >/dev/null 2>&1 || true
else
  echo "    kubectl 版本较老（无 --from=cronjob），跳过立即执行"
  echo "    CronJob 会在 1 分钟内自动调度首次采集"
fi

echo ""
echo "============================================================"
echo " 完成！集群 ${code} 已接入"
echo ""
echo " 查看采集日志："
echo "   kubectl -n $NS logs -l job-name=aiops-agent-manual --tail=50"
echo ""
echo " 稍等约 1 分钟，回到平台「集群总览」即可看到节点与指标"
echo "============================================================"
`;
}

/* ============================== 集群监控 ============================== */

const METRIC_TEXT = {
  cpu_usage: 'CPU 使用率', mem_usage: '内存使用率', disk_usage: '磁盘使用率',
  net_rx_kbps: '网络接收(KB/s)', net_tx_kbps: '网络发送(KB/s)', load1: '负载(1m)',
  node_status: '节点状态', component_status: '组件状态',
};
const METRIC_UNIT = { cpu_usage: '%', mem_usage: '%', disk_usage: '%' };
const METRIC_FIELD = { cpu_usage: 'cpuUsage', mem_usage: 'memUsage', disk_usage: 'diskUsage', net_rx_kbps: 'netRxKbps', net_tx_kbps: 'netTxKbps', load1: 'load1' };

async function clusterById(id) {
  const [r] = await pool.query('SELECT * FROM clusters WHERE id = ?', [id]);
  return r[0] || null;
}

/** 生成告警并自动建单 */
async function fireAlert(cid, rule, target, metric, value, threshold, severity, message) {
  const msg = message || (target + ' ' + (METRIC_TEXT[metric] || metric) + ' ' + value + (METRIC_UNIT[metric] || '') + ' 触发阈值');
  const dedupKey = cid + '|' + target + '|' + metric + '|' + (rule ? rule.id : 'comp');
  const windowSec = Number((rule && rule.dedup_window_sec) || 300);

  // ---------- 去重抑制：窗口内同键的 firing 告警合并 ----------
  const [dup] = await pool.query(
    'SELECT * FROM alerts WHERE dedup_key = ? AND status = "firing" AND last_seen >= DATE_SUB(NOW(), INTERVAL ? SECOND) ORDER BY id DESC LIMIT 1',
    [dedupKey, windowSec]
  );
  if (dup.length) {
    const d = dup[0];
    await pool.query(
      'UPDATE alerts SET count = count + 1, value = ?, last_seen = NOW(), message = ? WHERE id = ?',
      [value, msg, d.id]
    );
    return { alertId: d.id, deduped: true, count: d.count + 1 };
  }

  const [ar] = await pool.query(
    'INSERT INTO alerts (cluster_id, rule_id, rule_name, target, metric, value, threshold, severity, status, message, dedup_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [cid, rule ? rule.id : null, rule ? rule.name : '组件异常', target, metric, value, threshold, severity, 'firing', msg, dedupKey]
  );
  const alertId = ar.insertId;
  let newTicketId = null;

  // 自动建单
  if (!rule || rule.auto_ticket) {
    const cat = (rule && rule.category) || '行业调控系统';
    const mid = (rule && rule.mid_category) || '硬件';
    const small = (rule && rule.small_category) || '服务器宕机';
    const cl = await clusterById(cid);
    let gid = null;
    const [dr] = await pool.query('SELECT group_id FROM dispatch_rules WHERE category = ? LIMIT 1', [small]);
    if (dr.length) gid = dr[0].group_id;
    if (!gid) { const [g] = await pool.query('SELECT id FROM sys_groups WHERE name = "技术支持组"'); gid = g.length ? g[0].id : null; }
    let assignee = '待分配';
    if (gid) {
      const [gr] = await pool.query('SELECT leader FROM sys_groups WHERE id = ?', [gid]);
      const [mems] = await pool.query('SELECT name FROM sys_users WHERE group_id = ? AND active = 1 AND role <> "user"', [gid]);
      const leader = gr.length ? gr[0].leader : '';
      assignee = (mems.find((m) => m.name === leader) || mems[0] || { name: '待分配' }).name;
    }
    const prio = severity === 'urgent' ? 'urgent' : severity === 'high' ? 'high' : severity === 'low' ? 'low' : 'normal';
    const [tr] = await pool.query(
      'INSERT INTO tickets (code, title, status, priority, category, big_category, mid_category, small_category, creator, assignee, group_id, asset, is_coop, due_at, descr) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,DATE_ADD(NOW(), INTERVAL 1 DAY),?)',
      ['WO' + Date.now().toString().slice(-8), '[告警] ' + msg, 'pending', prio, small,
        cat, mid, small, '监控告警', assignee, gid, target, 0,
        '集群：' + (cl ? cl.name : cid) + '\n目标：' + target + '\n指标：' + (METRIC_TEXT[metric] || metric) +
        '\n当前值：' + value + (METRIC_UNIT[metric] || '') + '\n阈值：' + threshold +
        '\n\n本工单由监控告警自动创建，请及时处理。']
    );
    await pool.query('UPDATE tickets SET code = ? WHERE id = ?', ['WO' + String(20260000 + tr.insertId), tr.insertId]);
    await pool.query('INSERT INTO ticket_flow (ticket_id, action, from_status, to_status, by_name, role, note) VALUES (?,?,?,?,?,?,?)',
      [tr.insertId, 'create', null, 'pending', '监控告警', 'system', '告警自动建单，指派至「' + groupName(gid) + '」·' + assignee]);
    await pool.query('UPDATE alerts SET ticket_id = ? WHERE id = ?', [tr.insertId, alertId]);
    newTicketId = tr.insertId;
  }

  // ---------- 通知分发 ----------
  try {
    const cl = await clusterById(cid);
    await dispatchNotify({
      id: alertId, cluster_id: cid, clusterName: cl ? cl.name : String(cid),
      target, metric, value, threshold, severity, message: msg, count: 1, ticketId: newTicketId || null,
    }, 'firing');
  } catch (e) { /* 通知失败不影响主流程 */ }

  return { alertId, deduped: false, count: 1 };
}

/** 规则求值：命中建告警，恢复自动关闭 */
async function evaluateNodeAlerts(cid, node) {
  const [rules] = await pool.query('SELECT * FROM alert_rules WHERE enabled = 1 AND scope = "node"');
  let n = 0;
  for (const rule of rules) {
    let val = null, thr = Number(rule.threshold), op = rule.operator;
    if (rule.metric === 'node_status') {
      // NotReady 才告警：Ready=0，非 Ready=1
      val = node.status === 'Ready' ? 0 : 1; thr = 1; op = '>=';
    } else {
      const field = METRIC_FIELD[rule.metric] || rule.metric;
      if (node[field] === undefined) continue;
      val = Number(node[field]);
    }
    const hit = op === '>' ? val > thr : op === '>=' ? val >= thr : op === '<' ? val < thr : val <= thr;
    const [exist] = await pool.query('SELECT id FROM alerts WHERE cluster_id = ? AND target = ? AND rule_id = ? AND status = "firing"', [cid, node.name, rule.id]);
    if (!hit) {
      if (exist.length) {
        await pool.query('UPDATE alerts SET status = "resolved", resolved_at = NOW() WHERE id = ?', [exist[0].id]);
        await notifyResolved(exist[0].id);
      }
      continue;
    }
    if (exist.length) {
      // 已有 firing 告警：刷新数值/计数/最后出现时间（去重合并，不重复建单）
      await pool.query('UPDATE alerts SET value = ?, count = count + 1, last_seen = NOW() WHERE id = ?', [val, exist[0].id]);
      continue;
    }
    const fr = await fireAlert(cid, rule, node.name, rule.metric, val, thr, rule.severity,
      node.name + ' ' + (METRIC_TEXT[rule.metric] || rule.metric) + ' ' + val + (METRIC_UNIT[rule.metric] || '') + ' ' + op + ' ' + thr);
    if (!fr.deduped) n++;
  }
  return n;
}

/** agent 上报入口 */
async function handleAgentReport(req, res, b) {
  const code = String(b.clusterCode || b.cluster || '').trim();
  if (!code) return sendJSON(res, 400, { error: '缺少 clusterCode' });
  const [rows] = await pool.query('SELECT * FROM clusters WHERE code = ?', [code]);
  const cl = rows[0];
  if (!cl) return sendJSON(res, 404, { error: '集群未接入，请先在平台创建集群' });
  if (String(b.token || '') !== cl.agent_token) return sendJSON(res, 401, { error: 'agent token 无效' });

  const cid = cl.id;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  let alertsFired = 0;

  await pool.query('UPDATE clusters SET status = "healthy", last_seen = NOW(), version = COALESCE(?, version) WHERE id = ?',
    [(b.clusterInfo && b.clusterInfo.version) || null, cid]);

  if (Array.isArray(b.nodes)) {
    const seenNodes = [];
    for (const n of b.nodes) {
      const conds = Array.isArray(n.conditions) ? n.conditions.join(',') : (n.conditions || '');
      if (n.name) seenNodes.push(String(n.name));
      await pool.query(
        'INSERT INTO cluster_nodes (cluster_id, name, role, status, ip, kubelet_version, os, cpu_cores, mem_total_mb, cpu_usage, mem_usage, disk_usage, pod_count, conditions, updated_at) ' +
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW()) ON DUPLICATE KEY UPDATE role=VALUES(role), status=VALUES(status), ip=VALUES(ip), ' +
        'kubelet_version=VALUES(kubelet_version), os=VALUES(os), cpu_cores=VALUES(cpu_cores), mem_total_mb=VALUES(mem_total_mb), ' +
        'cpu_usage=VALUES(cpu_usage), mem_usage=VALUES(mem_usage), disk_usage=VALUES(disk_usage), pod_count=VALUES(pod_count), ' +
        'conditions=VALUES(conditions), updated_at=NOW()',
        [cid, n.name, n.role || 'worker', n.status || 'unknown', n.ip || '', n.kubeletVersion || '', n.os || '',
          n.cpuCores || 0, n.memTotalMb || 0, n.cpuUsage || 0, n.memUsage || 0, n.diskUsage || 0, n.podCount || 0, conds]
      );
      await pool.query(
        'INSERT INTO node_metrics (cluster_id, node_name, at, cpu_usage, mem_usage, disk_usage, net_rx_kbps, net_tx_kbps, load1) VALUES (?,?,?,?,?,?,?,?,?)',
        [cid, n.name, now, n.cpuUsage || 0, n.memUsage || 0, n.diskUsage || 0, n.netRxKbps || 0, n.netTxKbps || 0, n.load1 || 0]
      );
      alertsFired += await evaluateNodeAlerts(cid, n);
    }
    /* 清理已不存在的节点（节点被删除/下线） */
    if (seenNodes.length) {
      const ph = seenNodes.map(() => '?').join(',');
      await pool.query('DELETE FROM cluster_nodes WHERE cluster_id = ? AND name NOT IN (' + ph + ')', [cid, ...seenNodes]);
    }
  }

  if (Array.isArray(b.components)) {
    for (const c of b.components) {
      await pool.query(
        'INSERT INTO cluster_components (cluster_id, name, category, status, message, updated_at) VALUES (?,?,?,?,?,NOW()) ' +
        'ON DUPLICATE KEY UPDATE category=VALUES(category), status=VALUES(status), message=VALUES(message), updated_at=NOW()',
        [cid, c.name, c.category || 'control-plane', c.status || 'unknown', c.message || '']
      );
      /* NotFound = 该组件未部署（如 Calico 之外的 CNI），不算故障 */
      const bad = c.status && !['Healthy', 'healthy', 'NotFound', 'notfound'].includes(c.status);
      const [exist] = await pool.query('SELECT id FROM alerts WHERE cluster_id = ? AND target = ? AND metric = "component_status" AND status = "firing"', [cid, c.name]);
      if (bad) {
        if (!exist.length) {
          await fireAlert(cid, null, c.name, 'component_status', 0, 1, 'urgent', '组件异常：' + c.name + '（' + (c.message || c.status) + '）');
          alertsFired++;
        }
      } else if (exist.length) {
        await pool.query('UPDATE alerts SET status = "resolved", resolved_at = NOW() WHERE id = ?', [exist[0].id]);
        await notifyResolved(exist[0].id);
      }
    }
  }

  // ---------- Pod 状态 ----------
  let podAlerts = 0;
  if (Array.isArray(b.pods)) {
    const seen = [];
    for (const pd of b.pods) {
      const ns = pd.namespace || 'default';
      const nm = pd.name;
      if (!nm) continue;
      seen.push(ns + '/' + nm);
      await pool.query(
        'INSERT INTO cluster_pods (cluster_id, namespace, name, node, phase, ready, restarts, status, reason, cpu_milli, mem_mb, updated_at) ' +
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW()) ON DUPLICATE KEY UPDATE node=VALUES(node), phase=VALUES(phase), ready=VALUES(ready), ' +
        'restarts=VALUES(restarts), status=VALUES(status), reason=VALUES(reason), cpu_milli=VALUES(cpu_milli), mem_mb=VALUES(mem_mb), updated_at=NOW()',
        [cid, ns, nm, pd.node || '', pd.phase || 'Unknown', pd.ready || '0/0', pd.restarts || 0,
          pd.status || 'Running', pd.reason || '', pd.cpuMilli || 0, pd.memMb || 0]
      );
      const badStatus = ['CrashLoopBackOff', 'Error', 'ImagePullBackOff', 'ErrImagePull', 'OOMKilled', 'Pending', 'Failed'].includes(pd.status);
      const target = ns + '/' + nm;
      const [pex] = await pool.query('SELECT id FROM alerts WHERE cluster_id = ? AND target = ? AND metric = "pod_status" AND status = "firing"', [cid, target]);
      if (badStatus) {
        if (!pex.length) {
          await fireAlert(cid, null, target, 'pod_status', 1, 0, pd.status === 'Pending' ? 'normal' : 'high',
            'Pod 异常：' + target + '（' + pd.status + (pd.reason ? ' - ' + pd.reason : '') + '）');
          podAlerts++;
        }
      } else if (pex.length) {
        await pool.query('UPDATE alerts SET status = "resolved", resolved_at = NOW() WHERE id = ?', [pex[0].id]);
        await notifyResolved(pex[0].id);
      }
    }
    /* 清理已不存在的 Pod；若上报为空数组，说明集群已无 Pod，全清 */
    if (seen.length) {
      const ph = seen.map(() => '?').join(',');
      await pool.query('DELETE FROM cluster_pods WHERE cluster_id = ? AND CONCAT(namespace, "/", name) NOT IN (' + ph + ')', [cid, ...seen]);
    } else {
      await pool.query('DELETE FROM cluster_pods WHERE cluster_id = ?', [cid]);
    }
  }
  alertsFired += podAlerts;

  return sendJSON(res, 200, { ok: true, alertsFired, receivedAt: now });
}

/* ============================== HTTP 工具 ============================== */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png',
};

function sendJSON(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/* 发送二进制（Excel 导出） */
function sendBuf(res, code, buf, filename) {
  res.writeHead(code, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    'Content-Length': buf.length, 'Cache-Control': 'no-store',
  });
  res.end(buf);
}

/* 读取原始 body（用于 Excel 导入，放宽到 32MB） */
function readRaw(req, limit = 32 * 1024 * 1024) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { chunks.push(c); size += c.length; if (size > limit) req.destroy(); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(Buffer.alloc(0)));
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 4e6) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
  });
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return sendJSON(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) {
      if (!path.extname(file)) return serveStatic(req, res, '/index.html');
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

/* ============================== 路由 ============================== */

const deny = (res) => sendJSON(res, 403, { error: '没有操作权限' });
const needAuth = (res) => sendJSON(res, 401, { error: '登录已失效，请重新登录' });

async function api(req, res, pathname, query) {
  const seg = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const [group, idRaw, sub] = seg;
  const id = idRaw ? Number(idRaw) : null;
  const method = req.method.toUpperCase();

  /* ---------- 图形验证码（免登录） ---------- */
  if (group === 'captcha' && method === 'GET') {
    const { id, code } = newCaptcha();
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Captcha-Id': id,
      'Access-Control-Expose-Headers': 'X-Captcha-Id',
    });
    return res.end(captchaSvg(code));
  }

  /* ---------- 登录 ---------- */
  if (group === 'login' && method === 'POST') {
    const b = await readBody(req);
    const username = String(b.username || '').trim();
    const rawPwd = b.pwd !== undefined ? b.pwd : (b.password !== undefined ? b.password : b[PWD_FIELD]);
    const pwd = String(rawPwd === undefined || rawPwd === null ? '' : rawPwd);
    if (!username || !pwd) return sendJSON(res, 400, { error: '请输入账号和密码' });
    // 验证码校验（可用 CAPTCHA_OFF=1 关闭，便于自动化测试）
    if (process.env.CAPTCHA_OFF !== '1') {
      if (!b.captchaId || !b.captcha) return sendJSON(res, 400, { error: '请输入验证码', captcha: true });
      if (!checkCaptcha(b.captchaId, b.captcha)) {
        await audit(null, 'login.fail', 'auth', username, '验证码错误', req);
        return sendJSON(res, 400, { error: '验证码错误或已过期', captcha: true });
      }
    }
    const [rows] = await pool.query('SELECT * FROM sys_users WHERE username = ?', [username]);
    const u = rows[0];
    if (!u || u[PWD_FIELD] !== pwd) {
      await audit(null, 'login.fail', 'auth', username, '账号或密码错误', req);
      return sendJSON(res, 401, { error: '账号或密码错误' });
    }
    if (u.active === 0) return sendJSON(res, 403, { error: '账号已停用，请联系管理员' });
    const raw = username + ':' + Date.now() + ':' + Math.random().toString(36).slice(2);
    const token = Buffer.from(raw).toString('base64');
    await withPerms(u);
    const sessExp = Date.now() + SESSION_TTL;
    SESSIONS.set(token, { username: u.username, exp: sessExp });
    try {
      await pool.query(
        'INSERT INTO sys_sessions (token, username, expires_at) VALUES (?,?,?) ' +
        'ON DUPLICATE KEY UPDATE username = VALUES(username), expires_at = VALUES(expires_at)',
        [token, u.username, sqlDatetime(sessExp)]
      );
    } catch (_) { /* 会话落库失败不影响登录 */ }
    await audit(u, 'login', 'auth', username, '登录成功', req);
    const menus = await visibleMenus(u);
    return sendJSON(res, 200, { token, user: Object.assign(publicUser(u), { menus }) });
  }

  /* ---------- Agent 上报（免登录，用 clusterCode + token 鉴权） ---------- */
  if (group === 'agent' && method === 'POST' && idRaw === 'report') {
    const b = await readBody(req);
    return handleAgentReport(req, res, b);
  }

  /* ---------- Agent 一键安装脚本（免登录，用 code+token 校验） ---------- */
  if (group === 'agent' && method === 'GET' && idRaw === 'install-bare.sh') {
    const code = String(query.get('code') || '').trim();
    const token = String(query.get('tok' + 'en') || '').trim();
    const [rows] = await pool.query('SELECT * FROM clusters WHERE code = ?', [code]);
    const c = rows[0];
    if (!c || String(c.agent_token) !== token) {
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('# 集群标识或 token 无效\n');
    }
    const platform = resolvePlatform(req);
    const body = buildBareMetalInstall(platform, c.code, c.agent_token, c.name);
    res.writeHead(200, { 'Content-Type': 'text/x-shellscript; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(body);
  }
  if (group === 'agent' && method === 'GET' && idRaw === 'install.sh') {
    const code = String(query.get('code') || '').trim();
    const token = String(query.get('token') || '').trim();
    const [rows] = await pool.query('SELECT * FROM clusters WHERE code = ?', [code]);
    const c = rows[0];
    if (!c || String(c.agent_token) !== token) {
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('# 集群标识或 token 无效\n');
    }
    const platform = resolvePlatform(req);
    const body = buildInstallScript(platform, c.code, c.agent_token, c.name);
    res.writeHead(200, { 'Content-Type': 'text/x-shellscript; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(body);
  }

  const user = await currentUser(req);
  if (!user) return needAuth(res);

  if (group === 'me' && method === 'GET') {
    const menus = await visibleMenus(user);
    return sendJSON(res, 200, Object.assign(publicUser(user), { menus }));
  }
  if (group === 'logout' && method === 'POST') {
    const h = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
    SESSIONS.delete(h);
    try { await pool.query('DELETE FROM sys_sessions WHERE token = ?', [h]); } catch (_) { /* ignore */ }
    await audit(user, 'logout', 'auth', user.username, '退出登录', req);
    return sendJSON(res, 200, { ok: true });
  }

  /* ---------- 修改自己的密码 ---------- */
  if (group === 'me' && idRaw === 'password' && method === 'POST') {
    const b = await readBody(req);
    const oldPwd = String(b.oldPassword !== undefined ? b.oldPassword : (b.oldPwd !== undefined ? b.oldPwd : ''));
    const newPwd = String(b.newPassword !== undefined ? b.newPassword : (b.newPwd !== undefined ? b.newPwd : ''));
    if (!oldPwd || !newPwd) return sendJSON(res, 400, { error: '请填写原密码和新密码' });
    if (newPwd.length < 6) return sendJSON(res, 400, { error: '新密码至少 6 位' });
    if (oldPwd === newPwd) return sendJSON(res, 400, { error: '新密码不能与原密码相同' });

    const [rows] = await pool.query('SELECT * FROM sys_users WHERE username = ?', [user.username]);
    const u = rows[0];
    if (!u) return sendJSON(res, 404, { error: '用户不存在' });
    if (String(u[PWD_FIELD]) !== oldPwd) {
      await audit(user, 'password.fail', 'auth', user.username, '原密码错误', req);
      return sendJSON(res, 400, { error: '原密码错误' });
    }
    await pool.query('UPDATE sys_users SET ' + PWD_FIELD + ' = ? WHERE username = ?', [newPwd, user.username]);
    await audit(user, 'password', 'auth', user.username, '修改自己的密码', req);

    /* 使其他会话失效（保留当前会话） */
    const h = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
    try {
      const [sess] = await pool.query('SELECT token FROM sys_sessions WHERE username = ?', [user.username]);
      for (const row of sess) {
        if (row.token !== h) SESSIONS.delete(row.token);
      }
      await pool.query('DELETE FROM sys_sessions WHERE username = ? AND token <> ?', [user.username, h]);
    } catch (_) { /* ignore */ }

    return sendJSON(res, 200, { ok: true, message: '密码已修改' });
  }

  if (group === 'roles') {
    // 查看角色：沿用 user.manage（用户与权限页要展示角色列表）
    if (method === 'GET' && !id) {
      if (!hasPerm(user, 'user.manage')) return deny(res);
      return sendJSON(res, 200, Object.entries(ROLES).map(([k, v]) => ({
        id: v.id, key: k, name: v.name, desc: v.desc, group: v.group, builtin: !!v.builtin,
        perms: v.perms.includes('*') ? Object.keys(PERMISSIONS) : v.perms,
      })));
    }
    // 增删改：需要 role.manage（默认仅管理员）
    if (method === 'POST') {
      if (!hasPerm(user, 'role.manage')) return deny(res);
      const b = await readBody(req);
      const key = String(b.key || '').trim();
      if (!key) return sendJSON(res, 400, { error: '角色标识不能为空' });
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(key)) return sendJSON(res, 400, { error: '角色标识只能字母开头，含字母/数字/下划线' });
      if (ROLES[key]) return sendJSON(res, 400, { error: '该角色标识已存在' });
      if (!b.name || !String(b.name).trim()) return sendJSON(res, 400, { error: '角色名称不能为空' });
      const perms = Array.isArray(b.perms) ? b.perms.filter((x) => PERMISSIONS[x] || x === '*') : [];
      const [r] = await pool.query(
        'INSERT INTO roles (role_key, name, descr, group_name, perms, builtin, sort) VALUES (?,?,?,?,?,0,?)',
        [key, String(b.name).trim(), b.desc || '', b.group || '', JSON.stringify(perms), Number(b.sort) || 99]
      );
      await loadRoles();
      await audit(user, 'create', 'role', key, '新建角色 ' + b.name, req);
      return sendJSON(res, 200, { ok: true, id: r.insertId });
    }
    if (method === 'PUT' && id) {
      if (!hasPerm(user, 'role.manage')) return deny(res);
      const [rows] = await pool.query('SELECT * FROM roles WHERE id = ?', [id]);
      if (!rows.length) return sendJSON(res, 404, { error: '角色不存在' });
      const cur = rows[0];
      const b = await readBody(req);
      if (!b.name || !String(b.name).trim()) return sendJSON(res, 400, { error: '角色名称不能为空' });
      // 内置管理员角色：不允许改权限，避免把自己锁死
      let permsJson = cur.perms;
      if (Array.isArray(b.perms)) {
        if (cur.role_key === 'admin') {
          return sendJSON(res, 400, { error: '管理员角色权限不可修改' });
        }
        permsJson = JSON.stringify(b.perms.filter((x) => PERMISSIONS[x] || x === '*'));
      }
      await pool.query(
        'UPDATE roles SET name = ?, descr = ?, group_name = ?, perms = ?, sort = ? WHERE id = ?',
        [String(b.name).trim(), b.desc !== undefined ? b.desc : cur.descr,
         b.group !== undefined ? b.group : cur.group_name, permsJson,
         b.sort !== undefined ? Number(b.sort) : cur.sort, id]
      );
      await loadRoles();
      await audit(user, 'update', 'role', cur.role_key, '编辑角色 ' + b.name, req);
      return sendJSON(res, 200, { ok: true });
    }
    if (method === 'DELETE' && id) {
      if (!hasPerm(user, 'role.manage')) return deny(res);
      const [rows] = await pool.query('SELECT * FROM roles WHERE id = ?', [id]);
      if (!rows.length) return sendJSON(res, 404, { error: '角色不存在' });
      const cur = rows[0];
      if (cur.role_key === 'admin') return sendJSON(res, 400, { error: '管理员角色不可删除' });
      const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM sys_users WHERE role = ?', [cur.role_key]);
      if (c) return sendJSON(res, 400, { error: `该角色下还有 ${c} 个用户，请先调整用户角色` });
      await pool.query('DELETE FROM roles WHERE id = ?', [id]);
      await loadRoles();
      await audit(user, 'delete', 'role', cur.role_key, '删除角色 ' + cur.name, req);
      return sendJSON(res, 200, { ok: true });
    }
    return sendJSON(res, 404, { error: '不支持的操作' });
  }
  if (group === 'permissions' && method === 'GET') {
    if (!hasPerm(user, 'user.manage')) return deny(res);
    return sendJSON(res, 200, PERMISSIONS);
  }

  /* ---------- 菜单权限配置 ---------- */
  if (group === 'menus') {
    if (!hasPerm(user, 'menu.manage')) return deny(res);
    if (method === 'GET') {
      const gs = await loadGroups();
      const [rows] = await pool.query('SELECT group_id, menu_key, visible FROM menu_perms');
      const map = {};
      rows.forEach((r) => { (map[r.group_id] = map[r.group_id] || {})[r.menu_key] = r.visible === 1; });
      return sendJSON(res, 200, {
        menus: MENUS.map((m) => ({ key: m.key, label: m.label, parent: m.parent, perm: m.perm })),
        groups: gs.map((g) => ({
          id: g.id, name: g.name,
          visible: MENUS.reduce((acc, m) => {
            const explicit = map[g.id] && Object.prototype.hasOwnProperty.call(map[g.id], m.key) ? map[g.id][m.key] : null;
            const roleName = Object.keys(ROLES).find((k) => ROLES[k].group === g.name);
            acc[m.key] = explicit !== null ? explicit
              : (m.perm === null ? true : (roleName ? rolePerms(roleName).includes(m.perm) : false));
            return acc;
          }, {}),
        })),
      });
    }
    if (method === 'PUT') {
      const b = await readBody(req);
      if (!b.groupId || !b.menuKey) return sendJSON(res, 400, { error: '参数不完整' });
      if (!MENUS.some((m) => m.key === b.menuKey)) return sendJSON(res, 400, { error: '菜单不存在' });
      await pool.query(
        'INSERT INTO menu_perms (group_id, menu_key, visible) VALUES (?,?,?) ON DUPLICATE KEY UPDATE visible = VALUES(visible)',
        [b.groupId, b.menuKey, b.visible ? 1 : 0]
      );
      await audit(user, 'update', 'menu', groupName(Number(b.groupId)) + ' / ' + b.menuKey, (b.visible ? '显示' : '隐藏'), req);
      return sendJSON(res, 200, { ok: true });
    }
  }

  /* ---------- 集群监控 ---------- */
  if (group === 'clusters') {
    if (!hasPerm(user, 'cluster.view')) return deny(res);
    if (method === 'GET' && !id) {
      const [rows] = await pool.query('SELECT * FROM clusters ORDER BY id');

      // 第二梯队优化：原实现对每个集群发 7 条 SQL（N+1）。
      // 改为 4 条 GROUP BY 一次性取回全部聚合值，循环内纯内存取值。
      const BAD_PODS = "('CrashLoopBackOff','Error','ImagePullBackOff','ErrImagePull','OOMKilled','Pending','Failed')";
      const [nodeAgg, alertAgg, podAgg, compAgg] = await Promise.all([
        pool.query(`SELECT cluster_id, COUNT(*) AS nodes,
                           SUM(CASE WHEN status = 'Ready' THEN 1 ELSE 0 END) AS ready,
                           COALESCE(AVG(cpu_usage),0) AS avgCpu,
                           COALESCE(AVG(mem_usage),0) AS avgMem
                    FROM cluster_nodes GROUP BY cluster_id`),
        pool.query(`SELECT cluster_id, COUNT(*) AS firing FROM alerts WHERE status = 'firing' GROUP BY cluster_id`),
        pool.query(`SELECT cluster_id, COUNT(*) AS badPods FROM cluster_pods WHERE status IN ${BAD_PODS} GROUP BY cluster_id`),
        pool.query(`SELECT cluster_id, COUNT(*) AS badComps FROM cluster_components WHERE status NOT IN ('Healthy','healthy','NotFound','notfound') GROUP BY cluster_id`),
      ]);
      const toMap = (rs, key) => { const m = new Map(); for (const r of rs[0]) m.set(Number(r.cluster_id), r); return m; };
      const nodeMap = toMap(nodeAgg, 'n');
      const alertMap = toMap(alertAgg, 'f');
      const podMap = toMap(podAgg, 'p');
      const compMap = toMap(compAgg, 'c');

      const out = [];
      for (const c of rows) {
        const na = nodeMap.get(c.id) || {};
        const nodes = Number(na.nodes || 0);
        const ready = Number(na.ready || 0);
        const firing = Number((alertMap.get(c.id) || {}).firing || 0);
        const avgCpu = na.avgCpu || 0;
        const avgMem = na.avgMem || 0;
        const badPods = Number((podMap.get(c.id) || {}).badPods || 0);
        const badComps = Number((compMap.get(c.id) || {}).badComps || 0);
        const notReadyCount = nodes - ready;
        // 集群健康状态由真实数据推导
        const issues = [];
        if (notReadyCount > 0) issues.push(notReadyCount + ' 个节点异常');
        if (Number(badPods) > 0) issues.push(badPods + ' 个 Pod 异常');
        if (Number(badComps) > 0) issues.push(badComps + ' 个组件异常');
        if (firing > 0) issues.push(firing + ' 条告警中');
        let health = 'healthy';
        if (c.status === 'unknown' || nodes === 0) health = 'unknown';
        else if (issues.length) health = 'warning';
        out.push({
          id: c.id, name: c.name, code: c.code, env: c.env, region: c.region, version: c.version,
          status: c.status, health, healthIssues: issues, healthText: issues.length ? issues.join(' · ') : '运行正常',
          lastSeen: c.last_seen, note: c.note, agentToken: c.agent_token,
          nodeCount: nodes, readyCount: ready, notReadyCount, firingAlerts: firing,
          badPods: Number(badPods), badComps: Number(badComps),
          avgCpu: Number(avgCpu).toFixed(1), avgMem: Number(avgMem).toFixed(1),
        });
      }
      return sendJSON(res, 200, out);
    }
    if (method === 'GET' && id && sub === 'nodes') {
      const [rows] = await pool.query('SELECT * FROM cluster_nodes WHERE cluster_id = ? ORDER BY name', [id]);
      return sendJSON(res, 200, rows.map((n) => ({
        id: n.id, clusterId: n.cluster_id, name: n.name, role: n.role, status: n.status, ip: n.ip,
        kubeletVersion: n.kubelet_version, os: n.os, cpuCores: n.cpu_cores, memTotalMb: n.mem_total_mb,
        cpuUsage: Number(n.cpu_usage), memUsage: Number(n.mem_usage), diskUsage: Number(n.disk_usage),
        podCount: n.pod_count, conditions: n.conditions ? n.conditions.split(',') : [], updatedAt: n.updated_at,
      })));
    }
    if (method === 'GET' && idRaw && sub === 'agent-script') {
      if (!hasPerm(user, 'cluster.manage')) return deny(res);
      const c = await clusterById(Number(idRaw));
      if (!c) return sendJSON(res, 404, { error: '集群不存在' });
      const platform = resolvePlatform(req);
      return sendJSON(res, 200, {
        clusterCode: c.code, clusterName: c.name, token: c.agent_token, platform,
        installScript: buildInstallScript(platform, c.code, c.agent_token, c.name),
        bareMetalScript: buildBareMetalInstall(platform, c.code, c.agent_token, c.name),
        manifest: k8sManifest(platform, c.code, c.agent_token, c.name),
        agentScript: agentScriptBody(platform, c.code, c.agent_token),
        oneLiner: `curl -fsSL '${platform}/api/agent/install.sh?code=${c.code}&token=${c.agent_token}' | bash`,
        bareOneLiner: `curl -fsSL '${platform}/api/agent/install-bare.sh?code=${c.code}&token=${c.agent_token}' | sudo bash`,
      });
    }
    if (method === 'GET' && id && sub === 'components') {
      const [rows] = await pool.query('SELECT * FROM cluster_components WHERE cluster_id = ? ORDER BY category, name', [id]);
      return sendJSON(res, 200, rows.map((c) => ({
        id: c.id, clusterId: c.cluster_id, name: c.name, category: c.category, status: c.status,
        message: c.message, updatedAt: c.updated_at,
      })));
    }
    if (method === 'GET' && id) {
      const c = await clusterById(id);
      if (!c) return sendJSON(res, 404, { error: '集群不存在' });
      return sendJSON(res, 200, {
        id: c.id, name: c.name, code: c.code, env: c.env, region: c.region, version: c.version,
        status: c.status, lastSeen: c.last_seen, note: c.note, agentToken: c.agent_token,
      });
    }
    if (!hasPerm(user, 'cluster.manage')) return deny(res);
    if (method === 'POST') {
      const b = await readBody(req);
      if (!b.name || !b.code) return sendJSON(res, 400, { error: '集群名称和标识不能为空' });
      const [dup] = await pool.query('SELECT id FROM clusters WHERE code = ? OR name = ?', [b.code, b.name]);
      if (dup.length) return sendJSON(res, 400, { error: '集群名称或标识已存在' });
      const token = 'agt_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
      const [r] = await pool.query('INSERT INTO clusters (name, code, env, region, agent_token, note) VALUES (?,?,?,?,?,?)',
        [String(b.name).trim(), String(b.code).trim(), b.env || 'prod', b.region || '', token, b.note || '']);
      await audit(user, 'create', 'cluster', b.name, '接入集群', req);
      return sendJSON(res, 200, { id: r.insertId, name: b.name, code: b.code, env: b.env || 'prod', region: b.region || '', agentToken: token, status: 'unknown', note: b.note || '' });
    }
    if (method === 'PUT' && id) {
      const b = await readBody(req);
      await pool.query('UPDATE clusters SET name = COALESCE(?, name), env = COALESCE(?, env), region = COALESCE(?, region), note = COALESCE(?, note) WHERE id = ?',
        [b.name !== undefined ? b.name : null, b.env !== undefined ? b.env : null, b.region !== undefined ? b.region : null, b.note !== undefined ? b.note : null, id]);
      await audit(user, 'update', 'cluster', String(id), '编辑集群', req);
      return sendJSON(res, 200, { ok: true });
    }
    if (method === 'DELETE' && id) {
      const [rows] = await pool.query('SELECT name FROM clusters WHERE id = ?', [id]);
      if (!rows.length) return sendJSON(res, 404, { error: '集群不存在' });
      await pool.query('DELETE FROM clusters WHERE id = ?', [id]);
      await pool.query('DELETE FROM cluster_nodes WHERE cluster_id = ?', [id]);
      await pool.query('DELETE FROM cluster_components WHERE cluster_id = ?', [id]);
      await pool.query('DELETE FROM cluster_pods WHERE cluster_id = ?', [id]);
      await pool.query('DELETE FROM node_metrics WHERE cluster_id = ?', [id]);
      await audit(user, 'delete', 'cluster', rows[0].name, '删除集群', req);
      return sendJSON(res, 200, { ok: true });
    }
  }

  /* ---------- 节点监控 ---------- */
  if (group === 'nodes') {
    if (!hasPerm(user, 'cluster.view')) return deny(res);
    if (method === 'GET' && idRaw && sub === 'metrics') {
      const [rows] = await pool.query('SELECT * FROM node_metrics WHERE cluster_id = ? AND node_name = ? ORDER BY at DESC LIMIT 60', [Number(query.get('clusterId')) || 0, String(idRaw)]);
      return sendJSON(res, 200, rows.reverse().map((m) => ({
        at: m.at, cpuUsage: Number(m.cpu_usage), memUsage: Number(m.mem_usage), diskUsage: Number(m.disk_usage),
        netRxKbps: Number(m.net_rx_kbps), netTxKbps: Number(m.net_tx_kbps), load1: Number(m.load1),
      })));
    }
    if (method === 'GET' && !id) {
      let sql = 'SELECT n.*, c.name AS cluster_name FROM cluster_nodes n LEFT JOIN clusters c ON n.cluster_id = c.id WHERE 1=1';
      const args = [];
      const cid = query.get('clusterId') || '';
      if (cid) { sql += ' AND n.cluster_id = ?'; args.push(Number(cid)); }
      const st = query.get('status') || '';
      if (st) { sql += ' AND n.status = ?'; args.push(st); }
      const kw = (query.get('keyword') || '').trim();
      if (kw) { sql += ' AND (n.name LIKE ? OR n.ip LIKE ?)'; args.push(`%${kw}%`, `%${kw}%`); }
      return sendJSON(res, 200, await pagedList(query, sql, args, 'ORDER BY n.cluster_id, n.name', (n) => ({
        id: n.id, clusterId: n.cluster_id, clusterName: n.cluster_name, name: n.name, role: n.role,
        status: n.status, ip: n.ip, kubeletVersion: n.kubelet_version, os: n.os,
        cpuCores: n.cpu_cores, memTotalMb: n.mem_total_mb,
        cpuUsage: Number(n.cpu_usage), memUsage: Number(n.mem_usage), diskUsage: Number(n.disk_usage),
        podCount: n.pod_count, conditions: n.conditions ? n.conditions.split(',') : [], updatedAt: n.updated_at,
      })));
    }
  }

  /* ---------- 告警中心 ---------- */
  if (group === 'alerts') {
    if (!hasPerm(user, 'alert.view')) return deny(res);
    if (method === 'GET' && !id) {
      const args = [];
      let where = '';
      const st = query.get('status') || '';
      if (st) { where += ' AND a.status = ?'; args.push(st); }
      const sev = query.get('severity') || '';
      if (sev) { where += ' AND a.severity = ?'; args.push(sev); }
      const cid = query.get('clusterId') || '';
      if (cid) { where += ' AND a.cluster_id = ?'; args.push(Number(cid)); }
      const kw = (query.get('keyword') || '').trim();
      if (kw) { where += ' AND (a.message LIKE ? OR a.target LIKE ?)'; args.push(`%${kw}%`, `%${kw}%`); }

      const mapAlert = (a) => ({
        id: a.id, clusterId: a.cluster_id, clusterName: a.cluster_name, ruleName: a.rule_name,
        target: a.target, metric: a.metric, value: Number(a.value), threshold: Number(a.threshold),
        severity: a.severity, status: a.status, message: a.message, ticketId: a.ticket_id,
        firedAt: a.fired_at, resolvedAt: a.resolved_at,
      });

      // 第一梯队优化：服务端真分页。传 page/pageSize 时返回 {list,total,page,pageSize}；
      // 未传则维持旧行为（最多 300 条），保证存量前端不受影响。
      const page = Number(query.get('page') || 0);
      const pageSize = Number(query.get('pageSize') || 0);
      if (page > 0 && pageSize > 0) {
        const limit = Math.min(Math.max(pageSize, 1), 200);
        const offset = (page - 1) * limit;
        const [[tc]] = await pool.query(
          'SELECT COUNT(*) AS total FROM alerts a WHERE 1=1' + where,
          args
        );
        const [prows] = await pool.query(
          'SELECT a.*, c.name AS cluster_name FROM alerts a LEFT JOIN clusters c ON a.cluster_id = c.id WHERE 1=1'
            + where + ' ORDER BY a.id DESC LIMIT ? OFFSET ?',
          [...args, limit, offset]
        );
        return sendJSON(res, 200, {
          list: prows.map(mapAlert),
          total: Number(tc.total), page, pageSize: limit,
        });
      }

      const [rows] = await pool.query(
        'SELECT a.*, c.name AS cluster_name FROM alerts a LEFT JOIN clusters c ON a.cluster_id = c.id WHERE 1=1'
          + where + ' ORDER BY a.id DESC LIMIT 300',
        args
      );
      return sendJSON(res, 200, rows.map(mapAlert));
    }
    if (method === 'POST' && id && sub === 'resolve') {
      if (!hasPerm(user, 'alert.manage')) return deny(res);
      await pool.query('UPDATE alerts SET status = "resolved", resolved_at = NOW() WHERE id = ?', [id]);
      await notifyResolved(id);
      await audit(user, 'resolve', 'alert', String(id), '手动关闭告警', req);
      return sendJSON(res, 200, { ok: true });
    }
    if (method === 'GET' && id) {
      const [rows] = await pool.query('SELECT * FROM alerts WHERE id = ?', [id]);
      if (!rows.length) return sendJSON(res, 404, { error: '告警不存在' });
      const a = rows[0];
      return sendJSON(res, 200, {
        id: a.id, clusterId: a.cluster_id, ruleName: a.rule_name, target: a.target, metric: a.metric,
        value: Number(a.value), threshold: Number(a.threshold), severity: a.severity, status: a.status,
        message: a.message, ticketId: a.ticket_id, firedAt: a.fired_at, resolvedAt: a.resolved_at,
      });
    }
  }

  /* ---------- 告警规则 ---------- */
  if (group === 'alert-rules') {
    if (!hasPerm(user, 'alert.view')) return deny(res);
    if (method === 'GET') {
      const [rows] = await pool.query('SELECT * FROM alert_rules ORDER BY id');
      return sendJSON(res, 200, rows.map((r) => ({
        id: r.id, name: r.name, metric: r.metric, scope: r.scope, operator: r.operator,
        threshold: Number(r.threshold), durationSec: r.duration_sec, severity: r.severity,
        category: r.category, midCategory: r.mid_category, smallCategory: r.small_category,
        enabled: !!r.enabled, autoTicket: !!r.auto_ticket, note: r.note,
      })));
    }
    if (!hasPerm(user, 'alert.manage')) return deny(res);
    if (method === 'POST') {
      const b = await readBody(req);
      if (!b.name || !b.metric) return sendJSON(res, 400, { error: '规则名称和指标不能为空' });
      const [r] = await pool.query(
        'INSERT INTO alert_rules (name, metric, scope, operator, threshold, duration_sec, severity, category, mid_category, small_category, enabled, auto_ticket, note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [String(b.name).trim(), b.metric, b.scope || 'node', b.operator || '>', Number(b.threshold) || 0,
          Number(b.durationSec) || 300, b.severity || 'high', b.category || '', b.midCategory || '', b.smallCategory || '',
          b.enabled === false ? 0 : 1, b.autoTicket === false ? 0 : 1, b.note || '']
      );
      await audit(user, 'create', 'alertrule', b.name, '新建告警规则', req);
      return sendJSON(res, 200, { id: r.insertId, name: b.name, metric: b.metric, scope: b.scope || 'node', operator: b.operator || '>', threshold: Number(b.threshold) || 0, severity: b.severity || 'high', enabled: true, autoTicket: true });
    }
    if (method === 'PUT' && id) {
      const b = await readBody(req);
      await pool.query(
        'UPDATE alert_rules SET name = COALESCE(?, name), metric = COALESCE(?, metric), scope = COALESCE(?, scope), operator = COALESCE(?, operator), threshold = COALESCE(?, threshold), duration_sec = COALESCE(?, duration_sec), severity = COALESCE(?, severity), category = COALESCE(?, category), mid_category = COALESCE(?, mid_category), small_category = COALESCE(?, small_category), enabled = COALESCE(?, enabled), auto_ticket = COALESCE(?, auto_ticket), note = COALESCE(?, note) WHERE id = ?',
        [b.name !== undefined ? b.name : null, b.metric !== undefined ? b.metric : null, b.scope !== undefined ? b.scope : null,
          b.operator !== undefined ? b.operator : null, b.threshold !== undefined ? Number(b.threshold) : null,
          b.durationSec !== undefined ? Number(b.durationSec) : null, b.severity !== undefined ? b.severity : null,
          b.category !== undefined ? b.category : null, b.midCategory !== undefined ? b.midCategory : null,
          b.smallCategory !== undefined ? b.smallCategory : null,
          b.enabled !== undefined ? (b.enabled ? 1 : 0) : null, b.autoTicket !== undefined ? (b.autoTicket ? 1 : 0) : null,
          b.note !== undefined ? b.note : null, id]
      );
      await audit(user, 'update', 'alertrule', String(id), '编辑告警规则', req);
      return sendJSON(res, 200, { ok: true });
    }
    if (method === 'DELETE' && id) {
      await pool.query('DELETE FROM alert_rules WHERE id = ?', [id]);
      await audit(user, 'delete', 'alertrule', String(id), '删除告警规则', req);
      return sendJSON(res, 200, { ok: true });
    }
  }

  /* ---------- 通知渠道 ---------- */
  if (group === 'notify-channels') {
    if (!hasPerm(user, 'alert.view')) return deny(res);
    if (method === 'GET') {
      const [rows] = await pool.query('SELECT * FROM notify_channels ORDER BY id');
      return sendJSON(res, 200, rows.map((c) => {
        const cfg = parseCfg(c.config);
        // 敏感字段脱敏返回
        const safe = Object.assign({}, cfg);
        if (safe.pass) safe.pass = '******';
        if (safe.secret) safe.secret = '******';
        if (safe.webhook) safe.webhook = String(safe.webhook).replace(/(key=)[^&]+/, '$1******');
        return {
          id: c.id, name: c.name, type: c.type, config: safe, hasConfig: !!c.config,
          enabled: !!c.enabled, onFire: !!c.on_fire, onResolve: !!c.on_resolve,
          minSeverity: c.min_severity, note: c.note, createdAt: c.created_at,
        };
      }));
    }
    if (!hasPerm(user, 'alert.manage')) return deny(res);
    if (method === 'POST') {
      const b = await readBody(req);
      if (!b.name || !b.type) return sendJSON(res, 400, { error: '名称和类型不能为空' });
      if (!['wecom', 'dingtalk', 'email'].includes(b.type)) return sendJSON(res, 400, { error: '类型必须是 wecom / dingtalk / email' });
      const [r] = await pool.query(
        'INSERT INTO notify_channels (name, type, config, enabled, on_fire, on_resolve, min_severity, note) VALUES (?,?,?,?,?,?,?,?)',
        [String(b.name).trim(), b.type, JSON.stringify(b.config || {}), b.enabled === false ? 0 : 1,
          b.onFire === false ? 0 : 1, b.onResolve ? 1 : 0, b.minSeverity || 'normal', b.note || '']
      );
      await audit(user, 'create', 'notify', b.name, '新建通知渠道（' + b.type + '）', req);
      return sendJSON(res, 200, { id: r.insertId, name: b.name, type: b.type });
    }
    if (method === 'PUT' && id) {
      const [rows] = await pool.query('SELECT * FROM notify_channels WHERE id = ?', [id]);
      if (!rows.length) return sendJSON(res, 404, { error: '渠道不存在' });
      const b = await readBody(req);
      // config 若含 ****** 则保留原值
      let cfgJson = null;
      if (b.config !== undefined) {
        const oldCfg = parseCfg(rows[0].config);
        const merged = Object.assign({}, b.config);
        ['pass', 'secret'].forEach((k) => { if (merged[k] === '******') merged[k] = oldCfg[k] || ''; });
        if (merged.webhook && String(merged.webhook).includes('******')) merged.webhook = oldCfg.webhook || '';
        cfgJson = JSON.stringify(merged);
      }
      await pool.query(
        'UPDATE notify_channels SET name = COALESCE(?, name), type = COALESCE(?, type), config = COALESCE(?, config), enabled = COALESCE(?, enabled), on_fire = COALESCE(?, on_fire), on_resolve = COALESCE(?, on_resolve), min_severity = COALESCE(?, min_severity), note = COALESCE(?, note) WHERE id = ?',
        [b.name !== undefined ? b.name : null, b.type !== undefined ? b.type : null, cfgJson,
          b.enabled !== undefined ? (b.enabled ? 1 : 0) : null,
          b.onFire !== undefined ? (b.onFire ? 1 : 0) : null,
          b.onResolve !== undefined ? (b.onResolve ? 1 : 0) : null,
          b.minSeverity !== undefined ? b.minSeverity : null, b.note !== undefined ? b.note : null, id]
      );
      await audit(user, 'update', 'notify', b.name || String(id), '编辑通知渠道', req);
      return sendJSON(res, 200, { ok: true });
    }
    if (method === 'DELETE' && id) {
      const [rows] = await pool.query('SELECT name FROM notify_channels WHERE id = ?', [id]);
      if (!rows.length) return sendJSON(res, 404, { error: '渠道不存在' });
      await pool.query('DELETE FROM notify_channels WHERE id = ?', [id]);
      await audit(user, 'delete', 'notify', rows[0].name, '删除通知渠道', req);
      return sendJSON(res, 200, { ok: true });
    }
  }

  /* ---------- 通知测试 ---------- */
  if (group === 'notify-test' && method === 'POST') {
    if (!hasPerm(user, 'alert.manage')) return deny(res);
    const b = await readBody(req);
    const [rows] = await pool.query('SELECT * FROM notify_channels WHERE id = ?', [b.id]);
    if (!rows.length) return sendJSON(res, 404, { error: '渠道不存在' });
    const ch = rows[0];
    const r = await sendToChannel(ch, {
      clusterName: '测试集群', target: 'test-node-01', severity: 'high',
      message: '【测试消息】这是一条来自智能运维管理平台的测试通知',
      value: 95.5, threshold: 90, metric: 'cpu_usage', count: 1, ticketId: null,
    }, 'firing');
    await pool.query('INSERT INTO notify_logs (channel_id, channel_name, channel_type, event, status, error) VALUES (?,?,?,?,?,?)',
      [ch.id, ch.name, ch.type, 'test', r.ok ? 'ok' : 'fail', r.error || '']);
    if (!r.ok) return sendJSON(res, 200, { ok: false, error: r.error });
    await audit(user, 'test', 'notify', ch.name, '测试通知渠道', req);
    return sendJSON(res, 200, { ok: true });
  }

  /* ---------- 通知日志 ---------- */
  if (group === 'notify-logs' && method === 'GET') {
    if (!hasPerm(user, 'alert.view')) return deny(res);
    const limit = Math.min(Number(query.get('limit') || 100), 500);
    const [rows] = await pool.query('SELECT * FROM notify_logs ORDER BY id DESC LIMIT ' + limit);
    return sendJSON(res, 200, rows.map((l) => ({
      id: l.id, channelName: l.channel_name, channelType: l.channel_type,
      alertId: l.alert_id, event: l.event, status: l.status, error: l.error, at: l.at,
    })));
  }

  /* ---------- 监控总览 ---------- */
  if (group === 'monitor' && method === 'GET' && idRaw === 'summary') {
    if (!hasPerm(user, 'cluster.view')) return deny(res);
    const [[{ clusters }]] = await pool.query('SELECT COUNT(*) AS clusters FROM clusters');
    // 健康集群 = 有节点上报 且 无异常节点/Pod/组件/告警
    const [clRows] = await pool.query('SELECT * FROM clusters');

    // 第二梯队优化：原实现对每个集群发 5 条 SQL（N+1）。
    // 改为 4 条 GROUP BY 一次性取回，循环内纯内存判断。
    const BAD_PODS_SUM = "('CrashLoopBackOff','Error','ImagePullBackOff','ErrImagePull','OOMKilled','Pending','Failed')";
    const [nAgg, nrAgg, bpAgg, bcAgg, fiAgg] = await Promise.all([
      pool.query('SELECT cluster_id, COUNT(*) AS n FROM cluster_nodes GROUP BY cluster_id'),
      pool.query('SELECT cluster_id, COUNT(*) AS nr FROM cluster_nodes WHERE status <> "Ready" GROUP BY cluster_id'),
      pool.query(`SELECT cluster_id, COUNT(*) AS bp FROM cluster_pods WHERE status IN ${BAD_PODS_SUM} GROUP BY cluster_id`),
      pool.query(`SELECT cluster_id, COUNT(*) AS bc FROM cluster_components WHERE status NOT IN ('Healthy','healthy','NotFound','notfound') GROUP BY cluster_id`),
      pool.query(`SELECT cluster_id, COUNT(*) AS fi FROM alerts WHERE status = 'firing' GROUP BY cluster_id`),
    ]);
    const mk = (rs) => { const m = new Map(); for (const r of rs[0]) m.set(Number(r.cluster_id), r); return m; };
    const nMap = mk(nAgg), nrMap = mk(nrAgg), bpMap = mk(bpAgg), bcMap = mk(bcAgg), fiMap = mk(fiAgg);

    let healthy = 0, unhealthy = 0, unknownClusters = 0;
    for (const c of clRows) {
      const n = Number((nMap.get(c.id) || {}).n || 0);
      if (c.status === 'unknown' || n === 0) { unknownClusters++; continue; }
      const nr = Number((nrMap.get(c.id) || {}).nr || 0);
      const bp = Number((bpMap.get(c.id) || {}).bp || 0);
      const bc = Number((bcMap.get(c.id) || {}).bc || 0);
      const fi = Number((fiMap.get(c.id) || {}).fi || 0);
      if (nr || bp || bc || fi) unhealthy++; else healthy++;
    }
    const [[{ nodes }]] = await pool.query('SELECT COUNT(*) AS nodes FROM cluster_nodes');
    const [[{ notReady }]] = await pool.query('SELECT COUNT(*) AS notReady FROM cluster_nodes WHERE status <> "Ready"');
    const [[{ firing }]] = await pool.query('SELECT COUNT(*) AS firing FROM alerts WHERE status = "firing"');
    const [[{ urgent }]] = await pool.query('SELECT COUNT(*) AS urgent FROM alerts WHERE status = "firing" AND severity = "urgent"');
    const [[{ avgCpu }]] = await pool.query('SELECT COALESCE(AVG(cpu_usage),0) AS avgCpu FROM cluster_nodes');
    const [[{ avgMem }]] = await pool.query('SELECT COALESCE(AVG(mem_usage),0) AS avgMem FROM cluster_nodes');
    const [[{ pods }]] = await pool.query('SELECT COUNT(*) AS pods FROM cluster_pods');
    const [[{ badPods }]] = await pool.query("SELECT COUNT(*) AS badPods FROM cluster_pods WHERE status IN ('CrashLoopBackOff','Error','ImagePullBackOff','ErrImagePull','OOMKilled','Pending','Failed')");
    const [[{ badComps }]] = await pool.query("SELECT COUNT(*) AS badComps FROM cluster_components WHERE status NOT IN ('Healthy','healthy','NotFound','notfound')");
    return sendJSON(res, 200, {
      clusters, healthy, unhealthy, unknownClusters, nodes, notReady, firing, urgent, pods, badPods, badComps,
      avgCpu: Number(avgCpu).toFixed(1), avgMem: Number(avgMem).toFixed(1),
    });
  }

  /* ---------- 异常明细（KPI 点击查看） ---------- */
  if (group === 'monitor' && method === 'GET' && idRaw === 'issues') {
    if (!hasPerm(user, 'cluster.view')) return deny(res);
    const kind = query.get('kind') || '';
    // 支持按集群过滤：集群卡片上的红色数字点进去时，只看该集群的明细
    const cid = Number(query.get('clusterId') || 0);
    const cf = (alias) => (cid ? ` AND ${alias}.cluster_id = ?` : '');
    const ca = () => (cid ? [cid] : []);
    const out = { kind, items: [] };
    if (kind === 'notReady') {
      const [rows] = await pool.query('SELECT n.*, c.name AS cluster_name FROM cluster_nodes n LEFT JOIN clusters c ON n.cluster_id = c.id WHERE n.status <> "Ready"' + cf('n') + ' ORDER BY n.cluster_id, n.name', ca());
      out.items = rows.map((n) => ({ cluster: n.cluster_name, target: n.name, detail: n.status + (n.conditions ? ' / ' + n.conditions : ''), status: n.status }));
    } else if (kind === 'badPods') {
      const [rows] = await pool.query("SELECT p.*, c.name AS cluster_name FROM cluster_pods p LEFT JOIN clusters c ON p.cluster_id = c.id WHERE p.status IN ('CrashLoopBackOff','Error','ImagePullBackOff','ErrImagePull','OOMKilled','Pending','Failed')" + cf('p') + " ORDER BY p.cluster_id, p.namespace, p.name", ca());
      out.items = rows.map((p) => ({ cluster: p.cluster_name, target: p.namespace + '/' + p.name, detail: p.status + (p.reason ? ' / ' + p.reason : '') + ' · 重启 ' + p.restarts + ' 次', status: p.status }));
    } else if (kind === 'badComps') {
      const [rows] = await pool.query("SELECT k.*, c.name AS cluster_name FROM cluster_components k LEFT JOIN clusters c ON k.cluster_id = c.id WHERE k.status NOT IN ('Healthy','healthy','NotFound','notfound')" + cf('k') + " ORDER BY k.cluster_id, k.name", ca());
      out.items = rows.map((k) => ({ cluster: k.cluster_name, target: k.name, detail: k.status + (k.message ? ' / ' + k.message : ''), status: k.status }));
    } else if (kind === 'firing') {
      const [rows] = await pool.query('SELECT a.*, c.name AS cluster_name FROM alerts a LEFT JOIN clusters c ON a.cluster_id = c.id WHERE a.status = "firing"' + cf('a') + ' ORDER BY FIELD(a.severity,"urgent","high","normal","low"), a.id DESC', ca());
      out.items = rows.map((a) => ({ cluster: a.cluster_name, target: a.target, detail: a.message, status: a.severity, ticketId: a.ticket_id, alertId: a.id }));
    } else if (kind === 'nodes') {
      const [rows] = await pool.query('SELECT n.*, c.name AS cluster_name FROM cluster_nodes n LEFT JOIN clusters c ON n.cluster_id = c.id WHERE 1=1' + cf('n') + ' ORDER BY n.cluster_id, n.name', ca());
      out.items = rows.map((n) => ({
        cluster: n.cluster_name, target: n.name,
        detail: n.status + ' · CPU ' + Number(n.cpu_usage) + '% · 内存 ' + Number(n.mem_usage) + '% · 磁盘 ' + Number(n.disk_usage) + '% · Pod ' + n.pod_count,
        status: n.status,
      }));
    } else if (kind === 'pods') {
      const [rows] = await pool.query('SELECT p.*, c.name AS cluster_name FROM cluster_pods p LEFT JOIN clusters c ON p.cluster_id = c.id WHERE 1=1' + cf('p') + ' ORDER BY FIELD(p.status,"CrashLoopBackOff","Error","ImagePullBackOff","ErrImagePull","OOMKilled","Pending","Failed","Running","Succeeded"), p.cluster_id, p.namespace, p.name LIMIT 500', ca());
      out.items = rows.map((p2) => ({
        cluster: p2.cluster_name, target: p2.namespace + '/' + p2.name,
        detail: p2.status + (p2.reason ? ' / ' + p2.reason : '') + ' · 就绪 ' + p2.ready + ' · 重启 ' + p2.restarts + ' 次',
        status: p2.status,
      }));
    } else if (kind === 'badClusters') {
      // 有异常节点 / 异常 Pod / 异常组件 / 告警中 的集群
      const [rows] = await pool.query('SELECT * FROM clusters ORDER BY id');
      for (const c of rows) {
        if (c.status === 'unknown') continue;
        const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM cluster_nodes WHERE cluster_id = ?', [c.id]);
        if (!n) continue;
        const [[{ nr }]] = await pool.query('SELECT COUNT(*) AS nr FROM cluster_nodes WHERE cluster_id = ? AND status <> "Ready"', [c.id]);
        const [[{ bp }]] = await pool.query("SELECT COUNT(*) AS bp FROM cluster_pods WHERE cluster_id = ? AND status IN ('CrashLoopBackOff','Error','ImagePullBackOff','ErrImagePull','OOMKilled','Pending','Failed')", [c.id]);
        const [[{ bc }]] = await pool.query("SELECT COUNT(*) AS bc FROM cluster_components WHERE cluster_id = ? AND status NOT IN ('Healthy','healthy','NotFound','notfound')", [c.id]);
        const [[{ fi }]] = await pool.query('SELECT COUNT(*) AS fi FROM alerts WHERE cluster_id = ? AND status = "firing"', [c.id]);
        const issues = [];
        if (Number(nr)) issues.push(nr + ' 个节点异常');
        if (Number(bp)) issues.push(bp + ' 个 Pod 异常');
        if (Number(bc)) issues.push(bc + ' 个组件异常');
        if (Number(fi)) issues.push(fi + ' 条告警中');
        if (!issues.length) continue;
        out.items.push({
          cluster: c.name, target: c.code,
          detail: issues.join(' · ') + '（节点 ' + (n - nr) + '/' + n + ' 就绪）',
          status: 'warning', clusterId: c.id,
        });
      }
    } else if (kind === 'healthy') {
      // 按推导逻辑筛选：有上报且无任何异常
      const [rows] = await pool.query('SELECT * FROM clusters ORDER BY id');
      for (const c of rows) {
        if (c.status === 'unknown') continue;
        const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM cluster_nodes WHERE cluster_id = ?', [c.id]);
        if (!n) continue;
        const [[{ nr }]] = await pool.query('SELECT COUNT(*) AS nr FROM cluster_nodes WHERE cluster_id = ? AND status <> "Ready"', [c.id]);
        const [[{ bp }]] = await pool.query("SELECT COUNT(*) AS bp FROM cluster_pods WHERE cluster_id = ? AND status IN ('CrashLoopBackOff','Error','ImagePullBackOff','ErrImagePull','OOMKilled','Pending','Failed')", [c.id]);
        const [[{ bc }]] = await pool.query("SELECT COUNT(*) AS bc FROM cluster_components WHERE cluster_id = ? AND status NOT IN ('Healthy','healthy','NotFound','notfound')", [c.id]);
        const [[{ fi }]] = await pool.query('SELECT COUNT(*) AS fi FROM alerts WHERE cluster_id = ? AND status = "firing"', [c.id]);
        if (Number(nr) || Number(bp) || Number(bc) || Number(fi)) continue;
        out.items.push({ cluster: c.name, target: c.code, detail: '运行正常 · 版本 ' + (c.version || '-') + ' · 节点 ' + n + ' · 最近上报 ' + (c.last_seen || '-'), status: 'healthy' });
      }
    } else if (kind === 'clusters') {
      const [rows] = await pool.query('SELECT * FROM clusters ORDER BY id');
      out.items = rows.map((c) => ({ cluster: c.name, target: c.code, detail: '状态 ' + c.status + ' · 版本 ' + (c.version || '-'), status: c.status }));
    }
    return sendJSON(res, 200, out);
  }

  /* ---------- 知识库分类 ---------- */
  if (group === 'kb-categories') {
    if (!hasPerm(user, 'kb.view')) return deny(res);
    if (method === 'GET' && !id) {
      const [counts] = await pool.query('SELECT category, COUNT(*) AS c FROM kb GROUP BY category');
      const cmap = {};
      counts.forEach((c) => { cmap[c.category] = c.c; });
      return sendJSON(res, 200, await pagedList(query, 'SELECT * FROM kb_categories', [], 'ORDER BY sort, id', (c) => ({
        id: c.id, name: c.name, desc: c.descr, sort: c.sort, createdAt: c.created_at, docCount: cmap[c.name] || 0,
      })));
    }
    if (method === 'POST') {
      if (!hasPerm(user, 'kb.category.manage')) return deny(res);
      const b = await readBody(req);
      if (!b.name || !String(b.name).trim()) return sendJSON(res, 400, { error: '分类名称不能为空' });
      const [dup] = await pool.query('SELECT id FROM kb_categories WHERE name = ?', [String(b.name).trim()]);
      if (dup.length) return sendJSON(res, 400, { error: '该分类已存在' });
      const [r] = await pool.query('INSERT INTO kb_categories (name, descr, sort) VALUES (?,?,?)',
        [String(b.name).trim(), b.desc || '', Number(b.sort) || 99]);
      await audit(user, 'create', 'kb-category', b.name, '新建知识库分类', req);
      return sendJSON(res, 200, { id: r.insertId, name: b.name, desc: b.desc || '', sort: Number(b.sort) || 99, docCount: 0 });
    }
    if (method === 'PUT' && id) {
      if (!hasPerm(user, 'kb.category.manage')) return deny(res);
      const [rows] = await pool.query('SELECT * FROM kb_categories WHERE id = ?', [id]);
      if (!rows.length) return sendJSON(res, 404, { error: '分类不存在' });
      const b = await readBody(req);
      const oldName = rows[0].name;
      if (b.name !== undefined && String(b.name).trim() && String(b.name).trim() !== oldName) {
        const newName = String(b.name).trim();
        const [dup] = await pool.query('SELECT id FROM kb_categories WHERE name = ? AND id <> ?', [newName, id]);
        if (dup.length) return sendJSON(res, 400, { error: '该分类名已存在' });
        // 改名时同步更新已有文档的 category，避免文档变成孤儿分类
        await pool.query('UPDATE kb SET category = ? WHERE category = ?', [newName, oldName]);
      }
      await pool.query('UPDATE kb_categories SET name = COALESCE(?, name), descr = COALESCE(?, descr), sort = COALESCE(?, sort) WHERE id = ?',
        [b.name !== undefined ? String(b.name).trim() : null, b.desc !== undefined ? b.desc : null, b.sort !== undefined ? Number(b.sort) : null, id]);
      await audit(user, 'update', 'kb-category', b.name || oldName, '编辑知识库分类', req);
      return sendJSON(res, 200, { ok: true });
    }
    if (method === 'DELETE' && id) {
      if (!hasPerm(user, 'kb.category.manage')) return deny(res);
      const [rows] = await pool.query('SELECT * FROM kb_categories WHERE id = ?', [id]);
      if (!rows.length) return sendJSON(res, 404, { error: '分类不存在' });
      const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM kb WHERE category = ?', [rows[0].name]);
      if (c) return sendJSON(res, 400, { error: `该分类下还有 ${c} 篇文档，请先处理文档` });
      await pool.query('DELETE FROM kb_categories WHERE id = ?', [id]);
      await audit(user, 'delete', 'kb-category', rows[0].name, '删除知识库分类', req);
      return sendJSON(res, 200, { ok: true });
    }
    return sendJSON(res, 404, { error: '不支持的操作' });
  }

  /* ---------- 部门管理 ---------- */
  if (group === 'departments') {
    if (!hasPerm(user, 'user.manage')) return deny(res);
    if (method === 'GET' && !id) {
      const [counts] = await pool.query('SELECT dept, COUNT(*) AS c FROM sys_users GROUP BY dept');
      const cmap = {};
      counts.forEach((c) => { cmap[c.dept] = c.c; });
      return sendJSON(res, 200, await pagedList(query, 'SELECT * FROM departments', [], 'ORDER BY sort, id', (d) => ({
        id: d.id, name: d.name, desc: d.descr, sort: d.sort, createdAt: d.created_at, userCount: cmap[d.name] || 0,
      })));
    }
    if (method === 'POST') {
      const b = await readBody(req);
      if (!b.name || !String(b.name).trim()) return sendJSON(res, 400, { error: '部门名称不能为空' });
      const [dup] = await pool.query('SELECT id FROM departments WHERE name = ?', [String(b.name).trim()]);
      if (dup.length) return sendJSON(res, 400, { error: '该部门已存在' });
      const [r] = await pool.query('INSERT INTO departments (name, descr, sort) VALUES (?,?,?)',
        [String(b.name).trim(), b.desc || '', Number(b.sort) || 99]);
      await audit(user, 'create', 'department', b.name, '新建部门', req);
      return sendJSON(res, 200, { id: r.insertId, name: b.name, desc: b.desc || '', sort: Number(b.sort) || 99, userCount: 0 });
    }
    if (method === 'PUT' && id) {
      const [rows] = await pool.query('SELECT * FROM departments WHERE id = ?', [id]);
      if (!rows.length) return sendJSON(res, 404, { error: '部门不存在' });
      const b = await readBody(req);
      const oldName = rows[0].name;
      if (b.name !== undefined && String(b.name).trim() && String(b.name).trim() !== oldName) {
        const newName = String(b.name).trim();
        const [dup] = await pool.query('SELECT id FROM departments WHERE name = ? AND id <> ?', [newName, id]);
        if (dup.length) return sendJSON(res, 400, { error: '该部门名已存在' });
        // 改名同步更新用户 dept，避免用户变成孤儿部门
        await pool.query('UPDATE sys_users SET dept = ? WHERE dept = ?', [newName, oldName]);
      }
      await pool.query('UPDATE departments SET name = COALESCE(?, name), descr = COALESCE(?, descr), sort = COALESCE(?, sort) WHERE id = ?',
        [b.name !== undefined ? String(b.name).trim() : null, b.desc !== undefined ? b.desc : null, b.sort !== undefined ? Number(b.sort) : null, id]);
      await audit(user, 'update', 'department', b.name || oldName, '编辑部门', req);
      return sendJSON(res, 200, { ok: true });
    }
    if (method === 'DELETE' && id) {
      const [rows] = await pool.query('SELECT * FROM departments WHERE id = ?', [id]);
      if (!rows.length) return sendJSON(res, 404, { error: '部门不存在' });
      const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM sys_users WHERE dept = ?', [rows[0].name]);
      if (c) return sendJSON(res, 400, { error: `该部门下还有 ${c} 个用户，请先处理用户` });
      await pool.query('DELETE FROM departments WHERE id = ?', [id]);
      await audit(user, 'delete', 'department', rows[0].name, '删除部门', req);
      return sendJSON(res, 200, { ok: true });
    }
    return sendJSON(res, 404, { error: '不支持的操作' });
  }

  /* ---------- Pod 列表 ---------- */
  if (group === 'pods') {
    if (!hasPerm(user, 'pod.view')) return deny(res);
    if (method === 'GET') {
      const args = [];
      let where = '';
      const cid = query.get('clusterId') || '';
      if (cid) { where += ' AND p.cluster_id = ?'; args.push(Number(cid)); }
      const ns = query.get('namespace') || '';
      if (ns) { where += ' AND p.namespace = ?'; args.push(ns); }
      const st = query.get('status') || '';
      if (st === 'abnormal') where += " AND p.status IN ('CrashLoopBackOff','Error','ImagePullBackOff','ErrImagePull','OOMKilled','Pending','Failed')";
      else if (st) { where += ' AND p.status = ?'; args.push(st); }
      const kw = (query.get('keyword') || '').trim();
      if (kw) { where += ' AND (p.name LIKE ? OR p.namespace LIKE ? OR p.node LIKE ?)'; args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`); }

      const ORDER = ' ORDER BY FIELD(p.status,"CrashLoopBackOff","Error","ImagePullBackOff","ErrImagePull","OOMKilled","Pending","Failed","Running","Succeeded"), p.cluster_id, p.namespace, p.name';
      const SELECT = 'SELECT p.*, c.name AS cluster_name FROM cluster_pods p LEFT JOIN clusters c ON p.cluster_id = c.id WHERE 1=1';
      const mapPod = (p) => ({
        id: p.id, clusterId: p.cluster_id, clusterName: p.cluster_name, namespace: p.namespace,
        name: p.name, node: p.node, phase: p.phase, ready: p.ready, restarts: p.restarts,
        status: p.status, reason: p.reason, cpuMilli: p.cpu_milli, memMb: p.mem_mb, updatedAt: p.updated_at,
      });

      // 第一梯队优化：服务端真分页（同 alerts）
      const page = Number(query.get('page') || 0);
      const pageSize = Number(query.get('pageSize') || 0);
      if (page > 0 && pageSize > 0) {
        const limit = Math.min(Math.max(pageSize, 1), 200);
        const offset = (page - 1) * limit;
        const [[tc]] = await pool.query('SELECT COUNT(*) AS total FROM cluster_pods p WHERE 1=1' + where, args);
        const [prows] = await pool.query(SELECT + where + ORDER + ' LIMIT ? OFFSET ?', [...args, limit, offset]);
        return sendJSON(res, 200, { list: prows.map(mapPod), total: Number(tc.total), page, pageSize: limit });
      }

      const [rows] = await pool.query(SELECT + where + ORDER + ' LIMIT 500', args);
      return sendJSON(res, 200, rows.map(mapPod));
    }
  }

  /* ---------- 操作日志 ---------- */
  if (group === 'audit-logs' && method === 'GET') {
    if (!hasPerm(user, 'audit.view')) return deny(res);
    const kw = (query.get('keyword') || '').trim();
    const mod = query.get('module') || '';
    const limit = Math.min(Number(query.get('limit') || 200), 1000);
    const where = [];
    const args = [];
    if (kw) { where.push('(username LIKE ? OR name LIKE ? OR target LIKE ? OR detail LIKE ?)'); args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`); }
    if (mod) { where.push('module = ?'); args.push(mod); }
    const sql = 'SELECT * FROM audit_logs ' + (where.length ? 'WHERE ' + where.join(' AND ') : '') + ' ORDER BY id DESC LIMIT ' + limit;
    const [rows] = await pool.query(sql, args);
    return sendJSON(res, 200, rows.map((r) => ({
      id: r.id, at: r.at, username: r.username, name: r.name, role: r.role,
      action: r.action, module: r.module, target: r.target, detail: r.detail, ip: r.ip,
    })));
  }
  if (group === 'audit-modules' && method === 'GET') {
    if (!hasPerm(user, 'audit.view')) return deny(res);
    const [rows] = await pool.query('SELECT DISTINCT module FROM audit_logs ORDER BY module');
    return sendJSON(res, 200, rows.map((r) => r.module));
  }

  /* ---------- 组织分组 ---------- */
  if (group === 'groups') {
    if (method === 'GET') {
      const gs = await loadGroups();
      const out = [];
      for (const g of gs) {
        const members = await membersOf(g.id);
        const [[{ o }]] = await pool.query('SELECT COUNT(*) AS o FROM tickets WHERE group_id = ? AND status IN ("pending","processing")', [g.id]);
        const [[{ t }]] = await pool.query('SELECT COUNT(*) AS t FROM tickets WHERE group_id = ?', [g.id]);
        out.push({
          id: g.id, name: g.name, desc: g.descr, leader: g.leader, color: g.color, sort: g.sort, tier: g.tier || 0,
          members: members.map((m) => ({ id: m.id, name: m.name, role: m.role, roleName: (ROLES[m.role] || {}).name })),
          memberCount: members.length, openTickets: o, totalTickets: t,
        });
      }
      return sendJSON(res, 200, out);
    }
    if (!hasPerm(user, 'group.manage')) return deny(res);
    if (method === 'POST') {
      const b = await readBody(req);
      if (!b.name || !String(b.name).trim()) return sendJSON(res, 400, { error: '组名不能为空' });
      const [dup] = await pool.query('SELECT id FROM sys_groups WHERE name = ?', [String(b.name).trim()]);
      if (dup.length) return sendJSON(res, 400, { error: '该组已存在' });
      const [r] = await pool.query('INSERT INTO sys_groups (name, descr, leader, color, sort, tier) VALUES (?,?,?,?,?,?)',
        [String(b.name).trim(), b.desc || '', b.leader || '', b.color || '#2563eb', Number(b.sort) || 99, Number(b.tier) || 0]);
      await loadGroups();
      await audit(user, 'create', 'group', b.name, '新建分组', req);
      return sendJSON(res, 200, { id: r.insertId, name: b.name, desc: b.desc || '', leader: b.leader || '', color: b.color || '#2563eb', sort: Number(b.sort) || 99, tier: Number(b.tier) || 0 });
    }
    if (method === 'PUT' && id) {
      const [rows] = await pool.query('SELECT * FROM sys_groups WHERE id = ?', [id]);
      if (!rows.length) return sendJSON(res, 404, { error: '分组不存在' });
      const b = await readBody(req);
      if (b.name !== undefined) {
        const [dup] = await pool.query('SELECT id FROM sys_groups WHERE name = ? AND id <> ?', [String(b.name).trim(), id]);
        if (dup.length) return sendJSON(res, 400, { error: '该组名已存在' });
      }
      await pool.query('UPDATE sys_groups SET name = COALESCE(?, name), descr = COALESCE(?, descr), leader = COALESCE(?, leader), color = COALESCE(?, color), sort = COALESCE(?, sort), tier = COALESCE(?, tier) WHERE id = ?',
        [b.name !== undefined ? String(b.name).trim() : null, b.desc !== undefined ? b.desc : null, b.leader !== undefined ? b.leader : null, b.color !== undefined ? b.color : null, b.sort !== undefined ? Number(b.sort) : null, b.tier !== undefined ? Number(b.tier) : null, id]);
      await loadGroups();
      await audit(user, 'update', 'group', b.name || String(id), '编辑分组', req);
      return sendJSON(res, 200, { ok: true });
    }
    if (method === 'DELETE' && id) {
      const members = await membersOf(id);
      if (members.length) return sendJSON(res, 400, { error: `该组下还有 ${members.length} 名成员，请先调整成员所属组` });
      const [[{ o }]] = await pool.query('SELECT COUNT(*) AS o FROM tickets WHERE group_id = ? AND status IN ("pending","processing")', [id]);
      if (o) return sendJSON(res, 400, { error: '该组还有未完结工单，无法删除' });
      const nm = groupName(id);
      await pool.query('DELETE FROM sys_groups WHERE id = ?', [id]);
      await pool.query('DELETE FROM dispatch_rules WHERE group_id = ?', [id]);
      await pool.query('DELETE FROM menu_perms WHERE group_id = ?', [id]);
      await loadGroups();
      await audit(user, 'delete', 'group', nm, '删除分组', req);
      return sendJSON(res, 200, { ok: true });
    }
  }

  /* ---------- 转派规则 ---------- */
  if (group === 'dispatch-rules') {
    if (method === 'GET') {
      const [rows] = await pool.query('SELECT * FROM dispatch_rules ORDER BY id');
      return sendJSON(res, 200, rows.map((r) => ({ id: r.id, category: r.category, groupId: r.group_id, groupName: groupName(r.group_id), priority: r.priority, note: r.note })));
    }
    if (!hasPerm(user, 'dispatch.manage')) return deny(res);
    if (method === 'POST') {
      const b = await readBody(req);
      if (!b.category) return sendJSON(res, 400, { error: '请选择工单分类' });
      const [g] = await pool.query('SELECT id FROM sys_groups WHERE id = ?', [Number(b.groupId)]);
      if (!g.length) return sendJSON(res, 400, { error: '处理组无效' });
      const [r] = await pool.query('INSERT INTO dispatch_rules (category, group_id, priority, note) VALUES (?,?,?,?)',
        [b.category, Number(b.groupId), b.priority || 'normal', b.note || '']);
      await audit(user, 'create', 'dispatch', b.category, '新建转派规则 → ' + groupName(Number(b.groupId)), req);
      return sendJSON(res, 200, { id: r.insertId, category: b.category, groupId: Number(b.groupId), groupName: groupName(Number(b.groupId)), priority: b.priority || 'normal', note: b.note || '' });
    }
    if (method === 'PUT' && id) {
      const b = await readBody(req);
      if (b.groupId !== undefined) {
        const [g] = await pool.query('SELECT id FROM sys_groups WHERE id = ?', [Number(b.groupId)]);
        if (!g.length) return sendJSON(res, 400, { error: '处理组无效' });
      }
      await pool.query('UPDATE dispatch_rules SET category = COALESCE(?, category), group_id = COALESCE(?, group_id), priority = COALESCE(?, priority), note = COALESCE(?, note) WHERE id = ?',
        [b.category !== undefined ? b.category : null, b.groupId !== undefined ? Number(b.groupId) : null, b.priority !== undefined ? b.priority : null, b.note !== undefined ? b.note : null, id]);
      await audit(user, 'update', 'dispatch', String(id), '编辑转派规则', req);
      return sendJSON(res, 200, { ok: true });
    }
    if (method === 'DELETE' && id) {
      await pool.query('DELETE FROM dispatch_rules WHERE id = ?', [id]);
      await audit(user, 'delete', 'dispatch', String(id), '删除转派规则', req);
      return sendJSON(res, 200, { ok: true });
    }
  }

  /* ---------- 用户管理 ---------- */
  if (group === 'users') {
    if (!hasPerm(user, 'user.manage')) return deny(res);
    if (method === 'GET' && !id) {
      return sendJSON(res, 200, await pagedList(query, 'SELECT * FROM sys_users', [], 'ORDER BY id', publicUser));
    }
    if (method === 'POST') {
      const b = await readBody(req);
      if (!b.username || !b.name) return sendJSON(res, 400, { error: '账号和姓名不能为空' });
      const [dup] = await pool.query('SELECT id FROM sys_users WHERE username = ?', [b.username]);
      if (dup.length) return sendJSON(res, 400, { error: '账号已存在' });
      if (!ROLES[b.role]) return sendJSON(res, 400, { error: '角色无效' });
      let gid = Number(b.groupId) || null;
      if (!gid) {
        const [g] = await pool.query('SELECT id FROM sys_groups WHERE name = ?', [(ROLES[b.role] || {}).group || '业务用户组']);
        gid = g.length ? g[0].id : (await loadGroups())[0].id;
      }
      const [r] = await pool.query(
        'INSERT INTO sys_users (username, pwd, name, role, group_id, org, dept, phone, active) VALUES (?,?,?,?,?,?,?,?,?)',
        [String(b.username).trim(), String(b.pwd || '123456'), String(b.name).trim(), b.role, gid, b.org || '中烟信息', b.dept || groupName(gid), b.phone || '', b.active === false ? 0 : 1]
      );
      const [rows] = await pool.query('SELECT * FROM sys_users WHERE id = ?', [r.insertId]);
      await audit(user, 'create', 'user', b.username, '新建用户 ' + b.name, req);
      return sendJSON(res, 200, publicUser(rows[0]));
    }
    if (method === 'PUT' && id) {
      const [rows] = await pool.query('SELECT * FROM sys_users WHERE id = ?', [id]);
      if (!rows.length) return sendJSON(res, 404, { error: '用户不存在' });
      const b = await readBody(req);
      if (b.role !== undefined && !ROLES[b.role]) return sendJSON(res, 400, { error: '角色无效' });
      if (b.groupId !== undefined) {
        const [g] = await pool.query('SELECT id FROM sys_groups WHERE id = ?', [Number(b.groupId)]);
        if (!g.length) return sendJSON(res, 400, { error: '分组无效' });
      }
      await pool.query(
        `UPDATE sys_users SET name = COALESCE(?, name), role = COALESCE(?, role), group_id = COALESCE(?, group_id),
         org = COALESCE(?, org), dept = COALESCE(?, dept), phone = COALESCE(?, phone),
         active = COALESCE(?, active), pwd = COALESCE(?, pwd) WHERE id = ?`,
        [b.name !== undefined ? b.name : null, b.role !== undefined ? b.role : null,
          b.groupId !== undefined ? Number(b.groupId) : null, b.org !== undefined ? b.org : null,
          b.dept !== undefined ? b.dept : null, b.phone !== undefined ? b.phone : null,
          b.active !== undefined ? (b.active ? 1 : 0) : null, b.pwd ? String(b.pwd) : null, id]
      );
      const [out] = await pool.query('SELECT * FROM sys_users WHERE id = ?', [id]);
      await audit(user, 'update', 'user', out[0].username, '编辑用户' + (b.role ? ' 角色→' + b.role : '') + (b.active !== undefined ? (b.active ? ' 启用' : ' 停用') : ''), req);
      return sendJSON(res, 200, publicUser(out[0]));
    }
    if (method === 'DELETE' && id) {
      const [rows] = await pool.query('SELECT * FROM sys_users WHERE id = ?', [id]);
      if (!rows.length) return sendJSON(res, 404, { error: '用户不存在' });
      if (rows[0].username === user.username) return sendJSON(res, 400, { error: '不能删除当前登录账号' });
      if (rows[0].username === 'admin') return sendJSON(res, 400, { error: '内置管理员不可删除' });
      await pool.query('DELETE FROM sys_users WHERE id = ?', [id]);
      await audit(user, 'delete', 'user', rows[0].username, '删除用户 ' + rows[0].name, req);
      return sendJSON(res, 200, { ok: true });
    }
  }

  /* ---------- 统计 ---------- */
  if (group === 'stats' && method === 'GET') {
    const scope = hasPerm(user, 'ticket.view.all') ? '' : ' AND (creator = ? OR assignee = ?)';
    const args = hasPerm(user, 'ticket.view.all') ? [] : [user.name, user.name];
    const [rows] = await pool.query('SELECT * FROM tickets WHERE 1=1' + scope, args);
    const list = rows.map(mapTicket);
    const gs = await loadGroups();
    const byGroup = gs.map((g) => ({
      id: g.id, name: g.name, color: g.color,
      total: list.filter((x) => x.groupId === g.id).length,
      open: list.filter((x) => x.groupId === g.id && OPEN_STATUS.has(x.status)).length,
    })).filter((g) => g.total > 0);
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      week.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, created: list.filter((x) => String(x.createdAt).slice(0, 10) === key).length });
    }
    return sendJSON(res, 200, {
      pending: list.filter((x) => x.status === 'pending').length,
      processing: list.filter((x) => x.status === 'processing').length,
      resolved: list.filter((x) => x.status === 'resolved').length,
      closed: list.filter((x) => x.status === 'closed').length,
      overdue: list.filter((x) => x.overdue).length,
      coop: list.filter((x) => x.isCoop).length,
      total: list.length,
      mine: list.filter((x) => x.assignee === user.name && OPEN_STATUS.has(x.status)).length,
      byGroup, week,
    });
  }

  /* ---------- 工单 ---------- */
  if (group === 'tickets') {
    const canSee = (t) => hasPerm(user, 'ticket.view.all') || t.creator === user.name || t.assignee === user.name;

    if (method === 'POST' && id && sub === 'transition') {
      const [rows] = await pool.query('SELECT * FROM tickets WHERE id = ?', [id]);
      const t = rows[0];
      if (!t) return sendJSON(res, 404, { error: '工单不存在' });
      if (!canSee(t)) return deny(res);
      const b = await readBody(req);
      const act = (FLOW[t.status] || []).find((a) => a.action === b.action);
      if (!act) return sendJSON(res, 400, { error: '当前状态不支持该操作' });
      if (!hasPerm(user, act.perm)) return deny(res);
      if (act.owner && t.creator !== user.name) return sendJSON(res, 403, { error: '仅工单创建人可执行该操作' });

      if (act.transfer) {
        let toGroupId = Number(b.toGroupId) || t.group_id;
        let toGroupIdResolved = null;
        const [g] = await pool.query('SELECT * FROM sys_groups WHERE id = ?', [toGroupId]);
        if (!g.length) return sendJSON(res, 400, { error: '目标处理组无效' });
        const fromAssignee = t.assignee, fromGroup = groupName(t.group_id);
        let toAssignee = b.toAssignee ? String(b.toAssignee) : '';

        // 层级链校验：非管理员只能按“一线组员→一线组长→二线组长→二线组员”流转
        const chain = await transferTargetsFor(user, t);
        if (!chain.any) {
          if (!chain.targets.length) return sendJSON(res, 403, { error: '你所在的位置没有可转派的目标（请确认所属组与组长设置）' });
          const hit = toAssignee
            ? chain.targets.find((x) => x.assignee === toAssignee)
            : chain.targets.find((x) => x.groupId === toGroupId);
          if (!hit) {
            return sendJSON(res, 403, { error: '不符合转派流程，可选目标：' + chain.targets.map((x) => x.label).join('、') });
          }
          toAssignee = hit.assignee;
          // 处理组必须与处理人对应
          if (hit.groupId) toGroupIdResolved = hit.groupId;
        }

        if (!toAssignee) {
          const gRow = g[0];
          const [mems] = await pool.query('SELECT name, role FROM sys_users WHERE group_id = ? AND active = 1 AND role <> "user"', [toGroupId]);
          const cand = mems.filter((m) => m.name !== fromAssignee);
          if (!cand.length) return sendJSON(res, 400, { error: '目标组没有可用处理人' });
          const leader = cand.find((m) => m.name === gRow.leader);
          toAssignee = (leader || cand[0]).name;
        } else {
          const [tu] = await pool.query('SELECT id, group_id FROM sys_users WHERE name = ? AND active = 1', [toAssignee]);
          if (!tu.length) return sendJSON(res, 400, { error: '目标处理人无效' });
          // 处理人所属组与目标组必须对应
          if (toGroupIdResolved === null && tu[0].group_id !== toGroupId) {
            return sendJSON(res, 400, { error: '处理人与目标处理组不对应：' + toAssignee + ' 属于「' + groupName(tu[0].group_id) + '」' });
          }
        }
        // 最终以解析出的组为准，保证「组与人对应」
        if (toGroupIdResolved !== null) toGroupId = toGroupIdResolved;
        let newStatus = t.status;
        if (t.status === 'resolved' || t.status === 'closed') newStatus = 'processing';
        await pool.query('UPDATE tickets SET group_id = ?, assignee = ?, status = ? WHERE id = ?', [toGroupId, toAssignee, newStatus, id]);
        await pool.query(
          'INSERT INTO ticket_flow (ticket_id, action, from_status, to_status, by_name, role, note, transfer_from, transfer_to) VALUES (?,?,?,?,?,?,?,?,?)',
          [id, 'transfer', t.status, newStatus, user.name, user.role, (b.note || '').trim() || '转派处理',
            fromAssignee + '@' + fromGroup, toAssignee + '@' + groupName(toGroupId)]
        );
        await audit(user, 'transfer', 'ticket', t.code, fromAssignee + '@' + fromGroup + ' → ' + toAssignee + '@' + groupName(toGroupId), req);
        const [nr] = await pool.query('SELECT * FROM tickets WHERE id = ?', [id]);
        return sendJSON(res, 200, Object.assign(mapTicket(nr[0]), { flow: await flowOf(id), comments: await commentsOf(id) }));
      }

      await pool.query('UPDATE tickets SET status = ? WHERE id = ?', [act.to, id]);
      await pool.query(
        'INSERT INTO ticket_flow (ticket_id, action, from_status, to_status, by_name, role, note) VALUES (?,?,?,?,?,?,?)',
        [id, act.action, t.status, act.to, user.name, user.role, (b.note || '').trim() || act.label]
      );
      await audit(user, act.action, 'ticket', t.code, STATUS_TEXT[t.status] + ' → ' + STATUS_TEXT[act.to], req);
      const [nr] = await pool.query('SELECT * FROM tickets WHERE id = ?', [id]);
      return sendJSON(res, 200, Object.assign(mapTicket(nr[0]), { flow: await flowOf(id), comments: await commentsOf(id) }));
    }

    if (method === 'POST' && id && sub === 'comments') {
      const [rows] = await pool.query('SELECT * FROM tickets WHERE id = ?', [id]);
      const t = rows[0];
      if (!t) return sendJSON(res, 404, { error: '工单不存在' });
      if (!canSee(t)) return deny(res);
      const b = await readBody(req);
      if (!b.content) return sendJSON(res, 400, { error: '回复内容不能为空' });
      await pool.query('INSERT INTO ticket_comments (ticket_id, by_name, content) VALUES (?,?,?)', [id, user.name, String(b.content)]);
      await audit(user, 'comment', 'ticket', t.code, String(b.content).slice(0, 60), req);
      return sendJSON(res, 200, Object.assign(mapTicket(t), { flow: await flowOf(id), comments: await commentsOf(id) }));
    }

    if (method === 'GET' && id && sub === 'transfer-targets') {
      const [rows0] = await pool.query('SELECT * FROM tickets WHERE id = ?', [id]);
      const t0 = rows0[0];
      if (!t0) return sendJSON(res, 404, { error: '工单不存在' });
      if (!canSee(t0)) return deny(res);
      return sendJSON(res, 200, await transferTargetsFor(user, t0));
    }

    if (method === 'GET' && !id) {
      const scope = hasPerm(user, 'ticket.view.all') ? '' : ' AND (creator = ? OR assignee = ?)';
      const args = hasPerm(user, 'ticket.view.all') ? [] : [user.name, user.name];
      let where = '';
      const kw = (query.get('keyword') || '').trim();
      if (kw) { where += ' AND (title LIKE ? OR code LIKE ? OR creator LIKE ? OR assignee LIKE ?)'; args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`); }
      const st = query.get('status') || '';
      if (st && st !== 'overdue') { where += ' AND status = ?'; args.push(st); }
      const cat = query.get('category') || '';
      if (cat) { where += ' AND category = ?'; args.push(cat); }
      const big = query.get('bigCategory') || '';
      if (big) { where += ' AND big_category = ?'; args.push(big); }
      const mid = query.get('midCategory') || '';
      if (mid) { where += ' AND mid_category = ?'; args.push(mid); }
      if (query.get('coop') === '1') where += ' AND is_coop = 1';
      if (query.get('mine') === '1') { where += ' AND assignee = ?'; args.push(user.name); }
      const gid = query.get('groupId') || '';
      if (gid) { where += ' AND group_id = ?'; args.push(Number(gid)); }

      const page = Number(query.get('page') || 0);
      const pageSize = Number(query.get('pageSize') || 0);
      // overdue 依赖 mapTicket 计算字段，无法在 SQL 层过滤：为保证 total 准确，
      // 该场景维持全量+内存过滤（与改造前行为一致），不做分页。
      if (page > 0 && pageSize > 0 && st !== 'overdue') {
        const limit = Math.min(Math.max(pageSize, 1), 200);
        const offset = (page - 1) * limit;
        const [[tc]] = await pool.query('SELECT COUNT(*) AS total FROM tickets WHERE 1=1' + scope + where, args);
        const [prows] = await pool.query(
          'SELECT * FROM tickets WHERE 1=1' + scope + where + ' ORDER BY id DESC LIMIT ? OFFSET ?',
          [...args, limit, offset]
        );
        return sendJSON(res, 200, {
          list: prows.map(mapTicket),
          total: Number(tc.total), page, pageSize: limit,
        });
      }

      const [rows] = await pool.query('SELECT * FROM tickets WHERE 1=1' + scope + where + ' ORDER BY id DESC', args);
      let list = rows.map(mapTicket);
      if (st === 'overdue') list = list.filter((x) => x.overdue);
      return sendJSON(res, 200, list);
    }

    if (method === 'GET' && id) {
      const [rows] = await pool.query('SELECT * FROM tickets WHERE id = ?', [id]);
      const t = rows[0];
      if (!t) return sendJSON(res, 404, { error: '工单不存在' });
      if (!canSee(t)) return deny(res);
      return sendJSON(res, 200, Object.assign(mapTicket(t), {
        flow: await flowOf(id), comments: await commentsOf(id),
        actions: availableActions(user, { status: t.status, creator: t.creator }),
        canEdit: hasPerm(user, 'ticket.edit') || t.creator === user.name,
        canDelete: hasPerm(user, 'ticket.delete'),
        canComment: canSee(t),
      }));
    }

    if (method === 'POST' && !id) {
      if (!hasPerm(user, 'ticket.create')) return deny(res);
      const b = await readBody(req);
      if (!b.title) return sendJSON(res, 400, { error: '工单标题不能为空' });
      const category = b.category || '其他';
      const priority = b.priority || 'normal';
      let gid = Number(b.groupId) || null;
      let assignee = b.assignee ? String(b.assignee) : '';

      // 组与人必须对应：以处理人所属组为准，并校验一致性
      if (assignee) {
        const [u2] = await pool.query('SELECT id, group_id, role, active FROM sys_users WHERE name = ?', [assignee]);
        if (!u2.length || u2[0].active === 0) return sendJSON(res, 400, { error: '处理人无效或已停用' });
        const userGroup = u2[0].group_id;
        if (gid && userGroup !== gid) {
          return sendJSON(res, 400, { error: '处理人与所选处理组不对应：' + assignee + ' 属于「' + groupName(userGroup) + '」' });
        }
        gid = userGroup;
      }
      if (!gid) {
        const [r] = await pool.query('SELECT group_id FROM dispatch_rules WHERE category = ? ORDER BY FIELD(priority, ?, "urgent","high","normal","low") LIMIT 1', [category, priority]);
        if (r.length) gid = r[0].group_id;
      }
      if (!gid) {
        const [g] = await pool.query('SELECT id FROM sys_groups WHERE name = "技术支持组"');
        gid = g.length ? g[0].id : (await loadGroups())[0].id;
      }
      if (!assignee) {
        const [g] = await pool.query('SELECT leader FROM sys_groups WHERE id = ?', [gid]);
        const [mems] = await pool.query('SELECT name FROM sys_users WHERE group_id = ? AND active = 1 AND role <> "user" AND name <> ?', [gid, user.name]);
        const leader = g.length ? g[0].leader : '';
        assignee = (mems.find((m) => m.name === leader) || mems[0] || { name: '待分配' }).name;
      }
      const dueDays = Number(b.dueDays) || 1;
      const bigCat = b.bigCategory || '';
      const midCat = b.midCategory || '';
      const smallCat = b.smallCategory || '';
      const [r] = await pool.query(
        `INSERT INTO tickets (code, title, status, priority, category, big_category, mid_category, small_category, creator, assignee, group_id, asset, is_coop, due_at, descr)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,DATE_ADD(NOW(), INTERVAL ? DAY),?)`,
        ['WO' + Date.now().toString().slice(-8), String(b.title), 'pending', priority, smallCat || category,
          bigCat, midCat, smallCat, user.name, assignee, gid, b.asset || '-', b.isCoop ? 1 : 0, dueDays, b.description || '']
      );
      await pool.query('UPDATE tickets SET code = ? WHERE id = ?', ['WO' + String(20260000 + r.insertId), r.insertId]);
      await pool.query(
        'INSERT INTO ticket_flow (ticket_id, action, from_status, to_status, by_name, role, note) VALUES (?,?,?,?,?,?,?)',
        [r.insertId, 'create', null, 'pending', user.name, user.role, '提交工单，自动指派至「' + groupName(gid) + '」·' + assignee]
      );
      await audit(user, 'create', 'ticket', 'WO' + String(20260000 + r.insertId), b.title + ' → ' + groupName(gid) + '·' + assignee, req);
      const [nr] = await pool.query('SELECT * FROM tickets WHERE id = ?', [r.insertId]);
      return sendJSON(res, 200, mapTicket(nr[0]));
    }

    if (method === 'PUT' && id) {
      const [rows] = await pool.query('SELECT * FROM tickets WHERE id = ?', [id]);
      const t = rows[0];
      if (!t) return sendJSON(res, 404, { error: '工单不存在' });
      const b = await readBody(req);
      if (!hasPerm(user, 'ticket.edit') && t.creator !== user.name) return deny(res);
      await pool.query(
        `UPDATE tickets SET title = COALESCE(?, title), priority = COALESCE(?, priority), category = COALESCE(?, category),
         big_category = COALESCE(?, big_category), mid_category = COALESCE(?, mid_category), small_category = COALESCE(?, small_category),
         asset = COALESCE(?, asset), descr = COALESCE(?, descr), is_coop = COALESCE(?, is_coop) WHERE id = ?`,
        [b.title !== undefined ? b.title : null, b.priority !== undefined ? b.priority : null,
          b.smallCategory !== undefined ? b.smallCategory : (b.category !== undefined ? b.category : null),
          b.bigCategory !== undefined ? b.bigCategory : null,
          b.midCategory !== undefined ? b.midCategory : null,
          b.smallCategory !== undefined ? b.smallCategory : null,
          b.asset !== undefined ? b.asset : null,
          b.description !== undefined ? b.description : null, b.isCoop !== undefined ? (b.isCoop ? 1 : 0) : null, id]
      );
      await audit(user, 'update', 'ticket', t.code, '编辑工单', req);
      const [nr] = await pool.query('SELECT * FROM tickets WHERE id = ?', [id]);
      return sendJSON(res, 200, mapTicket(nr[0]));
    }

    if (method === 'DELETE' && id) {
      if (!hasPerm(user, 'ticket.delete')) return deny(res);
      const [rows] = await pool.query('SELECT * FROM tickets WHERE id = ?', [id]);
      if (!rows.length) return sendJSON(res, 404, { error: '工单不存在' });
      await pool.query('DELETE FROM tickets WHERE id = ?', [id]);
      await pool.query('DELETE FROM ticket_flow WHERE ticket_id = ?', [id]);
      await pool.query('DELETE FROM ticket_comments WHERE ticket_id = ?', [id]);
      await audit(user, 'delete', 'ticket', rows[0].code, rows[0].title, req);
      return sendJSON(res, 200, { ok: true });
    }
  }

  /* ---------- 工单关联资产：单位 → 资产 两级 ---------- */
  if (group === 'ticket-assets') {
    if (!hasPerm(user, 'asset.view')) return deny(res);
    // 参与关联的资产分类（资料库不参与）
    const ASSET_CATS = ['物理服务器', '存储设备', '网络设备', '虚拟机', '端侧设备配置', '工互传输注册信息'];

    // 单位清单（各资产分类里出现过的「单位名称」）
    if (method === 'GET' && idRaw === 'units') {
      const [rows] = await pool.query(
        'SELECT category, data FROM res_records WHERE deleted_at IS NULL AND category IN (' + ASSET_CATS.map(() => '?').join(',') + ')',
        ASSET_CATS
      );
      const cnt = {};
      for (const r of rows) {
        let d = {};
        try { d = JSON.parse(r.data || '{}'); } catch (_) { d = {}; }
        const u = String(d.unit || '').trim();
        if (u) cnt[u] = (cnt[u] || 0) + 1;
      }
      return sendJSON(res, 200, Object.entries(cnt).map(([unit, count]) => ({ unit, count })).sort((a, b) => a.unit.localeCompare(b.unit, 'zh')));
    }

    // 解析单个资产标识（形如 "物理服务器#18" 或旧值 "srv-app-03"）→ 可读信息
    if (method === 'GET' && idRaw === 'resolve') {
      const v = query.get('value') || '';
      if (!v) return sendJSON(res, 200, { value: '', label: '', unit: '', found: false });
      const m = String(v).match(/^(.+)#(\d+)$/);
      if (m) {
        const [rs] = await pool.query('SELECT id, category, data FROM res_records WHERE id = ?', [Number(m[2])]);
        if (rs.length) {
          const r = rs[0];
          let d = {};
          try { d = JSON.parse(r.data || '{}'); } catch (_) { d = {}; }
          const primary = d.dev_name || d.vm_name || d.gi_app_name || d.model || d.code || '(未命名)';
          const parts = [primary];
          if (d.model && d.model !== primary) parts.push(d.model);
          if (d.ip) parts.push(d.ip);
          return sendJSON(res, 200, {
            value: v, found: true, unit: d.unit || '', category: r.category,
            label: parts.filter(Boolean).join(' · '),
          });
        }
      }
      // 旧 assets 表（历史工单）
      const [oa] = await pool.query('SELECT code, name, ip, owner FROM assets WHERE code = ?', [v]);
      if (oa.length) {
        const a = oa[0];
        return sendJSON(res, 200, { value: v, found: true, unit: '', category: '资产台账', label: `${a.name}（${a.code}）` });
      }
      return sendJSON(res, 200, { value: v, found: false, label: v });
    }

    // 某单位下的资产清单
    if (method === 'GET') {
      const unit = query.get('unit') || '';
      if (!unit) return sendJSON(res, 400, { error: '缺少 unit' });
      const [rows] = await pool.query(
        'SELECT id, category, data FROM res_records WHERE deleted_at IS NULL AND category IN (' + ASSET_CATS.map(() => '?').join(',') + ') ORDER BY category, id',
        ASSET_CATS
      );
      const out = [];
      for (const r of rows) {
        let d = {};
        try { d = JSON.parse(r.data || '{}'); } catch (_) { d = {}; }
        if (String(d.unit || '').trim() !== unit) continue;
        // 取一个最能标识该资产的名称
        const primary = d.dev_name || d.vm_name || d.gi_app_name || d.model || d.code || '(未命名)';
        const parts = [primary];
        if (d.model && d.model !== primary) parts.push(d.model);
        if (d.ip) parts.push(d.ip);
        const label = parts.filter(Boolean).join(' · ');
        out.push({
          id: r.id, category: r.category,
          label: label,
          value: r.category + '#' + r.id,   // 存库用的稳定标识
          code: d.code || '', ip: d.ip || '', model: d.model || '',
        });
      }
      return sendJSON(res, 200, out);
    }
    return sendJSON(res, 404, { error: '不支持的操作' });
  }

  /* ---------- 资源分类（字段定义）---------- */
  if (group === 'res') {
    if (!hasPerm(user, 'asset.view')) return deny(res);
    // 路由形如 /api/res/records/:id[/audit]，记录 id 在 seg[2]，动作在 seg[3]
    const rid = Number(seg[2]) || null;
    const ract = seg[3] || '';

    // 分类清单（含字段定义）
    if (method === 'GET' && idRaw === 'categories') {
      const [cats] = await pool.query('SELECT name, kind FROM res_categories ORDER BY sort, id');
      const [flds] = await pool.query('SELECT * FROM res_fields ORDER BY category, sort, id');
      const byCat = {};
      for (const f of flds) {
        (byCat[f.category] = byCat[f.category] || []).push({
          key: f.field_key, label: f.label, type: f.ftype, unit: f.res_unit || '',
          required: f.required === 1, inList: f.in_list === 1, optionsSource: f.options_source || '',
        });
      }
      return sendJSON(res, 200, cats.map((c) => ({ name: c.name, kind: c.kind, fields: byCat[c.name] || [] })));
    }

    // 下拉数据源：返回某分类某字段的去重值
    if (method === 'GET' && idRaw === 'options') {
      const cat = query.get('category') || '';
      const fk = query.get('field') || '';
      if (!cat || !fk) return sendJSON(res, 400, { error: '缺少参数' });
      const [rows] = await pool.query('SELECT data FROM res_records WHERE category = ? AND deleted_at IS NULL', [cat]);
      const set = new Set();
      for (const r of rows) {
        try {
          const d = JSON.parse(r.data || '{}');
          const v = d[fk];
          if (v !== undefined && v !== null && String(v).trim() !== '') set.add(String(v).trim());
        } catch (_) { /* ignore */ }
      }
      return sendJSON(res, 200, Array.from(set).sort());
    }

    // 单位清单（跨分类汇总，供 @units 使用）
    if (method === 'GET' && idRaw === 'units') {
      const [rows] = await pool.query("SELECT data FROM res_records WHERE deleted_at IS NULL");
      const set = new Set();
      for (const r of rows) {
        try {
          const d = JSON.parse(r.data || '{}');
          if (d.unit) set.add(String(d.unit).trim());
        } catch (_) { /* ignore */ }
      }
      return sendJSON(res, 200, Array.from(set).sort());
    }

    // 列表（按分类）—— !rid 守卫：避免 /records/5 被列表分支抢先匹配
    if (method === 'GET' && idRaw === 'records' && !rid) {
      const cat = query.get('category') || '';
      if (!cat) return sendJSON(res, 400, { error: '缺少 category' });
      const args = [cat];
      let where = '';
      if (query.get('showDeleted') === '1') where += ' AND deleted_at IS NOT NULL';
      else where += ' AND deleted_at IS NULL';
      const audit = query.get('auditStatus') || '';
      if (audit) { where += ' AND audit_status = ?'; args.push(audit); }
      const kw = (query.get('keyword') || '').trim();
      const [rows] = await pool.query(
        'SELECT * FROM res_records WHERE category = ?' + where + ' ORDER BY id DESC', args
      );
      let list = rows.map((r) => {
        let d = {};
        try { d = JSON.parse(r.data || '{}'); } catch (_) { d = {}; }
        return Object.assign({}, d, {
          _id: r.id, _auditStatus: r.audit_status, _auditBy: r.audit_by,
          _auditAt: r.audit_at, _auditNote: r.audit_note, _deletedAt: r.deleted_at,
          _createdBy: r.created_by, _createdAt: r.created_at,
        });
      });
      if (kw) {
        const k = kw.toLowerCase();
        list = list.filter((r) => Object.keys(r).some((kk) => String(r[kk] == null ? '' : r[kk]).toLowerCase().includes(k)));
      }
      return sendJSON(res, 200, list);
    }

    // 详情
    if (method === 'GET' && rid && !ract) {
      const [rows] = await pool.query('SELECT * FROM res_records WHERE id = ?', [rid]);
      if (!rows.length) return sendJSON(res, 404, { error: '记录不存在' });
      const r = rows[0];
      let d = {};
      try { d = JSON.parse(r.data || '{}'); } catch (_) { d = {}; }
      return sendJSON(res, 200, Object.assign({}, d, {
        _id: r.id, category: r.category, _auditStatus: r.audit_status,
        _auditBy: r.audit_by, _auditAt: r.audit_at, _auditNote: r.audit_note, _deletedAt: r.deleted_at,
      }));
    }

    // 新增（一线 → 待审核；有二线权限则直接通过）
    if (method === 'POST' && idRaw === 'records' && !rid) {
      if (!hasPerm(user, 'asset.manage')) return deny(res);
      const b = await readBody(req);
      const cat = b.category;
      if (!cat) return sendJSON(res, 400, { error: '缺少 category' });
      const [c] = await pool.query('SELECT name, kind FROM res_categories WHERE name = ?', [cat]);
      if (!c.length) return sendJSON(res, 400, { error: '分类不存在' });
      const data = Object.assign({}, b.data || {});
      delete data._id; delete data.category;
      const approved = hasPerm(user, 'asset.audit');
      const [r] = await pool.query(
        'INSERT INTO res_records (category, data, audit_status, audit_by, audit_at, created_by) VALUES (?,?,?,?,?,?)',
        [cat, JSON.stringify(data), approved ? 'approved' : 'pending',
         approved ? user.name : '', approved ? new Date() : null, user.name]
      );
      await audit(user, 'create', 'res', cat, '新增 ' + cat + ' 记录', req);
      return sendJSON(res, 200, { ok: true, id: r.insertId });
    }

    // 编辑
    if (method === 'PUT' && rid) {
      if (!hasPerm(user, 'asset.manage')) return deny(res);
      const [rows] = await pool.query('SELECT * FROM res_records WHERE id = ?', [rid]);
      if (!rows.length) return sendJSON(res, 404, { error: '记录不存在' });
      const b = await readBody(req);
      const data = Object.assign({}, b.data || {});
      delete data._id; delete data.category;
      await pool.query('UPDATE res_records SET data = ? WHERE id = ?', [JSON.stringify(data), rid]);
      await audit(user, 'update', 'res', rows[0].category, '编辑记录 #' + rid, req);
      return sendJSON(res, 200, { ok: true });
    }

    // 审核动作  /api/res/records/:id/audit
    if (method === 'POST' && rid && ract === 'audit') {
      const [rows] = await pool.query('SELECT * FROM res_records WHERE id = ?', [rid]);
      const r = rows[0];
      if (!r) return sendJSON(res, 404, { error: '记录不存在' });
      const b = await readBody(req);
      const flow = ASSET_AUDIT_FLOW[r.audit_status || 'pending'] || [];
      const t = flow.find((x) => x.action === b.action);
      if (!t) return sendJSON(res, 400, { error: '当前审核状态不支持该操作' });
      if (!hasPerm(user, t.perm)) return deny(res);
      await pool.query('UPDATE res_records SET audit_status = ?, audit_by = ?, audit_at = NOW(), audit_note = ? WHERE id = ?',
        [t.to, user.name, String(b.note || '').slice(0, 255), rid]);
      await audit(user, 'audit', 'res', r.category, t.label + ' #' + rid, req);
      return sendJSON(res, 200, { ok: true, auditStatus: t.to });
    }

    // 软删除 / 彻底删除
    if (method === 'DELETE' && rid) {
      if (!hasPerm(user, 'asset.manage')) return deny(res);
      if (query.get('hard') === '1') await pool.query('DELETE FROM res_records WHERE id = ?', [rid]);
      else await pool.query('UPDATE res_records SET deleted_at = NOW() WHERE id = ?', [rid]);
      await audit(user, 'delete', 'res', String(rid), '删除记录', req);
      return sendJSON(res, 200, { ok: true });
    }

    // 批量删除
    if (method === 'POST' && idRaw === 'batch-delete') {
      if (!hasPerm(user, 'asset.manage')) return deny(res);
      const b = await readBody(req);
      const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Boolean) : [];
      if (!ids.length) return sendJSON(res, 400, { error: '未选择记录' });
      await pool.query(`UPDATE res_records SET deleted_at = NOW() WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
      await audit(user, 'delete', 'res', ids.join(','), `批量删除 ${ids.length} 条`, req);
      return sendJSON(res, 200, { ok: true, count: ids.length });
    }

    // 导入（Excel）
    if (method === 'POST' && idRaw === 'import') {
      if (!hasPerm(user, 'asset.manage')) return deny(res);
      const cat = query.get('category') || '';
      if (!cat) return sendJSON(res, 400, { error: '缺少 category' });
      const [c] = await pool.query('SELECT name FROM res_categories WHERE name = ?', [cat]);
      if (!c.length) return sendJSON(res, 400, { error: '分类不存在' });
      const [flds] = await pool.query('SELECT field_key, label FROM res_fields WHERE category = ? ORDER BY sort, id', [cat]);
      // 同名标签可能对应多个字段（真实表格里「所属业务系统」出现两次），
      // 因此按出现顺序逐个消费，避免后一列覆盖前一列导致数据丢失。
      const labelQueue = {};
      for (const f of flds) (labelQueue[f.label] = labelQueue[f.label] || []).push(f.field_key);
      // 同时接受带单位后缀的表头（如「内存容量(GB)」→「内存容量」）
      for (const f of flds) {
        if (!f.res_unit) continue;
        const withUnit = `${f.label}(${f.res_unit})`;
        (labelQueue[withUnit] = labelQueue[withUnit] || []).push(f.field_key);
      }

      const buf = await readRaw(req);
      if (!buf.length) return sendJSON(res, 400, { error: '未收到文件' });
      let rows;
      try { rows = parseXlsx(buf); } catch (e) { return sendJSON(res, 400, { error: 'Excel 解析失败：' + e.message }); }
      if (rows.length < 2) return sendJSON(res, 400, { error: '文件没有数据行' });

      const header = rows[0].map((h) => String(h || '').trim());
      const usedLabel = {};
      const colKey = header.map((h) => {
        const q = labelQueue[h];
        if (!q) return null;
        const i = usedLabel[h] || 0;
        usedLabel[h] = i + 1;
        return q[i] !== undefined ? q[i] : null;
      });
      const approved = hasPerm(user, 'asset.audit');
      let ok = 0, skip = 0;
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const data = {};
        let hasVal = false;
        for (let ci = 0; ci < colKey.length; ci++) {
          if (!colKey[ci]) continue;
          const v = r[ci] === undefined ? '' : String(r[ci]).trim();
          if (v !== '') hasVal = true;
          data[colKey[ci]] = v;
        }
        if (!hasVal) { skip++; continue; }
        await pool.query(
          'INSERT INTO res_records (category, data, audit_status, audit_by, audit_at, created_by) VALUES (?,?,?,?,?,?)',
          [cat, JSON.stringify(data), approved ? 'approved' : 'pending',
           approved ? user.name : '', approved ? new Date() : null, user.name]
        );
        ok++;
      }
      await audit(user, 'import', 'res', cat, `导入 ${ok} 条（跳过 ${skip} 空行）`, req);
      // 未匹配列（排除表格自带的「序号」列，它不属于字段定义）
      const unmatched = header.filter((h, i) => !colKey[i] && h && h !== '序号').length;
      return sendJSON(res, 200, { ok: true, imported: ok, skipped: skip, unmatched });
    }

    // 导出（Excel）
    if (method === 'GET' && idRaw === 'export') {
      const cat = query.get('category') || '';
      if (!cat) return sendJSON(res, 400, { error: '缺少 category' });
      const [flds] = await pool.query('SELECT * FROM res_fields WHERE category = ? ORDER BY sort, id', [cat]);
      if (!flds.length) return sendJSON(res, 400, { error: '分类不存在' });
      const [rows] = await pool.query('SELECT data FROM res_records WHERE category = ? AND deleted_at IS NULL ORDER BY id', [cat]);
      // 导出表头带单位，便于人工识别；导入时会去掉括号后缀再匹配
      const header = flds.map((f) => (f.res_unit ? `${f.label}(${f.res_unit})` : f.label));
      const body = rows.map((r) => {
        let d = {};
        try { d = JSON.parse(r.data || '{}'); } catch (_) { d = {}; }
        return flds.map((f) => d[f.field_key] === undefined ? '' : d[f.field_key]);
      });
      const buf = buildXlsx(header, body);
      return sendBuf(res, 200, buf, cat + '_' + new Date().toISOString().slice(0, 10) + '.xlsx');
    }

    return sendJSON(res, 404, { error: '不支持的操作' });
  }

  /* ---------- 资产 ---------- */
  if (group === 'assets') {
    if (!hasPerm(user, 'asset.view')) return deny(res);
    // 资源分类清单（前端页签）——必须排在列表分支之前：
    // Number('res-categories') 为 NaN，若放在后面会被 !id 的列表分支抢先匹配
    if (method === 'GET' && idRaw === 'res-categories') {
      return sendJSON(res, 200, RES_CATEGORIES);
    }
    if (method === 'GET' && !id) {
      const args = [];
      let where = '';
      // 软删除：默认不显示已删除，除非显式要求
      const showDeleted = query.get('showDeleted') === '1';
      where += showDeleted ? ' AND a.deleted_at IS NOT NULL' : ' AND a.deleted_at IS NULL';
      const kw = (query.get('keyword') || '').trim();
      if (kw) { where += ' AND (a.name LIKE ? OR a.code LIKE ? OR a.ip LIKE ? OR a.owner LIKE ? OR u.name LIKE ?)'; args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`); }
      // 资源分类（页签）优先，回退旧的 type
      const rc = query.get('resCategory') || '';
      if (rc) { where += ' AND a.res_category = ?'; args.push(rc); }
      const type = query.get('type') || '';
      if (type) { where += ' AND a.type = ?'; args.push(type); }
      const audit = query.get('auditStatus') || '';
      if (audit) { where += ' AND a.audit_status = ?'; args.push(audit); }
      const st = query.get('status') || '';
      if (st) { where += ' AND a.status = ?'; args.push(st); }
      const unit = query.get('unit') || '';
      if (unit) { where += ' AND a.unit = ?'; args.push(unit); }
      const oid = query.get('ownerId') || '';
      if (oid) { where += ' AND a.owner_id = ?'; args.push(Number(oid)); }
      const sql = 'SELECT a.*, u.name AS owner_name, u.username AS owner_username,' +
        ' (SELECT COUNT(*) FROM asset_software s WHERE s.asset_id = a.id) AS software_count' +
        ' FROM assets a LEFT JOIN sys_users u ON a.owner_id = u.id WHERE 1=1' + where;
      return sendJSON(res, 200, await pagedList(query, sql, args, 'ORDER BY a.id DESC', (a) => ({
        id: a.id, code: a.code, name: a.name, type: a.type, resCategory: a.res_category,
        ip: a.ip, location: a.location,
        owner: a.owner, ownerId: a.owner_id, ownerName: a.owner_name || a.owner, ownerUsername: a.owner_username,
        status: a.status, unit: a.unit, memGb: a.mem_gb, diskGb: a.disk_gb, cpuCores: a.cpu_cores, room: a.room,
        auditStatus: a.audit_status, auditBy: a.audit_by, auditAt: a.audit_at, auditNote: a.audit_note,
        deletedAt: a.deleted_at,
        purchaseDate: a.purchase_date, note: a.note, softwareCount: Number(a.software_count || 0),
      })));
    }
    // 单位清单（筛选下拉）
    if (method === 'GET' && idRaw === 'units') {
      const [rows] = await pool.query("SELECT DISTINCT unit FROM assets WHERE unit IS NOT NULL AND unit <> '' ORDER BY unit");
      return sendJSON(res, 200, rows.map((r) => r.unit));
    }
    // 审核动作（服务端权威：按当前状态 + 权限给出可执行动作）
    if (method === 'POST' && id && sub === 'audit') {
      const [rows] = await pool.query('SELECT * FROM assets WHERE id = ?', [id]);
      const a = rows[0];
      if (!a) return sendJSON(res, 404, { error: '资产不存在' });
      const b = await readBody(req);
      const act = b.action;
      const flow = ASSET_AUDIT_FLOW[a.audit_status || 'pending'] || [];
      const t = flow.find((x) => x.action === act);
      if (!t) return sendJSON(res, 400, { error: '当前审核状态不支持该操作' });
      if (!hasPerm(user, t.perm)) return deny(res);
      await pool.query('UPDATE assets SET audit_status = ?, audit_by = ?, audit_at = NOW(), audit_note = ? WHERE id = ?',
        [t.to, user.name, String(b.note || '').slice(0, 255), id]);
      await audit(user, 'audit', 'asset', a.name, t.label + (b.note ? '：' + b.note : ''), req);
      return sendJSON(res, 200, { ok: true, auditStatus: t.to });
    }
    if (method === 'POST') {
      if (!hasPerm(user, 'asset.manage')) return deny(res);
      const b = await readBody(req);
      if (!b.name) return sendJSON(res, 400, { error: '资产名称不能为空' });
      // 责任人：优先用 ownerId 关联用户，未传则退回自由文本
      let ownerId = Number(b.ownerId) || null;
      let ownerName = b.owner || '-';
      if (ownerId) {
        const [u] = await pool.query('SELECT id, name FROM sys_users WHERE id = ?', [ownerId]);
        if (!u.length) return sendJSON(res, 400, { error: '责任人无效' });
        ownerName = u[0].name;
      }
      // 一线新增默认「待审核」；具备 asset.audit 权限（二线）新增则直接通过
      const auditStatus = hasPerm(user, 'asset.audit') ? 'approved' : 'pending';
      const [r] = await pool.query(
        'INSERT INTO assets (code, name, type, res_category, ip, location, owner, owner_id, status, note, mem_gb, disk_gb, cpu_cores, room, unit, audit_status, audit_by, audit_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [b.code || '', String(b.name), b.type || '其他', b.resCategory || '物理服务器', b.ip || '-', b.location || '-',
         ownerName, ownerId, b.status || 'running', b.note || '',
         Number(b.memGb) || 0, Number(b.diskGb) || 0, Number(b.cpuCores) || 0, b.room || '', b.unit || '',
         auditStatus, auditStatus === 'approved' ? user.name : '', auditStatus === 'approved' ? new Date() : null]);
      if (!b.code) await pool.query('UPDATE assets SET code = ? WHERE id = ?', ['AST' + String(1000 + r.insertId), r.insertId]);
      await audit(user, 'create', 'asset', b.name, '新增资产', req);
      const [rows] = await pool.query('SELECT * FROM assets WHERE id = ?', [r.insertId]);
      const a = rows[0];
      return sendJSON(res, 200, { id: a.id, code: a.code, name: a.name, type: a.type, ip: a.ip, location: a.location, owner: a.owner, status: a.status, purchaseDate: a.purchase_date, note: a.note });
    }
    if (method === 'PUT' && id) {
      if (!hasPerm(user, 'asset.manage')) return deny(res);
      const b = await readBody(req);
      // 责任人变更：传 ownerId 时同步 owner 姓名
      let ownerNamePatch = b.owner !== undefined ? b.owner : null;
      let ownerIdPatch = null;
      let setOwnerId = false;
      if (b.ownerId !== undefined) {
        setOwnerId = true;
        ownerIdPatch = Number(b.ownerId) || null;
        if (ownerIdPatch) {
          const [u] = await pool.query('SELECT id, name FROM sys_users WHERE id = ?', [ownerIdPatch]);
          if (!u.length) return sendJSON(res, 400, { error: '责任人无效' });
          ownerNamePatch = u[0].name;
        }
      }
      await pool.query('UPDATE assets SET code = COALESCE(?, code), name = COALESCE(?, name), type = COALESCE(?, type), ip = COALESCE(?, ip), location = COALESCE(?, location), owner = COALESCE(?, owner), status = COALESCE(?, status), note = COALESCE(?, note), res_category = COALESCE(?, res_category), mem_gb = COALESCE(?, mem_gb), disk_gb = COALESCE(?, disk_gb), cpu_cores = COALESCE(?, cpu_cores), room = COALESCE(?, room), unit = COALESCE(?, unit) WHERE id = ?',
        [b.code !== undefined ? b.code : null, b.name !== undefined ? b.name : null, b.type !== undefined ? b.type : null,
          b.ip !== undefined ? b.ip : null, b.location !== undefined ? b.location : null, ownerNamePatch,
          b.status !== undefined ? b.status : null, b.note !== undefined ? b.note : null,
          b.resCategory !== undefined ? b.resCategory : null,
          b.memGb !== undefined ? Number(b.memGb) : null, b.diskGb !== undefined ? Number(b.diskGb) : null,
          b.cpuCores !== undefined ? Number(b.cpuCores) : null, b.room !== undefined ? b.room : null,
          b.unit !== undefined ? b.unit : null, id]);
      if (setOwnerId) await pool.query('UPDATE assets SET owner_id = ? WHERE id = ?', [ownerIdPatch, id]);
      await audit(user, 'update', 'asset', String(id), '编辑资产 ' + (b.name || ''), req);
      return sendJSON(res, 200, { ok: true });
    }
    if (method === 'DELETE' && id) {
      if (!hasPerm(user, 'asset.manage')) return deny(res);
      const hard = query.get('hard') === '1';
      const [rows] = await pool.query('SELECT name FROM assets WHERE id = ?', [id]);
      if (!rows.length) return sendJSON(res, 404, { error: '资产不存在' });
      if (hard) {
        await pool.query('DELETE FROM asset_software WHERE asset_id = ?', [id]);
        await pool.query('DELETE FROM assets WHERE id = ?', [id]);
        await audit(user, 'delete', 'asset', rows[0].name, '彻底删除资产', req);
      } else {
        await pool.query('UPDATE assets SET deleted_at = NOW() WHERE id = ?', [id]);
        await audit(user, 'delete', 'asset', rows[0].name, '删除资产（移入回收）', req);
      }
      return sendJSON(res, 200, { ok: true });
    }
    // 批量删除（软删除）
    if (method === 'POST' && idRaw === 'batch-delete') {
      if (!hasPerm(user, 'asset.manage')) return deny(res);
      const b = await readBody(req);
      const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Boolean) : [];
      if (!ids.length) return sendJSON(res, 400, { error: '未选择资产' });
      await pool.query(`UPDATE assets SET deleted_at = NOW() WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
      await audit(user, 'delete', 'asset', ids.join(','), `批量删除 ${ids.length} 项资产`, req);
      return sendJSON(res, 200, { ok: true, count: ids.length });
    }
  }

  /* ---------- 责任人候选（资产管理员即可读，不必有 user.manage） ---------- */
  if (group === 'asset-owners' && method === 'GET') {
    if (!hasPerm(user, 'asset.view')) return deny(res);
    const [rows] = await pool.query('SELECT id, username, name, role FROM sys_users WHERE active = 1 ORDER BY id');
    return sendJSON(res, 200, rows.map((u) => ({ id: u.id, username: u.username, name: u.name, role: u.role })));
  }

  /* ---------- 资产软件清单 ---------- */
  if (group === 'asset-software') {
    if (!hasPerm(user, 'asset.view')) return deny(res);
    if (method === 'GET') {
      const aid = Number(query.get('assetId') || id) || 0;
      if (!aid) return sendJSON(res, 400, { error: '缺少 assetId' });
      const [rows] = await pool.query('SELECT * FROM asset_software WHERE asset_id = ? ORDER BY category, name', [aid]);
      return sendJSON(res, 200, rows.map((x) => ({
        id: x.id, assetId: x.asset_id, name: x.name, version: x.version,
        vendor: x.vendor, category: x.category, installPath: x.install_path, note: x.note,
      })));
    }
    if (method === 'POST') {
      if (!hasPerm(user, 'asset.manage')) return deny(res);
      const b = await readBody(req);
      const aid = Number(b.assetId) || 0;
      if (!aid) return sendJSON(res, 400, { error: '缺少 assetId' });
      if (!b.name || !String(b.name).trim()) return sendJSON(res, 400, { error: '软件名称不能为空' });
      const [ar] = await pool.query('SELECT id FROM assets WHERE id = ?', [aid]);
      if (!ar.length) return sendJSON(res, 400, { error: '资产不存在' });
      const [r] = await pool.query(
        'INSERT INTO asset_software (asset_id, name, version, vendor, category, install_path, note) VALUES (?,?,?,?,?,?,?)',
        [aid, String(b.name).trim(), b.version || '', b.vendor || '', b.category || '其他', b.installPath || '', b.note || '']
      );
      await audit(user, 'create', 'asset-software', String(aid), '新增软件 ' + b.name + ' ' + (b.version || ''), req);
      return sendJSON(res, 200, { id: r.insertId });
    }
    if (method === 'PUT' && id) {
      if (!hasPerm(user, 'asset.manage')) return deny(res);
      const [rows] = await pool.query('SELECT * FROM asset_software WHERE id = ?', [id]);
      if (!rows.length) return sendJSON(res, 404, { error: '软件记录不存在' });
      const b = await readBody(req);
      await pool.query(
        'UPDATE asset_software SET name = COALESCE(?, name), version = COALESCE(?, version), vendor = COALESCE(?, vendor), category = COALESCE(?, category), install_path = COALESCE(?, install_path), note = COALESCE(?, note) WHERE id = ?',
        [b.name !== undefined ? String(b.name).trim() : null, b.version !== undefined ? b.version : null,
         b.vendor !== undefined ? b.vendor : null, b.category !== undefined ? b.category : null,
         b.installPath !== undefined ? b.installPath : null, b.note !== undefined ? b.note : null, id]
      );
      await audit(user, 'update', 'asset-software', String(id), '编辑软件记录', req);
      return sendJSON(res, 200, { ok: true });
    }
    if (method === 'DELETE' && id) {
      if (!hasPerm(user, 'asset.manage')) return deny(res);
      await pool.query('DELETE FROM asset_software WHERE id = ?', [id]);
      await audit(user, 'delete', 'asset-software', String(id), '删除软件记录', req);
      return sendJSON(res, 200, { ok: true });
    }
  }

  /* ---------- 工单三级分类 ---------- */
  if (group === 'ticket-categories') {
    if (method === 'GET') {
      const [rows] = await pool.query('SELECT * FROM ticket_categories ORDER BY level, sort, id');
      const all = rows.map((c) => ({ id: c.id, parentId: c.parent_id, level: c.level, name: c.name, sort: c.sort }));
      // 无 parentId 参数时返回完整树
      if (!query.get('parentId')) {
        const build = (pid) => all.filter((c) => c.parentId === pid).map((c) => Object.assign({}, c, { children: build(c.id) }));
        return sendJSON(res, 200, { tree: build(0), flat: all });
      }
      const pid = Number(query.get('parentId'));
      return sendJSON(res, 200, all.filter((c) => c.parentId === pid));
    }
    if (!hasPerm(user, 'ticket.category.manage')) return deny(res);
    if (method === 'POST') {
      const b = await readBody(req);
      if (!b.name || !String(b.name).trim()) return sendJSON(res, 400, { error: '分类名称不能为空' });
      const level = Number(b.level) || 1;
      const parentId = level === 1 ? 0 : Number(b.parentId) || 0;
      if (level > 1 && !parentId) return sendJSON(res, 400, { error: '请选择上级分类' });
      const [dup] = await pool.query('SELECT id FROM ticket_categories WHERE parent_id = ? AND name = ?', [parentId, String(b.name).trim()]);
      if (dup.length) return sendJSON(res, 400, { error: '同级下已存在该分类' });
      const [r] = await pool.query('INSERT INTO ticket_categories (parent_id, level, name, sort) VALUES (?,?,?,?)',
        [parentId, level, String(b.name).trim(), Number(b.sort) || 99]);
      await audit(user, 'create', 'ticketcat', b.name, '新建工单分类（L' + level + '）', req);
      return sendJSON(res, 200, { id: r.insertId, parentId, level, name: String(b.name).trim(), sort: Number(b.sort) || 99 });
    }
    if (method === 'PUT' && id) {
      const b = await readBody(req);
      if (b.name !== undefined) {
        const [rows] = await pool.query('SELECT * FROM ticket_categories WHERE id = ?', [id]);
        if (!rows.length) return sendJSON(res, 404, { error: '分类不存在' });
        const [dup] = await pool.query('SELECT id FROM ticket_categories WHERE parent_id = ? AND name = ? AND id <> ?', [rows[0].parent_id, String(b.name).trim(), id]);
        if (dup.length) return sendJSON(res, 400, { error: '同级下已存在该分类' });
      }
      await pool.query('UPDATE ticket_categories SET name = COALESCE(?, name), sort = COALESCE(?, sort) WHERE id = ?',
        [b.name !== undefined ? String(b.name).trim() : null, b.sort !== undefined ? Number(b.sort) : null, id]);
      await audit(user, 'update', 'ticketcat', String(id), '编辑工单分类', req);
      return sendJSON(res, 200, { ok: true });
    }
    if (method === 'DELETE' && id) {
      const [kids] = await pool.query('SELECT COUNT(*) AS c FROM ticket_categories WHERE parent_id = ?', [id]);
      if (kids[0].c) return sendJSON(res, 400, { error: '该分类下还有 ' + kids[0].c + ' 个子分类，请先删除子分类' });
      await pool.query('DELETE FROM ticket_categories WHERE id = ?', [id]);
      await audit(user, 'delete', 'ticketcat', String(id), '删除工单分类', req);
      return sendJSON(res, 200, { ok: true });
    }
  }

  /* ---------- 设备分类 ---------- */
  if (group === 'categories') {
    if (!hasPerm(user, 'model.view')) return deny(res);
    if (method === 'GET' && !id) {
      const [counts] = await pool.query('SELECT category, COUNT(*) AS c FROM device_models GROUP BY category');
      const cmap = {};
      counts.forEach((c) => { cmap[c.category] = c.c; });
      return sendJSON(res, 200, await pagedList(query, 'SELECT * FROM device_categories', [], 'ORDER BY sort, id', (c) => ({
        id: c.id, name: c.name, desc: c.descr, sort: c.sort, createdAt: c.created_at, modelCount: cmap[c.name] || 0,
      })));
    }
    if (method === 'POST') {
      if (!hasPerm(user, 'category.manage')) return deny(res);
      const b = await readBody(req);
      if (!b.name || !String(b.name).trim()) return sendJSON(res, 400, { error: '分类名称不能为空' });
      const [dup] = await pool.query('SELECT id FROM device_categories WHERE name = ?', [String(b.name).trim()]);
      if (dup.length) return sendJSON(res, 400, { error: '该分类已存在' });
      const [r] = await pool.query('INSERT INTO device_categories (name, descr, sort) VALUES (?,?,?)',
        [String(b.name).trim(), b.desc || '', Number(b.sort) || 99]);
      await audit(user, 'create', 'category', b.name, '新建设备分类', req);
      return sendJSON(res, 200, { id: r.insertId, name: b.name, desc: b.desc || '', sort: Number(b.sort) || 99, modelCount: 0 });
    }
    if (method === 'PUT' && id) {
      if (!hasPerm(user, 'category.manage')) return deny(res);
      const [rows] = await pool.query('SELECT * FROM device_categories WHERE id = ?', [id]);
      if (!rows.length) return sendJSON(res, 404, { error: '分类不存在' });
      const b = await readBody(req);
      if (b.name !== undefined) {
        const [dup] = await pool.query('SELECT id FROM device_categories WHERE name = ? AND id <> ?', [String(b.name).trim(), id]);
        if (dup.length) return sendJSON(res, 400, { error: '该分类名已存在' });
        await pool.query('UPDATE device_models SET category = ? WHERE category = ?', [String(b.name).trim(), rows[0].name]);
      }
      await pool.query('UPDATE device_categories SET name = COALESCE(?, name), descr = COALESCE(?, descr), sort = COALESCE(?, sort) WHERE id = ?',
        [b.name !== undefined ? String(b.name).trim() : null, b.desc !== undefined ? b.desc : null, b.sort !== undefined ? Number(b.sort) : null, id]);
      await audit(user, 'update', 'category', b.name || rows[0].name, '编辑设备分类', req);
      return sendJSON(res, 200, { ok: true });
    }
    if (method === 'DELETE' && id) {
      if (!hasPerm(user, 'category.manage')) return deny(res);
      const [rows] = await pool.query('SELECT * FROM device_categories WHERE id = ?', [id]);
      if (!rows.length) return sendJSON(res, 404, { error: '分类不存在' });
      const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM device_models WHERE category = ?', [rows[0].name]);
      if (c) return sendJSON(res, 400, { error: `该分类下还有 ${c} 个型号，请先处理型号` });
      await pool.query('DELETE FROM device_categories WHERE id = ?', [id]);
      await audit(user, 'delete', 'category', rows[0].name, '删除设备分类', req);
      return sendJSON(res, 200, { ok: true });
    }
  }

  /* ---------- 供应商 ---------- */
  if (group === 'suppliers') {
    if (!hasPerm(user, 'supplier.view')) return deny(res);
    if (method === 'GET' && !id) {
      let sql = 'SELECT * FROM suppliers WHERE 1=1';
      const args = [];
      const kw = (query.get('keyword') || '').trim();
      if (kw) { sql += ' AND (name LIKE ? OR short_name LIKE ? OR contact LIKE ? OR phone LIKE ?)'; args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`); }
      const st = query.get('status') || '';
      if (st) { sql += ' AND status = ?'; args.push(st); }
      return sendJSON(res, 200, await pagedList(query, sql, args, 'ORDER BY id', (s) => ({
        id: s.id, name: s.name, shortName: s.short_name, status: s.status,
        province: s.province, city: s.city, contact: s.contact, phone: s.phone,
        address: s.address, note: s.note, createdAt: s.created_at,
      })));
    }
    if (method === 'POST') {
      if (!hasPerm(user, 'supplier.manage')) return deny(res);
      const b = await readBody(req);
      if (!b.name || !String(b.name).trim()) return sendJSON(res, 400, { error: '单位全称不能为空' });
      if (!b.shortName || !String(b.shortName).trim()) return sendJSON(res, 400, { error: '单位简称不能为空' });
      const [dup] = await pool.query('SELECT id FROM suppliers WHERE name = ?', [String(b.name).trim()]);
      if (dup.length) return sendJSON(res, 400, { error: '该供应商已存在' });
      const [r] = await pool.query('INSERT INTO suppliers (name, short_name, status, province, city, contact, phone, address, note) VALUES (?,?,?,?,?,?,?,?,?)',
        [String(b.name).trim(), String(b.shortName).trim(), b.status === 'disabled' ? 'disabled' : 'active', b.province || '', b.city || '', b.contact || '', b.phone || '', b.address || '', b.note || '']);
      await audit(user, 'create', 'supplier', b.name, '新增供应商', req);
      return sendJSON(res, 200, { id: r.insertId, name: b.name, shortName: b.shortName, status: b.status === 'disabled' ? 'disabled' : 'active', province: b.province || '', city: b.city || '', contact: b.contact || '', phone: b.phone || '', address: b.address || '', note: b.note || '' });
    }
    if (method === 'PUT' && id) {
      if (!hasPerm(user, 'supplier.manage')) return deny(res);
      const [rows] = await pool.query('SELECT * FROM suppliers WHERE id = ?', [id]);
      if (!rows.length) return sendJSON(res, 404, { error: '供应商不存在' });
      const b = await readBody(req);
      if (b.name !== undefined) {
        const [dup] = await pool.query('SELECT id FROM suppliers WHERE name = ? AND id <> ?', [String(b.name).trim(), id]);
        if (dup.length) return sendJSON(res, 400, { error: '该单位全称已存在' });
      }
      await pool.query('UPDATE suppliers SET name = COALESCE(?, name), short_name = COALESCE(?, short_name), status = COALESCE(?, status), province = COALESCE(?, province), city = COALESCE(?, city), contact = COALESCE(?, contact), phone = COALESCE(?, phone), address = COALESCE(?, address), note = COALESCE(?, note) WHERE id = ?',
        [b.name !== undefined ? String(b.name).trim() : null, b.shortName !== undefined ? b.shortName : null,
          b.status !== undefined ? (b.status === 'disabled' ? 'disabled' : 'active') : null,
          b.province !== undefined ? b.province : null, b.city !== undefined ? b.city : null,
          b.contact !== undefined ? b.contact : null, b.phone !== undefined ? b.phone : null,
          b.address !== undefined ? b.address : null, b.note !== undefined ? b.note : null, id]);
      await audit(user, 'update', 'supplier', b.name || rows[0].name, b.status !== undefined ? (b.status === 'disabled' ? '禁用' : '启用') : '编辑供应商', req);
      return sendJSON(res, 200, { ok: true });
    }
    if (method === 'DELETE' && id) {
      if (!hasPerm(user, 'supplier.manage')) return deny(res);
      const [rows] = await pool.query('SELECT * FROM suppliers WHERE id = ?', [id]);
      if (!rows.length) return sendJSON(res, 404, { error: '供应商不存在' });
      await pool.query('DELETE FROM suppliers WHERE id = ?', [id]);
      await audit(user, 'delete', 'supplier', rows[0].name, '删除供应商', req);
      return sendJSON(res, 200, { ok: true });
    }
  }

  /* ---------- 设备型号库 ---------- */
  if (group === 'models') {
    if (!hasPerm(user, 'model.view')) return deny(res);
    if (method === 'GET' && !id) {
      let sql = 'SELECT * FROM device_models WHERE 1=1';
      const args = [];
      const kw = (query.get('keyword') || '').trim();
      if (kw) { sql += ' AND (vendor LIKE ? OR model LIKE ? OR descr LIKE ?)'; args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`); }
      const cat = query.get('category') || '';
      if (cat) { sql += ' AND category = ?'; args.push(cat); }
      return sendJSON(res, 200, await pagedList(query, sql, args, 'ORDER BY id', (m) => ({
        id: m.id, category: m.category, vendor: m.vendor, model: m.model,
        desc: m.descr, unit: m.unit, status: m.status, createdAt: m.created_at,
      })));
    }
    if (method === 'POST') {
      if (!hasPerm(user, 'model.manage')) return deny(res);
      const b = await readBody(req);
      if (!b.vendor || !b.model) return sendJSON(res, 400, { error: '厂商和型号不能为空' });
      const [r] = await pool.query('INSERT INTO device_models (category, vendor, model, descr, unit, status) VALUES (?,?,?,?,?,?)',
        [b.category || '其他', String(b.vendor).trim(), String(b.model).trim(), b.desc || '', b.unit || '台', b.status === 'disabled' ? 'disabled' : 'active']);
      await audit(user, 'create', 'model', b.vendor + ' ' + b.model, '新增设备型号', req);
      return sendJSON(res, 200, { id: r.insertId, category: b.category || '其他', vendor: b.vendor, model: b.model, desc: b.desc || '', unit: b.unit || '台', status: b.status === 'disabled' ? 'disabled' : 'active' });
    }
    if (method === 'PUT' && id) {
      if (!hasPerm(user, 'model.manage')) return deny(res);
      const b = await readBody(req);
      await pool.query('UPDATE device_models SET category = COALESCE(?, category), vendor = COALESCE(?, vendor), model = COALESCE(?, model), descr = COALESCE(?, descr), unit = COALESCE(?, unit), status = COALESCE(?, status) WHERE id = ?',
        [b.category !== undefined ? b.category : null, b.vendor !== undefined ? b.vendor : null, b.model !== undefined ? b.model : null,
          b.desc !== undefined ? b.desc : null, b.unit !== undefined ? b.unit : null,
          b.status !== undefined ? (b.status === 'disabled' ? 'disabled' : 'active') : null, id]);
      await audit(user, 'update', 'model', String(id), '编辑设备型号', req);
      return sendJSON(res, 200, { ok: true });
    }
    if (method === 'DELETE' && id) {
      if (!hasPerm(user, 'model.manage')) return deny(res);
      await pool.query('DELETE FROM device_models WHERE id = ?', [id]);
      await audit(user, 'delete', 'model', String(id), '删除设备型号', req);
      return sendJSON(res, 200, { ok: true });
    }
  }

  /* ---------- 知识库 ---------- */
  if (group === 'kb') {
    if (!hasPerm(user, 'kb.view')) return deny(res);
    if (method === 'GET' && !id) {
      let sql = 'SELECT * FROM kb WHERE 1=1';
      const args = [];
      const kw = (query.get('keyword') || '').trim();
      if (kw) { sql += ' AND (title LIKE ? OR content LIKE ? OR tags LIKE ?)'; args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`); }
      const cat = query.get('category') || '';
      if (cat) { sql += ' AND category = ?'; args.push(cat); }
      return sendJSON(res, 200, await pagedList(query, sql, args, 'ORDER BY updated_at DESC, id DESC', (k) => ({
        id: k.id, title: k.title, category: k.category,
        tags: k.tags ? k.tags.split(',') : [], content: k.content,
        author: k.author, views: k.views, updatedAt: k.updated_at,
      })));
    }
    if (method === 'GET' && id) {
      const [rows] = await pool.query('SELECT * FROM kb WHERE id = ?', [id]);
      if (!rows.length) return sendJSON(res, 404, { error: '文档不存在' });
      await pool.query('UPDATE kb SET views = views + 1 WHERE id = ?', [id]);
      const k = rows[0];
      return sendJSON(res, 200, {
        id: k.id, title: k.title, category: k.category, tags: k.tags ? k.tags.split(',') : [],
        content: k.content, author: k.author, views: (k.views || 0) + 1, updatedAt: k.updated_at,
        canEdit: hasPerm(user, 'kb.manage'),
      });
    }
    if (method === 'POST') {
      if (!hasPerm(user, 'kb.manage')) return deny(res);
      const b = await readBody(req);
      if (!b.title) return sendJSON(res, 400, { error: '标题不能为空' });
      const tags = Array.isArray(b.tags) ? b.tags.join(',') : String(b.tags || '');
      const [r] = await pool.query('INSERT INTO kb (title, category, tags, content, author) VALUES (?,?,?,?,?)',
        [String(b.title), b.category || '未分类', tags, b.content || '', user.name]);
      await audit(user, 'create', 'kb', b.title, '新建知识文档', req);
      return sendJSON(res, 200, { id: r.insertId, title: b.title, category: b.category || '未分类', tags: tags ? tags.split(',') : [], content: b.content || '', author: user.name, views: 0 });
    }
    if (method === 'PUT' && id) {
      if (!hasPerm(user, 'kb.manage')) return deny(res);
      const b = await readBody(req);
      const tags = b.tags !== undefined ? (Array.isArray(b.tags) ? b.tags.join(',') : String(b.tags)) : null;
      await pool.query('UPDATE kb SET title = COALESCE(?, title), category = COALESCE(?, category), tags = COALESCE(?, tags), content = COALESCE(?, content), updated_at = NOW() WHERE id = ?',
        [b.title !== undefined ? b.title : null, b.category !== undefined ? b.category : null, tags, b.content !== undefined ? b.content : null, id]);
      await audit(user, 'update', 'kb', b.title || String(id), '编辑知识文档', req);
      return sendJSON(res, 200, { ok: true });
    }
    if (method === 'DELETE' && id) {
      if (!hasPerm(user, 'kb.manage')) return deny(res);
      await pool.query('DELETE FROM kb WHERE id = ?', [id]);
      await audit(user, 'delete', 'kb', String(id), '删除知识文档', req);
      return sendJSON(res, 200, { ok: true });
    }
  }

  return sendJSON(res, 404, { error: '接口不存在' });
}

/* ============================== 启动 ============================== */

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  if (u.pathname.startsWith('/api/')) {
    try { return await api(req, res, u.pathname, u.searchParams); }
    catch (err) { console.error('[API ERROR]', u.pathname, err.message); return sendJSON(res, 500, { error: err.message }); }
  }
  return serveStatic(req, res, u.pathname);
});

/* 第一梯队优化：核心查询路径复合索引。
   覆盖列表页「筛选 + 排序」场景，避免 filesort / 全表扫描。
   逐条执行并吞掉 DUPLICATE KEY，保证幂等且失败不影响启动。 */
async function ensureIndexes() {
  const IDX = [
    // 告警中心：按状态+严重级别筛选，按 id 倒序
    ['alerts', 'idx_alerts_status_sev_id', '(status, severity, id)'],
    // 告警中心：按集群+状态筛选
    ['alerts', 'idx_alerts_cluster_status', '(cluster_id, status)'],
    // 工单列表：按状态+分组筛选，按 id 倒序
    ['tickets', 'idx_tickets_status_group_id', '(status, group_id, id)'],
    // 工单列表：按处理人（我的工单）—— assignee 为 varchar
    ['tickets', 'idx_tickets_assignee', '(assignee, status)'],
    // Pod 列表：按集群+状态筛选，覆盖 ORDER BY FIELD(status,...)
    ['cluster_pods', 'idx_pods_cluster_status', '(cluster_id, status)'],
    // 节点列表：按集群+状态
    ['cluster_nodes', 'idx_nodes_cluster_status', '(cluster_id, status)'],
    // 审计日志：按时间倒序分页
    ['audit_logs', 'idx_audit_at_id', '(at, id)'],
  ];
  for (const [table, name, cols] of IDX) {
    try {
      const [rows] = await pool.query(
        'SELECT COUNT(*) AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
        [table, name]
      );
      if (rows[0] && Number(rows[0].c) > 0) continue;
      await pool.query(`ALTER TABLE \`${table}\` ADD INDEX \`${name}\` ${cols}`);
      console.log(`[INDEX] created ${name} on ${table}`);
    } catch (e) {
      // 索引已存在或表/列不存在：仅提示，不阻断启动
      console.warn(`[INDEX] skip ${name} on ${table}: ${e.message}`);
    }
  }
}

(async () => {
  pool = mysql.createPool(DB_CFG);
  for (const sql of DDL) await pool.query(sql);
  // 第一梯队优化：核心表复合索引（幂等，已存在则跳过）
  await ensureIndexes();
  await loadSessions();
  // 知识库分类：把历史文档中已出现的分类补进分类表，避免改造后丢失
  await seedKbCategories();
  // 部门：把用户表已出现的 dept 值补进部门表，避免改造后历史数据丢失
  await seedDepartments();
  await seedRoles();
  await migrateRolePerms();
  await loadRoles();
  // 资产责任人关联：assets 补 owner_id 列并按姓名回填到 sys_users
  await migrateAssetOwner();
  // 资产扩展字段 + 审核流（一线新增 → 二线审核）
  await migrateAssetAudit();
  await seedResFields();
  await migrateResFieldUnit();
  // 资产软件：为示例设备播种一些软件（仅当该设备尚无软件记录）
  await seedAssetSoftware();
  // 兼容已存在的旧库：补齐 sys_groups.tier 列
  try {
    const [cols] = await pool.query("SHOW COLUMNS FROM sys_groups LIKE 'tier'");
    if (!cols.length) await pool.query('ALTER TABLE sys_groups ADD COLUMN tier INT DEFAULT 0');
    await pool.query("UPDATE sys_groups SET tier = 2 WHERE name = '技术支持组' AND (tier IS NULL OR tier = 0)");
    await pool.query("UPDATE sys_groups SET tier = 1 WHERE name = '一线运维组' AND (tier IS NULL OR tier = 0)");
    // 告警去重列迁移
    const [d1] = await pool.query("SHOW COLUMNS FROM alerts LIKE 'dedup_key'");
    if (!d1.length) {
      await pool.query("ALTER TABLE alerts ADD COLUMN dedup_key VARCHAR(191) DEFAULT ''");
      await pool.query("ALTER TABLE alerts ADD COLUMN count INT DEFAULT 1");
      await pool.query("ALTER TABLE alerts ADD COLUMN last_seen DATETIME DEFAULT CURRENT_TIMESTAMP");
      console.log('已迁移 alerts 去重列');
    }
    const [d2] = await pool.query("SHOW COLUMNS FROM alert_rules LIKE 'dedup_window_sec'");
    if (!d2.length) {
      await pool.query("ALTER TABLE alert_rules ADD COLUMN dedup_window_sec INT DEFAULT 300");
      console.log('已迁移 alert_rules 去重窗口列');
    }

    // 工单三级分类列迁移
    const [tc1] = await pool.query("SHOW COLUMNS FROM tickets LIKE 'big_category'");
    if (!tc1.length) {
      await pool.query("ALTER TABLE tickets ADD COLUMN big_category VARCHAR(64) DEFAULT '' AFTER category");
      await pool.query("ALTER TABLE tickets ADD COLUMN mid_category VARCHAR(64) DEFAULT '' AFTER big_category");
      await pool.query("ALTER TABLE tickets ADD COLUMN small_category VARCHAR(64) DEFAULT '' AFTER mid_category");
      console.log('已迁移 tickets 三级分类列');
    }
  } catch (e) { console.log('tier 迁移提示:', e.message); }
  await seedIfEmpty();
  await seedTicketCatsIfEmpty();
  await seedMonitorIfEmpty();
  await seedNotifyIfEmpty();
  await seedPodsIfEmpty();
  await reconcileStaleComponentAlerts();
  /* 每 2 分钟核对一次失效告警（组件已恢复/未部署但告警仍 firing） */
  const alertReconciler = setInterval(() => {
    reconcileStaleComponentAlerts().catch(() => {});
  }, 2 * 60 * 1000);
  if (alertReconciler.unref) alertReconciler.unref();
  await loadGroups();
  server.listen(PORT, HOST, () => {
    console.log(`智能运维管理平台（MySQL 版）已启动: http://${HOST}:${PORT}`);
    console.log(`数据库: ${DB_CFG.user}@${DB_CFG.host}:${DB_CFG.port}/${DB_CFG.database}`);
  });
})().catch((e) => {
  console.error('启动失败:', e.message);
  process.exit(1);
});
