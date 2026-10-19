/* 智能运维管理平台 —— 前端主程序 */
'use strict';

const { createApp, ref, reactive, computed, onMounted, onBeforeUnmount, watch, h } = Vue;
const { ElMessage, ElMessageBox } = ElementPlus;

const API = '/api';

const STATUS_TEXT = { pending: '待受理', processing: '受理中', resolved: '已解决', closed: '已关闭' };
const STATUS_TAG = { pending: 'warning', processing: 'primary', resolved: 'success', closed: 'info' };
const PRIORITY_TEXT = { low: '低', normal: '普通', high: '高', urgent: '紧急' };
const PRIORITY_TAG = { low: 'info', normal: 'info', high: 'warning', urgent: 'danger' };
const ASSET_STATUS = { running: '运行中', warning: '告警', offline: '离线' };
const ASSET_TAG = { running: 'success', warning: 'warning', offline: 'info' };
const CATEGORIES = ['服务器', '网络', '应用系统', '数据库', '终端', '邮件系统', '账号权限', '监控', '其他'];
const ASSET_TYPES = ['服务器', '网络设备', '安全设备', '存储设备', '应用系统', '终端设备', '机房设施', '其他'];
const RES_CATEGORIES = ['物理服务器', '存储设备', '网络设备', '虚拟机', '端侧设备配置', '设备-软件关联', '工互传输注册信息'];
const AUDIT_STATUS = { pending: '待审核', approved: '已通过', rejected: '已驳回' };
const ASSET_AUDIT_TAG = { pending: 'warning', approved: 'success', rejected: 'danger' };
const SOFTWARE_CATEGORIES = ['业务系统', '数据库', '中间件', '运行时', '监控', '办公', '安全', '工具', '邮件', '其他'];
const KB_CATEGORIES_FALLBACK = ['操作指南', '运维规范', '故障处理', '未分类'];
const PAGES = [
  {
    key: 'monitor', label: '集群监控', icon: 'Monitor', perm: 'cluster.view',
    children: [
      { key: 'clusters', label: '集群总览', icon: 'Monitor', perm: 'cluster.view' },
      { key: 'nodes', label: '节点监控', icon: 'Cpu', perm: 'cluster.view' },
      { key: 'alerts', label: '告警中心', icon: 'BellFilled', perm: 'alert.view' },
      { key: 'alertrules', label: '告警规则', icon: 'SetUp', perm: 'alert.manage' },
      { key: 'notify', label: '通知渠道', icon: 'Bell', perm: 'alert.manage' },
    ],
  },
  { key: 'users', label: '用户与权限', icon: 'UserFilled', perm: 'user.manage' },
];
const PAGE_TITLE = {
  monitor: '集群监控', clusters: '集群总览', nodes: '节点监控',
  alerts: '告警中心', alertrules: '告警规则', notify: '通知渠道',
  users: '用户与权限',
};
const SEVERITY_TEXT = { urgent: '紧急', high: '高', normal: '中', low: '低' };
const POD_ABNORMAL = ['CrashLoopBackOff', 'Error', 'ImagePullBackOff', 'ErrImagePull', 'OOMKilled', 'Pending', 'Failed'];
const POD_STATUS_TAG = {
  Running: 'success', Succeeded: 'info', Pending: 'warning',
  CrashLoopBackOff: 'danger', Error: 'danger', Failed: 'danger',
  ImagePullBackOff: 'danger', ErrImagePull: 'danger', OOMKilled: 'danger',
};
const CHANNEL_TYPE_TEXT = { wecom: '企业微信', dingtalk: '钉钉', email: '邮件' };
const CHANNEL_TYPE_TAG = { wecom: 'success', dingtalk: 'primary', email: 'warning' };
const SEVERITY_TAG = { urgent: 'danger', high: 'warning', normal: 'primary', low: 'info' };
const ALERT_STATUS_TEXT = { firing: '告警中', resolved: '已恢复' };
const CLUSTER_STATUS_TEXT = { healthy: '健康', warning: '异常', unknown: '未知' };
const CLUSTER_STATUS_TAG = { healthy: 'success', warning: 'warning', unknown: 'info' };
const NODE_STATUS_TAG = { Ready: 'success', NotReady: 'danger' };
const METRIC_OPTIONS = [
  { value: 'cpu_usage', label: 'CPU 使用率(%)' },
  { value: 'mem_usage', label: '内存使用率(%)' },
  { value: 'disk_usage', label: '磁盘使用率(%)' },
  { value: 'load1', label: '负载(1m)' },
  { value: 'node_status', label: '节点状态(NotReady)' },
];
const SUPPLIER_STATUS = { active: '正常', disabled: '禁用' };
const MODEL_UNITS = ['台', '套', '个', '块', '条', '批'];
const PROVINCES = ['北京市', '上海市', '广东省', '浙江省', '江苏省', '山东省', '四川省', '湖北省', '河南省', '福建省', '陕西省', '辽宁省'];
const MODEL_CATEGORIES = ['服务器', '网络设备', '安全设备', '存储设备', '终端设备', '机房设施', '软件系统', '其他'];
const AUDIT_ACTION = {
  login: '登录', 'login.fail': '登录失败', logout: '退出', create: '新增', update: '修改',
  delete: '删除', accept: '受理', resolve: '解决', close: '关闭', reopen: '重新打开',
  reject: '退回', cancel: '取消', transfer: '转派', comment: '回复',
};
const AUDIT_TAG = {
  create: 'success', update: 'primary', delete: 'danger', login: 'info', 'login.fail': 'danger',
  logout: 'info', accept: 'primary', resolve: 'success', close: 'info', reopen: 'warning',
  reject: 'warning', cancel: 'danger', transfer: 'warning', comment: 'info',
};
const FLOW_TEXT = { create: '创建', accept: '受理', resolve: '解决', close: '关闭', reopen: '重新打开', reject: '退回', cancel: '取消', transfer: '转派' };
const FLOW_TAG = { create: 'info', accept: 'primary', resolve: 'success', close: 'info', reopen: 'warning', reject: 'danger', cancel: 'danger', transfer: 'warning' };

async function req(method, url, body) {
  const opt = { method, headers: {} };
  const tk = sessionStorage.getItem('aiops_token');
  if (tk) opt.headers['Authorization'] = 'Bearer ' + tk;
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(API + url, opt);
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = { error: text }; }
  if (r.status === 401) { sessionStorage.removeItem('aiops_token'); sessionStorage.removeItem('aiops_user'); }
  if (!r.ok) throw new Error((data && data.error) || ('请求失败 ' + r.status));
  return data;
}

const fmtDate = (iso, withTime) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d)) return '-';
  const p = (n) => String(n).padStart(2, '0');
  const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${base} ${p(d.getHours())}:${p(d.getMinutes())}` : base;
};
const weekdayCN = (d) => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
const greeting = () => {
  const hr = new Date().getHours();
  if (hr < 6) return '凌晨好';
  if (hr < 9) return '早上好';
  if (hr < 12) return '上午好';
  if (hr < 14) return '中午好';
  if (hr < 18) return '下午好';
  return '晚上好';
};

/* ============================== 根组件 ============================== */

const App = {
  setup() {
    const token = ref(sessionStorage.getItem('aiops_token') || '');
    const user = ref(JSON.parse(sessionStorage.getItem('aiops_user') || 'null'));
    const page = ref('clusters');
    const sidebarOpen = ref(false);
    const loginErr = ref('');
    const loginForm = reactive({ username: 'admin', password: '123456', captcha: '' });
    const logging = ref(false);
    /* 图形验证码：图片用 blob URL，id 从响应头拿 */
    const captchaId = ref('');
    const captchaImg = ref('');
    const captchaLoading = ref(false);
    async function loadCaptcha() {
      captchaLoading.value = true;
      try {
        const r = await fetch('/api/captcha', { cache: 'no-store' });
        const id = r.headers.get('X-Captcha-Id') || '';
        const blob = await r.blob();
        if (captchaImg.value) URL.revokeObjectURL(captchaImg.value);
        captchaImg.value = URL.createObjectURL(blob);
        captchaId.value = id;
        loginForm.captcha = '';
      } catch (e) { /* 忽略，登录时会提示 */ }
      finally { captchaLoading.value = false; }
    }

    const stats = ref(null);
    const tickets = ref([]);
    const assets = ref([]);
    const kb = ref([]);
    const kbCategories = ref([]);
    const suppliers = ref([]);
    const assetOwners = ref([]);
    /* 工单关联资产：单位 → 资产 两级 */
    const taUnits = ref([]);        // [{unit, count}]
    const taAssets = ref([]);       // [{id, category, label, value}]
    const taUnit = ref('');         // 当前选中的单位
    const assetSoftware = ref([]);
    const assetUnits = ref([]);
    const assetSelected = ref([]);
    /* 资源分类（动态字段模型） */
    const resCats = ref([]);            // [{name, kind, fields:[{key,label,type,inList,optionsSource}]}]
    const resRecords = ref([]);         // 当前分类记录
    const resCat = ref('物理服务器');    // 当前分类
    const resOptions = reactive({});    // 字段下拉候选缓存 { '分类.字段': [...] }
    const resDialog = reactive({ visible: false, mode: 'create', form: {} });
    const resDetail = reactive({ visible: false, data: null });
    const resKw = ref('');
    const resAuditFilter = ref('');
    const resShowDeleted = ref(false);
    const resImportInput = ref(null);
    const models = ref([]);
    const categories = ref([]);
    const ticketCatTree = ref([]);
    const tcDialog = reactive({ visible: false, mode: 'create', form: {} });
    const auditLogs = ref([]);
    const auditModules = ref([]);
    const menuMatrix = ref(null);
    const clusters = ref([]);
    const nodes = ref([]);
    const alerts = ref([]);
    const alertRules = ref([]);
    const monSummary = ref(null);
    const nodeMetrics = ref([]);
    const components = ref([]);
    const componentsDialog = reactive({ visible: false, cluster: null });
    const clusterPodsDialog = reactive({ visible: false, cluster: null, loading: false, list: [] });
    const clusterPage = ref(1);
    const clusterPageSize = ref(6);

    /** 通用分页工厂：返回 page/size/items/pages + 切换处理 */
    function usePager(src, defSize) {
      const page = ref(1);
      const size = ref(defSize);
      const items = computed(() => {
        const start = (page.value - 1) * size.value;
        return src.value.slice(start, start + size.value);
      });
      const pages = computed(() => Math.max(1, Math.ceil(src.value.length / size.value)));
      const onSize = () => { page.value = 1; };
      return { page, size, items, pages, onSize };
    }


    const installDialog = reactive({ visible: false, cluster: null, loading: false, tab: 'onekey',
      oneLiner: '', installScript: '', bareMetalScript: '', bareOneLiner: '', manifest: '', agentScript: '', platform: '' });
    const clusterDialog = reactive({ visible: false, mode: 'create', form: {} });
    const nodeDialog = reactive({ visible: false, node: null, clusterId: null });
    const alertRuleDialog = reactive({ visible: false, mode: 'create', form: {} });
    const notifyChannels = ref([]);
    const notifyLogs = ref([]);
    const notifyDialog = reactive({ visible: false, mode: 'create', form: {} });
    const notifyTab = ref('channels');
    const pods = ref([]);
    const pf = reactive({ clusterId: null, namespace: '', status: '', keyword: '' });
    const issuesDialog = reactive({ visible: false, kind: '', title: '', items: [], clusterId: null, clusterName: '' });
    const mf2 = reactive({ clusterId: null, status: '', keyword: '' });
    const alf = reactive({ status: 'firing', severity: '', clusterId: null, keyword: '' });
    const af2 = reactive({ keyword: '', status: '' });
    const cf = reactive({ keyword: '' });
    const lf = reactive({ keyword: '', module: '' });
    const sf = reactive({ keyword: '', status: '' });
    const mf = reactive({ keyword: '', category: '' });
    const openTabs = ref([{ key: 'clusters', label: '集群总览' }]);
    const users = ref([]);
    const uf = reactive({ keyword: '', role: '' });
    const roles = ref([]);
    const permMap = ref({});
    const userKeyword = ref('');
    const groups = ref([]);
    const departments = ref([]);
    const rules = ref([]);
    const orgTab = ref('groups');
    const filteredUsers = computed(() => {
      const q = userKeyword.value.trim().toLowerCase();
      if (!q) return users.value;
      return users.value.filter((u) => (u.username + u.name + (u.dept || '')).toLowerCase().includes(q));
    });

    const { page: ticketPage, size: ticketPageSize, items: pagedTickets, pages: ticketTotalPages, onSize: onTicketSizeChange } = usePager(tickets, 10);
    const { page: assetPage, size: assetPageSize, items: pagedAssets, pages: assetTotalPages, onSize: onAssetSizeChange } = usePager(assets, 12);
    const { page: kbPage, size: kbPageSize, items: pagedKb, pages: kbTotalPages, onSize: onKbSizeChange } = usePager(kb, 12);
    const { page: userPage, size: userPageSize, items: pagedUsers, pages: userTotalPages, onSize: onUserSizeChange } = usePager(filteredUsers, 10);
    const { page: supplierPage, size: supplierPageSize, items: pagedSuppliers, pages: supplierTotalPages, onSize: onSupplierSizeChange } = usePager(suppliers, 10);
    const { page: modelPage, size: modelPageSize, items: pagedModels, pages: modelTotalPages, onSize: onModelSizeChange } = usePager(models, 10);
    const { page: categoryPage, size: categoryPageSize, items: pagedCategories, pages: categoryTotalPages, onSize: onCategorySizeChange } = usePager(categories, 10);
    const { page: alertPage, size: alertPageSize, items: pagedAlerts, pages: alertTotalPages, onSize: onAlertSizeChange } = usePager(alerts, 15);
    const { page: alertRulePage, size: alertRulePageSize, items: pagedAlertRules, pages: alertRuleTotalPages, onSize: onAlertRuleSizeChange } = usePager(alertRules, 10);
    const { page: nodePage, size: nodePageSize, items: pagedNodes, pages: nodeTotalPages, onSize: onNodeSizeChange } = usePager(nodes, 10);
    const { page: auditPage, size: auditPageSize, items: pagedAuditLogs, pages: auditTotalPages, onSize: onAuditSizeChange } = usePager(auditLogs, 20);
    const { page: notifyLogPage, size: notifyLogPageSize, items: pagedNotifyLogs, pages: notifyLogTotalPages, onSize: onNotifyLogSizeChange } = usePager(notifyLogs, 20);
    const { page: rulePage, size: rulePageSize, items: pagedRules, pages: ruleTotalPages, onSize: onRuleSizeChange } = usePager(rules, 10);
    const { page: tcPage, size: tcPageSize, items: pagedTicketCats, pages: tcTotalPages, onSize: onTcSizeChange } = usePager(ticketCatTree, 15);
    const { page: menuPage, size: menuPageSize, items: pagedMenus, pages: menuTotalPages, onSize: onMenuSizeChange } = usePager(computed(() => (menuMatrix.value && menuMatrix.value.menus) || []), 20);

    const tf = reactive({ keyword: '', status: '', category: '', coop: false, groupId: null });
    const af = reactive({ keyword: '', type: '', ownerId: '', resCategory: '物理服务器', auditStatus: '', status: '', unit: '', showDeleted: false });
    const kf = reactive({ keyword: '', category: '' });

    /* ---------- 登录 ---------- */
    async function doLogin() {
      loginErr.value = '';
      if (!loginForm.username || !loginForm.password) { loginErr.value = '请输入账号和密码'; return; }
      if (!loginForm.captcha) { loginErr.value = '请输入验证码'; return; }
      logging.value = true;
      try {
        const r = await req('POST', '/login', {
          username: loginForm.username, password: loginForm.password,
          captchaId: captchaId.value, captcha: loginForm.captcha,
        });
        token.value = r.token; user.value = r.user;
        sessionStorage.setItem('aiops_token', r.token);
        sessionStorage.setItem('aiops_user', JSON.stringify(r.user));
        ElMessage.success('欢迎回来，' + r.user.name);
        await loadAll();
      } catch (e) {
        loginErr.value = e.message;
        // 验证码错误/过期时自动换一张
        loadCaptcha();
      }
      finally { logging.value = false; }
    }
    /* 用户下拉菜单命令 */
    function onUserCommand(cmd) {
      if (cmd === 'logout') return logout();
      if (cmd === 'pwd') return openPwdDialog();
    }

    /* ---------- 修改自己的密码 ---------- */
    const pwdDialog = reactive({ visible: false, oldPassword: '', newPassword: '', confirmPassword: '', loading: false });
    function openPwdDialog() {
      pwdDialog.oldPassword = '';
      pwdDialog.newPassword = '';
      pwdDialog.confirmPassword = '';
      pwdDialog.loading = false;
      pwdDialog.visible = true;
    }
    async function submitPwdChange() {
      if (!pwdDialog.oldPassword) { ElMessage.error('请输入原密码'); return; }
      if (!pwdDialog.newPassword) { ElMessage.error('请输入新密码'); return; }
      if (pwdDialog.newPassword.length < 6) { ElMessage.error('新密码至少 6 位'); return; }
      if (pwdDialog.newPassword !== pwdDialog.confirmPassword) { ElMessage.error('两次输入的新密码不一致'); return; }
      pwdDialog.loading = true;
      try {
        await req('POST', '/me/password', {
          oldPassword: pwdDialog.oldPassword,
          newPassword: pwdDialog.newPassword,
        });
        pwdDialog.visible = false;
        ElMessage.success('密码已修改，其他设备需重新登录');
      } catch (e) {
        ElMessage.error(e.message || '修改失败');
      } finally {
        pwdDialog.loading = false;
      }
    }

    async function logout() {
      token.value = ''; user.value = null;
      sessionStorage.removeItem('aiops_token');
      sessionStorage.removeItem('aiops_user');
      loadCaptcha();
    }
    /* 快速登录：填充账号后换一张验证码，避免沿用旧图 */
    function quickLogin(username) {
      loginForm.username = username;
      loginForm.password = '123456';
      loadCaptcha();
    }

    /* ---------- 数据加载 ---------- */
    async function loadStats() { stats.value = await req('GET', '/stats'); }
    async function loadTickets() {
      const qs = new URLSearchParams();
      if (tf.keyword) qs.set('keyword', tf.keyword);
      if (tf.status) qs.set('status', tf.status);
      if (tf.category) qs.set('category', tf.category);
      if (tf.coop) qs.set('coop', '1');
      if (tf.groupId) qs.set('groupId', tf.groupId);
      tickets.value = await req('GET', '/tickets' + (qs.toString() ? '?' + qs : ''));
    }
    async function loadAssets() {
      const qs = new URLSearchParams();
      if (af.keyword) qs.set('keyword', af.keyword);
      if (af.type) qs.set('type', af.type);
      if (af.ownerId) qs.set('ownerId', af.ownerId);
      if (af.resCategory) qs.set('resCategory', af.resCategory);
      if (af.auditStatus) qs.set('auditStatus', af.auditStatus);
      if (af.status) qs.set('status', af.status);
      if (af.unit) qs.set('unit', af.unit);
      if (af.showDeleted) qs.set('showDeleted', '1');
      assets.value = await req('GET', '/assets' + (qs.toString() ? '?' + qs : ''));
      assetSelected.value = [];
    }
    async function loadAssetUnits() {
      try { assetUnits.value = await req('GET', '/assets/units'); } catch (e) { /* ignore */ }
    }

    /* ---------- 资源分类：动态字段模型 ---------- */
    async function loadResCats() {
      try { resCats.value = await req('GET', '/res/categories'); } catch (e) { /* ignore */ }
    }
    const resFields = computed(() => {
      const c = resCats.value.find((x) => x.name === resCat.value);
      return c ? c.fields : [];
    });
    const resListFields = computed(() => resFields.value.filter((f) => f.inList));
    const resKind = computed(() => {
      const c = resCats.value.find((x) => x.name === resCat.value);
      return c ? c.kind : 'asset';
    });
    async function loadResRecords() {
      const qs = new URLSearchParams();
      qs.set('category', resCat.value);
      if (resAuditFilter.value) qs.set('auditStatus', resAuditFilter.value);
      if (resShowDeleted.value) qs.set('showDeleted', '1');
      if (resKw.value) qs.set('keyword', resKw.value);
      try { resRecords.value = await req('GET', '/res/records?' + qs.toString()); } catch (e) { resRecords.value = []; }
      assetSelected.value = [];
    }
    function switchResCat(c) {
      resCat.value = c;
      resKw.value = '';
      resAuditFilter.value = '';
      resShowDeleted.value = false;
      loadResRecords();
      // 预取该分类所有下拉源
      for (const f of resFields.value) if (f.optionsSource) loadResOptions(f);
    }
    async function loadResOptions(f) {
      const src = f.optionsSource;
      if (!src) return;
      const cacheKey = resCat.value + '.' + f.key;
      if (resOptions[cacheKey]) return;
      try {
        if (src === '@units') {
          resOptions[cacheKey] = await req('GET', '/res/units');
        } else {
          const [cat, fk] = src.split('.');
          resOptions[cacheKey] = await req('GET', '/res/options?category=' + encodeURIComponent(cat) + '&field=' + encodeURIComponent(fk));
        }
      } catch (e) { resOptions[cacheKey] = []; }
    }
    function resOpts(f) { return resOptions[resCat.value + '.' + f.key] || []; }
    function emptyRes() {
      const o = {};
      for (const f of resFields.value) o[f.key] = '';
      return o;
    }
    function openResCreate() {
      resDialog.mode = 'create';
      resDialog.form = emptyRes();
      resDialog.visible = true;
      for (const f of resFields.value) if (f.optionsSource) loadResOptions(f);
    }
    function openResEdit(r) {
      resDialog.mode = 'edit';
      const o = {};
      for (const f of resFields.value) o[f.key] = r[f.key] === undefined ? '' : r[f.key];
      o._id = r._id;
      resDialog.form = o;
      resDialog.visible = true;
      for (const f of resFields.value) if (f.optionsSource) loadResOptions(f);
    }
    async function saveRes() {
      const f = resDialog.form;
      const req0 = resFields.value.find((x) => x.required && !String(f[x.key] || '').trim());
      if (req0) { ElMessage.error('请填写' + req0.label); return; }
      try {
        if (resDialog.mode === 'edit') await req('PUT', '/res/records/' + f._id, { data: f });
        else await req('POST', '/res/records', { category: resCat.value, data: f });
        resDialog.visible = false;
        ElMessage.success(resDialog.mode === 'edit' ? '已更新' : '已新增');
        await loadResRecords();
      } catch (e) { ElMessage.error(e.message); }
    }
    function openResDetail(r) { resDetail.data = r; resDetail.visible = true; }
    async function removeRes(r) {
      try { await ElMessageBox.confirm('确定删除该记录？', '删除确认', { type: 'warning' }); }
      catch (_) { return; }
      try {
        await req('DELETE', '/res/records/' + r._id);
        ElMessage.success('已删除');
        resDetail.visible = false;
        await loadResRecords();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function auditRes(r, action) {
      const label = action === 'approve' ? '审核通过' : '驳回';
      let note = '';
      try {
        const x = await ElMessageBox.prompt('确认' + label + '？', label, {
          inputPlaceholder: '审核意见（可选）', showCancelButton: true,
          confirmButtonText: label, cancelButtonText: '取消',
        });
        note = x.value || '';
      } catch (_) { return; }
      try {
        await req('POST', '/res/records/' + r._id + '/audit', { action, note });
        ElMessage.success(label + '成功');
        await loadResRecords();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function batchDeleteRes() {
      const ids = assetSelected.value;
      if (!ids.length) { ElMessage.warning('请先勾选记录'); return; }
      try { await ElMessageBox.confirm('确定删除选中的 ' + ids.length + ' 条？', '批量删除', { type: 'warning' }); }
      catch (_) { return; }
      try {
        await req('POST', '/res/batch-delete', { ids });
        ElMessage.success('已删除 ' + ids.length + ' 条');
        await loadResRecords();
      } catch (e) { ElMessage.error(e.message); }
    }
    /* 导出当前分类（走浏览器下载，带鉴权头需用 fetch + blob） */
    async function exportRes() {
      try {
        const token = sessionStorage.getItem('aiops_token') || '';
        const r = await fetch('/api/res/export?category=' + encodeURIComponent(resCat.value), {
          headers: token ? { 'X-Token': token } : {},
        });
        if (!r.ok) throw new Error('导出失败 HTTP ' + r.status);
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = resCat.value + '_' + new Date().toISOString().slice(0, 10) + '.xlsx';
        a.click();
        URL.revokeObjectURL(url);
        ElMessage.success('已导出');
      } catch (e) { ElMessage.error(e.message); }
    }
    /* 导入当前分类 */
    function triggerResImport() { if (resImportInput.value) resImportInput.value.click(); }
    async function onResImportFile(ev) {
      const file = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      try {
        const token = sessionStorage.getItem('aiops_token') || '';
        const r = await fetch('/api/res/import?category=' + encodeURIComponent(resCat.value), {
          method: 'POST',
          headers: token ? { 'X-Token': token } : {},
          body: file,
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
        ElMessage.success('导入 ' + j.imported + ' 条' + (j.skipped ? '，跳过 ' + j.skipped + ' 空行' : '')
          + (j.unmatched ? '，' + j.unmatched + ' 列未匹配' : ''));
        await loadResRecords();
      } catch (e) { ElMessage.error(e.message); }
    }
    function switchResCategory(c) { af.resCategory = c; loadAssets(); }
    async function auditAsset(a, action) {
      const label = action === 'approve' ? '审核通过' : '驳回';
      let note = '';
      try {
        const r = await ElMessageBox.prompt(`确认${label}资产「${a.name}」？`, label, {
          inputPlaceholder: '审核意见（可选）', inputValue: '', showCancelButton: true,
          confirmButtonText: label, cancelButtonText: '取消',
        });
        note = r.value || '';
      } catch (_) { return; }
      try {
        await req('POST', `/assets/${a.id}/audit`, { action, note });
        ElMessage.success(label + '成功');
        await loadAssets();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function batchDeleteAssets() {
      const ids = assetSelected.value;
      if (!ids.length) { ElMessage.warning('请先勾选资产'); return; }
      try { await ElMessageBox.confirm(`确定删除选中的 ${ids.length} 项资产？`, '批量删除', { type: 'warning' }); }
      catch (_) { return; }
      try {
        await req('POST', '/assets/batch-delete', { ids });
        ElMessage.success(`已删除 ${ids.length} 项`);
        await loadAssets();
      } catch (e) { ElMessage.error(e.message); }
    }
    function exportAssetsExcel() {
      // 前端导出 CSV（Excel 可直接打开）
      const rows = assets.value;
      if (!rows.length) { ElMessage.warning('没有可导出的数据'); return; }
      const head = ['资产编号', '资产名称', '资源分类', '主机IP', '内存容量(GB)', '存储容量(GB)', 'CPU核数', '机房名称', '运行状态', '审核状态', '责任人', '单位'];
      const lines = [head.join(',')];
      for (const a of rows) {
        lines.push([
          a.code, a.name, a.resCategory || '', a.ip || '', a.memGb || 0, a.diskGb || 0,
          a.cpuCores || 0, a.room || '', ASSET_STATUS[a.status] || a.status,
          AUDIT_STATUS[a.auditStatus] || a.auditStatus, a.ownerName || a.owner || '', a.unit || '',
        ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
      }
      const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a2 = document.createElement('a');
      a2.href = url;
      a2.download = '资产台账_' + new Date().toISOString().slice(0, 10) + '.csv';
      a2.click();
      URL.revokeObjectURL(url);
    }
    async function loadKbCategories() {
      try { kbCategories.value = await req('GET', '/kb-categories'); } catch (e) { /* ignore */ }
    }
    const kbCatDialog = reactive({ visible: false, mode: 'create', form: {} });
    const kbCatManage = reactive({ visible: false });
    function openKbCategoryManage() { kbCatManage.visible = true; loadKbCategories(); }
    function emptyKbCategory() { return { name: '', desc: '', sort: 99 }; }
    function openKbCategoryCreate() { kbCatDialog.mode = 'create'; kbCatDialog.form = emptyKbCategory(); kbCatDialog.visible = true; }
    function openKbCategoryEdit(c) { kbCatDialog.mode = 'edit'; kbCatDialog.form = { id: c.id, name: c.name, desc: c.desc, sort: c.sort }; kbCatDialog.visible = true; }
    async function saveKbCategory() {
      const f = kbCatDialog.form;
      if (!f.name || !f.name.trim()) { ElMessage.error('分类名称不能为空'); return; }
      try {
        if (kbCatDialog.mode === 'edit') await req('PUT', '/kb-categories/' + f.id, f);
        else await req('POST', '/kb-categories', f);
        kbCatDialog.visible = false;
        ElMessage.success(kbCatDialog.mode === 'edit' ? '分类已更新' : '分类已新增');
        await loadKbCategories();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function removeKbCategory(c) {
      try { await ElMessageBox.confirm(`确定删除分类「${c.name}」？`, '删除确认', { type: 'warning' }); }
      catch (_) { return; }
      try { await req('DELETE', '/kb-categories/' + c.id); ElMessage.success('已删除'); await loadKbCategories(); await loadKB(); }
      catch (e) { ElMessage.error(e.message); }
    }
    async function loadKB() {
      const qs = new URLSearchParams();
      if (kf.keyword) qs.set('keyword', kf.keyword);
      if (kf.category) qs.set('category', kf.category);
      kb.value = await req('GET', '/kb' + (qs.toString() ? '?' + qs : ''));
    }
    // 知识库分类：优先用后端维护的分类；无数据时回退到内置默认值
    const kbCategoryNames = computed(() => {
      const list = (kbCategories.value || []).map((c) => c.name).filter(Boolean);
      return list.length ? list : KB_CATEGORIES_FALLBACK;
    });

    async function loadAll() {
      /* 仅集群监控：加载监控总览 / 节点 / 告警 / 规则 / 通知 / Pod */
      if (can('cluster.view')) {
        await loadMonitor();
        await loadNodes();
      }
      if (can('alert.view')) {
        await loadAlerts();
        await loadAlertRules();
        await loadNotify();
      }
      if (can('pod.view')) await loadPods();
    }

    /* ---------- 集群监控 ---------- */
    async function loadMonitor() {
      try {
        monSummary.value = await req('GET', '/monitor/summary');
        clusters.value = await req('GET', '/clusters');
      } catch (e) { /* ignore */ }
    }
    async function loadNodes() {
      const qs = new URLSearchParams();
      if (mf2.clusterId) qs.set('clusterId', mf2.clusterId);
      if (mf2.status) qs.set('status', mf2.status);
      if (mf2.keyword) qs.set('keyword', mf2.keyword);
      try { nodes.value = await req('GET', '/nodes' + (qs.toString() ? '?' + qs : '')); } catch (e) { /* ignore */ }
    }
    function resetNodeFilter() { mf2.clusterId = null; mf2.status = ''; mf2.keyword = ''; loadNodes(); }
    async function loadAlerts() {
      const qs = new URLSearchParams();
      if (alf.status) qs.set('status', alf.status);
      if (alf.severity) qs.set('severity', alf.severity);
      if (alf.clusterId) qs.set('clusterId', alf.clusterId);
      if (alf.keyword) qs.set('keyword', alf.keyword);
      try { alerts.value = await req('GET', '/alerts' + (qs.toString() ? '?' + qs : '')); } catch (e) { /* ignore */ }
    }
    function resetAlertFilter() { alf.status = 'firing'; alf.severity = ''; alf.clusterId = null; alf.keyword = ''; loadAlerts(); }
    async function loadAlertRules() {
      try { alertRules.value = await req('GET', '/alert-rules'); } catch (e) { /* ignore */ }
    }
    async function resolveAlert(a) {
      try { await ElMessageBox.confirm('确定将该告警标记为已恢复？', '确认', { type: 'warning' }); } catch (_) { return; }
      try { await req('POST', `/alerts/${a.id}/resolve`); ElMessage.success('已标记恢复'); await loadAlerts(); await loadMonitor(); }
      catch (e) { ElMessage.error(e.message); }
    }
    function openClusterCreate() {
      clusterDialog.mode = 'create';
      clusterDialog.form = { name: '', code: '', env: 'prod', region: '', note: '' };
      clusterDialog.visible = true;
    }
    function openClusterEdit(c) {
      clusterDialog.mode = 'edit';
      clusterDialog.form = { id: c.id, name: c.name, code: c.code, env: c.env, region: c.region, note: c.note, agentToken: c.agentToken };
      clusterDialog.visible = true;
    }
    async function saveCluster() {
      const f = clusterDialog.form;
      if (!f.name || !f.code) { ElMessage.error('集群名称和标识不能为空'); return; }
      try {
        if (clusterDialog.mode === 'edit') { await req('PUT', '/clusters/' + f.id, f); }
        else {
          const created = await req('POST', '/clusters', f);
          clusterDialog.visible = false;
          ElMessage.success('集群已接入，正在生成安装命令…');
          await loadMonitor();
          const full = (await req('GET', '/clusters')).find((x) => x.code === f.code) || created;
          return openInstallScript(full);
        }
        clusterDialog.visible = false;
        ElMessage.success('集群已更新');
        await loadMonitor();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function openInstallScript(c) {
      installDialog.cluster = c;
      installDialog.loading = true;
      installDialog.tab = 'onekey';
      installDialog.visible = true;
      try {
        const r = await req('GET', `/clusters/${c.id}/agent-script`);
        installDialog.oneLiner = r.oneLiner || '';
        installDialog.bareOneLiner = r.bareOneLiner || '';
        installDialog.bareMetalScript = r.bareMetalScript || '';
        installDialog.installScript = r.installScript || '';
        installDialog.manifest = r.manifest || '';
        installDialog.agentScript = r.agentScript || '';
        installDialog.platform = r.platform || '';
      } catch (e) { ElMessage.error(e.message); }
      installDialog.loading = false;
    }
    function installTabContent() {
      if (installDialog.tab === 'onekey') return installDialog.oneLiner;
      if (installDialog.tab === 'script') return installDialog.installScript;
      if (installDialog.tab === 'bare') return installDialog.bareMetalScript;
      if (installDialog.tab === 'manifest') return installDialog.manifest;
      return installDialog.agentScript;
    }
    async function removeCluster(c) {
      try { await ElMessageBox.confirm(`确定删除集群「${c.name}」？`, '删除确认', { type: 'warning' }); } catch (_) { return; }
      try { await req('DELETE', '/clusters/' + c.id); ElMessage.success('已删除'); await loadMonitor(); }
      catch (e) { ElMessage.error(e.message); }
    }
    async function openNodeDetail(n) {
      nodeDialog.node = n;
      nodeDialog.clusterId = n.clusterId;
      nodeDialog.visible = true;
      try { nodeMetrics.value = await req('GET', `/nodes/${encodeURIComponent(n.name)}/metrics?clusterId=${n.clusterId}`); } catch (e) { nodeMetrics.value = []; }
    }
    async function openClusterComponents(c) {
      componentsDialog.cluster = c;
      components.value = [];
      componentsDialog.visible = true;
      try { components.value = await req('GET', `/clusters/${c.id}/components`); } catch (e) { components.value = []; }
    }
    /** 查看某集群的 Pod */
    async function openClusterPods(c) {
      clusterPodsDialog.cluster = c;
      clusterPodsDialog.list = [];
      clusterPodsDialog.loading = true;
      clusterPodsDialog.visible = true;
      try {
        clusterPodsDialog.list = await req('GET', '/pods?clusterId=' + c.id);
      } catch (e) { ElMessage.error(e.message); }
      clusterPodsDialog.loading = false;
    }
    /** 集群 Pod 弹窗内：仅异常 / 全部 */
    function podDialogFiltered() {
      return clusterPodsDialog.list;
    }
    /** 告警规则的小类候选：跟随大类/中类联动 */
    const ruleSmallCatOptions = computed(() => {
      const big = alertRuleDialog.form.category;
      const mid = alertRuleDialog.form.midCategory;
      const b = ticketCatTree.value.find((x) => x.name === big);
      if (!b) return [];
      const m = (b.children || []).find((x) => x.name === mid);
      return m ? (m.children || []).map((x) => x.name) : [];
    });
    function copyText(t) {
      try {
        navigator.clipboard.writeText(t).then(() => ElMessage.success('已复制')).catch(() => ElMessage.warning('复制失败，请手动选择'));
      } catch (e) { ElMessage.warning('复制失败，请手动选择'); }
    }
    /** 节点指标趋势折线（viewBox 坐标） */
    function metricLine(field, W, H) {
      const d = nodeMetrics.value;
      if (!d || d.length < 2) return '';
      const max = Math.max(100, ...d.map((m) => Number(m[field]) || 0));
      const step = W / (d.length - 1);
      return d.map((m, i) => {
        const v = Number(m[field]) || 0;
        const x = (i * step).toFixed(1);
        const y = (H - (v / max) * (H - 20) - 10).toFixed(1);
        return x + ',' + y;
      }).join(' ');
    }
    function emptyAlertRule() {
      return { name: '', metric: 'cpu_usage', scope: 'node', operator: '>', threshold: 90, durationSec: 300, severity: 'high', category: '行业调控系统', midCategory: '硬件', smallCategory: '服务器宕机', enabled: true, autoTicket: true, note: '' };
    }
    function openAlertRuleCreate() { alertRuleDialog.mode = 'create'; alertRuleDialog.form = emptyAlertRule(); alertRuleDialog.visible = true; }
    function openAlertRuleEdit(r) { alertRuleDialog.mode = 'edit'; alertRuleDialog.form = Object.assign({}, r); alertRuleDialog.visible = true; }
    async function saveAlertRule() {
      const f = alertRuleDialog.form;
      if (!f.name) { ElMessage.error('规则名称不能为空'); return; }
      try {
        if (alertRuleDialog.mode === 'edit') await req('PUT', '/alert-rules/' + f.id, f);
        else await req('POST', '/alert-rules', f);
        alertRuleDialog.visible = false;
        ElMessage.success(alertRuleDialog.mode === 'edit' ? '规则已更新' : '规则已创建');
        await loadAlertRules();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function removeAlertRule(r) {
      try { await ElMessageBox.confirm(`确定删除规则「${r.name}」？`, '删除确认', { type: 'warning' }); } catch (_) { return; }
      try { await req('DELETE', '/alert-rules/' + r.id); ElMessage.success('已删除'); await loadAlertRules(); }
      catch (e) { ElMessage.error(e.message); }
    }
    async function toggleRule(r) {
      try { await req('PUT', '/alert-rules/' + r.id, { enabled: !r.enabled }); await loadAlertRules(); }
      catch (e) { ElMessage.error(e.message); }
    }
    /** 集群分页切片 */
    const clusterTotalPages = computed(() => Math.max(1, Math.ceil(clusters.value.length / clusterPageSize.value)));
    const pagedClusters = computed(() => {
      const start = (clusterPage.value - 1) * clusterPageSize.value;
      return clusters.value.slice(start, start + clusterPageSize.value);
    });
    function onClusterPageSizeChange() { clusterPage.value = 1; }
    function onClusterPageChange(p) { clusterPage.value = p; }

    /* ---------- 通知渠道 ---------- */
    async function loadNotify() {
      try {
        notifyChannels.value = await req('GET', '/notify-channels');
        notifyLogs.value = await req('GET', '/notify-logs?limit=100');
      } catch (e) { /* ignore */ }
    }
    function emptyNotify() {
      return { name: '', type: 'wecom', config: { webhook: '' }, enabled: true, onFire: true, onResolve: false, minSeverity: 'normal', note: '' };
    }
    function openNotifyCreate() { notifyDialog.mode = 'create'; notifyDialog.form = emptyNotify(); notifyDialog.visible = true; }
    function openNotifyEdit(c) {
      notifyDialog.mode = 'edit';
      notifyDialog.form = {
        id: c.id, name: c.name, type: c.type,
        config: Object.assign({ webhook: '', secret: '', host: '', port: 465, secure: true, user: '', pass: '', from: '', to: '', fromName: '' }, c.config || {}),
        enabled: c.enabled, onFire: c.onFire, onResolve: c.onResolve, minSeverity: c.minSeverity, note: c.note,
      };
      notifyDialog.visible = true;
    }
    function onNotifyTypeChange(t) {
      if (t === 'wecom') notifyDialog.form.config = { webhook: '' };
      else if (t === 'dingtalk') notifyDialog.form.config = { webhook: '', secret: '' };
      else notifyDialog.form.config = { host: '', port: 465, secure: true, user: '', pass: '', from: '', to: '', fromName: 'AIOps告警' };
    }
    async function saveNotify() {
      const f = notifyDialog.form;
      if (!f.name || !f.name.trim()) { ElMessage.error('请填写渠道名称'); return; }
      try {
        if (notifyDialog.mode === 'edit') await req('PUT', '/notify-channels/' + f.id, f);
        else await req('POST', '/notify-channels', f);
        notifyDialog.visible = false;
        ElMessage.success(notifyDialog.mode === 'edit' ? '渠道已更新' : '渠道已创建');
        await loadNotify();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function removeNotify(c) {
      try { await ElMessageBox.confirm(`确定删除渠道「${c.name}」？`, '删除确认', { type: 'warning' }); } catch (_) { return; }
      try { await req('DELETE', '/notify-channels/' + c.id); ElMessage.success('已删除'); await loadNotify(); }
      catch (e) { ElMessage.error(e.message); }
    }
    async function toggleNotify(c) {
      try { await req('PUT', '/notify-channels/' + c.id, { enabled: !c.enabled }); await loadNotify(); ElMessage.success(c.enabled ? '已停用' : '已启用'); }
      catch (e) { ElMessage.error(e.message); }
    }
    async function testNotify(c) {
      try {
        const r = await req('POST', '/notify-test', { id: c.id });
        if (r.ok) ElMessage.success('测试消息已发送，请查看接收端');
        else ElMessage.error('发送失败：' + (r.error || '未知错误'));
        await loadNotify();
      } catch (e) { ElMessage.error(e.message); }
    }

    /* ---------- Pod 监控 ---------- */
    async function loadPods() {
      const qs = new URLSearchParams();
      if (pf.clusterId) qs.set('clusterId', pf.clusterId);
      if (pf.namespace) qs.set('namespace', pf.namespace);
      if (pf.status) qs.set('status', pf.status);
      if (pf.keyword) qs.set('keyword', pf.keyword);
      try { pods.value = await req('GET', '/pods' + (qs.toString() ? '?' + qs : '')); } catch (e) { /* ignore */ }
    }
    function resetPodFilter() { pf.clusterId = null; pf.namespace = ''; pf.status = ''; pf.keyword = ''; loadPods(); }
    const podNamespaces = computed(() => {
      const s = new Set(pods.value.map((p) => p.namespace).filter(Boolean));
      return Array.from(s).sort();
    });

    /* ---------- 异常明细（KPI 点击） ---------- */
    async function openIssues(kind, clusterId, clusterName) {
      const titles = {
        notReady: '异常节点明细', badPods: '异常 Pod 明细', badComps: '异常组件明细',
        firing: '告警中明细', clusters: '集群明细',
        nodes: '节点明细', pods: '全部 Pod 明细', healthy: '健康集群明细', badClusters: '异常集群明细',
      };
      issuesDialog.kind = kind;
      issuesDialog.clusterId = clusterId || null;
      issuesDialog.clusterName = clusterName || '';
      const base = titles[kind] || '明细';
      // 带集群时标题带上集群名，明确看的是哪个集群
      issuesDialog.title = clusterName ? (clusterName + ' · ' + base) : base;
      issuesDialog.items = [];
      issuesDialog.visible = true;
      try {
        const qs = clusterId ? ('?kind=' + kind + '&clusterId=' + clusterId) : ('?kind=' + kind);
        const r = await req('GET', '/monitor/issues' + qs);
        issuesDialog.items = r.items || [];
      } catch (e) { ElMessage.error(e.message); }
    }

    /* 重载当前已打开的明细弹窗（供自动刷新调用） */
    async function reloadIssuesIfOpen() {
      if (!issuesDialog.visible) return;
      const qs = issuesDialog.clusterId
        ? ('?kind=' + issuesDialog.kind + '&clusterId=' + issuesDialog.clusterId)
        : ('?kind=' + issuesDialog.kind);
      try {
        const r = await req('GET', '/monitor/issues' + qs);
        issuesDialog.items = r.items || [];
      } catch (e) { /* 静默，避免打断用户 */ }
    }

    async function gotoAlertTicket(a) {
      if (!a.ticketId) return;
      try {
        const t = await req('GET', '/tickets/' + a.ticketId);
        ticketDetail.data = t; ticketDetail.comment = ''; ticketDetail.visible = true;
      } catch (e) { ElMessage.error(e.message); }
    }

    /* ---------- 事件分类（三级） ---------- */
    async function loadTicketCats() {
      try { const r = await req('GET', '/ticket-categories'); ticketCatTree.value = r.tree || []; }
      catch (e) { /* ignore */ }
    }
    const bigCatOptions = computed(() => ticketCatTree.value.map((c) => c.name));
    const midCatOptions = computed(() => {
      const big = ticketDialog.form.bigCategory;
      const node = ticketCatTree.value.find((c) => c.name === big);
      return node ? (node.children || []).map((c) => c.name) : [];
    });
    const smallCatOptions = computed(() => {
      const node = ticketCatTree.value.find((c) => c.name === ticketDialog.form.bigCategory);
      if (!node) return [];
      const mid = (node.children || []).find((c) => c.name === ticketDialog.form.midCategory);
      return mid ? (mid.children || []).map((c) => c.name) : [];
    });
    function onBigCatChange() { ticketDialog.form.midCategory = ''; ticketDialog.form.smallCategory = ''; }
    function onMidCatChange() { ticketDialog.form.smallCategory = ''; }

    function emptyTc() { return { name: '', level: 1, parentId: 0, sort: 99 }; }
    function openTcCreate(level, parentId) {
      tcDialog.mode = 'create';
      tcDialog.form = { name: '', level: level || 1, parentId: parentId || 0, sort: 99 };
      tcDialog.visible = true;
    }
    function openTcEdit(node) {
      tcDialog.mode = 'edit';
      tcDialog.form = { id: node.id, name: node.name, level: node.level, parentId: node.parentId, sort: node.sort };
      tcDialog.visible = true;
    }
    async function saveTc() {
      const f = tcDialog.form;
      if (!f.name || !f.name.trim()) { ElMessage.error('分类名称不能为空'); return; }
      try {
        if (tcDialog.mode === 'edit') await req('PUT', '/ticket-categories/' + f.id, f);
        else await req('POST', '/ticket-categories', f);
        tcDialog.visible = false;
        ElMessage.success(tcDialog.mode === 'edit' ? '分类已更新' : '分类已新增');
        await loadTicketCats();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function removeTc(node) {
      try { await ElMessageBox.confirm(`确定删除分类「${node.name}」？`, '删除确认', { type: 'warning' }); }
      catch (_) { return; }
      try { await req('DELETE', '/ticket-categories/' + node.id); ElMessage.success('已删除'); await loadTicketCats(); }
      catch (e) { ElMessage.error(e.message); }
    }

    /* ---------- 设备分类 ---------- */
    async function loadCategories() {
      const qs = new URLSearchParams();
      if (cf.keyword) qs.set('keyword', cf.keyword);
      try { categories.value = await req('GET', '/categories' + (qs.toString() ? '?' + qs : '')); } catch (e) { /* ignore */ }
    }
    const categoryDialog = reactive({ visible: false, mode: 'create', form: {} });
    function emptyCategory() { return { name: '', desc: '', sort: 99 }; }
    function openCategoryCreate() { categoryDialog.mode = 'create'; categoryDialog.form = emptyCategory(); categoryDialog.visible = true; }
    function openCategoryEdit(c) { categoryDialog.mode = 'edit'; categoryDialog.form = { id: c.id, name: c.name, desc: c.desc, sort: c.sort }; categoryDialog.visible = true; }
    async function saveCategory() {
      const f = categoryDialog.form;
      if (!f.name || !f.name.trim()) { ElMessage.error('分类名称不能为空'); return; }
      try {
        if (categoryDialog.mode === 'edit') await req('PUT', '/categories/' + f.id, f);
        else await req('POST', '/categories', f);
        categoryDialog.visible = false;
        ElMessage.success(categoryDialog.mode === 'edit' ? '分类已更新' : '分类已新增');
        await loadCategories(); await loadModels();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function removeCategory(c) {
      try { await ElMessageBox.confirm(`确定删除分类「${c.name}」？`, '删除确认', { type: 'warning' }); }
      catch (_) { return; }
      try { await req('DELETE', '/categories/' + c.id); ElMessage.success('已删除'); await loadCategories(); }
      catch (e) { ElMessage.error(e.message); }
    }

    /* ---------- 操作日志 ---------- */
    async function loadAudit() {
      const qs = new URLSearchParams();
      if (lf.keyword) qs.set('keyword', lf.keyword);
      if (lf.module) qs.set('module', lf.module);
      qs.set('limit', '300');
      try {
        auditLogs.value = await req('GET', '/audit-logs?' + qs);
        auditModules.value = await req('GET', '/audit-modules');
      } catch (e) { /* ignore */ }
    }
    function resetAuditFilter() { lf.keyword = ''; lf.module = ''; loadAudit(); }

    /* ---------- 菜单权限 ---------- */
    async function loadMenuMatrix() {
      try { menuMatrix.value = await req('GET', '/menus'); } catch (e) { /* ignore */ }
    }
    async function toggleMenu(groupId, menuKey, val) {
      try {
        await req('PUT', '/menus', { groupId, menuKey, visible: val });
        ElMessage.success(val ? '已设为可见' : '已隐藏');
        await loadMenuMatrix();
      } catch (e) { ElMessage.error(e.message); await loadMenuMatrix(); }
    }

    /* ---------- 供应商 ---------- */
    async function loadSuppliers() {
      const qs = new URLSearchParams();
      if (sf.keyword) qs.set('keyword', sf.keyword);
      if (sf.status) qs.set('status', sf.status);
      try { suppliers.value = await req('GET', '/suppliers' + (qs.toString() ? '?' + qs : '')); } catch (e) { /* ignore */ }
    }
    function resetSupplierFilter() { sf.keyword = ''; sf.status = ''; loadSuppliers(); }
    const supplierDialog = reactive({ visible: false, mode: 'create', form: {} });
    function emptySupplier() {
      return { name: '', shortName: '', status: 'active', province: '北京市', city: '北京市', contact: '', phone: '', address: '', note: '' };
    }
    function openSupplierCreate() { supplierDialog.mode = 'create'; supplierDialog.form = emptySupplier(); supplierDialog.visible = true; }
    function openSupplierEdit(s) { supplierDialog.mode = 'edit'; supplierDialog.form = Object.assign({}, s); supplierDialog.visible = true; }
    async function saveSupplier() {
      const f = supplierDialog.form;
      if (!f.name || !f.name.trim()) { ElMessage.error('请填写单位全称'); return; }
      if (!f.shortName || !f.shortName.trim()) { ElMessage.error('请填写单位简称'); return; }
      try {
        if (supplierDialog.mode === 'edit') await req('PUT', '/suppliers/' + f.id, f);
        else await req('POST', '/suppliers', f);
        supplierDialog.visible = false;
        ElMessage.success(supplierDialog.mode === 'edit' ? '供应商已更新' : '供应商已新增');
        await loadSuppliers();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function toggleSupplier(s) {
      const next = s.status === 'active' ? 'disabled' : 'active';
      try { await req('PUT', '/suppliers/' + s.id, { status: next }); ElMessage.success(next === 'active' ? '已启用' : '已禁用'); await loadSuppliers(); }
      catch (e) { ElMessage.error(e.message); }
    }
    async function removeSupplier(s) {
      try { await ElMessageBox.confirm(`确定删除供应商「${s.name}」？`, '删除确认', { type: 'warning' }); }
      catch (_) { return; }
      try { await req('DELETE', '/suppliers/' + s.id); ElMessage.success('已删除'); await loadSuppliers(); }
      catch (e) { ElMessage.error(e.message); }
    }

    /* ---------- 设备型号库 ---------- */
    async function loadModels() {
      const qs = new URLSearchParams();
      if (mf.keyword) qs.set('keyword', mf.keyword);
      if (mf.category) qs.set('category', mf.category);
      try { models.value = await req('GET', '/models' + (qs.toString() ? '?' + qs : '')); } catch (e) { /* ignore */ }
    }
    function resetModelFilter() { mf.keyword = ''; mf.category = ''; loadModels(); }
    const modelDialog = reactive({ visible: false, mode: 'create', form: {} });
    function emptyModel() { return { category: '服务器', vendor: '', model: '', desc: '', unit: '台', status: 'active' }; }
    function openModelCreate() { modelDialog.mode = 'create'; modelDialog.form = emptyModel(); modelDialog.visible = true; }
    function openModelEdit(m) { modelDialog.mode = 'edit'; modelDialog.form = Object.assign({}, m); modelDialog.visible = true; }
    async function saveModel() {
      const f = modelDialog.form;
      if (!f.vendor || !f.model) { ElMessage.error('请填写厂商和型号'); return; }
      try {
        if (modelDialog.mode === 'edit') await req('PUT', '/models/' + f.id, f);
        else await req('POST', '/models', f);
        modelDialog.visible = false;
        ElMessage.success(modelDialog.mode === 'edit' ? '型号已更新' : '型号已新增');
        await loadModels();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function toggleModel(m) {
      const next = m.status === 'active' ? 'disabled' : 'active';
      try { await req('PUT', '/models/' + m.id, { status: next }); ElMessage.success(next === 'active' ? '已启用' : '已禁用'); await loadModels(); }
      catch (e) { ElMessage.error(e.message); }
    }
    async function removeModel(m) {
      try { await ElMessageBox.confirm(`确定删除型号「${m.vendor} ${m.model}」？`, '删除确认', { type: 'warning' }); }
      catch (_) { return; }
      try { await req('DELETE', '/models/' + m.id); ElMessage.success('已删除'); await loadModels(); }
      catch (e) { ElMessage.error(e.message); }
    }

    /* ---------- 组织分组 / 转派规则 ---------- */
    async function loadGroups() {
      try { groups.value = await req('GET', '/groups'); } catch (e) { /* ignore */ }
    }
    async function loadDepartments() {
      try { departments.value = await req('GET', '/departments'); } catch (e) { /* ignore */ }
    }
    const deptManage = reactive({ visible: false });
    const deptDialog = reactive({ visible: false, mode: 'create', form: {} });
    function openDeptManage() { deptManage.visible = true; loadDepartments(); }
    /* 组织分组：复用 groupDialog 的列表弹窗 */
    function openGroupManage() {
      if (typeof groupManage !== 'undefined') { groupManage.visible = true; loadGroups(); }
      else { loadGroups(); }
    }
    function emptyDept() { return { name: '', desc: '', sort: 99 }; }
    function openDeptCreate() { deptDialog.mode = 'create'; deptDialog.form = emptyDept(); deptDialog.visible = true; }
    function openDeptEdit(d) { deptDialog.mode = 'edit'; deptDialog.form = { id: d.id, name: d.name, desc: d.desc, sort: d.sort }; deptDialog.visible = true; }
    async function saveDept() {
      const f = deptDialog.form;
      if (!f.name || !f.name.trim()) { ElMessage.error('部门名称不能为空'); return; }
      try {
        if (deptDialog.mode === 'edit') await req('PUT', '/departments/' + f.id, f);
        else await req('POST', '/departments', f);
        deptDialog.visible = false;
        ElMessage.success(deptDialog.mode === 'edit' ? '部门已更新' : '部门已新增');
        await loadDepartments(); await loadUsers();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function removeDept(d) {
      try { await ElMessageBox.confirm(`确定删除部门「${d.name}」？`, '删除确认', { type: 'warning' }); }
      catch (_) { return; }
      try { await req('DELETE', '/departments/' + d.id); ElMessage.success('已删除'); await loadDepartments(); await loadUsers(); }
      catch (e) { ElMessage.error(e.message); }
    }
    async function loadRules() {
      try { rules.value = await req('GET', '/dispatch-rules'); } catch (e) { /* ignore */ }
    }
    const groupDialog = reactive({ visible: false, mode: 'create', form: {} });
    const ruleDialog = reactive({ visible: false, mode: 'create', form: {} });
    function emptyGroup() { return { name: '', desc: '', leader: '', color: '#2563eb', tier: 0 }; }
    function emptyRule() { return { category: '网络', groupId: null, priority: 'normal', note: '' }; }
    function openGroupCreate() { groupDialog.mode = 'create'; groupDialog.form = emptyGroup(); groupDialog.visible = true; }
    function openGroupEdit(g) {
      groupDialog.mode = 'edit';
      groupDialog.form = { id: g.id, name: g.name, desc: g.desc, leader: g.leader, color: g.color, tier: g.tier || 0 };
      groupDialog.visible = true;
    }
    async function saveGroup() {
      const f = groupDialog.form;
      if (!f.name || !f.name.trim()) { ElMessage.error('组名不能为空'); return; }
      try {
        if (groupDialog.mode === 'edit') await req('PUT', '/groups/' + f.id, f);
        else await req('POST', '/groups', f);
        groupDialog.visible = false;
        ElMessage.success(groupDialog.mode === 'edit' ? '分组已更新' : '分组已创建');
        await loadGroups(); await loadAll();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function removeGroup(g) {
      try { await ElMessageBox.confirm(`确定删除分组「${g.name}」？`, '删除确认', { type: 'warning' }); }
      catch (_) { return; }
      try { await req('DELETE', '/groups/' + g.id); ElMessage.success('已删除'); await loadGroups(); await loadAll(); }
      catch (e) { ElMessage.error(e.message); }
    }
    function openRuleCreate() { ruleDialog.mode = 'create'; ruleDialog.form = emptyRule(); ruleDialog.visible = true; }
    function openRuleEdit(r) {
      ruleDialog.mode = 'edit';
      ruleDialog.form = { id: r.id, category: r.category, groupId: r.groupId, priority: r.priority, note: r.note };
      ruleDialog.visible = true;
    }
    async function saveRule() {
      const f = ruleDialog.form;
      if (!f.groupId) { ElMessage.error('请选择处理组'); return; }
      try {
        if (ruleDialog.mode === 'edit') await req('PUT', '/dispatch-rules/' + f.id, f);
        else await req('POST', '/dispatch-rules', f);
        ruleDialog.visible = false;
        ElMessage.success(ruleDialog.mode === 'edit' ? '规则已更新' : '规则已创建');
        await loadRules();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function removeRule(r) {
      try { await ElMessageBox.confirm(`确定删除「${r.category}」的转派规则？`, '删除确认', { type: 'warning' }); }
      catch (_) { return; }
      try { await req('DELETE', '/dispatch-rules/' + r.id); ElMessage.success('已删除'); await loadRules(); }
      catch (e) { ElMessage.error(e.message); }
    }

    /* ---------- 权限 ---------- */
    function can(perm) {
      const p = (user.value && user.value.perms) || [];
      return p.includes(perm);
    }
    const visiblePages = computed(() => {
      const allowed = (user.value && user.value.menus) || null;
      const ok = (k) => (allowed ? allowed.includes(k) : true);
      return PAGES
        .map((p) => {
          if (p.children) {
            const kids = p.children.filter((c) => ok(c.key));
            return kids.length ? Object.assign({}, p, { children: kids }) : null;
          }
          return ok(p.key) ? p : null;
        })
        .filter(Boolean);
    });

    /* ---------- 用户与权限 ---------- */
    async function loadUsers() {
      try {
        users.value = await req('GET', '/users');
        roles.value = await req('GET', '/roles');
        permMap.value = await req('GET', '/permissions');
      } catch (e) { /* 无权限则忽略 */ }
    }
    const userDialog = reactive({ visible: false, mode: 'create', form: {} });
    const permDialog = reactive({ visible: false, role: null });
    const roleManage = reactive({ visible: false });
    const roleDialog = reactive({ visible: false, mode: 'create', form: {} });
    const permOptions = computed(() => Object.entries(permMap.value || {}).map(([k, v]) => ({ key: k, label: v })));
    function loadRoles() {
      return req('GET', '/roles').then((r) => { roles.value = r; }).catch(() => {});
    }
    function openRoleManage() { roleManage.visible = true; loadRoles(); }
    function emptyRole() { return { key: '', name: '', desc: '', group: '', perms: [] }; }
    function openRoleCreate() { roleDialog.mode = 'create'; roleDialog.form = emptyRole(); roleDialog.visible = true; }
    function openRoleEdit(r) {
      roleDialog.mode = 'edit';
      roleDialog.form = {
        id: r.id, key: r.key, name: r.name, desc: r.desc || '', group: r.group || '',
        perms: (r.perms || []).filter((x) => x !== '*'), builtin: !!r.builtin,
      };
      roleDialog.visible = true;
    }
    async function saveRole() {
      const f = roleDialog.form;
      if (!f.name || !f.name.trim()) { ElMessage.error('角色名称不能为空'); return; }
      if (roleDialog.mode === 'create' && (!f.key || !f.key.trim())) { ElMessage.error('角色标识不能为空'); return; }
      try {
        if (roleDialog.mode === 'edit') {
          await req('PUT', '/roles/' + f.id, { name: f.name, desc: f.desc, group: f.group, perms: f.perms });
        } else {
          await req('POST', '/roles', { key: f.key.trim(), name: f.name, desc: f.desc, group: f.group, perms: f.perms });
        }
        roleDialog.visible = false;
        ElMessage.success(roleDialog.mode === 'edit' ? '角色已更新' : '角色已新增');
        await loadRoles(); await loadUsers();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function removeRole(r) {
      try { await ElMessageBox.confirm(`确定删除角色「${r.name}」？`, '删除确认', { type: 'warning' }); }
      catch (_) { return; }
      try { await req('DELETE', '/roles/' + r.id); ElMessage.success('已删除'); await loadRoles(); await loadUsers(); }
      catch (e) { ElMessage.error(e.message); }
    }
    function emptyUser() {
      const g = groups.value.find((x) => x.name === '业务用户组') || groups.value[0];
      const s = suppliers.value[0];
      return {
        username: '', name: '', pwd: '123456', role: 'user',
        groupId: g ? g.id : null,
        org: s ? s.name : '', orgId: s ? s.id : null,
        dept: '', phone: '', active: true,
      };
    }
    function openUserCreate() { userDialog.mode = 'create'; userDialog.form = emptyUser(); userDialog.visible = true; }
    /** 单位变更时，同步带出供应商 id（用于后续扩展） */
    function onUserOrgChange(name) {
      const s = suppliers.value.find((x) => x.name === name);
      userDialog.form.orgId = s ? s.id : null;
    }
    function openUserEdit(u) {
      userDialog.mode = 'edit';
      userDialog.form = Object.assign({}, u, { pwd: '' });
      userDialog.visible = true;
    }
    async function saveUser() {
      const f = userDialog.form;
      if (!f.username || !f.name) { ElMessage.error('账号和姓名不能为空'); return; }
      try {
        if (userDialog.mode === 'edit') await req('PUT', '/users/' + f.id, f);
        else await req('POST', '/users', f);
        userDialog.visible = false;
        ElMessage.success(userDialog.mode === 'edit' ? '用户已更新' : '用户已创建');
        await loadUsers();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function toggleUser(u) {
      try { await req('PUT', '/users/' + u.id, { active: u.active }); ElMessage.success(u.active ? '已启用' : '已停用'); }
      catch (e) { u.active = !u.active; ElMessage.error(e.message); }
    }
    async function removeUser(u) {
      try { await ElMessageBox.confirm(`确定删除用户「${u.name}」？`, '删除确认', { type: 'warning' }); }
      catch (_) { return; }
      try { await req('DELETE', '/users/' + u.id); ElMessage.success('已删除'); await loadUsers(); }
      catch (e) { ElMessage.error(e.message); }
    }
    function openPermView(role) { permDialog.role = role; permDialog.visible = true; }
    function permLabel(key) { return permMap.value[key] || key; }
    const ROLES_MAP = computed(() => {
      const m = {};
      (roles.value || []).forEach((r) => { m[r.key] = { name: r.name }; });
      return m;
    });
    function roleName(key) {
      const r = roles.value.find((x) => x.key === key);
      return r ? r.name : (key || '-');
    }
    /** 监控进度条配色 */
    function barColor(v) {
      const n = Number(v);
      if (n >= 90) return '#dc2626';
      if (n >= 75) return '#f59e0b';
      return '#16a34a';
    }

    /* ---------- 工单 ---------- */
    const ticketDialog = reactive({ visible: false, mode: 'create', form: {} });
    const ticketDetail = reactive({ visible: false, data: null, comment: '' });

    function emptyTicket() {
      return {
        title: '', category: '服务器', priority: 'normal', assignee: '', asset: '',
        groupId: null, creator: (user.value && user.value.name) || '', dueDays: 2,
        description: '', isCoop: false,
      };
    }
    /** 处理人候选：选中处理组时取该组成员（排除普通用户）；未选组时取所有运维/技术人员 */
    const assigneeOptions = computed(() => {
      const gid = ticketDialog.form.groupId;
      if (gid) {
        const g = groups.value.find((x) => x.id === gid);
        return g ? g.members.filter((m) => m.role !== 'user') : [];
      }
      const out = [];
      groups.value.forEach((g) => {
        g.members.forEach((m) => { if (m.role !== 'user') out.push({ id: g.id + '-' + m.id, name: m.name, roleName: m.roleName, groupName: g.name }); });
      });
      return out;
    });
    function onTicketGroupChange() {
      const ok = assigneeOptions.value.some((m) => m.name === ticketDialog.form.assignee);
      if (!ok) ticketDialog.form.assignee = '';
    }
    /** 选了具体处理人 → 自动带出他所在的组（保证组与人对应） */
    function onTicketAssigneeChange(name) {
      if (!name) return;
      for (const g of groups.value) {
        const m = g.members.find((x) => x.name === name);
        if (m) { ticketDialog.form.groupId = g.id; return; }
      }
    }
    /** 当前选中处理人所属组（用于提示） */
    const assigneeGroupName = computed(() => {
      const name = ticketDialog.form.assignee;
      if (!name) return '';
      const g = groups.value.find((x) => x.members.some((m) => m.name === name));
      return g ? g.name : '';
    });
    function openTicketCreate() {
      ticketDialog.mode = 'create'; ticketDialog.form = emptyTicket(); ticketDialog.visible = true;
    }
    async function openTicketEdit(t) {
      ticketDialog.mode = 'edit';
      ticketDialog.form = Object.assign({}, t, { dueDays: 2 });
      ticketDialog.visible = true;
      // 回显两级下拉：按已存资产标识反查其所属单位，再加载该单位资产
      taUnit.value = '';
      taAssets.value = [];
      if (t.asset) {
        try {
          const r = await req('GET', '/ticket-assets/resolve?value=' + encodeURIComponent(t.asset));
          if (r.found && r.unit) {
            taUnit.value = r.unit;
            taAssets.value = await req('GET', '/ticket-assets?unit=' + encodeURIComponent(r.unit));
          } else if (r.found) {
            // 旧资产台账记录：仅展示，不参与两级
            taAssets.value = [{ value: t.asset, label: r.label, category: r.category || '' }];
          }
        } catch (e) { /* ignore */ }
      }
    }
    async function saveTicket() {
      const f = ticketDialog.form;
      if (!f.title || !f.title.trim()) { ElMessage.error('请填写工单标题'); return; }
      try {
        if (ticketDialog.mode === 'edit') await req('PUT', '/tickets/' + f.id, f);
        else await req('POST', '/tickets', f);
        ticketDialog.visible = false;
        ElMessage.success(ticketDialog.mode === 'edit' ? '工单已更新' : '工单已创建');
        await loadAll();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function openTicketDetail(row) {
      try {
        ticketDetail.data = await req('GET', '/tickets/' + row.id);
        ticketDetail.comment = '';
        ticketDetail.visible = true;
        if (ticketDetail.data.asset) resolveAssetLabel(ticketDetail.data.asset);
      } catch (e) { ElMessage.error(e.message); }
    }
    /** 执行工单流转 */
    async function doTransition(action) {
      const d = ticketDetail.data;
      if (!d) return;
      if (action === 'transfer') return openTransfer();
      let note = '';
      try {
        const r = await ElMessageBox.prompt('可填写处理说明（选填）', '确认执行流转', {
          confirmButtonText: '确定', cancelButtonText: '取消', inputPlaceholder: '处理说明…',
        });
        note = r.value || '';
      } catch (_) { return; }
      try {
        ticketDetail.data = await req('POST', `/tickets/${d.id}/transition`, { action, note });
        ElMessage.success('流转完成');
        await loadAll();
      } catch (e) { ElMessage.error(e.message); }
    }

    /* ---------- 工单转派（层级链） ---------- */
    const transferDialog = reactive({ visible: false, targets: [], any: false, toAssignee: '', toGroupId: null, note: '', loading: false });
    async function openTransfer() {
      const d = ticketDetail.data;
      if (!d) return;
      transferDialog.toAssignee = '';
      transferDialog.toGroupId = null;
      transferDialog.note = '';
      transferDialog.targets = [];
      transferDialog.loading = true;
      transferDialog.visible = true;
      try {
        const r = await req('GET', `/tickets/${d.id}/transfer-targets`);
        transferDialog.any = !!r.any;
        transferDialog.targets = r.targets || [];
        if (transferDialog.targets.length === 1) {
          transferDialog.toAssignee = transferDialog.targets[0].assignee;
          transferDialog.toGroupId = transferDialog.targets[0].groupId;
        }
      } catch (e) { ElMessage.error(e.message); }
      transferDialog.loading = false;
    }
    async function submitTransfer() {
      const d = ticketDetail.data;
      if (!transferDialog.toAssignee) { ElMessage.error('请选择转派对象'); return; }
      const hit = transferDialog.targets.find((x) => x.assignee === transferDialog.toAssignee);
      try {
        ticketDetail.data = await req('POST', `/tickets/${d.id}/transition`, {
          action: 'transfer',
          toGroupId: hit ? hit.groupId : transferDialog.toGroupId,
          toAssignee: transferDialog.toAssignee,
          note: transferDialog.note,
        });
        transferDialog.visible = false;
        ElMessage.success('转派成功');
        await loadAll();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function saveTicketStatus() {
      try {
        await req('PUT', '/tickets/' + ticketDetail.data.id, { status: ticketDetail.data.status });
        ElMessage.success('工单状态已更新');
        ticketDetail.visible = false;
        await loadAll();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function addComment() {
      if (!ticketDetail.comment.trim()) return;
      try {
        ticketDetail.data = await req('POST', `/tickets/${ticketDetail.data.id}/comments`,
          { content: ticketDetail.comment.trim(), by: user.value.name });
        ticketDetail.comment = '';
        ElMessage.success('已添加处理记录');
        await loadAll();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function removeTicket(t) {
      try {
        await ElMessageBox.confirm(`确定删除工单「${t.title}」？`, '删除确认', { type: 'warning' });
      } catch (_) { return; }
      try { await req('DELETE', '/tickets/' + t.id); ElMessage.success('已删除'); ticketDetail.visible = false; await loadAll(); }
      catch (e) { ElMessage.error(e.message); }
    }

    /* ---------- 资产 ---------- */
    const assetDialog = reactive({ visible: false, mode: 'create', form: {} });
    const assetDetail = reactive({ visible: false, data: null });
    function emptyAsset() {
      return { name: '', code: '', type: '服务器', resCategory: af.resCategory || '物理服务器', status: 'running', ip: '', owner: '', ownerId: null, location: '', note: '', memGb: 0, diskGb: 0, cpuCores: 0, room: '', unit: '' };
    }
    function openAssetCreate() { assetDialog.mode = 'create'; assetDialog.form = emptyAsset(); assetDialog.visible = true; }
    function openAssetEdit(a) { assetDialog.mode = 'edit'; assetDialog.form = Object.assign({}, a); assetDialog.visible = true; }
    async function saveAsset() {
      const f = assetDialog.form;
      if (!f.name || !f.name.trim()) { ElMessage.error('请填写资产名称'); return; }
      try {
        if (assetDialog.mode === 'edit') await req('PUT', '/assets/' + f.id, f);
        else await req('POST', '/assets', f);
        assetDialog.visible = false;
        ElMessage.success(assetDialog.mode === 'edit' ? '资产已更新' : '资产已新增');
        await loadAll();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function loadAssetOwners() {
      try { assetOwners.value = await req('GET', '/asset-owners'); } catch (e) { /* ignore */ }
    }
    /* 资产标识 → 可读标签（编辑回显、详情显示） */
    const assetLabelMap = reactive({});
    async function resolveAssetLabel(v) {
      if (!v) return '';
      if (assetLabelMap[v] !== undefined) return assetLabelMap[v];
      try {
        const r = await req('GET', '/ticket-assets/resolve?value=' + encodeURIComponent(v));
        assetLabelMap[v] = r.found ? (r.unit ? r.unit + ' / ' + r.label : r.label) : v;
      } catch (e) { assetLabelMap[v] = v; }
      return assetLabelMap[v];
    }
    function assetLabel(v) { return v ? (assetLabelMap[v] || v) : '-'; }

    /* 工单关联资产：加载单位清单 */
    async function loadTaUnits() {
      try { taUnits.value = await req('GET', '/ticket-assets/units'); } catch (e) { taUnits.value = []; }
    }
    /* 选定单位后加载该单位的资产 */
    async function onTaUnitChange(unit) {
      ticketDialog.form.asset = '';
      taAssets.value = [];
      if (!unit) return;
      try { taAssets.value = await req('GET', '/ticket-assets?unit=' + encodeURIComponent(unit)); } catch (e) { taAssets.value = []; }
    }
    async function loadAssetSoftware(assetId) {
      try { assetSoftware.value = await req('GET', '/asset-software?assetId=' + assetId); } catch (e) { assetSoftware.value = []; }
    }
    const swDialog = reactive({ visible: false, mode: 'create', form: {} });
    function emptySoftware() { return { assetId: null, name: '', version: '', vendor: '', category: '其他', installPath: '', note: '' }; }
    function openSwCreate() { swDialog.mode = 'create'; swDialog.form = emptySoftware(); swDialog.form.assetId = assetDetail.data ? assetDetail.data.id : null; swDialog.visible = true; }
    function openSwEdit(x) { swDialog.mode = 'edit'; swDialog.form = Object.assign({}, x); swDialog.visible = true; }
    async function saveSoftware() {
      const f = swDialog.form;
      if (!f.name || !f.name.trim()) { ElMessage.error('软件名称不能为空'); return; }
      try {
        if (swDialog.mode === 'edit') await req('PUT', '/asset-software/' + f.id, f);
        else await req('POST', '/asset-software', f);
        swDialog.visible = false;
        ElMessage.success(swDialog.mode === 'edit' ? '软件已更新' : '软件已新增');
        await loadAssetSoftware(f.assetId);
        await loadAssets();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function removeSoftware(x) {
      try { await ElMessageBox.confirm(`确定删除软件「${x.name}」？`, '删除确认', { type: 'warning' }); }
      catch (_) { return; }
      try {
        await req('DELETE', '/asset-software/' + x.id);
        ElMessage.success('已删除');
        await loadAssetSoftware(x.assetId);
        await loadAssets();
      } catch (e) { ElMessage.error(e.message); }
    }
    function openAssetDetail(a) {
      assetDetail.data = a;
      assetDetail.visible = true;
      assetSoftware.value = [];
      loadAssetSoftware(a.id);
    }
    const relatedTickets = computed(() => {
      if (!assetDetail.data) return [];
      return tickets.value.filter((t) => t.asset === assetDetail.data.code);
    });
    async function removeAsset(a) {
      try { await ElMessageBox.confirm(`确定删除资产「${a.name}」？`, '删除确认', { type: 'warning' }); }
      catch (_) { return; }
      try { await req('DELETE', '/assets/' + a.id); ElMessage.success('已删除'); assetDetail.visible = false; await loadAll(); }
      catch (e) { ElMessage.error(e.message); }
    }

    /* ---------- 知识库 ---------- */
    const kbDialog = reactive({ visible: false, mode: 'create', form: {} });
    const kbDetail = reactive({ visible: false, data: null });
    function emptyKB() { return { title: '', category: '操作指南', tags: '', content: '' }; }
    function openKBCreate() { kbDialog.mode = 'create'; kbDialog.form = emptyKB(); kbDialog.visible = true; }
    function openKBEdit(k) {
      kbDialog.mode = 'edit';
      kbDialog.form = Object.assign({}, k, { tags: (k.tags || []).join(',') });
      kbDialog.visible = true;
    }
    async function saveKB() {
      const f = kbDialog.form;
      if (!f.title || !f.title.trim()) { ElMessage.error('请填写标题'); return; }
      const payload = Object.assign({}, f, { author: user.value.name });
      try {
        if (kbDialog.mode === 'edit') await req('PUT', '/kb/' + f.id, payload);
        else await req('POST', '/kb', payload);
        kbDialog.visible = false;
        ElMessage.success(kbDialog.mode === 'edit' ? '文档已更新' : '文档已创建');
        await loadAll();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function openKBDetail(k) {
      try {
        kbDetail.data = await req('GET', '/kb/' + k.id);
        kbDetail.visible = true;
        await loadKB();
      } catch (e) { ElMessage.error(e.message); }
    }
    async function removeKB(k) {
      try { await ElMessageBox.confirm(`确定删除文档「${k.title}」？`, '删除确认', { type: 'warning' }); }
      catch (_) { return; }
      try { await req('DELETE', '/kb/' + k.id); ElMessage.success('已删除'); kbDetail.visible = false; await loadAll(); }
      catch (e) { ElMessage.error(e.message); }
    }

    /* ---------- 菜单搜索 ---------- */
    const palette = reactive({ visible: false, keyword: '' });
    const paletteItems = computed(() => {
      const items = PAGES.map((p) => ({ label: p.label, grp: '菜单', run: () => go(p.key) }));
      items.push({ label: '新建工单', grp: '操作', run: openTicketCreate });
      items.push({ label: '新增资产', grp: '操作', run: openAssetCreate });
      items.push({ label: '新建知识文档', grp: '操作', run: openKBCreate });
      items.push({ label: '查看告警中心', grp: '快捷', run: () => go('alerts') });
      items.push({ label: '集群总览', grp: '快捷', run: () => go('clusters') });
      const q = palette.keyword.trim().toLowerCase();
      return q ? items.filter((it) => it.label.toLowerCase().includes(q)) : items;
    });
    function openPalette() { palette.keyword = ''; palette.visible = true; }

    /* 从集群卡片进入节点页：只显示该集群的节点 */
    function goClusterNodes(c) {
      mf2.clusterId = c.id;
      mf2.status = '';
      mf2.keyword = '';
      go('nodes');
    }

    function go(p, filter) {
      page.value = p;
      const flat = [];
      PAGES.forEach((x) => { if (x.children) flat.push(...x.children); else flat.push(x); });
      const pg = flat.find((x) => x.key === p);
      if (pg && !openTabs.value.some((t) => t.key === p)) openTabs.value.push({ key: p, label: pg.label });
      // 按页面懒加载数据
      if (p === 'clusters') { loadMonitor(); if (can('pod.view')) loadPods(); }
      else if (p === 'nodes') { loadMonitor(); loadNodes(); }
      else if (p === 'alerts') { loadMonitor(); loadAlerts(); }
      else if (p === 'alertrules') { loadMonitor(); loadAlertRules(); }
      else if (p === 'notify') { loadMonitor(); loadNotify(); }
      else if (p === 'users') { loadUsers(); }
      sidebarOpen.value = false;
    }
    /* 组件状态标签：NotFound 视为「未部署」（灰色），不算故障 */
    function compTagType(st) {
      const v = String(st || '').toLowerCase();
      if (v === 'healthy') return 'success';
      if (v === 'notfound') return 'info';
      if (v === 'degraded') return 'warning';
      return 'danger';
    }
    function compStatusText(st) {
      const v = String(st || '').toLowerCase();
      if (v === 'healthy') return '正常';
      if (v === 'notfound') return '未部署';
      if (v === 'degraded') return '降级';
      if (v === 'unhealthy') return '异常';
      return st || '-';
    }

    function closeTab(key) {
      const i = openTabs.value.findIndex((t) => t.key === key);
      if (i < 0) return;
      openTabs.value.splice(i, 1);
      if (page.value === key) {
        const next = openTabs.value[Math.min(i, openTabs.value.length - 1)];
        go(next ? next.key : 'clusters');
      }
    }

    function onKeydown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    }
    /* ---------- 自动刷新（60 秒，仅登录后、页面可见时） ---------- */
    let autoTimer = null;
    function startAutoRefresh() {
      stopAutoRefresh();
      autoTimer = setInterval(() => {
        if (!token.value || !user.value) return;
        if (document.hidden) return;          // 页面不可见时跳过
        refreshCurrentPage();
      }, 60 * 1000);
    }
    function stopAutoRefresh() {
      if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    }
    /* 只刷新当前页面需要的数据，避免全量请求 */
    function refreshCurrentPage() {
      const p = page.value;
      if (p === 'clusters') { loadMonitor(); if (can('pod.view')) loadPods(); }
      else if (p === 'nodes') { loadMonitor(); loadNodes(); }
      else if (p === 'alerts') { loadMonitor(); loadAlerts(); }
      else if (p === 'alertrules') { loadMonitor(); loadAlertRules(); }
      else if (p === 'notify') { loadNotify(); }
      else { loadMonitor(); }
      /* 已打开的弹窗同步刷新 */
      reloadIssuesIfOpen();
      if (componentsDialog.visible && componentsDialog.cluster) {
        req('GET', `/clusters/${componentsDialog.cluster.id}/components`)
          .then((v) => { components.value = v || []; })
          .catch(() => {});
      }
      if (clusterPodsDialog.visible && clusterPodsDialog.cluster) {
        req('GET', '/pods?clusterId=' + clusterPodsDialog.cluster.id)
          .then((v) => { clusterPodsDialog.list = v || []; })
          .catch(() => {});
      }
    }

    onMounted(async () => {
      document.addEventListener('keydown', onKeydown);
      if (token.value && user.value) {
        try { await loadAll(); } catch (_) { /* 保持页面，稍后手动刷新 */ }
        startAutoRefresh();
      } else {
        loadCaptcha();   // 未登录时准备验证码
      }
    });
    onBeforeUnmount(() => {
      document.removeEventListener('keydown', onKeydown);
      stopAutoRefresh();
    });

    /* 登录页为深色，需同步 body 背景，避免滚动/回弹时露出浅色底（底部白线） */
    watch([token, user], () => {
      const loggedOut = !token.value || !user.value;
      document.body.classList.toggle('login-mode', loggedOut);
      document.documentElement.classList.toggle('login-mode', loggedOut);
      /* 登录态变化时启停自动刷新 */
      if (loggedOut) stopAutoRefresh();
      else startAutoRefresh();
    }, { immediate: true });

    /* ---------- 统计卡 ---------- */
    const statCards = computed(() => {
      const s = stats.value || {};
      return [
        { key: 'pending', label: '待受理', n: s.pending || 0, cls: 'sc-pending', icon: 'Bell' },
        { key: 'processing', label: '受理中', n: s.processing || 0, cls: 'sc-processing', icon: 'Refresh' },
        { key: 'resolved', label: '已解决', n: s.resolved || 0, cls: 'sc-resolved', icon: 'CircleCheck' },
        { key: 'closed', label: '已关闭', n: s.closed || 0, cls: 'sc-closed', icon: 'CircleClose' },
        { key: 'overdue', label: '已超期', n: s.overdue || 0, cls: 'sc-overdue', icon: 'AlarmClock' },
        { key: 'coop', label: '协作工单', n: s.coop || 0, cls: 'sc-coop', icon: 'UserFilled' },
        { key: 'total', label: '全部工单', n: s.total || 0, cls: 'sc-total', icon: 'Document' },
      ];
    });
    const pendingTickets = computed(() => tickets.value.filter((t) => t.status === 'pending').slice(0, 6));
    const maxWeek = computed(() => Math.max(1, ...((stats.value && stats.value.week) || []).map((w) => w.created)));

    /* KPI 占比（用于迷你条宽度），异常/总数，保护除零 */
    function kpiPct(bad, total) {
      const t = Number(total) || 0;
      if (!t) return '0%';
      return Math.min(100, Math.round(((Number(bad) || 0) / t) * 100)) + '%';
    }

    const today = new Date();

    return {
      token, user, page, sidebarOpen, loginErr, loginForm, logging, doLogin, logout, quickLogin, loadCaptcha, captchaImg, captchaId, captchaLoading, pwdDialog, openPwdDialog, submitPwdChange, onUserCommand,
      stats, tickets, assets, kb, tf, af, kf, loadTickets, loadAssets, loadKB, loadAll,
      PAGES, PAGE_TITLE, STATUS_TEXT, STATUS_TAG, PRIORITY_TEXT, PRIORITY_TAG,
      ASSET_STATUS, ASSET_TAG, CATEGORIES, ASSET_TYPES, KB_CATEGORIES_FALLBACK, RES_CATEGORIES, AUDIT_STATUS, ASSET_AUDIT_TAG,
      fmtDate, weekdayCN, greeting, today,
      ticketDialog, ticketDetail, openTicketCreate, openTicketEdit, saveTicket,
      openTicketDetail, saveTicketStatus, addComment, removeTicket, doTransition,
      FLOW_TEXT, FLOW_TAG,
      users, roles, permMap, can, visiblePages, loadUsers, userKeyword, filteredUsers, uf, ROLES_MAP, openGroupManage,
      groups, rules, orgTab, loadGroups, loadRules,
      departments, loadDepartments, deptManage, deptDialog, openDeptManage, openDeptCreate, openDeptEdit, saveDept, removeDept,
      groupDialog, ruleDialog, openGroupCreate, openGroupEdit, saveGroup, removeGroup,
      openRuleCreate, openRuleEdit, saveRule, removeRule,
      transferDialog, openTransfer, submitTransfer,
      assigneeOptions, onTicketGroupChange, onTicketAssigneeChange, assigneeGroupName,
      userDialog, permDialog, openUserCreate, openUserEdit, saveUser, toggleUser, removeUser,
      openPermView, permLabel,
      roleManage, roleDialog, permOptions, loadRoles, openRoleManage, openRoleCreate, openRoleEdit, saveRole, removeRole,
      assetDialog, assetDetail, openAssetCreate, openAssetEdit, saveAsset,
      assetOwners, assetSoftware, loadAssetOwners, loadAssetSoftware, swDialog, SOFTWARE_CATEGORIES,
      taUnits, taAssets, taUnit, loadTaUnits, onTaUnitChange, assetLabel, resolveAssetLabel,
      assetUnits, assetSelected, loadAssetUnits, switchResCategory, auditAsset, batchDeleteAssets, exportAssetsExcel,
      resCats, resRecords, resCat, resFields, resListFields, resKind, resKw, resAuditFilter, resShowDeleted,
      resDialog, resDetail, resImportInput, resOpts, loadResCats, loadResRecords, switchResCat, loadResOptions,
      openResCreate, openResEdit, saveRes, openResDetail, removeRes, auditRes, batchDeleteRes, exportRes,
      triggerResImport, onResImportFile,
      openSwCreate, openSwEdit, saveSoftware, removeSoftware,
      openAssetDetail, removeAsset, relatedTickets,
      kbDialog, kbDetail, openKBCreate, openKBEdit, saveKB, openKBDetail, removeKB,
      kbCategories, kbCategoryNames, loadKbCategories, kbCatDialog, kbCatManage, openKbCategoryManage,
      openKbCategoryCreate, openKbCategoryEdit, saveKbCategory, removeKbCategory,
      suppliers, models, sf, mf, loadSuppliers, resetSupplierFilter, supplierDialog,
      openSupplierCreate, openSupplierEdit, saveSupplier, toggleSupplier, removeSupplier,
      loadModels, resetModelFilter, modelDialog, openModelCreate, openModelEdit, saveModel, toggleModel, removeModel,
      SUPPLIER_STATUS, MODEL_UNITS, PROVINCES, MODEL_CATEGORIES,
      categories, cf, loadCategories, categoryDialog, openCategoryCreate, openCategoryEdit, saveCategory, removeCategory,
      ticketCatTree, bigCatOptions, midCatOptions, smallCatOptions, loadTicketCats,
      onBigCatChange, onMidCatChange, tcDialog, openTcCreate, openTcEdit, saveTc, removeTc,
      auditLogs, auditModules, lf, loadAudit, resetAuditFilter, AUDIT_ACTION, AUDIT_TAG, roleName,
      menuMatrix, loadMenuMatrix, toggleMenu,
      onUserOrgChange,
      clusters, nodes, alerts, alertRules, monSummary, nodeMetrics, components, componentsDialog,
      clusterPodsDialog, openClusterPods,
      clusterPage, clusterPageSize, clusterTotalPages, pagedClusters, onClusterPageSizeChange, onClusterPageChange,
      ticketPage, ticketPageSize, ticketTotalPages, pagedTickets, onTicketSizeChange,
      assetPage, assetPageSize, assetTotalPages, pagedAssets, onAssetSizeChange,
      kbPage, kbPageSize, kbTotalPages, pagedKb, onKbSizeChange,
      userPage, userPageSize, userTotalPages, pagedUsers, onUserSizeChange,
      supplierPage, supplierPageSize, supplierTotalPages, pagedSuppliers, onSupplierSizeChange,
      modelPage, modelPageSize, modelTotalPages, pagedModels, onModelSizeChange,
      categoryPage, categoryPageSize, categoryTotalPages, pagedCategories, onCategorySizeChange,
      alertPage, alertPageSize, alertTotalPages, pagedAlerts, onAlertSizeChange,
      alertRulePage, alertRulePageSize, alertRuleTotalPages, pagedAlertRules, onAlertRuleSizeChange,
      nodePage, nodePageSize, nodeTotalPages, pagedNodes, onNodeSizeChange,
      auditPage, auditPageSize, auditTotalPages, pagedAuditLogs, onAuditSizeChange,
      notifyLogPage, notifyLogPageSize, notifyLogTotalPages, pagedNotifyLogs, onNotifyLogSizeChange,
      rulePage, rulePageSize, ruleTotalPages, pagedRules, onRuleSizeChange,
      tcPage, tcPageSize, tcTotalPages, pagedTicketCats, onTcSizeChange,
      menuPage, menuPageSize, menuTotalPages, pagedMenus, onMenuSizeChange,
      installDialog, openInstallScript, installTabContent,
      pods, pf, loadPods, resetPodFilter, podNamespaces, POD_STATUS_TAG, POD_ABNORMAL,
      notifyChannels, notifyLogs, notifyDialog, notifyTab, loadNotify, emptyNotify,
      openNotifyCreate, openNotifyEdit, saveNotify, removeNotify, toggleNotify, testNotify, onNotifyTypeChange,
      CHANNEL_TYPE_TEXT, CHANNEL_TYPE_TAG,
      issuesDialog, openIssues, reloadIssuesIfOpen,
      clusterDialog, nodeDialog, alertRuleDialog, mf2, alf,
      loadMonitor, loadNodes, resetNodeFilter, loadAlerts, resetAlertFilter, loadAlertRules,
      resolveAlert, openClusterCreate, openClusterEdit, saveCluster, removeCluster,
      openNodeDetail, openClusterComponents, openAlertRuleCreate, openAlertRuleEdit, saveAlertRule,
      removeAlertRule, toggleRule, gotoAlertTicket, barColor, ruleSmallCatOptions, copyText, metricLine,
      SEVERITY_TEXT, SEVERITY_TAG, ALERT_STATUS_TEXT, CLUSTER_STATUS_TEXT, CLUSTER_STATUS_TAG,
      NODE_STATUS_TAG, METRIC_OPTIONS,
      openTabs, closeTab,
      palette, paletteItems, openPalette, go, goClusterNodes, kpiPct, compTagType, compStatusText,
    };
  },

  template: `
  <!-- ============ 登录页（左右分栏） ============ -->
  <div v-if="!token || !user" class="login-wrap">
    <!-- 左：等距插画 -->
    <div class="login-visual">
      <img class="login-iso" src="./login-iso.svg" alt="" />
    </div>

    <!-- 右：登录面板 -->
    <div class="login-side">
      <div class="login-card">
        <div class="login-head">
          <span class="login-logo">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
                 stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M12 22V12"/><path d="M3 7l9 5 9-5"/>
            </svg>
          </span>
          <h1>智能运维管理平台</h1>
        </div>

        <div class="login-tab">账号密码登录</div>

        <el-alert v-if="loginErr" :title="loginErr" type="error" :closable="false" show-icon class="login-alert" />

        <el-form class="login-form" @submit.prevent="doLogin">
          <el-input v-model="loginForm.username" placeholder="请输入账号" size="large" class="login-input"
                    @keyup.enter="doLogin">
            <template #prefix><el-icon><User /></el-icon></template>
          </el-input>
          <el-input v-model="loginForm.password" type="password" show-password size="large" class="login-input"
                    placeholder="请输入密码" @keyup.enter="doLogin">
            <template #prefix><el-icon><Lock /></el-icon></template>
          </el-input>
          <div class="captcha-row">
            <el-input v-model="loginForm.captcha" placeholder="请输入验证码" size="large" maxlength="4"
                      class="login-input" @keyup.enter="doLogin">
              <template #prefix><el-icon><Key /></el-icon></template>
            </el-input>
            <div class="captcha-box" :class="{ loading: captchaLoading }" @click="loadCaptcha" title="点击刷新">
              <img v-if="captchaImg" :src="captchaImg" alt="验证码" />
              <span v-else class="captcha-ph">…</span>
            </div>
          </div>
          <el-button class="login-btn" size="large" :loading="logging" @click="doLogin">登 录</el-button>
        </el-form>

        <div class="login-sep"><span>快速体验</span></div>
        <div class="quick-row">
          <button class="quick-btn" @click="quickLogin('admin')">
            <span class="qd">管理员</span><span class="qu">admin</span>
          </button>
          <button class="quick-btn" @click="quickLogin('liqiang')">
            <span class="qd">运维</span><span class="qu">liqiang</span>
          </button>
          <button class="quick-btn" @click="quickLogin('wangfang')">
            <span class="qd">用户</span><span class="qu">wangfang</span>
          </button>
        </div>
        <p class="login-tip">演示密码均为 <code>123456</code></p>
      </div>
    </div>
  </div>

  <!-- ============ 主界面 ============ -->
  <div v-else class="layout">
    <aside class="aside" :class="{ open: sidebarOpen }">
      <div class="aside-head">
        <div class="mark">运</div><span>智能运维管理平台</span>
      </div>
      <el-menu :default-active="page" @select="go">
        <template v-for="p in visiblePages" :key="p.key">
          <el-sub-menu v-if="p.children" :index="p.key">
            <template #title>
              <el-icon><component :is="p.icon" /></el-icon>
              <span>{{ p.label }}</span>
            </template>
            <el-menu-item v-for="c in p.children" :key="c.key" :index="c.key">
              <el-icon><component :is="c.icon" /></el-icon>
              <span>{{ c.label }}</span>
            </el-menu-item>
          </el-sub-menu>
          <el-menu-item v-else :index="p.key">
            <el-icon><component :is="p.icon" /></el-icon>
            <span>{{ p.label }}</span>
          </el-menu-item>
        </template>
      </el-menu>
    </aside>

    <div class="main">
      <header class="topbar">
        <el-button class="hamburger" text @click="sidebarOpen = !sidebarOpen"><el-icon><Fold /></el-icon></el-button>
        <div class="crumbs">
          <span>{{ user.org || '中烟信息' }}</span><span>/</span>
          <span class="cur">{{ PAGE_TITLE[page] }}</span>
        </div>
        <div class="topbar-right">
          <div class="menu-search" @click="openPalette">
            <el-icon><Search /></el-icon><span class="txt">菜单搜索</span>
          </div>
          <el-badge is-dot>
            <el-icon style="font-size:18px;cursor:pointer;color:#4b5563" @click="go('alerts')"><Bell /></el-icon>
          </el-badge>
          <el-dropdown trigger="click" @command="onUserCommand">
            <div class="user-chip">
              <div class="avatar">{{ (user.name || '管').slice(0, 1) }}</div>
              <span class="nm">{{ user.name }}</span>
              <el-icon style="font-size:11px;color:#9ca3af"><ArrowDown /></el-icon>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item disabled>{{ user.username }} · {{ user.roleName }}</el-dropdown-item>
                <el-dropdown-item divided command="pwd">修改密码</el-dropdown-item>
                  <el-dropdown-item command="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <div class="tabbar" v-if="openTabs.length">
        <div v-for="t in openTabs" :key="t.key" class="tab-item" :class="{ active: t.key === page }" @click="go(t.key)">
          <span>{{ t.label }}</span>
          <el-icon v-if="t.key !== 'clusters'" class="tab-x" @click.stop="closeTab(t.key)"><Close /></el-icon>
        </div>
      </div>

      <main class="content">












        <!-- ========== 集群总览 ========== -->
        <template v-if="page === 'clusters'">
          <div class="mon-kpi">
            <div class="mon-kpi-card clickable" @click="openIssues('clusters')">
              <div class="kpi-top"><span class="kpi-ic"><el-icon><Monitor /></el-icon></span><span class="k">集群总数</span></div>
              <div class="v">{{ monSummary ? monSummary.clusters : 0 }}</div>
              <div class="kpi-bar"><i style="width:100%"></i></div>
            </div>
            <div class="mon-kpi-card bad clickable" @click="openIssues('badClusters')">
              <div class="kpi-top"><span class="kpi-ic"><el-icon><WarningFilled /></el-icon></span><span class="k">异常集群</span></div>
              <div class="v">{{ monSummary ? monSummary.unhealthy : 0 }}</div>
              <div class="kpi-bar bad"><i :style="{ width: kpiPct(monSummary && monSummary.unhealthy, monSummary && monSummary.clusters) }"></i></div>
            </div>
            <div class="mon-kpi-card clickable" @click="openIssues('nodes')">
              <div class="kpi-top"><span class="kpi-ic"><el-icon><Platform /></el-icon></span><span class="k">节点总数</span></div>
              <div class="v">{{ monSummary ? monSummary.nodes : 0 }}</div>
              <div class="kpi-bar"><i style="width:100%"></i></div>
            </div>
            <div class="mon-kpi-card bad clickable" @click="openIssues('notReady')">
              <div class="kpi-top"><span class="kpi-ic"><el-icon><Connection /></el-icon></span><span class="k">异常节点</span></div>
              <div class="v">{{ monSummary ? monSummary.notReady : 0 }}</div>
              <div class="kpi-bar bad"><i :style="{ width: kpiPct(monSummary && monSummary.notReady, monSummary && monSummary.nodes) }"></i></div>
            </div>
            <div class="mon-kpi-card clickable" @click="openIssues('pods')">
              <div class="kpi-top"><span class="kpi-ic"><el-icon><Box /></el-icon></span><span class="k">Pod 总数</span></div>
              <div class="v">{{ monSummary ? monSummary.pods : 0 }}</div>
              <div class="kpi-bar"><i style="width:100%"></i></div>
            </div>
            <div class="mon-kpi-card bad clickable" @click="openIssues('badPods')">
              <div class="kpi-top"><span class="kpi-ic"><el-icon><Grid /></el-icon></span><span class="k">异常 Pod</span></div>
              <div class="v">{{ monSummary ? monSummary.badPods : 0 }}</div>
              <div class="kpi-bar bad"><i :style="{ width: kpiPct(monSummary && monSummary.badPods, monSummary && monSummary.pods) }"></i></div>
            </div>
            <div class="mon-kpi-card bad clickable" @click="openIssues('badComps')">
              <div class="kpi-top"><span class="kpi-ic"><el-icon><SetUp /></el-icon></span><span class="k">异常组件</span></div>
              <div class="v">{{ monSummary ? monSummary.badComps : 0 }}</div>
              <div class="kpi-bar bad"><i style="width:100%"></i></div>
            </div>
            <div class="mon-kpi-card warn clickable" @click="openIssues('firing')">
              <div class="kpi-top"><span class="kpi-ic"><el-icon><Bell /></el-icon></span><span class="k">告警中</span></div>
              <div class="v">{{ monSummary ? monSummary.firing : 0 }}</div>
              <div class="kpi-bar warn"><i style="width:100%"></i></div>
            </div>
            <div class="mon-kpi-card">
              <div class="kpi-top"><span class="kpi-ic"><el-icon><Cpu /></el-icon></span><span class="k">平均 CPU</span></div>
              <div class="v">{{ monSummary ? monSummary.avgCpu : 0 }}<em>%</em></div>
              <div class="kpi-bar"><i :style="{ width: (monSummary ? monSummary.avgCpu : 0) + '%' }"></i></div>
            </div>
            <div class="mon-kpi-card">
              <div class="kpi-top"><span class="kpi-ic"><el-icon><Histogram /></el-icon></span><span class="k">平均内存</span></div>
              <div class="v">{{ monSummary ? monSummary.avgMem : 0 }}<em>%</em></div>
              <div class="kpi-bar"><i :style="{ width: (monSummary ? monSummary.avgMem : 0) + '%' }"></i></div>
            </div>
          </div>

          <div class="toolbar">
            <span style="font-size:13px;color:#6b7280">
              共 {{ clusters.length }} 个集群
              <span v-if="clusterTotalPages > 1">· 第 {{ clusterPage }} / {{ clusterTotalPages }} 页</span>
            </span>
            <el-select v-model="clusterPageSize" style="width:120px" @change="onClusterPageSizeChange">
              <el-option :value="6" label="每页 6 个" />
              <el-option :value="9" label="每页 9 个" />
              <el-option :value="12" label="每页 12 个" />
              <el-option :value="24" label="每页 24 个" />
            </el-select>
            <span class="spacer"></span>
            <el-button v-if="can('cluster.manage')" type="primary" @click="openClusterCreate"><el-icon><Plus /></el-icon>&nbsp;接入集群</el-button>
            <el-button @click="loadMonitor"><el-icon><Refresh /></el-icon>&nbsp;刷新</el-button>
          </div>

          <div class="cluster-grid">
            <div v-for="c in pagedClusters" :key="c.id" class="cluster-card" :class="'hc-' + c.health">
              <div class="cluster-topbar"></div>
              <div class="cluster-head">
                <span class="health-dot" :class="'hd-' + c.health"></span>
                <span class="cluster-name">{{ c.name }}</span>
                <el-tag :type="CLUSTER_STATUS_TAG[c.health] || 'info'" size="small">{{ CLUSTER_STATUS_TEXT[c.health] || c.health }}</el-tag>
                <el-tag size="small" effect="plain" type="info">{{ c.env }}</el-tag>
              </div>
              <div class="cluster-meta">
                <span>标识：<b>{{ c.code }}</b></span>
                <span>版本：<b>{{ c.version || '-' }}</b></span>
                <span>地域：<b>{{ c.region || '-' }}</b></span>
              </div>
              <div class="cluster-issues" :class="c.health === 'healthy' ? 'ok' : (c.health === 'unknown' ? 'unknown' : 'bad')">
                <el-icon><WarningFilled v-if="c.health === 'warning'" /><CircleCheckFilled v-else-if="c.health === 'healthy'" /><QuestionFilled v-else /></el-icon>
                <span>{{ c.healthText }}</span>
              </div>
              <div class="cluster-stats">
                <div class="cs clickable" @click="openIssues('nodes', c.id, c.name)" title="查看节点明细">
                  <div class="cs-v">{{ c.readyCount }}<em>/{{ c.nodeCount }}</em></div><div class="cs-k">就绪节点</div>
                </div>
                <div class="cs clickable" @click="openIssues('firing', c.id, c.name)" title="查看告警明细">
                  <div class="cs-v" :class="{ bad: c.firingAlerts > 0 }">{{ c.firingAlerts }}</div><div class="cs-k">告警中</div>
                </div>
                <div class="cs clickable" @click="openIssues('badPods', c.id, c.name)" title="查看异常 Pod 明细">
                  <div class="cs-v" :class="{ bad: c.badPods > 0 }">{{ c.badPods }}</div><div class="cs-k">异常 Pod</div>
                </div>
                <div class="cs">
                  <div class="cs-v">{{ c.avgCpu }}<em>%</em></div>
                  <div class="cs-bar" :class="{ hot: c.avgCpu >= 80 }"><i :style="{ width: c.avgCpu + '%' }"></i></div>
                  <div class="cs-k">平均 CPU</div>
                </div>
                <div class="cs">
                  <div class="cs-v">{{ c.avgMem }}<em>%</em></div>
                  <div class="cs-bar" :class="{ hot: c.avgMem >= 85 }"><i :style="{ width: c.avgMem + '%' }"></i></div>
                  <div class="cs-k">平均内存</div>
                </div>
              </div>
              <div class="cluster-foot">
                <span style="font-size:12px;color:#9ca3af">最近上报：{{ fmtDate(c.lastSeen, true) }}</span>
                <span class="spacer"></span>
                <el-button link type="primary" size="small" @click="openClusterComponents(c)">组件状态</el-button>
                <el-button v-if="can('pod.view')" link type="primary" size="small" @click="openClusterPods(c)">Pod</el-button>
                <el-button link type="primary" size="small" @click="goClusterNodes(c)">节点</el-button>
                <el-button v-if="can('cluster.manage')" link type="success" size="small" @click="openInstallScript(c)">安装 Agent</el-button>
                <el-button v-if="can('cluster.manage')" link type="primary" size="small" @click="openClusterEdit(c)">编辑</el-button>
                <el-button v-if="can('cluster.manage')" link type="danger" size="small" @click="removeCluster(c)">删除</el-button>
              </div>
            </div>
          </div>
          <div v-if="!clusters.length" class="empty">暂无集群，点击「接入集群」添加</div>
          <div v-else-if="clusterTotalPages > 1" class="pager" style="justify-content:center;border-top:none;margin-top:16px">
            <el-pagination
              background
              layout="prev, pager, next, jumper, total"
              :total="clusters.length"
              :page-size="clusterPageSize"
              :current-page="clusterPage"
              @current-change="onClusterPageChange" />
          </div>
        </template>

        <!-- ========== 节点监控 ========== -->
        <template v-else-if="page === 'nodes'">
          <div class="toolbar">
            <el-select v-model="mf2.clusterId" placeholder="全部集群" clearable style="width:170px" @change="loadNodes">
              <el-option v-for="c in clusters" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
            <el-select v-model="mf2.status" placeholder="全部状态" clearable style="width:140px" @change="loadNodes">
              <el-option label="Ready" value="Ready" />
              <el-option label="NotReady" value="NotReady" />
            </el-select>
            <el-input v-model="mf2.keyword" placeholder="节点名 / IP" clearable style="width:190px" @keyup.enter="loadNodes" @clear="loadNodes" />
            <el-button type="primary" @click="loadNodes"><el-icon><Search /></el-icon>&nbsp;查询</el-button>
            <el-button @click="resetNodeFilter">重置</el-button>
            <span class="spacer"></span>
            <span style="font-size:13px;color:#6b7280">共 {{ nodes.length }} 个节点</span>
          </div>

          <div class="table-wrap">
            <el-table :data="pagedNodes" style="width:100%" stripe @row-click="openNodeDetail">
              <el-table-column prop="clusterName" label="集群" width="130" />
              <el-table-column prop="name" label="节点" width="150" />
              <el-table-column label="角色" width="90">
                <template #default="{ row }"><el-tag size="small" effect="plain" :type="row.role === 'master' ? 'warning' : 'info'">{{ row.role === 'master' ? '控制面' : '工作节点' }}</el-tag></template>
              </el-table-column>
              <el-table-column label="状态" width="100">
                <template #default="{ row }"><el-tag size="small" :type="NODE_STATUS_TAG[row.status] || 'info'">{{ row.status }}</el-tag></template>
              </el-table-column>
              <el-table-column prop="ip" label="IP" width="120" />
              <el-table-column label="CPU" width="150">
                <template #default="{ row }">
                  <el-progress :percentage="Math.min(100, Number(row.cpuUsage))" :stroke-width="12" :color="barColor(row.cpuUsage)" :format="() => row.cpuUsage + '%'" />
                </template>
              </el-table-column>
              <el-table-column label="内存" width="150">
                <template #default="{ row }">
                  <el-progress :percentage="Math.min(100, Number(row.memUsage))" :stroke-width="12" :color="barColor(row.memUsage)" :format="() => row.memUsage + '%'" />
                </template>
              </el-table-column>
              <el-table-column label="磁盘" width="150">
                <template #default="{ row }">
                  <el-progress :percentage="Math.min(100, Number(row.diskUsage))" :stroke-width="12" :color="barColor(row.diskUsage)" :format="() => row.diskUsage + '%'" />
                </template>
              </el-table-column>
              <el-table-column prop="podCount" label="Pod" width="80" />
              <el-table-column prop="kubeletVersion" label="kubelet" width="110" />
            </el-table>
            <div class="pager">
              <span>共 {{ nodes.length }} 条</span>
              <el-pagination background layout="prev, pager, next, jumper, total"
                :total="nodes.length" :page-size="nodePageSize" :current-page="nodePage"
                @current-change="(p) => nodePage = p"
                @size-change="(s) => { nodePageSize = s; onNodeSizeChange(); }" />
            </div>
          </div>
        </template>

        <!-- ========== 告警中心 ========== -->
        <template v-else-if="page === 'alerts'">
          <div class="toolbar">
            <el-select v-model="alf.status" placeholder="状态" clearable style="width:130px" @change="loadAlerts">
              <el-option label="告警中" value="firing" />
              <el-option label="已恢复" value="resolved" />
            </el-select>
            <el-select v-model="alf.severity" placeholder="级别" clearable style="width:120px" @change="loadAlerts">
              <el-option v-for="(v, k) in SEVERITY_TEXT" :key="k" :label="v" :value="k" />
            </el-select>
            <el-select v-model="alf.clusterId" placeholder="全部集群" clearable style="width:160px" @change="loadAlerts">
              <el-option v-for="c in clusters" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
            <el-input v-model="alf.keyword" placeholder="告警内容 / 目标" clearable style="width:190px" @keyup.enter="loadAlerts" @clear="loadAlerts" />
            <el-button type="primary" @click="loadAlerts"><el-icon><Search /></el-icon>&nbsp;查询</el-button>
            <el-button @click="resetAlertFilter">重置</el-button>
            <span class="spacer"></span>
            <span style="font-size:13px;color:#6b7280">共 {{ alerts.length }} 条</span>
            <el-button @click="loadAlerts"><el-icon><Refresh /></el-icon>&nbsp;刷新</el-button>
          </div>

          <div class="table-wrap">
            <el-table :data="pagedAlerts" style="width:100%" stripe>
              <el-table-column label="级别" width="90">
                <template #default="{ row }"><el-tag size="small" :type="SEVERITY_TAG[row.severity] || 'info'">{{ SEVERITY_TEXT[row.severity] || row.severity }}</el-tag></template>
              </el-table-column>
              <el-table-column label="状态" width="100">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.status === 'firing' ? 'danger' : 'success'" effect="plain">{{ ALERT_STATUS_TEXT[row.status] || row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="clusterName" label="集群" width="130" />
              <el-table-column prop="target" label="目标" width="140" />
              <el-table-column prop="message" label="告警内容" min-width="260" show-overflow-tooltip />
              <el-table-column label="触发时间" width="150">
                <template #default="{ row }">{{ fmtDate(row.firedAt, true) }}</template>
              </el-table-column>
              <el-table-column label="关联工单" width="150">
                <template #default="{ row }">
                  <el-button v-if="row.ticketId" link type="primary" size="small" @click.stop="gotoAlertTicket(row)">查看工单 #{{ row.ticketId }}</el-button>
                  <span v-else style="color:#9ca3af;font-size:12px">—</span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="110" fixed="right">
                <template #default="{ row }">
                  <el-button v-if="row.status === 'firing' && can('alert.manage')" link type="primary" size="small" @click.stop="resolveAlert(row)">标记恢复</el-button>
                  <span v-else-if="row.status === 'resolved'" style="color:#9ca3af;font-size:12px">已恢复</span>
                </template>
              </el-table-column>
            </el-table>
            <div class="pager">
              <span>共 {{ alerts.length }} 条</span>
              <el-pagination background layout="prev, pager, next, jumper, total"
                :total="alerts.length" :page-size="alertPageSize" :current-page="alertPage"
                @current-change="(p) => alertPage = p"
                @size-change="(s) => { alertPageSize = s; onAlertSizeChange(); }" />
            </div>
          </div>
        </template>

        <!-- ========== 告警规则 ========== -->
        <template v-else-if="page === 'alertrules'">
          <el-alert type="info" :closable="false" show-icon style="margin-bottom:14px"
                    title="告警规则"
                    description="指标超阈值即触发告警，并可自动创建工单（按三级事件分类分派到处理组）。规则对 agent 上报的数据生效。" />
          <div class="toolbar">
            <span style="font-size:13px;color:#6b7280">共 {{ alertRules.length }} 条规则</span>
            <span class="spacer"></span>
            <el-button v-if="can('alert.manage')" type="primary" @click="openAlertRuleCreate"><el-icon><Plus /></el-icon>&nbsp;新建规则</el-button>
            <el-button @click="loadAlertRules"><el-icon><Refresh /></el-icon>&nbsp;刷新</el-button>
          </div>
          <div class="table-wrap">
            <el-table :data="pagedAlertRules" style="width:100%" stripe>
              <el-table-column prop="name" label="规则名称" min-width="180" />
              <el-table-column label="指标" width="150">
                <template #default="{ row }">{{ (METRIC_OPTIONS.find(m => m.value === row.metric) || {}).label || row.metric }}</template>
              </el-table-column>
              <el-table-column label="条件" width="120">
                <template #default="{ row }"><code>{{ row.operator }} {{ row.threshold }}</code></template>
              </el-table-column>
              <el-table-column label="级别" width="90">
                <template #default="{ row }"><el-tag size="small" :type="SEVERITY_TAG[row.severity]">{{ SEVERITY_TEXT[row.severity] }}</el-tag></template>
              </el-table-column>
              <el-table-column label="事件分类" min-width="180">
                <template #default="{ row }">
                  <span style="font-size:12.5px">{{ row.category }} / {{ row.midCategory }} / {{ row.smallCategory }}</span>
                </template>
              </el-table-column>
              <el-table-column label="自动建单" width="100">
                <template #default="{ row }"><el-tag size="small" :type="row.autoTicket ? 'success' : 'info'" effect="plain">{{ row.autoTicket ? '开' : '关' }}</el-tag></template>
              </el-table-column>
              <el-table-column label="启用" width="90">
                <template #default="{ row }">
                  <el-switch :model-value="row.enabled" :disabled="!can('alert.manage')" @change="toggleRule(row)" />
                </template>
              </el-table-column>
              <el-table-column label="操作" width="140" fixed="right">
                <template #default="{ row }">
                  <template v-if="can('alert.manage')">
                    <el-button link type="primary" size="small" @click="openAlertRuleEdit(row)">编辑</el-button>
                    <el-button link type="danger" size="small" @click="removeAlertRule(row)">删除</el-button>
                  </template>
                  <span v-else style="color:#9ca3af;font-size:12px">只读</span>
                </template>
              </el-table-column>
            </el-table>
            <div class="pager">
              <span>共 {{ alertRules.length }} 条</span>
              <el-pagination background layout="prev, pager, next, jumper, total"
                :total="alertRules.length" :page-size="alertRulePageSize" :current-page="alertRulePage"
                @current-change="(p) => alertRulePage = p"
                @size-change="(s) => { alertRulePageSize = s; onAlertRuleSizeChange(); }" />
            </div>
          </div>
        </template>

        <!-- ========== 通知渠道 ========== -->
        <template v-else-if="page === 'notify'">
          <el-tabs v-model="notifyTab">
            <el-tab-pane label="渠道配置" name="channels">
              <el-alert type="info" :closable="false" show-icon style="margin-bottom:14px"
                        title="通知渠道"
                        description="支持企业微信机器人、钉钉机器人、SMTP 邮件。告警触发/恢复时按级别过滤后推送；可点「测试」验证配置。" />
              <div class="toolbar">
                <span style="font-size:13px;color:#6b7280">共 {{ notifyChannels.length }} 个渠道</span>
                <span class="spacer"></span>
                <el-button v-if="can('alert.manage')" type="primary" @click="openNotifyCreate"><el-icon><Plus /></el-icon>&nbsp;新建渠道</el-button>
                <el-button @click="loadNotify"><el-icon><Refresh /></el-icon>&nbsp;刷新</el-button>
              </div>
              <div class="notify-grid">
                <div v-for="c in notifyChannels" :key="c.id" class="notify-card">
                  <div class="notify-head">
                    <el-tag size="small" :type="CHANNEL_TYPE_TAG[c.type]">{{ CHANNEL_TYPE_TEXT[c.type] || c.type }}</el-tag>
                    <span class="notify-name">{{ c.name }}</span>
                    <el-switch :model-value="c.enabled" :disabled="!can('alert.manage')" @change="toggleNotify(c)" />
                  </div>
                  <div class="notify-meta">
                    <span>最低级别：<b>{{ SEVERITY_TEXT[c.minSeverity] }}</b></span>
                    <span>触发通知：<b>{{ c.onFire ? '开' : '关' }}</b></span>
                    <span>恢复通知：<b>{{ c.onResolve ? '开' : '关' }}</b></span>
                  </div>
                  <div class="notify-foot">
                    <span style="font-size:12px;color:#9ca3af">{{ c.note || '' }}</span>
                    <span class="spacer"></span>
                    <el-button v-if="can('alert.manage')" link type="primary" size="small" @click="testNotify(c)">测试</el-button>
                    <el-button v-if="can('alert.manage')" link type="primary" size="small" @click="openNotifyEdit(c)">编辑</el-button>
                    <el-button v-if="can('alert.manage')" link type="danger" size="small" @click="removeNotify(c)">删除</el-button>
                  </div>
                </div>
              </div>
            </el-tab-pane>
            <el-tab-pane label="发送记录" name="logs">
              <div class="table-wrap">
                <el-table :data="pagedNotifyLogs" style="width:100%" stripe size="small">
                  <el-table-column label="时间" width="165">
                    <template #default="{ row }">{{ fmtDate(row.at, true) }}</template>
                  </el-table-column>
                  <el-table-column prop="channelName" label="渠道" width="180" />
                  <el-table-column label="类型" width="110">
                    <template #default="{ row }">{{ CHANNEL_TYPE_TEXT[row.channelType] || row.channelType }}</template>
                  </el-table-column>
                  <el-table-column prop="event" label="事件" width="100" />
                  <el-table-column label="结果" width="100">
                    <template #default="{ row }">
                      <el-tag size="small" :type="row.status === 'ok' ? 'success' : 'danger'">{{ row.status === 'ok' ? '成功' : '失败' }}</el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column prop="error" label="错误信息" min-width="200" show-overflow-tooltip />
                </el-table>
            <div class="pager">
              <span>共 {{ notifyLogs.length }} 条</span>
              <el-pagination background layout="prev, pager, next, jumper, total"
                :total="notifyLogs.length" :page-size="notifyLogPageSize" :current-page="notifyLogPage"
                @current-change="(p) => notifyLogPage = p"
                @size-change="(s) => { notifyLogPageSize = s; onNotifyLogSizeChange(); }" />
            </div>
              </div>
            </el-tab-pane>
          </el-tabs>
        </template>

        <!-- ========== 用户与权限 ========== -->
        <template v-else-if="page === 'users'">
          <div class="toolbar">
            <el-input v-model="uf.keyword" placeholder="账号 / 姓名 / 部门" clearable style="width:220px"
                      @keyup.enter="loadUsers" @clear="loadUsers" />
            <el-select v-model="uf.role" placeholder="全部角色" clearable style="width:150px" @change="loadUsers">
              <el-option v-for="(r, k) in ROLES_MAP" :key="k" :label="r.name" :value="k" />
            </el-select>
            <el-button type="primary" @click="loadUsers"><el-icon><Search /></el-icon>&nbsp;查询</el-button>
            <span class="spacer"></span>
            <span style="font-size:13px;color:#6b7280">共 {{ users.length }} 个用户</span>
            <el-button v-if="can('user.manage')" type="primary" @click="openUserCreate">
              <el-icon><Plus /></el-icon>&nbsp;新建用户
            </el-button>
            <el-button @click="openRoleManage"><el-icon><Setting /></el-icon>&nbsp;角色管理</el-button>
            <el-button @click="openDeptManage"><el-icon><OfficeBuilding /></el-icon>&nbsp;部门管理</el-button>
            <el-button @click="openGroupManage"><el-icon><Share /></el-icon>&nbsp;组织分组</el-button>
          </div>

          <div class="table-wrap">
            <el-table :data="filteredUsers" style="width:100%" stripe>
              <el-table-column prop="username" label="账号" width="130" />
              <el-table-column prop="name" label="姓名" width="110" />
              <el-table-column label="角色" width="120">
                <template #default="{ row }">
                  <el-tag size="small" effect="plain">{{ row.roleName || row.role }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="groupName" label="所属组" width="140" />
              <el-table-column prop="org" label="单位" min-width="160" show-overflow-tooltip />
              <el-table-column prop="dept" label="部门" width="130" />
              <el-table-column prop="phone" label="联系方式" width="140" />
              <el-table-column label="状态" width="90">
                <template #default="{ row }">
                  <el-switch :model-value="!!row.active" :disabled="!can('user.manage')" @change="toggleUser(row)" />
                </template>
              </el-table-column>
              <el-table-column label="操作" width="200" fixed="right">
                <template #default="{ row }">
                  <el-button link type="primary" size="small" @click="openPermView(row)">权限</el-button>
                  <el-button v-if="can('user.manage')" link type="primary" size="small" @click="openUserEdit(row)">编辑</el-button>
                  <el-button v-if="can('user.manage')" link type="danger" size="small" @click="removeUser(row)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </template>
      </main>
    </div>

    <!-- ============ 工单编辑弹窗 ============ -->
    <el-dialog v-model="ticketDialog.visible" :title="ticketDialog.mode === 'edit' ? '编辑工单' : '新建工单'" width="640px">
      <el-form label-position="top">
        <el-form-item label="工单标题 *">
          <el-input v-model="ticketDialog.form.title" placeholder="简要描述问题" />
        </el-form-item>
        <el-row :gutter="14">
          <el-col :span="8"><el-form-item label="大类（应用系统）">
            <el-select v-model="ticketDialog.form.bigCategory" style="width:100%" clearable placeholder="选择大类" @change="onBigCatChange">
              <el-option v-for="c in bigCatOptions" :key="c" :label="c" :value="c" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="8"><el-form-item label="中类">
            <el-select v-model="ticketDialog.form.midCategory" style="width:100%" clearable placeholder="选择中类" :disabled="!ticketDialog.form.bigCategory" @change="onMidCatChange">
              <el-option v-for="c in midCatOptions" :key="c" :label="c" :value="c" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="8"><el-form-item label="小类">
            <el-select v-model="ticketDialog.form.smallCategory" style="width:100%" clearable placeholder="选择小类" :disabled="!ticketDialog.form.midCategory">
              <el-option v-for="c in smallCatOptions" :key="c" :label="c" :value="c" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="优先级">
            <el-select v-model="ticketDialog.form.priority" style="width:100%">
              <el-option v-for="(v, k) in PRIORITY_TEXT" :key="k" :label="v" :value="k" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="处理组">
            <el-select v-model="ticketDialog.form.groupId" style="width:100%" clearable placeholder="留空按规则自动分派" @change="onTicketGroupChange">
              <el-option v-for="g in groups" :key="g.id" :label="g.name" :value="g.id" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="处理人">
            <el-select v-model="ticketDialog.form.assignee" style="width:100%" filterable clearable
                       placeholder="选择具体处理人（留空自动指派）" @change="onTicketAssigneeChange">
              <el-option v-for="m in assigneeOptions" :key="m.id" :label="m.name + '（' + (m.groupName || m.roleName || '') + '）'" :value="m.name" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="所属单位">
            <el-select v-model="taUnit" style="width:100%" filterable clearable placeholder="先选择单位"
                       @change="onTaUnitChange">
              <el-option v-for="u in taUnits" :key="u.unit" :label="u.unit" :value="u.unit">
                <span>{{ u.unit }}</span>
                <span style="float:right;color:#9ca3af;font-size:12px">{{ u.count }} 项资产</span>
              </el-option>
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="关联资产">
            <el-select v-model="ticketDialog.form.asset" style="width:100%" filterable clearable
                       :disabled="!taUnit" :placeholder="taUnit ? '选择该单位下的资产' : '请先选择单位'">
              <el-option v-for="a in taAssets" :key="a.value" :label="a.label" :value="a.value">
                <span>{{ a.label }}</span>
                <span style="float:right;color:#9ca3af;font-size:12px">{{ a.category }}</span>
              </el-option>
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12" v-if="ticketDialog.mode === 'create'"><el-form-item label="要求完成（天）">
            <el-input-number v-model="ticketDialog.form.dueDays" :min="1" style="width:100%" />
          </el-form-item></el-col>
        </el-row>
        <el-form-item v-if="ticketDialog.mode === 'create'" label="">
          <el-text size="small" type="info">
            {{ assigneeGroupName ? '处理人「' + ticketDialog.form.assignee + '」属于：' + assigneeGroupName : '不选处理组/处理人时，系统按「分类 + 优先级」自动分派到对应组' }}
          </el-text>
        </el-form-item>
        <el-form-item label="问题描述">
          <el-input v-model="ticketDialog.form.description" type="textarea" :rows="5" placeholder="补充详细现象、影响范围等" />
        </el-form-item>
        <el-checkbox v-model="ticketDialog.form.isCoop">标记为协作工单（需多部门配合）</el-checkbox>
      </el-form>
      <template #footer>
        <el-button @click="ticketDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveTicket">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 工单详情 ============ -->
    <el-dialog v-model="ticketDetail.visible" title="工单详情" width="680px" v-if="ticketDetail.data">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="工单编号">{{ ticketDetail.data.code }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag v-if="ticketDetail.data.overdue" type="danger" size="small">已超期</el-tag>
          <el-tag v-else :type="STATUS_TAG[ticketDetail.data.status]" size="small">{{ STATUS_TEXT[ticketDetail.data.status] }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="标题" :span="2">{{ ticketDetail.data.title }}</el-descriptions-item>
        <el-descriptions-item label="优先级"><el-tag :type="PRIORITY_TAG[ticketDetail.data.priority]" size="small" effect="plain">{{ PRIORITY_TEXT[ticketDetail.data.priority] }}</el-tag></el-descriptions-item>
        <el-descriptions-item label="分类">
          <template v-if="ticketDetail.data.bigCategory">
            {{ ticketDetail.data.bigCategory }} / {{ ticketDetail.data.midCategory }} / {{ ticketDetail.data.smallCategory }}
          </template>
          <template v-else>{{ ticketDetail.data.category }}</template>
        </el-descriptions-item>
        <el-descriptions-item label="关联资产">{{ assetLabel(ticketDetail.data.asset) }}</el-descriptions-item>
        <el-descriptions-item label="协作工单">{{ ticketDetail.data.isCoop ? '是' : '否' }}</el-descriptions-item>
        <el-descriptions-item label="创建人">{{ ticketDetail.data.creator }}</el-descriptions-item>
        <el-descriptions-item label="处理人">{{ ticketDetail.data.assignee }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ fmtDate(ticketDetail.data.createdAt, true) }}</el-descriptions-item>
        <el-descriptions-item label="截止时间">{{ fmtDate(ticketDetail.data.dueAt, true) }}</el-descriptions-item>
      </el-descriptions>

      <el-divider content-position="left">问题描述</el-divider>
      <div style="font-size:13.5px;line-height:1.8;white-space:pre-wrap">{{ ticketDetail.data.description || '—' }}</div>

      <el-divider content-position="left">流转记录（{{ ticketDetail.data.flow.length }}）</el-divider>
      <el-timeline style="padding-left:6px">
        <el-timeline-item v-for="(f, i) in ticketDetail.data.flow" :key="i"
                          :timestamp="fmtDate(f.at, true)" placement="top"
                          :type="FLOW_TAG[f.action] || 'primary'">
          <el-tag size="small" :type="FLOW_TAG[f.action] || 'primary'" effect="plain">{{ FLOW_TEXT[f.action] || f.action }}</el-tag>
          <span style="margin-left:8px;font-size:13px">
            <b>{{ f.by }}</b>
            <span v-if="f.from" style="color:#6b7280"> · {{ STATUS_TEXT[f.from] }} → {{ STATUS_TEXT[f.to] }}</span>
            <span v-else style="color:#6b7280"> · 创建工单</span>
          </span>
          <div v-if="f.note" style="font-size:12.5px;color:#6b7280;margin-top:2px">{{ f.note }}</div>
        </el-timeline-item>
      </el-timeline>

      <el-divider content-position="left">处理记录（{{ ticketDetail.data.comments.length }}）</el-divider>
      <template v-if="ticketDetail.data.comments.length">
        <div v-for="(cm, i) in ticketDetail.data.comments" :key="i" class="comment">
          <div class="meta">{{ cm.by }} · {{ fmtDate(cm.at, true) }}</div>{{ cm.content }}
        </div>
      </template>
      <div v-else class="empty" style="padding:12px">暂无处理记录</div>

      <el-input v-model="ticketDetail.comment" placeholder="填写处理进展…" style="margin-top:10px" @keyup.enter="addComment" v-if="ticketDetail.data.canComment">
        <template #append><el-button type="primary" @click="addComment">保存</el-button></template>
      </el-input>

      <template #footer>
        <span style="margin-right:auto;font-size:12.5px;color:#6b7280;align-self:center">
          当前状态：<b>{{ STATUS_TEXT[ticketDetail.data.status] }}</b>
        </span>
        <el-button v-for="a in ticketDetail.data.actions" :key="a.action"
                   :type="a.action === 'reopen' || a.action === 'reject' ? 'warning' : 'primary'"
                   @click="doTransition(a.action)">{{ a.label }}</el-button>
        <el-button v-if="ticketDetail.data.canDelete" type="danger" plain @click="removeTicket(ticketDetail.data)">删除</el-button>
        <el-button v-if="ticketDetail.data.canEdit" @click="openTicketEdit(ticketDetail.data)">编辑</el-button>
        <el-button @click="ticketDetail.visible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- ============ 资源记录 新增/编辑（动态字段） ============ -->
    <el-dialog v-model="resDialog.visible" :title="(resDialog.mode === 'edit' ? '编辑' : '新增') + ' · ' + resCat" width="720px">
      <el-form label-position="top">
        <el-row :gutter="14">
          <el-col v-for="f in resFields" :key="f.key" :span="12">
            <el-form-item :label="f.label + (f.required ? ' *' : '')">
              <el-select v-if="f.optionsSource" v-model="resDialog.form[f.key]" style="width:100%" filterable clearable
                         :placeholder="'选择' + f.label">
                <el-option v-for="o in resOpts(f)" :key="o" :label="o" :value="o" />
              </el-select>
              <el-input-number v-else-if="f.type === 'number'" v-model="resDialog.form[f.key]" :min="0" style="width:100%" />
              <el-date-picker v-else-if="f.type === 'date'" v-model="resDialog.form[f.key]" type="date"
                              value-format="YYYY-MM-DD" style="width:100%" :placeholder="'选择' + f.label" />
              <el-input v-else v-model="resDialog.form[f.key]" :placeholder="f.label" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="resDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveRes">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 资源记录 详情 ============ -->
    <el-dialog v-model="resDetail.visible" :title="'详情 · ' + resCat" width="720px" v-if="resDetail.data">
      <el-descriptions :column="2" border>
        <el-descriptions-item v-for="f in resFields" :key="f.key" :label="f.label" :span="1">
          {{ resDetail.data[f.key] || '—' }}
        </el-descriptions-item>
        <el-descriptions-item v-if="resKind === 'asset'" label="审核状态">
          <el-tag :type="ASSET_AUDIT_TAG[resDetail.data._auditStatus] || 'info'" size="small">
            {{ AUDIT_STATUS[resDetail.data._auditStatus] || resDetail.data._auditStatus }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item v-if="resKind === 'asset'" label="审核人">{{ resDetail.data._auditBy || '—' }}</el-descriptions-item>
        <el-descriptions-item label="创建人">{{ resDetail.data._createdBy || '—' }}</el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button v-if="can('asset.audit') && resDetail.data._auditStatus === 'pending'" type="success" @click="auditRes(resDetail.data, 'approve'); resDetail.visible = false">审核通过</el-button>
        <el-button v-if="can('asset.audit') && resDetail.data._auditStatus === 'pending'" type="warning" @click="auditRes(resDetail.data, 'reject'); resDetail.visible = false">驳回</el-button>
        <el-button v-if="can('asset.manage')" type="danger" plain @click="removeRes(resDetail.data)">删除</el-button>
        <el-button v-if="can('asset.manage')" @click="resDetail.visible = false; openResEdit(resDetail.data)">编辑</el-button>
        <el-button type="primary" @click="resDetail.visible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- ============ 资产编辑 ============ -->
    <el-dialog v-model="assetDialog.visible" :title="assetDialog.mode === 'edit' ? '编辑资产' : '新增资产'" width="560px">
      <el-form label-position="top">
        <el-row :gutter="14">
          <el-col :span="12"><el-form-item label="资产名称 *"><el-input v-model="assetDialog.form.name" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="资产编号"><el-input v-model="assetDialog.form.code" placeholder="留空自动生成" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="类型">
            <el-select v-model="assetDialog.form.type" style="width:100%">
              <el-option v-for="t in ASSET_TYPES" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="状态">
            <el-select v-model="assetDialog.form.status" style="width:100%">
              <el-option v-for="(v, k) in ASSET_STATUS" :key="k" :label="v" :value="k" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="资源分类">
            <el-select v-model="assetDialog.form.resCategory" style="width:100%">
              <el-option v-for="c in RES_CATEGORIES" :key="c" :label="c" :value="c" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="主机IP"><el-input v-model="assetDialog.form.ip" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="内存容量(GB)"><el-input-number v-model="assetDialog.form.memGb" :min="0" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="存储容量(GB)"><el-input-number v-model="assetDialog.form.diskGb" :min="0" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="CPU核数"><el-input-number v-model="assetDialog.form.cpuCores" :min="0" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="机房名称"><el-input v-model="assetDialog.form.room" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="单位"><el-input v-model="assetDialog.form.unit" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="责任人">
            <el-select v-model="assetDialog.form.ownerId" style="width:100%" filterable clearable placeholder="选择用户">
              <el-option v-for="u in assetOwners" :key="u.id" :label="u.name" :value="u.id">
                <span>{{ u.name }}</span>
                <span style="float:right;color:#9ca3af;font-size:12px">{{ u.username }}</span>
              </el-option>
            </el-select>
          </el-form-item></el-col>
        </el-row>
        <el-form-item label="位置"><el-input v-model="assetDialog.form.location" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="assetDialog.form.note" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="assetDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveAsset">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 资产详情 ============ -->
    <el-dialog v-model="assetDetail.visible" title="资产详情" width="600px" v-if="assetDetail.data">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="资产名称">{{ assetDetail.data.name }}</el-descriptions-item>
        <el-descriptions-item label="资产编号">{{ assetDetail.data.code }}</el-descriptions-item>
        <el-descriptions-item label="类型">{{ assetDetail.data.type }}</el-descriptions-item>
        <el-descriptions-item label="状态"><el-tag :type="ASSET_TAG[assetDetail.data.status]" size="small">{{ ASSET_STATUS[assetDetail.data.status] }}</el-tag></el-descriptions-item>
        <el-descriptions-item label="资源分类">{{ assetDetail.data.resCategory || '—' }}</el-descriptions-item>
        <el-descriptions-item label="主机IP">{{ assetDetail.data.ip }}</el-descriptions-item>
        <el-descriptions-item label="内存容量(GB)">{{ assetDetail.data.memGb || 0 }}</el-descriptions-item>
        <el-descriptions-item label="存储容量(GB)">{{ assetDetail.data.diskGb || 0 }}</el-descriptions-item>
        <el-descriptions-item label="CPU核数">{{ assetDetail.data.cpuCores || 0 }}</el-descriptions-item>
        <el-descriptions-item label="机房名称">{{ assetDetail.data.room || '—' }}</el-descriptions-item>
        <el-descriptions-item label="单位">{{ assetDetail.data.unit || '—' }}</el-descriptions-item>
        <el-descriptions-item label="审核状态"><el-tag :type="ASSET_AUDIT_TAG[assetDetail.data.auditStatus] || 'info'" size="small">{{ AUDIT_STATUS[assetDetail.data.auditStatus] || assetDetail.data.auditStatus }}</el-tag></el-descriptions-item>
        <el-descriptions-item label="审核人">{{ assetDetail.data.auditBy || '—' }}</el-descriptions-item>
        <el-descriptions-item label="位置">{{ assetDetail.data.location }}</el-descriptions-item>
        <el-descriptions-item label="责任人">{{ assetDetail.data.ownerName || assetDetail.data.owner }}</el-descriptions-item>
        <el-descriptions-item label="购置日期">{{ fmtDate(assetDetail.data.purchaseDate) }}</el-descriptions-item>
        <el-descriptions-item label="备注" :span="2">{{ assetDetail.data.note || '—' }}</el-descriptions-item>
      </el-descriptions>
      <el-divider content-position="left">
        已装软件（{{ assetSoftware.length }}）
        <el-button v-if="can('asset.manage')" link type="primary" size="small" style="margin-left:8px" @click="openSwCreate">+ 新增软件</el-button>
      </el-divider>
      <el-table v-if="assetSoftware.length" :data="assetSoftware" size="small" stripe style="width:100%">
        <el-table-column prop="name" label="软件名称" min-width="150" />
        <el-table-column prop="version" label="版本" width="110" />
        <el-table-column prop="vendor" label="厂商" min-width="110" />
        <el-table-column prop="category" label="类别" width="90" />
        <el-table-column v-if="can('asset.manage')" label="操作" width="120">
          <template #default="scope">
            <el-button size="small" @click="openSwEdit(scope.row)">编辑</el-button>
            <el-button size="small" type="danger" @click="removeSoftware(scope.row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="empty" style="padding:10px">暂无软件记录</div>

      <el-divider content-position="left">关联工单（{{ relatedTickets.length }}）</el-divider>
      <template v-if="relatedTickets.length">
        <div v-for="t in relatedTickets" :key="t.id" class="mini-row" style="padding-left:0;padding-right:0" @click="assetDetail.visible = false; openTicketDetail(t)">
          <span class="t">{{ t.title }}</span>
          <el-tag :type="STATUS_TAG[t.status]" size="small">{{ STATUS_TEXT[t.status] }}</el-tag>
        </div>
      </template>
      <div v-else class="empty" style="padding:10px">暂无关联工单</div>
      <template #footer>
        <el-button type="danger" plain @click="removeAsset(assetDetail.data)">删除</el-button>
        <el-button @click="openAssetEdit(assetDetail.data)">编辑</el-button>
        <el-button type="primary" @click="assetDetail.visible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- ============ 软件新增/编辑 ============ -->
    <el-dialog v-model="swDialog.visible" :title="swDialog.mode === 'edit' ? '编辑软件' : '新增软件'" width="520px">
      <el-form label-position="top">
        <el-row :gutter="14">
          <el-col :span="12"><el-form-item label="软件名称 *"><el-input v-model="swDialog.form.name" placeholder="如：Nginx" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="版本"><el-input v-model="swDialog.form.version" placeholder="如：1.24.0" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="厂商"><el-input v-model="swDialog.form.vendor" placeholder="如：F5" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="类别">
            <el-select v-model="swDialog.form.category" style="width:100%">
              <el-option v-for="c in SOFTWARE_CATEGORIES" :key="c" :label="c" :value="c" />
            </el-select>
          </el-form-item></el-col>
        </el-row>
        <el-form-item label="安装路径"><el-input v-model="swDialog.form.installPath" placeholder="可选" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="swDialog.form.note" placeholder="可选" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="swDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveSoftware">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 知识编辑 ============ -->
    <el-dialog v-model="kbDialog.visible" :title="kbDialog.mode === 'edit' ? '编辑文档' : '新建文档'" width="640px">
      <el-form label-position="top">
        <el-form-item label="标题 *"><el-input v-model="kbDialog.form.title" /></el-form-item>
        <el-row :gutter="14">
          <el-col :span="12"><el-form-item label="分类">
            <el-select v-model="kbDialog.form.category" style="width:100%">
              <el-option v-for="c in kbCategoryNames" :key="c" :label="c" :value="c" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="标签（逗号分隔）"><el-input v-model="kbDialog.form.tags" placeholder="如：VPN,远程办公" /></el-form-item></el-col>
        </el-row>
        <el-form-item label="正文">
          <el-input v-model="kbDialog.form.content" type="textarea" :rows="10" placeholder="支持纯文本 / Markdown" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="kbDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveKB">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 部门管理 ============ -->
    <el-dialog v-model="deptManage.visible" title="部门管理" width="700px">
      <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
        <el-button type="primary" size="small" @click="openDeptCreate"><el-icon><Plus /></el-icon>&nbsp;新增部门</el-button>
      </div>
      <el-table :data="departments" size="small" stripe style="width:100%">
        <el-table-column prop="name" label="部门名称" min-width="140" />
        <el-table-column prop="desc" label="说明" min-width="160" show-overflow-tooltip />
        <el-table-column prop="sort" label="排序" width="70" />
        <el-table-column prop="userCount" label="人数" width="70" />
        <el-table-column label="操作" width="130">
          <template #default="scope">
            <el-button size="small" @click="openDeptEdit(scope.row)">编辑</el-button>
            <el-button size="small" type="danger" @click="removeDept(scope.row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="!departments.length" class="empty">暂无部门</div>
      <template #footer>
        <el-button type="primary" @click="deptManage.visible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- ============ 部门新增/编辑 ============ -->
    <el-dialog v-model="deptDialog.visible" :title="deptDialog.mode === 'edit' ? '编辑部门' : '新增部门'" width="480px">
      <el-form label-position="top">
        <el-form-item label="部门名称 *"><el-input v-model="deptDialog.form.name" placeholder="如：信息中心" /></el-form-item>
        <el-form-item label="说明"><el-input v-model="deptDialog.form.desc" placeholder="可选" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="deptDialog.form.sort" :min="0" :max="999" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="deptDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveDept">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 知识库分类管理 ============ -->
    <el-dialog v-model="kbCatManage.visible" title="知识库分类管理" width="700px">
      <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
        <el-button type="primary" size="small" @click="openKbCategoryCreate"><el-icon><Plus /></el-icon>&nbsp;新增分类</el-button>
      </div>
      <el-table :data="kbCategories" size="small" stripe style="width:100%">
        <el-table-column prop="name" label="分类名称" min-width="140" />
        <el-table-column prop="desc" label="说明" min-width="160" show-overflow-tooltip />
        <el-table-column prop="sort" label="排序" width="70" />
        <el-table-column prop="docCount" label="文档数" width="80" />
        <el-table-column label="操作" width="130">
          <template #default="scope">
            <el-button size="small" @click="openKbCategoryEdit(scope.row)">编辑</el-button>
            <el-button size="small" type="danger" @click="removeKbCategory(scope.row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="!kbCategories.length" class="empty">暂无分类</div>
      <template #footer>
        <el-button type="primary" @click="kbCatManage.visible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- ============ 分类新增/编辑 ============ -->
    <el-dialog v-model="kbCatDialog.visible" :title="kbCatDialog.mode === 'edit' ? '编辑分类' : '新增分类'" width="480px">
      <el-form label-position="top">
        <el-form-item label="分类名称 *"><el-input v-model="kbCatDialog.form.name" placeholder="如：应急预案" /></el-form-item>
        <el-form-item label="说明"><el-input v-model="kbCatDialog.form.desc" placeholder="可选" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="kbCatDialog.form.sort" :min="0" :max="999" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="kbCatDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveKbCategory">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 知识详情 ============ -->
    <el-dialog v-model="kbDetail.visible" :title="kbDetail.data ? kbDetail.data.title : ''" width="720px" v-if="kbDetail.data">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
        <el-tag size="small" type="primary" effect="plain">{{ kbDetail.data.category }}</el-tag>
        <el-tag v-for="t in kbDetail.data.tags" :key="t" size="small" type="info" effect="plain">{{ t }}</el-tag>
        <span style="margin-left:auto;font-size:12px;color:#6b7280">
          {{ kbDetail.data.author }} · 更新于 {{ fmtDate(kbDetail.data.updatedAt) }} · 浏览 {{ kbDetail.data.views }}
        </span>
      </div>
      <div class="kb-content">{{ kbDetail.data.content }}</div>
      <template #footer>
        <el-button type="danger" plain @click="removeKB(kbDetail.data)">删除</el-button>
        <el-button @click="openKBEdit(kbDetail.data)">编辑</el-button>
        <el-button type="primary" @click="kbDetail.visible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- ============ 修改密码 ============ -->
    <el-dialog v-model="pwdDialog.visible" title="修改密码" width="440px">
      <el-form label-width="90px" @submit.prevent>
        <el-form-item label="原密码">
          <el-input v-model="pwdDialog.oldPassword" type="password" show-password placeholder="请输入当前密码" />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="pwdDialog.newPassword" type="password" show-password placeholder="至少 6 位" />
        </el-form-item>
        <el-form-item label="确认密码">
          <el-input v-model="pwdDialog.confirmPassword" type="password" show-password placeholder="再次输入新密码" />
        </el-form-item>
      </el-form>
      <el-alert type="info" :closable="false" show-icon
                title="修改后其他设备需重新登录，当前会话保持有效" style="margin-top:4px" />
      <template #footer>
        <el-button @click="pwdDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="pwdDialog.loading" @click="submitPwdChange">确定</el-button>
      </template>
    </el-dialog>

    <!-- ============ 用户编辑 ============ -->
    <el-dialog v-model="userDialog.visible" :title="userDialog.mode === 'edit' ? '编辑用户' : '新建用户'" width="560px">
      <el-form label-position="top">
        <el-row :gutter="14">
          <el-col :span="12"><el-form-item label="账号 *"><el-input v-model="userDialog.form.username" :disabled="userDialog.mode === 'edit'" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="姓名 *"><el-input v-model="userDialog.form.name" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item :label="userDialog.mode === 'edit' ? '重置密码（留空不改）' : '初始密码'">
            <el-input v-model="userDialog.form.pwd" type="password" show-password placeholder="默认 123456" />
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="角色">
            <el-select v-model="userDialog.form.role" style="width:100%">
              <el-option v-for="r in roles" :key="r.key" :label="r.name" :value="r.key" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="所属组">
            <el-select v-model="userDialog.form.groupId" style="width:100%" placeholder="请选择所属组">
              <el-option v-for="g in groups" :key="g.id" :label="g.name" :value="g.id" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="所属单位">
            <el-select v-model="userDialog.form.org" style="width:100%" filterable clearable placeholder="从供应商中选择"
                       @change="onUserOrgChange">
              <el-option v-for="s in suppliers" :key="s.id" :label="s.name" :value="s.name">
                <span>{{ s.name }}</span>
                <span style="float:right;color:#9ca3af;font-size:12px">{{ s.shortName }}</span>
              </el-option>
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="部门">
            <el-select v-model="userDialog.form.dept" style="width:100%" filterable clearable placeholder="请选择部门">
              <el-option v-for="d in departments" :key="d.id" :label="d.name" :value="d.name" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="联系方式"><el-input v-model="userDialog.form.phone" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="状态">
            <el-switch v-model="userDialog.form.active" active-text="启用" inactive-text="停用" />
          </el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="userDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveUser">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 角色管理 ============ -->
    <el-dialog v-model="roleManage.visible" title="角色管理" width="760px">
      <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
        <el-button type="primary" size="small" @click="openRoleCreate"><el-icon><Plus /></el-icon>&nbsp;新增角色</el-button>
      </div>
      <el-table :data="roles" size="small" stripe style="width:100%">
        <el-table-column prop="name" label="角色名称" min-width="120" />
        <el-table-column prop="key" label="标识" width="90" />
        <el-table-column prop="group" label="默认分组" min-width="110" />
        <el-table-column label="权限数" width="80">
          <template #default="scope">{{ scope.row.perms.length }}</template>
        </el-table-column>
        <el-table-column label="类型" width="70">
          <template #default="scope">
            <el-tag v-if="scope.row.builtin" size="small" type="info">内置</el-tag>
            <el-tag v-else size="small" type="success">自定义</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180">
          <template #default="scope">
            <el-button size="small" @click="openRoleEdit(scope.row)">编辑</el-button>
            <el-button size="small" @click="openPermView({ roleName: scope.row.name, perms: scope.row.perms })">查看</el-button>
            <el-button size="small" type="danger" :disabled="scope.row.key === 'admin'" @click="removeRole(scope.row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button type="primary" @click="roleManage.visible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- ============ 角色新增/编辑 ============ -->
    <el-dialog v-model="roleDialog.visible" :title="roleDialog.mode === 'edit' ? '编辑角色' : '新增角色'" width="640px">
      <el-form label-position="top">
        <el-row :gutter="14">
          <el-col :span="12"><el-form-item label="角色名称 *"><el-input v-model="roleDialog.form.name" placeholder="如：值班主管" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="角色标识 *">
            <el-input v-model="roleDialog.form.key" :disabled="roleDialog.mode === 'edit'" placeholder="如：duty（字母开头）" />
          </el-form-item></el-col>
        </el-row>
        <el-row :gutter="14">
          <el-col :span="12"><el-form-item label="默认分组">
            <el-select v-model="roleDialog.form.group" style="width:100%" clearable placeholder="可选">
              <el-option v-for="g in groups" :key="g.id" :label="g.name" :value="g.name" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="说明"><el-input v-model="roleDialog.form.desc" placeholder="可选" /></el-form-item></el-col>
        </el-row>
        <el-form-item label="权限">
          <el-alert v-if="roleDialog.form.builtin && roleDialog.form.key === 'admin'" type="warning" :closable="false"
                    title="管理员角色拥有全部权限，不可修改" style="margin-bottom:10px" />
          <div class="perm-picker">
            <el-checkbox-group v-model="roleDialog.form.perms" :disabled="roleDialog.form.key === 'admin'">
              <el-checkbox v-for="o in permOptions" :key="o.key" :label="o.key">{{ o.label }}</el-checkbox>
            </el-checkbox-group>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="roleDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveRole">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 权限查看 ============ -->
    <el-dialog v-model="permDialog.visible" :title="'权限明细 · ' + (permDialog.role ? permDialog.role.roleName : '')" width="620px">
      <div v-if="permDialog.role" style="display:flex;flex-wrap:wrap;gap:8px">
        <el-tag v-for="p in permDialog.role.perms" :key="p" effect="plain" type="primary">{{ permLabel(p) }}</el-tag>
      </div>
      <template #footer>
        <el-button type="primary" @click="permDialog.visible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- ============ 工单转派（层级链） ============ -->
    <el-dialog v-model="transferDialog.visible" title="工单转派" width="560px">
      <el-alert v-if="ticketDetail.data" type="info" :closable="false" show-icon style="margin-bottom:14px"
                :title="'当前：' + ticketDetail.data.groupName + ' · ' + ticketDetail.data.assignee" />
      <el-alert v-if="transferDialog.any" type="warning" :closable="false" show-icon style="margin-bottom:14px"
                title="管理员不受转派链限制，可转派给任意人员" />
      <el-form label-position="top">
        <el-form-item label="转派对象 *">
          <el-select v-model="transferDialog.toAssignee" style="width:100%" :loading="transferDialog.loading"
                     placeholder="选择转派对象" :disabled="!transferDialog.targets.length">
            <el-option v-for="t in transferDialog.targets" :key="t.groupId + '-' + t.assignee" :label="t.label" :value="t.assignee" />
          </el-select>
          <div v-if="!transferDialog.loading && !transferDialog.targets.length" style="font-size:12.5px;color:#dc2626;margin-top:6px">
            当前没有可转派的目标（请确认你所属组的组长设置）
          </div>
          <div v-else style="font-size:12px;color:#9ca3af;margin-top:6px">
            转派流程：一线组员 → 一线组长 → 二线组长 → 二线组员（二线组员可退回二线组长）
          </div>
        </el-form-item>
        <el-form-item label="转派原因">
          <el-input v-model="transferDialog.note" type="textarea" :rows="3" placeholder="如：需二线排查核心交换机" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="transferDialog.visible = false">取消</el-button>
        <el-button type="primary" :disabled="!transferDialog.targets.length" @click="submitTransfer">确认转派</el-button>
      </template>
    </el-dialog>

    <!-- ============ 集群接入/编辑 ============ -->
    <el-dialog v-model="clusterDialog.visible" :title="clusterDialog.mode === 'edit' ? '编辑集群' : '接入集群'" width="560px">
      <el-form label-position="top">
        <el-row :gutter="14">
          <el-col :span="12"><el-form-item label="集群名称 *"><el-input v-model="clusterDialog.form.name" placeholder="如：生产集群-北京" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="集群标识 *">
            <el-input v-model="clusterDialog.form.code" :disabled="clusterDialog.mode === 'edit'" placeholder="如：prod-bj" />
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="环境">
            <el-select v-model="clusterDialog.form.env" style="width:100%">
              <el-option label="生产 prod" value="prod" />
              <el-option label="测试 test" value="test" />
              <el-option label="灾备 dr" value="dr" />
              <el-option label="开发 dev" value="dev" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="地域"><el-input v-model="clusterDialog.form.region" placeholder="如：北京" /></el-form-item></el-col>
        </el-row>
        <el-form-item label="备注"><el-input v-model="clusterDialog.form.note" type="textarea" :rows="2" /></el-form-item>
        <el-form-item v-if="clusterDialog.mode === 'edit'" label="Agent Token">
          <el-input :model-value="clusterDialog.form.agentToken" readonly>
            <template #append><el-button @click="copyText(clusterDialog.form.agentToken)">复制</el-button></template>
          </el-input>
        </el-form-item>
        <el-alert v-if="clusterDialog.mode === 'edit'" type="info" :closable="false" show-icon
                  title="Agent 接入信息"
                  :description="'在集群内 agent 配置：clusterCode = ' + clusterDialog.form.code + '，token = ' + clusterDialog.form.agentToken + '，上报地址 POST /api/agent/report'" />
      </el-form>
      <template #footer>
        <el-button @click="clusterDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveCluster">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ Agent 一键安装 ============ -->
    <el-dialog v-model="installDialog.visible" :title="installDialog.cluster ? ('安装 Agent · ' + installDialog.cluster.name) : '安装 Agent'" width="820px">
      <el-alert type="success" :closable="false" show-icon style="margin-bottom:14px"
                title="一键接入（两种方式）"
                description="K8s 集群：用「一键命令」在集群内跑，自动部署 CronJob。openEuler/裸机/离线环境：用「裸机安装」在任一可访问集群的机器上跑，systemd 常驻采集，无需容器镜像。" />
      <el-tabs v-model="installDialog.tab">
        <el-tab-pane label="一键命令（推荐）" name="onekey">
          <div class="install-block">
            <pre class="install-pre">{{ installDialog.oneLiner || '加载中…' }}</pre>
            <el-button type="primary" size="small" @click="copyText(installDialog.oneLiner)">复制命令</el-button>
          </div>
          <div class="install-hint">
            该命令会下载安装脚本并执行：创建命名空间、写入采集脚本、配置只读 RBAC、部署每分钟采集的 CronJob，并立即跑一次验证。
          </div>
        </el-tab-pane>
        <el-tab-pane label="裸机安装（openEuler/离线）" name="bare">
          <div class="install-block">
            <pre class="install-pre">{{ installDialog.bareOneLiner || '加载中…' }}</pre>
            <el-button type="primary" size="small" @click="copyText(installDialog.bareOneLiner)">复制命令</el-button>
          </div>
          <div class="install-hint">
            在<strong>任一可访问 K8s 集群的机器</strong>（openEuler / CentOS / RHEL / Kylin / UOS）上以 root 执行。<br/>
            脚本会：检查 kubectl/jq/curl → 安装采集脚本到 <code>/opt/aiops-agent</code> → 注册 systemd timer（每分钟采集）→ 立即执行一次验证。<br/>
            不依赖任何容器镜像，适合内网/信创/离线环境。卸载：<code>bash install.sh uninstall</code>
          </div>
          <el-divider style="margin:12px 0">完整裸机脚本</el-divider>
          <div class="install-block">
            <pre class="install-pre" style="max-height:200px">{{ installDialog.bareMetalScript }}</pre>
            <el-button size="small" @click="copyText(installDialog.bareMetalScript)">复制裸机脚本</el-button>
          </div>
        </el-tab-pane>
        <el-tab-pane label="完整脚本（K8s CronJob）" name="script">
          <div class="install-block">
            <pre class="install-pre">{{ installDialog.installScript }}</pre>
            <el-button type="primary" size="small" @click="copyText(installDialog.installScript)">复制脚本</el-button>
          </div>
          <div class="install-hint">保存为 install.sh 后执行：<code>bash install.sh</code></div>
        </el-tab-pane>
        <el-tab-pane label="K8s 清单" name="manifest">
          <div class="install-block">
            <pre class="install-pre">{{ installDialog.manifest }}</pre>
            <el-button type="primary" size="small" @click="copyText(installDialog.manifest)">复制清单</el-button>
          </div>
          <div class="install-hint">保存为 agent.yaml 后执行：<code>kubectl apply -f agent.yaml</code></div>
        </el-tab-pane>
        <el-tab-pane label="采集脚本" name="agent">
          <div class="install-block">
            <pre class="install-pre">{{ installDialog.agentScript }}</pre>
            <el-button type="primary" size="small" @click="copyText(installDialog.agentScript)">复制采集脚本</el-button>
          </div>
          <div class="install-hint">仅采集脚本本体（已内置集群标识与 Token），适合自行包装部署。</div>
        </el-tab-pane>
      </el-tabs>
      <el-descriptions :column="3" border size="small" style="margin-top:12px">
        <el-descriptions-item label="集群标识">{{ installDialog.cluster ? installDialog.cluster.code : '' }}</el-descriptions-item>
        <el-descriptions-item label="上报地址">{{ installDialog.platform }}/api/agent/report</el-descriptions-item>
        <el-descriptions-item label="采集频率">每 1 分钟</el-descriptions-item>
        <el-descriptions-item label="裸机上报地址">{{ installDialog.platform }}/api/agent/report</el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button type="primary" @click="installDialog.visible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- ============ 集群 Pod 查看 ============ -->
    <el-dialog v-model="clusterPodsDialog.visible" :title="clusterPodsDialog.cluster ? ('Pod 列表 · ' + clusterPodsDialog.cluster.name) : 'Pod 列表'" width="900px">
      <div style="margin-bottom:12px;font-size:13px;color:#6b7280">
        共 <b>{{ clusterPodsDialog.list.length }}</b> 个 Pod ·
        异常 <b style="color:#dc2626">{{ clusterPodsDialog.list.filter(p => POD_ABNORMAL.includes(p.status)).length }}</b> 个
        <span v-if="clusterPodsDialog.loading" style="margin-left:10px">加载中…</span>
      </div>
      <div class="table-wrap" style="max-height:60vh;overflow:auto">
        <el-table :data="clusterPodsDialog.list" style="width:100%" size="small" stripe>
          <el-table-column prop="namespace" label="命名空间" width="140" />
          <el-table-column prop="name" label="Pod" min-width="200" show-overflow-tooltip />
          <el-table-column label="状态" width="150">
            <template #default="{ row }">
              <el-tag size="small" :type="POD_STATUS_TAG[row.status] || 'info'">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="ready" label="就绪" width="75" />
          <el-table-column label="重启" width="80">
            <template #default="{ row }">
              <span :style="{ color: row.restarts > 5 ? '#dc2626' : (row.restarts > 0 ? '#f59e0b' : '#6b7280') }">{{ row.restarts }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="node" label="所在节点" width="140" />
          <el-table-column prop="reason" label="原因" width="150" show-overflow-tooltip />
        </el-table>
        <div v-if="!clusterPodsDialog.list.length && !clusterPodsDialog.loading" class="empty">该集群暂无 Pod 数据（agent 上报后显示）</div>
      </div>
      <template #footer>
        <el-button type="primary" @click="clusterPodsDialog.visible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- ============ 组件状态 ============ -->
    <el-dialog v-model="componentsDialog.visible" :title="componentsDialog.cluster ? ('组件状态 · ' + componentsDialog.cluster.name) : '组件状态'" width="720px">
      <div class="table-wrap">
        <el-table :data="components" style="width:100%" size="small" stripe>
          <el-table-column prop="name" label="组件" min-width="170" />
          <el-table-column prop="category" label="类型" width="130" />
          <el-table-column label="状态" width="120">
            <template #default="{ row }">
              <el-tag :type="compTagType(row.status)" size="small">{{ compStatusText(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="message" label="说明" min-width="200" show-overflow-tooltip />
        </el-table>
      </div>
      <template #footer>
        <el-button type="primary" @click="componentsDialog.visible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- ============ 节点详情 ============ -->
    <el-dialog v-model="nodeDialog.visible" :title="nodeDialog.node ? ('节点详情 · ' + nodeDialog.node.name) : '节点详情'" width="760px">
      <template v-if="nodeDialog.node">
        <el-descriptions :column="3" border size="small">
          <el-descriptions-item label="集群">{{ nodeDialog.node.clusterName }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag size="small" :type="NODE_STATUS_TAG[nodeDialog.node.status] || 'info'">{{ nodeDialog.node.status }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="角色">{{ nodeDialog.node.role === 'master' ? '控制面' : '工作节点' }}</el-descriptions-item>
          <el-descriptions-item label="IP">{{ nodeDialog.node.ip }}</el-descriptions-item>
          <el-descriptions-item label="kubelet">{{ nodeDialog.node.kubeletVersion }}</el-descriptions-item>
          <el-descriptions-item label="系统">{{ nodeDialog.node.os }}</el-descriptions-item>
          <el-descriptions-item label="CPU 核数">{{ nodeDialog.node.cpuCores }}</el-descriptions-item>
          <el-descriptions-item label="内存">{{ (nodeDialog.node.memTotalMb / 1024).toFixed(0) }} GB</el-descriptions-item>
          <el-descriptions-item label="Pod 数">{{ nodeDialog.node.podCount }}</el-descriptions-item>
        </el-descriptions>

        <div class="node-gauges">
          <div class="ng">
            <el-progress type="dashboard" :percentage="Math.min(100, Number(nodeDialog.node.cpuUsage))" :color="barColor(nodeDialog.node.cpuUsage)" :width="120" />
            <div class="ng-k">CPU 使用率</div>
          </div>
          <div class="ng">
            <el-progress type="dashboard" :percentage="Math.min(100, Number(nodeDialog.node.memUsage))" :color="barColor(nodeDialog.node.memUsage)" :width="120" />
            <div class="ng-k">内存使用率</div>
          </div>
          <div class="ng">
            <el-progress type="dashboard" :percentage="Math.min(100, Number(nodeDialog.node.diskUsage))" :color="barColor(nodeDialog.node.diskUsage)" :width="120" />
            <div class="ng-k">磁盘使用率</div>
          </div>
        </div>

        <el-divider content-position="left">指标趋势（最近 {{ nodeMetrics.length }} 个采样点）</el-divider>
        <div v-if="nodeMetrics.length" class="metrics-chart">
          <svg viewBox="0 0 600 160" preserveAspectRatio="none">
            <polyline :points="metricLine('cpuUsage', 600, 160)" fill="none" stroke="#2563eb" stroke-width="2" />
            <polyline :points="metricLine('memUsage', 600, 160)" fill="none" stroke="#16a34a" stroke-width="2" />
            <polyline :points="metricLine('diskUsage', 600, 160)" fill="none" stroke="#f59e0b" stroke-width="2" />
          </svg>
          <div class="chart-legend">
            <span><i style="background:#2563eb"></i>CPU</span>
            <span><i style="background:#16a34a"></i>内存</span>
            <span><i style="background:#f59e0b"></i>磁盘</span>
          </div>
        </div>
        <div v-else class="empty" style="padding:14px">暂无时序数据（agent 上报后生成）</div>

        <div v-if="nodeDialog.node.conditions && nodeDialog.node.conditions.length" style="margin-top:12px">
          <div style="font-size:13px;color:#6b7280;margin-bottom:6px">节点 Conditions</div>
          <el-tag v-for="c in nodeDialog.node.conditions" :key="c" size="small" type="danger" effect="plain" style="margin-right:6px">{{ c }}</el-tag>
        </div>
      </template>
      <template #footer>
        <el-button type="primary" @click="nodeDialog.visible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- ============ 通知渠道编辑 ============ -->
    <el-dialog v-model="notifyDialog.visible" :title="notifyDialog.mode === 'edit' ? '编辑通知渠道' : '新建通知渠道'" width="640px">
      <el-form label-position="top">
        <el-row :gutter="14">
          <el-col :span="12"><el-form-item label="渠道名称 *"><el-input v-model="notifyDialog.form.name" placeholder="如：企业微信-运维群" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="渠道类型">
            <el-select v-model="notifyDialog.form.type" style="width:100%" @change="onNotifyTypeChange">
              <el-option label="企业微信机器人" value="wecom" />
              <el-option label="钉钉机器人" value="dingtalk" />
              <el-option label="邮件 SMTP" value="email" />
            </el-select>
          </el-form-item></el-col>
        </el-row>

        <template v-if="notifyDialog.form.type === 'wecom'">
          <el-form-item label="Webhook 地址 *">
            <el-input v-model="notifyDialog.form.config.webhook" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx" />
          </el-form-item>
          <el-alert type="info" :closable="false" show-icon title="企业微信群机器人：群设置 → 群机器人 → 添加 → 复制 Webhook 地址" />
        </template>

        <template v-else-if="notifyDialog.form.type === 'dingtalk'">
          <el-form-item label="Webhook 地址 *">
            <el-input v-model="notifyDialog.form.config.webhook" placeholder="https://oapi.dingtalk.com/robot/send?access_token=xxx" />
          </el-form-item>
          <el-form-item label="加签密钥（可选，安全设置选“加签”时填写）">
            <el-input v-model="notifyDialog.form.config.secret" placeholder="SECxxxxxx" />
          </el-form-item>
          <el-alert type="info" :closable="false" show-icon title="钉钉群机器人：群设置 → 智能群助手 → 添加机器人 → 自定义 → 复制 Webhook" />
        </template>

        <template v-else>
          <el-row :gutter="14">
            <el-col :span="12"><el-form-item label="SMTP 服务器 *"><el-input v-model="notifyDialog.form.config.host" placeholder="smtp.example.com" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item label="端口"><el-input-number v-model="notifyDialog.form.config.port" :min="1" style="width:100%" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item label="加密">
              <el-select v-model="notifyDialog.form.config.secure" style="width:100%">
                <el-option label="SSL/TLS" :value="true" />
                <el-option label="明文" :value="false" />
              </el-select>
            </el-form-item></el-col>
            <el-col :span="12"><el-form-item label="账号"><el-input v-model="notifyDialog.form.config.user" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="密码/授权码"><el-input v-model="notifyDialog.form.config.pass" type="password" show-password /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="发件人地址 *"><el-input v-model="notifyDialog.form.config.from" placeholder="aiops@example.com" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="收件人 *"><el-input v-model="notifyDialog.form.config.to" placeholder="ops@example.com（多个用逗号分隔）" /></el-form-item></el-col>
          </el-row>
        </template>

        <el-divider content-position="left">通知策略</el-divider>
        <el-row :gutter="14">
          <el-col :span="8"><el-form-item label="最低告警级别">
            <el-select v-model="notifyDialog.form.minSeverity" style="width:100%">
              <el-option v-for="(v, k) in SEVERITY_TEXT" :key="k" :label="v" :value="k" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="8"><el-form-item label="告警触发时通知"><el-switch v-model="notifyDialog.form.onFire" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="告警恢复时通知"><el-switch v-model="notifyDialog.form.onResolve" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="14">
          <el-col :span="12"><el-form-item label="启用"><el-switch v-model="notifyDialog.form.enabled" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="备注"><el-input v-model="notifyDialog.form.note" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="notifyDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveNotify">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 异常明细（KPI 点击） ============ -->
    <el-dialog v-model="issuesDialog.visible" :title="issuesDialog.title" width="760px">
      <div class="table-wrap">
        <el-table :data="issuesDialog.items" style="width:100%" size="small" stripe>
          <el-table-column prop="cluster" label="集群" width="150" />
          <el-table-column prop="target" label="对象" min-width="180" show-overflow-tooltip />
          <el-table-column prop="detail" label="详情" min-width="240" show-overflow-tooltip />
        </el-table>
        <div v-if="!issuesDialog.items.length" class="empty">暂无异常项 🎉</div>
      </div>
      <template #footer>
        <el-button type="primary" @click="issuesDialog.visible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- ============ 告警规则编辑 ============ -->
    <el-dialog v-model="alertRuleDialog.visible" :title="alertRuleDialog.mode === 'edit' ? '编辑告警规则' : '新建告警规则'" width="640px">
      <el-form label-position="top">
        <el-form-item label="规则名称 *"><el-input v-model="alertRuleDialog.form.name" placeholder="如：节点 CPU 使用率过高" /></el-form-item>
        <el-row :gutter="14">
          <el-col :span="12"><el-form-item label="监控指标">
            <el-select v-model="alertRuleDialog.form.metric" style="width:100%">
              <el-option v-for="m in METRIC_OPTIONS" :key="m.value" :label="m.label" :value="m.value" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="级别">
            <el-select v-model="alertRuleDialog.form.severity" style="width:100%">
              <el-option v-for="(v, k) in SEVERITY_TEXT" :key="k" :label="v" :value="k" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="运算符">
            <el-select v-model="alertRuleDialog.form.operator" style="width:100%">
              <el-option label="大于 >" value=">" />
              <el-option label="大于等于 >=" value=">=" />
              <el-option label="小于 <" value="<" />
              <el-option label="小于等于 <=" value="<=" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="阈值">
            <el-input-number v-model="alertRuleDialog.form.threshold" :min="0" style="width:100%" />
          </el-form-item></el-col>
        </el-row>
        <el-divider content-position="left">自动建单（事件分类）</el-divider>
        <el-row :gutter="14">
          <el-col :span="8"><el-form-item label="大类">
            <el-select v-model="alertRuleDialog.form.category" style="width:100%">
              <el-option v-for="c in bigCatOptions" :key="c" :label="c" :value="c" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="8"><el-form-item label="中类">
            <el-select v-model="alertRuleDialog.form.midCategory" style="width:100%">
              <el-option label="软件" value="软件" />
              <el-option label="硬件" value="硬件" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="8"><el-form-item label="小类">
            <el-select v-model="alertRuleDialog.form.smallCategory" style="width:100%" filterable allow-create>
              <el-option v-for="c in ruleSmallCatOptions" :key="c" :label="c" :value="c" />
            </el-select>
          </el-form-item></el-col>
        </el-row>
        <el-row :gutter="14">
          <el-col :span="12"><el-form-item label="启用">
            <el-switch v-model="alertRuleDialog.form.enabled" />
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="自动建单">
            <el-switch v-model="alertRuleDialog.form.autoTicket" />
          </el-form-item></el-col>
        </el-row>
        <el-form-item label="说明"><el-input v-model="alertRuleDialog.form.note" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="alertRuleDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveAlertRule">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 分组编辑 ============ -->
    <el-dialog v-model="groupDialog.visible" :title="groupDialog.mode === 'edit' ? '编辑分组' : '新建分组'" width="520px">
      <el-form label-position="top">
        <el-form-item label="组名 *"><el-input v-model="groupDialog.form.name" placeholder="如：网络运维组" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="groupDialog.form.desc" type="textarea" :rows="2" /></el-form-item>
        <el-row :gutter="14">
          <el-col :span="12"><el-form-item label="层级（转派链）">
            <el-select v-model="groupDialog.form.tier" style="width:100%">
              <el-option label="无（不参与转派链）" :value="0" />
              <el-option label="一线（组员 → 组长）" :value="1" />
              <el-option label="二线（组长 → 组员）" :value="2" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="组长">
            <el-select v-model="groupDialog.form.leader" style="width:100%" clearable placeholder="选择组长">
              <el-option v-for="u in users" :key="u.id" :label="u.name" :value="u.name" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="标识色">
            <el-color-picker v-model="groupDialog.form.color" />
          </el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="groupDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveGroup">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 转派规则编辑 ============ -->
    <el-dialog v-model="ruleDialog.visible" :title="ruleDialog.mode === 'edit' ? '编辑转派规则' : '新建转派规则'" width="520px">
      <el-form label-position="top">
        <el-row :gutter="14">
          <el-col :span="12"><el-form-item label="事件分类 *">
            <el-select v-model="ruleDialog.form.category" style="width:100%">
              <el-option v-for="c in CATEGORIES" :key="c" :label="c" :value="c" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="处理组 *">
            <el-select v-model="ruleDialog.form.groupId" style="width:100%" placeholder="选择处理组">
              <el-option v-for="g in groups" :key="g.id" :label="g.name" :value="g.id" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="优先级">
            <el-select v-model="ruleDialog.form.priority" style="width:100%">
              <el-option v-for="(v, k) in PRIORITY_TEXT" :key="k" :label="v" :value="k" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="说明"><el-input v-model="ruleDialog.form.note" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="ruleDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveRule">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 事件分类编辑 ============ -->
    <el-dialog v-model="tcDialog.visible" :title="(tcDialog.mode === 'edit' ? '编辑' : '新增') + (tcDialog.form.level === 1 ? '大类' : tcDialog.form.level === 2 ? '中类' : '小类')" width="480px">
      <el-form label-position="top">
        <el-form-item label="分类名称 *">
          <el-input v-model="tcDialog.form.name" :placeholder="tcDialog.form.level === 1 ? '如：行业调控系统' : tcDialog.form.level === 2 ? '如：软件 / 硬件' : '如：登录异常'" />
        </el-form-item>
        <el-form-item label="排序（数字越小越靠前）"><el-input-number v-model="tcDialog.form.sort" :min="0" style="width:100%" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="tcDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveTc">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 设备分类编辑 ============ -->
    <el-dialog v-model="categoryDialog.visible" :title="categoryDialog.mode === 'edit' ? '编辑设备分类' : '新增设备分类'" width="480px">
      <el-form label-position="top">
        <el-form-item label="分类名称 *"><el-input v-model="categoryDialog.form.name" placeholder="如：网络设备" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="categoryDialog.form.desc" type="textarea" :rows="2" placeholder="如：交换机、路由器、无线控制器" /></el-form-item>
        <el-form-item label="排序（数字越小越靠前）"><el-input-number v-model="categoryDialog.form.sort" :min="0" style="width:100%" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="categoryDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveCategory">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 供应商编辑 ============ -->
    <el-dialog v-model="supplierDialog.visible" :title="supplierDialog.mode === 'edit' ? '编辑供应商' : '新增供应商'" width="620px">
      <el-form label-position="top">
        <el-row :gutter="14">
          <el-col :span="16"><el-form-item label="单位全称 *"><el-input v-model="supplierDialog.form.name" placeholder="如：太极计算机股份有限公司" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="单位简称 *"><el-input v-model="supplierDialog.form.shortName" placeholder="如：太极" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="状态">
            <el-select v-model="supplierDialog.form.status" style="width:100%">
              <el-option label="正常" value="active" />
              <el-option label="禁用" value="disabled" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="8"><el-form-item label="省份">
            <el-select v-model="supplierDialog.form.province" style="width:100%" filterable allow-create>
              <el-option v-for="p in PROVINCES" :key="p" :label="p" :value="p" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="8"><el-form-item label="城市"><el-input v-model="supplierDialog.form.city" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="联系人"><el-input v-model="supplierDialog.form.contact" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="联系电话"><el-input v-model="supplierDialog.form.phone" /></el-form-item></el-col>
        </el-row>
        <el-form-item label="地址"><el-input v-model="supplierDialog.form.address" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="supplierDialog.form.note" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="supplierDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveSupplier">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 设备型号编辑 ============ -->
    <el-dialog v-model="modelDialog.visible" :title="modelDialog.mode === 'edit' ? '编辑设备型号' : '新增设备型号'" width="560px">
      <el-form label-position="top">
        <el-row :gutter="14">
          <el-col :span="12"><el-form-item label="设备分类">
            <el-select v-model="modelDialog.form.category" style="width:100%">
              <el-option v-for="c in MODEL_CATEGORIES" :key="c" :label="c" :value="c" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="状态">
            <el-select v-model="modelDialog.form.status" style="width:100%">
              <el-option label="正常" value="active" />
              <el-option label="禁用" value="disabled" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="厂商 *"><el-input v-model="modelDialog.form.vendor" placeholder="如：华为" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="型号 *"><el-input v-model="modelDialog.form.model" placeholder="如：2288H V5" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="单位">
            <el-select v-model="modelDialog.form.unit" style="width:100%">
              <el-option v-for="u in MODEL_UNITS" :key="u" :label="u" :value="u" />
            </el-select>
          </el-form-item></el-col>
        </el-row>
        <el-form-item label="描述"><el-input v-model="modelDialog.form.desc" placeholder="如：2U 机架服务器" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="modelDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveModel">保存</el-button>
      </template>
    </el-dialog>

    <!-- ============ 菜单搜索 ============ -->
    <el-dialog v-model="palette.visible" width="520px" :show-close="false" top="12vh" class="palette-dialog">
      <el-input v-model="palette.keyword" placeholder="输入菜单名称，回车直达…" size="large" autofocus>
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <div style="margin-top:10px;max-height:46vh;overflow-y:auto">
        <div v-for="(it, i) in paletteItems" :key="i"
             style="padding:11px 12px;border-radius:8px;cursor:pointer;display:flex;gap:10px;align-items:center"
             @mouseenter="$event.currentTarget.style.background='#eff6ff'"
             @mouseleave="$event.currentTarget.style.background=''"
             @click="palette.visible = false; it.run()">
          {{ it.label }}
          <span style="margin-left:auto;font-size:12px;color:#9ca3af">{{ it.grp }}</span>
        </div>
        <div v-if="!paletteItems.length" class="empty">未找到匹配项</div>
      </div>
    </el-dialog>
  </div>
  `,
};

/* ============================== 挂载 ============================== */

const app = createApp(App);

// Element Plus：中文语言包 + 全量图标注册
app.use(ElementPlus, { locale: window.ElementPlusLocaleZhCn });
for (const [name, comp] of Object.entries(ElementPlusIconsVue)) {
  app.component(name, comp);
}

app.mount('#app');
