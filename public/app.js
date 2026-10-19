/* 智能运维管理平台 — 前端（零依赖，原生 JS 渲染） */
'use strict';

/* ============================== 常量 / 工具 ============================== */

const API = '/api';

const STATUS_TEXT = { pending: '待受理', processing: '受理中', resolved: '已解决', closed: '已关闭' };
const PRIORITY_TEXT = { low: '低', normal: '普通', high: '高', urgent: '紧急' };
const ASSET_STATUS = { running: '运行中', warning: '告警', offline: '离线' };
const CATEGORIES = ['服务器', '网络', '应用系统', '数据库', '终端', '邮件系统', '账号权限', '监控', '其他'];
const ASSET_TYPES = ['服务器', '网络设备', '安全设备', '存储设备', '应用系统', '终端设备', '机房设施', '其他'];
const KB_CATEGORIES = ['操作指南', '运维规范', '故障处理', '未分类'];

const h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function toast(msg, type) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast' + (type ? ' ' + type : ''); }, 2400);
}

async function req(method, url, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(API + url, opt);
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = { error: text }; }
  if (!r.ok) throw new Error((data && data.error) || ('请求失败 ' + r.status));
  return data;
}

function fmtDate(iso, withTime) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d)) return '-';
  const p = (n) => String(n).padStart(2, '0');
  const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${base} ${p(d.getHours())}:${p(d.getMinutes())}` : base;
}

function weekdayCN(d) {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
}

function greeting() {
  const hr = new Date().getHours();
  if (hr < 6) return '凌晨好';
  if (hr < 9) return '早上好';
  if (hr < 12) return '上午好';
  if (hr < 14) return '中午好';
  if (hr < 18) return '下午好';
  return '晚上好';
}

/* ============================== 图标 ============================== */

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/>',
  ticket: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h10M7 13h6"/>',
  asset: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  kb: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v18H5.5A1.5 1.5 0 0 1 4 19.5z"/><path d="M8 3v18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
  close: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  users: '<path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 20v-2a4 4 0 0 0-3-3.87"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pin: '<path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
};

function icon(name, size) {
  const s = size || 18;
  return `<svg class="ico" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
}

/* ============================== 全局状态 ============================== */

const state = {
  token: sessionStorage.getItem('aiops_token') || '',
  user: JSON.parse(sessionStorage.getItem('aiops_user') || 'null'),
  page: 'dashboard',
  stats: null,
  tickets: [],
  assets: [],
  kb: [],
  filters: { ticket: {}, asset: {}, kb: {} },
  sidebarOpen: false,
  modal: null,
};

const PAGES = [
  { key: 'dashboard', label: '首页', icon: 'home' },
  { key: 'tickets', label: '工单管理', icon: 'ticket' },
  { key: 'assets', label: '资产管理', icon: 'asset' },
  { key: 'kb', label: '知识库管理', icon: 'kb' },
];

const PAGE_TITLE = { dashboard: '首页', tickets: '工单管理', assets: '资产管理', kb: '知识库管理' };

/* ============================== 登录 ============================== */

function renderLogin(err) {
  document.getElementById('app').innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="login-form">
        <div class="login-logo">
          <div class="mark">运</div>
          <h1>智能运维管理平台</h1>
        </div>
        <p class="login-sub">IT Operations Management Platform</p>
        ${err ? `<div class="login-err">${h(err)}</div>` : ''}
        <div class="field">
          <label>账号</label>
          <input id="lg-user" type="text" placeholder="请输入账号" autocomplete="username" value="admin" />
        </div>
        <div class="field">
          <label>密码</label>
          <input id="lg-pass" type="password" placeholder="请输入密码" autocomplete="current-password" value="123456" />
        </div>
        <button class="login-btn" type="submit">登 录</button>
        <p class="login-tip">演示账号 <code>admin</code> ／ 密码 <code>123456</code><br/>数据保存在本地 JSON 文件中，可自由增删改</p>
      </form>
    </div>`;

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = '登录中…';
    try {
      const r = await req('POST', '/login', {
        username: document.getElementById('lg-user').value.trim(),
        password: document.getElementById('lg-pass').value,
      });
      state.token = r.token;
      state.user = r.user;
      sessionStorage.setItem('aiops_token', r.token);
      sessionStorage.setItem('aiops_user', JSON.stringify(r.user));
      renderApp();
      toast('欢迎回来，' + r.user.name, 'ok');
    } catch (ex) {
      renderLogin(ex.message);
    }
  });
}

function logout() {
  state.token = ''; state.user = null;
  sessionStorage.removeItem('aiops_token');
  sessionStorage.removeItem('aiops_user');
  renderLogin();
}

/* ============================== 框架 ============================== */

function renderApp() {
  document.getElementById('app').innerHTML = `
    <div class="layout">
      <aside class="sidebar ${state.sidebarOpen ? 'open' : ''}" id="sidebar">
        <div class="sidebar-head">
          <div class="mark">运</div>
          <span>智能运维管理平台</span>
        </div>
        <nav class="menu" id="menu">
          ${PAGES.map((p) => `
            <button class="menu-item ${state.page === p.key ? 'active' : ''}" data-page="${p.key}">
              ${icon(p.icon, 17)}<span>${p.label}</span>
              <span class="chev">›</span>
            </button>`).join('')}
        </nav>
      </aside>

      <div class="main">
        <header class="topbar">
          <button class="hamburger" id="hamburger">☰</button>
          <div class="crumbs">
            <span>${h(state.user ? state.user.org || '中烟信息' : '')}</span><span>/</span>
            <span class="cur">${PAGE_TITLE[state.page]}</span>
          </div>
          <div class="topbar-right">
            <div class="menu-search" id="menu-search">
              ${icon('search', 15)}<span class="txt">菜单搜索</span>
            </div>
            <div class="bell" id="bell">${icon('bell', 18)}<i class="dot"></i></div>
            <div class="user-chip" id="user-chip">
              <div class="avatar">${h((state.user && state.user.name || '管').slice(0, 1))}</div>
              <span class="nm">${h(state.user ? state.user.name : '')}</span>
              <span style="font-size:11px;color:#9ca3af">▾</span>
            </div>
          </div>
        </header>
        <main class="content" id="content"></main>
      </div>
    </div>
    <div id="modal-root"></div>`;

  document.getElementById('menu').addEventListener('click', (e) => {
    const btn = e.target.closest('.menu-item');
    if (!btn) return;
    go(btn.dataset.page);
  });
  document.getElementById('hamburger').addEventListener('click', () => {
    state.sidebarOpen = !state.sidebarOpen;
    document.getElementById('sidebar').classList.toggle('open', state.sidebarOpen);
  });
  document.getElementById('menu-search').addEventListener('click', openPalette);
  document.getElementById('bell').addEventListener('click', () => {
    go('tickets', { status: 'overdue' });
    toast('已为你筛选：超期未处理工单');
  });
  document.getElementById('user-chip').addEventListener('click', () => {
    openModal({
      title: '账号信息',
      body: `
        <dl class="detail-list">
          <dt>账号</dt><dd>${h(state.user.username)}</dd>
          <dt>姓名</dt><dd>${h(state.user.name)}</dd>
          <dt>所属单位</dt><dd>${h(state.user.org)}</dd>
          <dt>角色</dt><dd>${h(state.user.role)}</dd>
        </dl>
        <div class="divider"></div>
        <button class="btn btn-danger" id="btn-logout">退出登录</button>`,
      onMount(root) {
        root.querySelector('#btn-logout').addEventListener('click', () => { closeModal(); logout(); });
      },
    });
  });

  renderPage();
}

function go(page, filter) {
  state.page = page;
  if (filter) state.filters[page === 'tickets' ? 'ticket' : page] = filter;
  document.querySelectorAll('.menu-item').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  const cur = document.querySelector('.crumbs .cur');
  if (cur) cur.textContent = PAGE_TITLE[page];
  state.sidebarOpen = false;
  const sb = document.getElementById('sidebar');
  if (sb) sb.classList.remove('open');
  renderPage();
}

async function renderPage() {
  const c = document.getElementById('content');
  if (state.page === 'dashboard') return renderDashboard(c);
  if (state.page === 'tickets') return renderTickets(c);
  if (state.page === 'assets') return renderAssets(c);
  if (state.page === 'kb') return renderKB(c);
}

/* ============================== 首页 ============================== */

async function renderDashboard(c) {
  c.innerHTML = '<div class="empty">加载中…</div>';
  const [s, tickets] = await Promise.all([req('GET', '/stats'), req('GET', '/tickets')]);
  state.stats = s;
  state.tickets = tickets;

  const cards = [
    { key: 'pending', label: '待受理', n: s.pending, cls: 'sc-pending', ico: 'bell' },
    { key: 'processing', label: '受理中', n: s.processing, cls: 'sc-processing', ico: 'refresh' },
    { key: 'resolved', label: '已解决', n: s.resolved, cls: 'sc-resolved', ico: 'check' },
    { key: 'closed', label: '已关闭', n: s.closed, cls: 'sc-closed', ico: 'close' },
    { key: 'overdue', label: '已超期', n: s.overdue, cls: 'sc-overdue', ico: 'clock' },
    { key: 'coop', label: '协作工单', n: s.coop, cls: 'sc-coop', ico: 'users' },
    { key: 'total', label: '全部工单', n: s.total, cls: 'sc-total', ico: 'doc' },
  ];

  const pendingList = tickets.filter((t) => t.status === 'pending').slice(0, 6);
  const maxWeek = Math.max(1, ...s.week.map((w) => w.created));

  c.innerHTML = `
    <section class="welcome">
      <div>
        <h2>${greeting()}，${h(state.user.name)}！</h2>
        <p>今天是 ${fmtDate(new Date())}，${weekdayCN(new Date())}，祝您工作顺利</p>
      </div>
      <div class="meta">
        <span>${icon('pin', 15)}${h(state.user.org || '中烟信息')}</span>
        <span>${icon('doc', 15)}${weekdayCN(new Date())}</span>
      </div>
    </section>

    <section class="stat-grid">
      ${cards.map((k) => `
        <div class="stat-card ${k.cls}" data-stat="${k.key}">
          <svg class="bg-ico" viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[k.ico]}</svg>
          <div class="num">${k.n}</div>
          <div class="lbl">${k.label}</div>
          <div class="more">查看详情 ›</div>
        </div>`).join('')}
    </section>

    <section class="panel-grid">
      <div class="panel">
        <div class="panel-head"><i class="bar"></i>待受理工单
          ${s.pending ? `<span class="badge">${s.pending}</span>` : ''}
          <span class="link" data-go="tickets">查看全部 →</span>
        </div>
        <div class="panel-body">
          ${pendingList.length ? pendingList.map((t) => `
            <div class="mini-row" data-ticket="${t.id}">
              <span class="t">${h(t.title)}</span>
              <span class="code">${h(t.code)}</span>
              <span class="tag tag-${t.priority}">${PRIORITY_TEXT[t.priority]}</span>
            </div>`).join('') : '<div class="empty">暂无待受理工单</div>'}
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><i class="bar"></i>数据概览</div>
        <div class="kpi-row">
          <div class="kpi"><div class="v">${s.total}</div><div class="k">本周工单总量</div></div>
          <div class="kpi"><div class="v">${s.overdue ? (s.overdue * 3.5).toFixed(0) + ' min' : '0 min'}</div><div class="k">平均响应时间</div></div>
        </div>
        <div class="spark">
          <svg viewBox="0 0 300 74" preserveAspectRatio="none">
            ${(() => {
              const pts = s.week.map((w, i) => {
                const x = 10 + i * (280 / Math.max(1, s.week.length - 1));
                const y = 62 - (w.created / maxWeek) * 48;
                return [x, y, w];
              });
              const line = pts.map((p) => `${p[0]},${p[1]}`).join(' ');
              const area = `${pts[0][0]},68 ` + line + ` ${pts[pts.length - 1][0]},68`;
              return `
                <polygon points="${area}" fill="rgba(37,99,235,.10)"/>
                <polyline points="${line}" fill="none" stroke="#2563eb" stroke-width="2" stroke-linejoin="round"/>
                ${pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="#2563eb"/>`).join('')}
                ${pts.map((p) => `<text x="${p[0]}" y="73" font-size="9" fill="#9ca3af" text-anchor="middle">${p[2].label}</text>`).join('')}`;
            })()}
          </svg>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><i class="bar"></i>快捷入口</div>
        <div class="shortcuts">
          <button class="shortcut" data-quick="new-ticket"><span class="si" style="background:linear-gradient(135deg,#2563eb,#3b82f6)">${icon('plus', 17)}</span>新建工单</button>
          <button class="shortcut" data-quick="tickets"><span class="si" style="background:linear-gradient(135deg,#7c3aed,#a855f7)">${icon('ticket', 17)}</span>工单列表</button>
          <button class="shortcut" data-quick="assets"><span class="si" style="background:linear-gradient(135deg,#f59e0b,#fbbf24)">${icon('asset', 17)}</span>资产台账</button>
          <button class="shortcut" data-quick="kb"><span class="si" style="background:linear-gradient(135deg,#0d9488,#14b8a6)">${icon('kb', 17)}</span>知识库</button>
          <button class="shortcut" data-quick="overdue"><span class="si" style="background:linear-gradient(135deg,#dc2626,#ef4444)">${icon('clock', 17)}</span>超期工单</button>
          <button class="shortcut" data-quick="new-kb"><span class="si" style="background:linear-gradient(135deg,#16a34a,#22c55e)">${icon('doc', 17)}</span>写知识</button>
        </div>
      </div>
    </section>`;

  c.querySelectorAll('[data-stat]').forEach((el) => el.addEventListener('click', () => {
    const k = el.dataset.stat;
    if (k === 'total') return go('tickets');
    go('tickets', k === 'coop' ? { coop: '1' } : { status: k });
  }));
  c.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => go(el.dataset.go)));
  c.querySelectorAll('[data-ticket]').forEach((el) => el.addEventListener('click', () => openTicketDetail(Number(el.dataset.ticket))));
  c.querySelectorAll('[data-quick]').forEach((el) => el.addEventListener('click', () => {
    const q = el.dataset.quick;
    if (q === 'new-ticket') return openTicketForm();
    if (q === 'new-kb') return openKBForm();
    if (q === 'overdue') return go('tickets', { status: 'overdue' });
    go(q);
  }));
}

/* ============================== 工单 ============================== */

async function renderTickets(c) {
  const f = state.filters.ticket || {};
  c.innerHTML = '<div class="empty">加载中…</div>';
  const qs = new URLSearchParams();
  ['keyword', 'status', 'category', 'coop'].forEach((k) => { if (f[k]) qs.set(k, f[k]); });
  const list = await req('GET', '/tickets' + (qs.toString() ? '?' + qs : ''));
  state.tickets = list;

  c.innerHTML = `
    <div class="toolbar">
      <input type="text" id="f-kw" placeholder="搜索工单号 / 标题 / 处理人" value="${h(f.keyword || '')}" />
      <select id="f-status">
        <option value="">全部状态</option>
        ${Object.entries(STATUS_TEXT).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v}</option>`).join('')}
        <option value="overdue" ${f.status === 'overdue' ? 'selected' : ''}>已超期</option>
      </select>
      <select id="f-cat">
        <option value="">全部分类</option>
        ${CATEGORIES.map((x) => `<option value="${x}" ${f.category === x ? 'selected' : ''}>${x}</option>`).join('')}
      </select>
      <label style="display:flex;align-items:center;gap:6px;font-size:13.5px;color:#4b5563">
        <input type="checkbox" id="f-coop" ${f.coop === '1' ? 'checked' : ''} /> 仅协作工单
      </label>
      <span class="spacer"></span>
      <button class="btn btn-primary" id="btn-new">+ 新建工单</button>
    </div>

    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>工单</th><th>状态</th><th>优先级</th><th>分类</th>
          <th>处理人</th><th>创建人</th><th>创建时间</th><th>截止时间</th>
        </tr></thead>
        <tbody>
          ${list.length ? list.map((t) => `
            <tr data-id="${t.id}">
              <td class="td-title">${h(t.title)}<span class="code">${h(t.code)}${t.isCoop ? ' · 协作' : ''}</span></td>
              <td>
                ${t.overdue ? `<span class="tag tag-overdue">已超期</span>` : `<span class="tag tag-${t.status}">${STATUS_TEXT[t.status]}</span>`}
              </td>
              <td><span class="tag tag-${t.priority}">${PRIORITY_TEXT[t.priority]}</span></td>
              <td>${h(t.category)}</td>
              <td>${h(t.assignee)}</td>
              <td>${h(t.creator)}</td>
              <td>${fmtDate(t.createdAt)}</td>
              <td>${fmtDate(t.dueAt)}</td>
            </tr>`).join('') : '<tr><td colspan="8"><div class="empty">没有符合条件的工单</div></td></tr>'}
        </tbody>
      </table>
    </div>`;

  const apply = () => {
    state.filters.ticket = {
      keyword: document.getElementById('f-kw').value.trim(),
      status: document.getElementById('f-status').value,
      category: document.getElementById('f-cat').value,
      coop: document.getElementById('f-coop').checked ? '1' : '',
    };
    renderTickets(c);
  };
  let timer = null;
  document.getElementById('f-kw').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(apply, 300); });
  ['f-status', 'f-cat', 'f-coop'].forEach((id) => document.getElementById(id).addEventListener('change', apply));
  document.getElementById('btn-new').addEventListener('click', () => openTicketForm());
  c.querySelectorAll('tbody tr[data-id]').forEach((tr) => tr.addEventListener('click', () => openTicketDetail(Number(tr.dataset.id))));
}

async function openTicketDetail(id) {
  let t;
  try { t = await req('GET', '/tickets/' + id); } catch (e) { return toast(e.message, 'err'); }
  openModal({
    title: '工单详情',
    body: `
      <dl class="detail-list">
        <dt>工单编号</dt><dd>${h(t.code)}</dd>
        <dt>标题</dt><dd>${h(t.title)}</dd>
        <dt>状态</dt><dd><span class="tag tag-${t.overdue ? 'overdue' : t.status}">${t.overdue ? '已超期' : STATUS_TEXT[t.status]}</span></dd>
        <dt>优先级</dt><dd><span class="tag tag-${t.priority}">${PRIORITY_TEXT[t.priority]}</span></dd>
        <dt>分类</dt><dd>${h(t.category)}</dd>
        <dt>关联资产</dt><dd>${h(t.asset)}</dd>
        <dt>创建人</dt><dd>${h(t.creator)}</dd>
        <dt>处理人</dt><dd>${h(t.assignee)}</dd>
        <dt>创建时间</dt><dd>${fmtDate(t.createdAt, true)}</dd>
        <dt>截止时间</dt><dd>${fmtDate(t.dueAt, true)}</dd>
        <dt>协作工单</dt><dd>${t.isCoop ? '是' : '否'}</dd>
      </dl>
      <div class="divider"></div>
      <div style="font-size:13px;color:#6b7280;margin-bottom:6px">问题描述</div>
      <div style="font-size:13.5px;line-height:1.8;white-space:pre-wrap">${h(t.description) || '—'}</div>
      <div class="divider"></div>
      <div style="font-size:13px;color:#6b7280;margin-bottom:8px">处理记录（${t.comments.length}）</div>
      <div id="cm-list">
        ${t.comments.length ? t.comments.map((cm) => `
          <div class="comment"><div class="meta">${h(cm.by)} · ${fmtDate(cm.at, true)}</div>${h(cm.content)}</div>`).join('')
        : '<div class="empty" style="padding:12px">暂无处理记录</div>'}
      </div>
      <div class="comment-box">
        <input id="cm-input" placeholder="填写处理进展…" />
        <button class="btn btn-primary" id="cm-send">发送</button>
      </div>`,
    footer: `
      <select id="dt-status" class="btn" style="padding:8px 10px">
        ${Object.entries(STATUS_TEXT).map(([k, v]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
      <button class="btn btn-danger" id="dt-del">删除</button>
      <button class="btn" id="dt-edit">编辑</button>
      <button class="btn btn-primary" id="dt-save">保存状态</button>`,
    onMount(root) {
      root.querySelector('#cm-send').addEventListener('click', async () => {
        const inp = root.querySelector('#cm-input');
        if (!inp.value.trim()) return;
        try {
          await req('POST', `/tickets/${id}/comments`, { content: inp.value.trim(), by: state.user.name });
          closeModal(); openTicketDetail(id); toast('已添加处理记录', 'ok');
        } catch (e) { toast(e.message, 'err'); }
      });
      root.querySelector('#dt-save').addEventListener('click', async () => {
        try {
          await req('PUT', '/tickets/' + id, { status: root.querySelector('#dt-status').value });
          closeModal(); toast('工单状态已更新', 'ok'); refresh();
        } catch (e) { toast(e.message, 'err'); }
      });
      root.querySelector('#dt-edit').addEventListener('click', () => { closeModal(); openTicketForm(t); });
      root.querySelector('#dt-del').addEventListener('click', async () => {
        if (!confirm('确定删除该工单？')) return;
        try { await req('DELETE', '/tickets/' + id); closeModal(); toast('已删除', 'ok'); refresh(); }
        catch (e) { toast(e.message, 'err'); }
      });
    },
  });
}

function openTicketForm(t) {
  const isEdit = !!t;
  openModal({
    title: isEdit ? '编辑工单' : '新建工单',
    body: `
      <div class="form-row"><label>工单标题 *</label><input id="tf-title" value="${h(t ? t.title : '')}" placeholder="简要描述问题" /></div>
      <div class="form-cols">
        <div class="form-row"><label>分类</label>
          <select id="tf-cat">${CATEGORIES.map((x) => `<option ${t && t.category === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
        </div>
        <div class="form-row"><label>优先级</label>
          <select id="tf-pri">${Object.entries(PRIORITY_TEXT).map(([k, v]) => `<option value="${k}" ${t && t.priority === k ? 'selected' : (!t && k === 'normal' ? 'selected' : '')}>${v}</option>`).join('')}</select>
        </div>
        <div class="form-row"><label>处理人</label><input id="tf-assignee" value="${h(t ? t.assignee : '')}" placeholder="如：李强" /></div>
        <div class="form-row"><label>关联资产</label><input id="tf-asset" value="${h(t ? t.asset : '')}" placeholder="如：srv-app-03" /></div>
        <div class="form-row"><label>创建人</label><input id="tf-creator" value="${h(t ? t.creator : (state.user.name || ''))}" /></div>
        <div class="form-row"><label>要求完成（天）</label><input id="tf-due" type="number" min="1" value="2" /></div>
      </div>
      <div class="form-row"><label>问题描述</label><textarea id="tf-desc" placeholder="补充详细现象、影响范围等">${h(t ? t.description : '')}</textarea></div>
      <label style="display:flex;align-items:center;gap:7px;font-size:13.5px;color:#4b5563">
        <input type="checkbox" id="tf-coop" ${t && t.isCoop ? 'checked' : ''} /> 标记为协作工单（需多部门配合）
      </label>`,
    footer: `<button class="btn" id="tf-cancel">取消</button><button class="btn btn-primary" id="tf-save">保存</button>`,
    onMount(root) {
      root.querySelector('#tf-cancel').addEventListener('click', closeModal);
      root.querySelector('#tf-save').addEventListener('click', async () => {
        const payload = {
          title: root.querySelector('#tf-title').value.trim(),
          category: root.querySelector('#tf-cat').value,
          priority: root.querySelector('#tf-pri').value,
          assignee: root.querySelector('#tf-assignee').value.trim() || '待分配',
          asset: root.querySelector('#tf-asset').value.trim() || '-',
          creator: root.querySelector('#tf-creator').value.trim(),
          dueDays: Number(root.querySelector('#tf-due').value) || 2,
          description: root.querySelector('#tf-desc').value.trim(),
          isCoop: root.querySelector('#tf-coop').checked,
        };
        if (!payload.title) return toast('请填写工单标题', 'err');
        try {
          if (isEdit) await req('PUT', '/tickets/' + t.id, payload);
          else await req('POST', '/tickets', payload);
          closeModal(); toast(isEdit ? '工单已更新' : '工单已创建', 'ok'); refresh();
        } catch (e) { toast(e.message, 'err'); }
      });
    },
  });
}

/* ============================== 资产 ============================== */

async function renderAssets(c) {
  const f = state.filters.asset || {};
  c.innerHTML = '<div class="empty">加载中…</div>';
  const qs = new URLSearchParams();
  ['keyword', 'type'].forEach((k) => { if (f[k]) qs.set(k, f[k]); });
  const list = await req('GET', '/assets' + (qs.toString() ? '?' + qs : ''));
  state.assets = list;

  const counts = list.reduce((m, a) => (m[a.status] = (m[a.status] || 0) + 1, m), {});

  c.innerHTML = `
    <div class="toolbar">
      <input type="text" id="a-kw" placeholder="搜索资产名称 / 编号 / IP / 责任人" value="${h(f.keyword || '')}" />
      <select id="a-type">
        <option value="">全部类型</option>
        ${ASSET_TYPES.map((x) => `<option value="${x}" ${f.type === x ? 'selected' : ''}>${x}</option>`).join('')}
      </select>
      <span style="font-size:13px;color:#6b7280">共 ${list.length} 项 · 运行中 ${counts.running || 0} · 告警 ${counts.warning || 0} · 离线 ${counts.offline || 0}</span>
      <span class="spacer"></span>
      <button class="btn btn-primary" id="btn-new-asset">+ 新增资产</button>
    </div>
    <div class="asset-grid">
      ${list.length ? list.map((a) => `
        <div class="asset-card" data-id="${a.id}" style="border-left-color:${a.status === 'running' ? '#16a34a' : a.status === 'warning' ? '#f59e0b' : '#9ca3af'}">
          <div class="row1">
            <span class="nm">${h(a.name)}</span>
            <span class="tag tag-${a.status}">${ASSET_STATUS[a.status]}</span>
          </div>
          <div class="kv"><b>编号</b><span>${h(a.code)}</span></div>
          <div class="kv"><b>类型</b><span>${h(a.type)}</span></div>
          <div class="kv"><b>IP</b><span>${h(a.ip)}</span></div>
          <div class="kv"><b>位置</b><span>${h(a.location)}</span></div>
          <div class="kv"><b>责任人</b><span>${h(a.owner)}</span></div>
        </div>`).join('') : '<div class="empty">没有符合条件的资产</div>'}
    </div>`;

  const apply = () => {
    state.filters.asset = {
      keyword: document.getElementById('a-kw').value.trim(),
      type: document.getElementById('a-type').value,
    };
    renderAssets(c);
  };
  let timer = null;
  document.getElementById('a-kw').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(apply, 300); });
  document.getElementById('a-type').addEventListener('change', apply);
  document.getElementById('btn-new-asset').addEventListener('click', () => openAssetForm());
  c.querySelectorAll('.asset-card').forEach((el) => el.addEventListener('click', () => openAssetDetail(Number(el.dataset.id))));
}

async function openAssetDetail(id) {
  const a = state.assets.find((x) => x.id === id) || (await req('GET', '/assets')).find((x) => x.id === id);
  if (!a) return toast('资产不存在', 'err');
  const related = state.tickets.filter((t) => t.asset === a.code);
  openModal({
    title: '资产详情',
    body: `
      <dl class="detail-list">
        <dt>资产名称</dt><dd>${h(a.name)}</dd>
        <dt>资产编号</dt><dd>${h(a.code)}</dd>
        <dt>类型</dt><dd>${h(a.type)}</dd>
        <dt>状态</dt><dd><span class="tag tag-${a.status}">${ASSET_STATUS[a.status]}</span></dd>
        <dt>IP 地址</dt><dd>${h(a.ip)}</dd>
        <dt>位置</dt><dd>${h(a.location)}</dd>
        <dt>责任人</dt><dd>${h(a.owner)}</dd>
        <dt>购置日期</dt><dd>${fmtDate(a.purchaseDate)}</dd>
        <dt>备注</dt><dd>${h(a.note) || '—'}</dd>
      </dl>
      <div class="divider"></div>
      <div style="font-size:13px;color:#6b7280;margin-bottom:8px">关联工单（${related.length}）</div>
      ${related.length ? related.map((t) => `
        <div class="mini-row" data-ticket="${t.id}" style="padding-left:0;padding-right:0">
          <span class="t">${h(t.title)}</span>
          <span class="tag tag-${t.status}">${STATUS_TEXT[t.status]}</span>
        </div>`).join('') : '<div class="empty" style="padding:10px">暂无关联工单</div>'}`,
    footer: `<button class="btn btn-danger" id="ad-del">删除</button><button class="btn" id="ad-edit">编辑</button><button class="btn btn-primary" id="ad-close">关闭</button>`,
    onMount(root) {
      root.querySelector('#ad-close').addEventListener('click', closeModal);
      root.querySelector('#ad-edit').addEventListener('click', () => { closeModal(); openAssetForm(a); });
      root.querySelectorAll('[data-ticket]').forEach((el) => el.addEventListener('click', () => { closeModal(); openTicketDetail(Number(el.dataset.ticket)); }));
      root.querySelector('#ad-del').addEventListener('click', async () => {
        if (!confirm('确定删除该资产？')) return;
        try { await req('DELETE', '/assets/' + id); closeModal(); toast('已删除', 'ok'); refresh(); }
        catch (e) { toast(e.message, 'err'); }
      });
    },
  });
}

function openAssetForm(a) {
  const isEdit = !!a;
  openModal({
    title: isEdit ? '编辑资产' : '新增资产',
    body: `
      <div class="form-cols">
        <div class="form-row"><label>资产名称 *</label><input id="af-name" value="${h(a ? a.name : '')}" /></div>
        <div class="form-row"><label>资产编号</label><input id="af-code" value="${h(a ? a.code : '')}" placeholder="留空自动生成" /></div>
        <div class="form-row"><label>类型</label>
          <select id="af-type">${ASSET_TYPES.map((x) => `<option ${a && a.type === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
        </div>
        <div class="form-row"><label>状态</label>
          <select id="af-status">${Object.entries(ASSET_STATUS).map(([k, v]) => `<option value="${k}" ${a && a.status === k ? 'selected' : (!a && k === 'running' ? 'selected' : '')}>${v}</option>`).join('')}</select>
        </div>
        <div class="form-row"><label>IP 地址</label><input id="af-ip" value="${h(a ? a.ip : '')}" /></div>
        <div class="form-row"><label>责任人</label><input id="af-owner" value="${h(a ? a.owner : '')}" /></div>
      </div>
      <div class="form-row"><label>位置</label><input id="af-loc" value="${h(a ? a.location : '')}" /></div>
      <div class="form-row"><label>备注</label><textarea id="af-note" style="min-height:70px">${h(a ? a.note : '')}</textarea></div>`,
    footer: `<button class="btn" id="af-cancel">取消</button><button class="btn btn-primary" id="af-save">保存</button>`,
    onMount(root) {
      root.querySelector('#af-cancel').addEventListener('click', closeModal);
      root.querySelector('#af-save').addEventListener('click', async () => {
        const payload = {
          name: root.querySelector('#af-name').value.trim(),
          code: root.querySelector('#af-code').value.trim(),
          type: root.querySelector('#af-type').value,
          status: root.querySelector('#af-status').value,
          ip: root.querySelector('#af-ip').value.trim() || '-',
          owner: root.querySelector('#af-owner').value.trim() || '-',
          location: root.querySelector('#af-loc').value.trim() || '-',
          note: root.querySelector('#af-note').value.trim(),
        };
        if (!payload.name) return toast('请填写资产名称', 'err');
        try {
          if (isEdit) await req('PUT', '/assets/' + a.id, payload);
          else await req('POST', '/assets', payload);
          closeModal(); toast(isEdit ? '资产已更新' : '资产已新增', 'ok'); refresh();
        } catch (e) { toast(e.message, 'err'); }
      });
    },
  });
}

/* ============================== 知识库 ============================== */

async function renderKB(c) {
  const f = state.filters.kb || {};
  c.innerHTML = '<div class="empty">加载中…</div>';
  const qs = new URLSearchParams();
  ['keyword', 'category'].forEach((k) => { if (f[k]) qs.set(k, f[k]); });
  const list = await req('GET', '/kb' + (qs.toString() ? '?' + qs : ''));
  state.kb = list;

  c.innerHTML = `
    <div class="toolbar">
      <input type="text" id="k-kw" placeholder="搜索标题 / 正文 / 标签" value="${h(f.keyword || '')}" />
      <select id="k-cat">
        <option value="">全部分类</option>
        ${KB_CATEGORIES.map((x) => `<option value="${x}" ${f.category === x ? 'selected' : ''}>${x}</option>`).join('')}
      </select>
      <span style="font-size:13px;color:#6b7280">共 ${list.length} 篇文档</span>
      <span class="spacer"></span>
      <button class="btn btn-primary" id="btn-new-kb">+ 新建文档</button>
    </div>
    <div class="kb-grid">
      ${list.length ? list.map((k) => `
        <div class="kb-card" data-id="${k.id}">
          <h3>${h(k.title)}</h3>
          <div class="excerpt">${h((k.content || '').replace(/\n+/g, ' ').slice(0, 120))}</div>
          <div class="foot">
            <span class="chip">${h(k.category)}</span>
            ${k.tags.slice(0, 3).map((t) => `<span class="chip">${h(t)}</span>`).join('')}
            <span style="margin-left:auto">${h(k.author)} · 浏览 ${k.views}</span>
          </div>
        </div>`).join('') : '<div class="empty">没有符合条件的文档</div>'}
    </div>`;

  const apply = () => {
    state.filters.kb = {
      keyword: document.getElementById('k-kw').value.trim(),
      category: document.getElementById('k-cat').value,
    };
    renderKB(c);
  };
  let timer = null;
  document.getElementById('k-kw').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(apply, 300); });
  document.getElementById('k-cat').addEventListener('change', apply);
  document.getElementById('btn-new-kb').addEventListener('click', () => openKBForm());
  c.querySelectorAll('.kb-card').forEach((el) => el.addEventListener('click', () => openKBDetail(Number(el.dataset.id))));
}

async function openKBDetail(id) {
  let k;
  try { k = await req('GET', '/kb/' + id); } catch (e) { return toast(e.message, 'err'); }
  openModal({
    title: k.title,
    body: `
      <div class="foot" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
        <span class="chip">${h(k.category)}</span>
        ${k.tags.map((t) => `<span class="chip">${h(t)}</span>`).join('')}
        <span style="margin-left:auto;font-size:12px;color:#6b7280">${h(k.author)} · 更新于 ${fmtDate(k.updatedAt)} · 浏览 ${k.views}</span>
      </div>
      <div class="kb-content">${h(k.content)}</div>`,
    footer: `<button class="btn btn-danger" id="kd-del">删除</button><button class="btn" id="kd-edit">编辑</button><button class="btn btn-primary" id="kd-close">关闭</button>`,
    onMount(root) {
      root.querySelector('#kd-close').addEventListener('click', closeModal);
      root.querySelector('#kd-edit').addEventListener('click', () => { closeModal(); openKBForm(k); });
      root.querySelector('#kd-del').addEventListener('click', async () => {
        if (!confirm('确定删除该文档？')) return;
        try { await req('DELETE', '/kb/' + id); closeModal(); toast('已删除', 'ok'); refresh(); }
        catch (e) { toast(e.message, 'err'); }
      });
    },
  });
}

function openKBForm(k) {
  const isEdit = !!k;
  openModal({
    title: isEdit ? '编辑文档' : '新建文档',
    body: `
      <div class="form-row"><label>标题 *</label><input id="kf-title" value="${h(k ? k.title : '')}" /></div>
      <div class="form-cols">
        <div class="form-row"><label>分类</label>
          <select id="kf-cat">${KB_CATEGORIES.map((x) => `<option ${k && k.category === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
        </div>
        <div class="form-row"><label>标签（逗号分隔）</label><input id="kf-tags" value="${h(k ? k.tags.join(',') : '')}" placeholder="如：VPN,远程办公" /></div>
      </div>
      <div class="form-row"><label>正文</label><textarea id="kf-content" placeholder="支持纯文本 / Markdown">${h(k ? k.content : '')}</textarea></div>`,
    footer: `<button class="btn" id="kf-cancel">取消</button><button class="btn btn-primary" id="kf-save">保存</button>`,
    onMount(root) {
      root.querySelector('#kf-cancel').addEventListener('click', closeModal);
      root.querySelector('#kf-save').addEventListener('click', async () => {
        const payload = {
          title: root.querySelector('#kf-title').value.trim(),
          category: root.querySelector('#kf-cat').value,
          tags: root.querySelector('#kf-tags').value,
          content: root.querySelector('#kf-content').value,
          author: state.user.name,
        };
        if (!payload.title) return toast('请填写标题', 'err');
        try {
          if (isEdit) await req('PUT', '/kb/' + k.id, payload);
          else await req('POST', '/kb', payload);
          closeModal(); toast(isEdit ? '文档已更新' : '文档已创建', 'ok'); refresh();
        } catch (e) { toast(e.message, 'err'); }
      });
    },
  });
}

/* ============================== 弹窗 ============================== */

function openModal({ title, body, footer, onMount }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="mask">
      <div class="modal">
        <div class="modal-head">${h(title)}<button class="x">×</button></div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>
    </div>`;
  const mask = root.querySelector('.mask');
  mask.addEventListener('click', (e) => { if (e.target === mask) closeModal(); });
  root.querySelector('.x').addEventListener('click', closeModal);
  if (onMount) onMount(root);
}

function closeModal() {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
}

/* ============================== 菜单搜索 ============================== */

function openPalette() {
  const items = [];
  PAGES.forEach((p) => items.push({ label: p.label, grp: '菜单', run: () => go(p.key) }));
  items.push({ label: '新建工单', grp: '操作', run: () => openTicketForm() });
  items.push({ label: '新增资产', grp: '操作', run: () => openAssetForm() });
  items.push({ label: '新建知识文档', grp: '操作', run: () => openKBForm() });
  items.push({ label: '查看超期工单', grp: '快捷', run: () => go('tickets', { status: 'overdue' }) });
  items.push({ label: '查看协作工单', grp: '快捷', run: () => go('tickets', { coop: '1' }) });

  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="palette-mask">
      <div class="palette">
        <input id="pal-input" placeholder="输入菜单名称，回车直达…" />
        <div class="palette-list" id="pal-list"></div>
      </div>
    </div>`;

  const input = root.querySelector('#pal-input');
  const listEl = root.querySelector('#pal-list');
  let sel = 0, shown = items;

  const paint = () => {
    listEl.innerHTML = shown.length ? shown.map((it, i) => `
      <div class="palette-item ${i === sel ? 'sel' : ''}" data-i="${i}">${h(it.label)}<span class="grp">${it.grp}</span></div>`).join('')
      : '<div class="empty">未找到匹配项</div>';
    listEl.querySelectorAll('.palette-item').forEach((el) => el.addEventListener('click', () => {
      closePalette(); shown[Number(el.dataset.i)].run();
    }));
  };

  const filter = () => {
    const q = input.value.trim().toLowerCase();
    shown = q ? items.filter((it) => it.label.toLowerCase().includes(q)) : items;
    sel = 0; paint();
  };

  input.addEventListener('input', filter);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, shown.length - 1); paint(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); paint(); e.preventDefault(); }
    else if (e.key === 'Enter') { if (shown[sel]) { closePalette(); shown[sel].run(); } }
    else if (e.key === 'Escape') closePalette();
  });
  root.querySelector('.palette-mask').addEventListener('click', (e) => {
    if (e.target.classList.contains('palette-mask')) closePalette();
  });
  paint();
  setTimeout(() => input.focus(), 30);
}

function closePalette() {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
}

/* ============================== 刷新 / 启动 ============================== */

function refresh() { renderPage(); }

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
});

if (state.token && state.user) renderApp();
else renderLogin();
