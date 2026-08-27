'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

let STATE = null;
let SERVER_TIME = Date.now();
let EDIT_MODE = false;
let editing = null;

const STATUS_META = {
  not_started: { label: '未开始', color: '#9ca3af' },
  in_progress: { label: '进行中', color: '#f59e0b' },
  done:        { label: '已完成', color: '#ef4444' },
};

const fmtTime = ts => { const d = new Date(ts); return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); };

const elevatorCompletion = e => !e.stages.length ? 0 : Math.round(e.stages.reduce((a, s) => a + (s.progress || 0), 0) / e.stages.length);
const buildingCompletion  = b => !b.elevators.length ? 0 : Math.round(b.elevators.reduce((a, e) => a + elevatorCompletion(e), 0) / b.elevators.length);
const overallCompletion   = () => { const all = STATE.buildings.flatMap(b => b.elevators); return all.length ? Math.round(all.reduce((a, e) => a + elevatorCompletion(e), 0) / all.length) : 0; };

const DAY = 86400000;
const fmtDate = ts => { const d = new Date(ts); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

// 电梯排期窗口：总工期从"拆梯"(stages[0])起算，到最晚 planEnd 结束
function elevatorWindow(e) {
  const dismantle = e.stages[0];
  const starts = e.stages.map(s => s.planStart).filter(Boolean).map(d => new Date(d).getTime());
  const ends = e.stages.map(s => s.planEnd).filter(Boolean).map(d => new Date(d).getTime());
  if (!ends.length) return null;
  // 优先用拆梯的计划开始日作为工期起点；拆梯未排期则用最早计划日
  const start = (dismantle && dismantle.planStart) ? new Date(dismantle.planStart).getTime() : (starts.length ? Math.min(...starts) : null);
  if (start === null) return null;
  return { start, end: Math.max(...ends) };
}
// 已用 / 剩余 进度（基于日期；无日期则用已完成阶段数推算）
function elapsedInfo(e, now) {
  const w = elevatorWindow(e);
  if (!w) {
    const total = e.stages.length || 1;
    const done = e.stages.filter(s => s.status === 'done').length;
    const elapsed = Math.round(done / total * 100);
    return { hasDates: false, elapsed, remaining: 100 - elapsed, totalDays: null, startStr: '', endStr: '', overdue: false, allDone: done === e.stages.length };
  }
  const total = Math.max(1, w.end - w.start);
  const elapsedMs = Math.min(Math.max(now - w.start, 0), w.end - w.start);
  const elapsed = Math.round(elapsedMs / total * 100);
  const allDone = e.stages.every(s => s.status === 'done');
  const overdue = now > w.end && !allDone;
  return { hasDates: true, elapsed, remaining: 100 - elapsed, totalDays: Math.round(total / DAY), start: w.start, end: w.end, startStr: fmtDate(w.start), endStr: fmtDate(w.end), overdue, allDone };
}
const elevatorStatus = e => {
  if (e.stages.every(s => s.status === 'done')) return 'done';
  if (e.stages.some(s => s.status === 'in_progress' || s.status === 'done')) return 'prog';
  return 'todo';
};
const STATUS_BADGE = { done: { label: '已投用', cls: 'done' }, prog: { label: '进行中', cls: 'prog' }, todo: { label: '未开始', cls: 'todo' } };

function render() {
  if (!STATE) return;
  $('#projName').textContent = STATE.project.name;
  $('#updatedAt').textContent = fmtTime(STATE.project.updatedAt || SERVER_TIME);
  renderSummary(); renderDonut(); renderBuildingBars(); renderBuildings();
}
const card = (label, val, cls = '') => `<div class="metric ${cls}"><div class="m-val">${val}</div><div class="m-label">${label}</div></div>`;
function renderSummary() {
  const all = STATE.buildings.flatMap(b => b.elevators);
  const done = all.filter(e => e.stages.every(s => s.status === 'done')).length;
  const inprog = all.filter(e => e.stages.some(s => s.status === 'in_progress')).length;
  $('#summary').innerHTML = [
    card('整体完成率', overallCompletion() + '%', 'accent'),
    card('苑 / 电梯', STATE.buildings.length + ' / ' + all.length),
    card('已投用电梯', done),
    card('进行中', inprog),
  ].join('');
}
function renderDonut() {
  const v = overallCompletion(); const r = 54, c = 2 * Math.PI * r, off = c * (1 - v / 100);
  $('#donut').innerHTML = `<svg viewBox="0 0 140 140" width="180" height="180">
    <defs><linearGradient id="donutGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3b82f6"/><stop offset="100%" stop-color="#2563eb"/></linearGradient></defs>
    <circle cx="70" cy="70" r="${r}" fill="none" stroke="#eef2f7" stroke-width="14"/>
    <circle cx="70" cy="70" r="${r}" fill="none" stroke="url(#donutGrad)" stroke-width="14" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${off}" transform="rotate(-90 70 70)"/>
    <text x="70" y="64" text-anchor="middle" font-size="32" font-weight="800" fill="#0f172a">${v}%</text>
    <text x="70" y="88" text-anchor="middle" font-size="12" fill="#64748b">整体完成率</text></svg>`;
}
function renderBuildingBars() {
  $('#buildingBars').innerHTML = STATE.buildings.map(b => {
    const total = b.elevators.length;
    const done = b.elevators.filter(e => e.stages.every(s => s.status === 'done')).length;
    const ratio = total ? Math.round(done / total * 100) : 0;
    return `<div class="bbar"><div class="bbar-top"><span>${b.name}</span><span>${done}/${total} 台</span></div>
      <div class="track"><div class="fill" style="width:${ratio}%"></div></div></div>`;
  }).join('') || '<div class="empty">暂无苑</div>';
}
function renderBuildings() {
  $('#buildings').innerHTML = STATE.buildings.map(b => {
    const v = buildingCompletion(b);
    const cards = b.elevators.map(e => elevatorCard(b, e)).join('') || '<div class="empty">该苑暂无电梯</div>';
    return `<section class="building"><div class="building-head"><h2>${b.name}</h2><span class="badge">${v}%</span>
      ${EDIT_MODE ? `<button class="btn small" data-add="${b.id}">+ 电梯</button>` : ''}</div>
      <div class="elev-grid">${cards}</div></section>`;
  }).join('');
  if (EDIT_MODE) {
    $$('[data-edit]').forEach(b => b.onclick = () => openModal(b.dataset.edit, b.dataset.elev));
    $$('[data-add]').forEach(b => b.onclick = () => addElevator(b.dataset.add));
  }
}
function elevatorCard(b, e) {
  const info = elapsedInfo(e, SERVER_TIME);
  const doneCount = e.stages.filter(s => s.status === 'done').length;
  const badge = STATUS_BADGE[elevatorStatus(e)];
  const checks = STATE.stages.map((st, i) => {
    const s = e.stages[i] || {};
    const cls = s.status === 'done' ? 'ok' : (s.status === 'in_progress' ? 'doing' : 'no');
    const mark = s.status === 'done' ? '✓' : (s.status === 'in_progress' ? '◐' : '☐');
    return `<span class="chk ${cls}" title="${st.name}：${STATUS_META[s.status].label}">${mark}</span>`;
  }).join('');
  const arrivalLine = e.arrival ? `设备到场 <b>${e.arrival}</b>` : `设备到场 <span class="undated">未记录</span>`;
  const durLine = `阶段完成 <b>${doneCount}/${e.stages.length}</b>`;
  const barCls = info.allDone ? 'green' : 'blue';
  const tip = info.allDone ? '已全部完成' : '';
  return `<div class="ecard">
    <div class="ecard-head">
      <div class="ecard-id"><span class="ename">${e.name}</span>${e.location ? `<span class="eloc">${e.location}</span>` : ''}</div>
      <div class="ecard-right"><span class="ebadge ${badge.cls}">${badge.label}</span>
        ${EDIT_MODE ? `<button class="icon" data-edit="${b.id}" data-elev="${e.id}">✎</button>` : ''}</div>
    </div>
    <div class="earr">${arrivalLine}</div>
    <div class="edur">${durLine}</div>
    <div class="etime" title="${tip}">
      <div class="etime-bar"><div class="etime-fill ${barCls}" style="width:${info.elapsed}%"></div></div>
      <div class="etime-txt"><span>已完成 ${info.elapsed}%</span><span>未完成 ${info.remaining}%</span></div>
    </div>
    <div class="echks">${checks}</div>
  </div>`;
}

function openModal(bid, eid) {
  const b = STATE.buildings.find(x => x.id === bid); const e = b.elevators.find(x => x.id === eid);
  editing = { buildingId: bid, elevatorId: eid, arrival: e.arrival || '', stages: JSON.parse(JSON.stringify(e.stages)) };
  $('#modalTitle').textContent = `编辑进度 · ${b.name} ${e.name}${e.location ? ' '+e.location : ''}`;
  $('#modalBody').innerHTML = `<div class="mrow arrival-row"><label>设备到场日期</label>
      <input type="date" id="arrivalInput" value="${editing.arrival}"></div>` + STATE.stages.map((st, i) => {
    const s = editing.stages[i];
    return `<div class="mrow"><label>${st.name}</label>
      <select data-i="${i}" class="st-status">${Object.keys(STATUS_META).map(k => `<option value="${k}" ${s.status === k ? 'selected' : ''}>${STATUS_META[k].label}</option>`).join('')}</select>
      <input type="text" value="${s.owner}" data-i="${i}" data-f="owner" placeholder="负责人">
      <input type="text" value="${s.note}" data-i="${i}" data-f="note" placeholder="备注"></div>`;
  }).join('');
  $$('#modalBody .st-status').forEach(sel => sel.onchange = () => {
    const i = +sel.dataset.i;
    editing.stages[i].status = sel.value;
    if (sel.value === 'done') editing.stages[i].progress = 100;
    else if (sel.value === 'not_started') editing.stages[i].progress = 0;
  });
  $$('#modalBody [data-f]').forEach(inp => inp.oninput = () => { editing.stages[+inp.dataset.i][inp.dataset.f] = inp.value; });
  const arr = $('#arrivalInput'); if (arr) arr.oninput = () => { editing.arrival = arr.value; };
  $('#modal').classList.remove('hidden');
}

async function saveModal() {
  if (!ensureAuth()) return;
  const ok = await mutate({ op: 'saveElevatorStages', buildingId: editing.buildingId, elevatorId: editing.elevatorId, stages: editing.stages, arrival: editing.arrival });
  if (ok) { $('#modal').classList.add('hidden'); toast('已保存'); }
}
async function addElevator(bid) {
  if (!ensureAuth()) return;
  const name = prompt('梯号（如 621-20#）'); if (!name) return;
  const location = prompt('位置（如 西苑20号）') || '';
  if (await mutate({ op: 'addElevator', buildingId: bid, name, location })) toast('已新增电梯');
}
async function addBuilding() {
  if (!ensureAuth()) return;
  const name = prompt('苑名称（如 中苑）'); if (!name) return;
  if (await mutate({ op: 'addBuilding', name })) toast('已新增苑');
}
async function resetData() {
  if (!ensureAuth()) return;
  if (!confirm('确定恢复为示例数据？当前修改将丢失。')) return;
  if (await mutate({ op: 'reset' })) toast('已恢复示例数据');
}

function ensureAuth() {
  if (!$('#adminPwd').value) { toast('请先在右下角输入编辑密码'); $('#adminPwd').focus(); return false; }
  return true;
}
async function mutate(body) {
  const r = await fetch('/api/mutate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, password: $('#adminPwd').value }) });
  const j = await r.json();
  if (!j.ok && j.error) { toast(j.error); return false; }
  if (j.state) applyState(j.state, SERVER_TIME);
  return j.ok !== false;
}

function connect() {
  const es = new EventSource('/api/events');
  es.onopen = () => { $('#liveDot').className = 'dot on'; $('#liveText').textContent = '实时已连接'; };
  es.onmessage = ev => { try { const d = JSON.parse(ev.data); applyState(d.state, d.serverTime); } catch (e) {} };
  es.onerror = () => { $('#liveDot').className = 'dot off'; $('#liveText').textContent = '重连中…'; };
}
function applyState(state, t) { STATE = state; if (t) SERVER_TIME = t; render(); }
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), 1800); }

$('#editToggle').onclick = () => { EDIT_MODE = !EDIT_MODE; $('#editToggle').textContent = EDIT_MODE ? '退出编辑' : '编辑模式'; $('#editPanel').classList.toggle('hidden', !EDIT_MODE); render(); };
$('#editClose').onclick = () => { EDIT_MODE = false; $('#editToggle').textContent = '编辑模式'; $('#editPanel').classList.add('hidden'); render(); };
$('#modalClose').onclick = () => $('#modal').classList.add('hidden');
$('#modalSave').onclick = saveModal;
$('#addBuildingBtn').onclick = addBuilding;
$('#resetBtn').onclick = resetData;
$('#modal').onclick = e => { if (e.target.id === 'modal') $('#modal').classList.add('hidden'); };

fetch('/api/state').then(r => r.json()).then(d => applyState(d.state, d.serverTime)).catch(() => {});
connect();