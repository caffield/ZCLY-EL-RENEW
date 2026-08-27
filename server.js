'use strict';
// 中城绿苑电梯安装进度实时平台 —— 零依赖 Node 服务
// 静态服务 + REST 变更接口 + SSE 实时推送 + JSON 文件持久化
// 运行: node server.js   (可选环境变量 PORT / HOST / ADMIN_PASSWORD)
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
// 兼容 GitHub 直接上传:静态资源/数据可能直接在仓库根,也可能仍在 public/、data/ 子目录
// 自动检测:子目录存在用子目录(本机开发更整洁),否则回落到仓库根(部署到 PaaS 直传的常见形态)
const _hasPublic = fs.existsSync(path.join(ROOT, 'public'));
const _hasData = fs.existsSync(path.join(ROOT, 'data'));
const PUBLIC = _hasPublic ? path.join(ROOT, 'public') : ROOT;
const DATA_DIR = _hasData ? path.join(ROOT, 'data') : ROOT;
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'lvyuan2026';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------------- 安装阶段模板(11 步:拆梯→投入使用;新设备到场堆货单独为"设备到场"日期) ----------------
const STAGES = [
  { key: 'dismantle', name: '拆梯' },
  { key: 'chisel',     name: '机房剔凿' },
  { key: 'sample',     name: '样板制作与放线' },
  { key: 'roompit',    name: '机房与底坑设备安装' },
  { key: 'car',        name: '轿厢组装与对重安装' },
  { key: 'rope',       name: '钢丝绳悬挂' },
  { key: 'rail',       name: '竖导轨' },
  { key: 'door',       name: '拆装层门' },
  { key: 'debug',      name: '收尾调试' },
  { key: 'accept',     name: '验收' },
  { key: 'use',        name: '投入使用' },
];
function emptyStages() {
  return STAGES.map(() => ({ status: 'not_started', progress: 0, planStart: '', planEnd: '', actualStart: '', actualEnd: '', owner: '', note: '' }));
}

// ---------------- 种子数据：东苑(16) + 西苑(21) = 37 部电梯 ----------------
function seedData() {
  const eastUnits = [
    ['620-1#',  '东苑01号'], ['620-2#',  '东苑02号'], ['620-6#',  '东苑06号'], ['620-7#',  '东苑07号'],
    ['620-8#',  '东苑08号'], ['620-9#',  '东苑09号'], ['620-10#', '东苑10号'], ['620-12#', '东苑12号'],
    ['620-13#', '东苑13号'], ['620-14#', '东苑14号'], ['620-15#', '东苑15号'], ['620-16#', '东苑16号'],
    ['620-17#', '东苑17号'], ['620-18#', '东苑18号'], ['620-20#', '东苑20号'], ['620-21#', '东苑21号'],
  ];
  const westUnits = [
    ['621-4#',  '西苑04号'], ['621-5#',  '西苑05号'], ['621-7#',  '西苑07号'], ['621-8#',  '西苑08号'],
    ['621-9#',  '西苑09号'], ['621-10#', '西苑10号'], ['621-12#', '西苑12号'], ['621-13#', '西苑13号'],
    ['621-14#', '西苑14号'], ['621-15#', '西苑15号'], ['621-16#', '西苑16号'], ['621-17#', '西苑17号'],
    ['621-18#', '西苑18号'], ['621-19#', '西苑19号'], ['621-20#', '西苑20号'], ['621-21#', '西苑21号'],
    ['621-22#', '西苑22号'], ['621-23#', '西苑23号'], ['621-25#', '西苑25号'], ['621-26#', '西苑26号'],
    ['621-27#', '西苑27号'],
  ];
  const mkElev = (no, loc) => ({ id: 'e' + no, name: no, location: loc, arrival: '', stages: emptyStages() });
  return {
    project: { name: '中城绿苑电梯更新', updatedAt: new Date().toISOString() },
    stages: STAGES,
    buildings: [
      { id: 'east', name: '东苑', elevators: eastUnits.map(([no, loc]) => mkElev(no, loc)) },
      { id: 'west', name: '西苑', elevators: westUnits.map(([no, loc]) => mkElev(no, loc)) },
    ],
  };
}

// ---------------- 存储 ----------------
let store = loadStore();
const sseClients = new Set();

function loadStore() {
  if (fs.existsSync(DATA_FILE)) {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { console.error('读取数据失败,重新初始化:', e.message); }
  }
  const s = seedData();
  fs.writeFileSync(DATA_FILE, JSON.stringify(s, null, 2));
  return s;
}
function saveStore() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
  store.project.updatedAt = new Date().toISOString();
}
function broadcast() {
  const msg = 'data: ' + JSON.stringify({ state: store, serverTime: Date.now() }) + '\n\n';
  for (const res of sseClients) { try { res.write(msg); } catch (e) {} }
}

// ---------------- 静态文件 ----------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC, path.normalize(rel));
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------------- API ----------------
function sendState(res) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ state: store, serverTime: Date.now() }));
}
function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { resolve({}); } });
  });
}
const findBuilding = id => store.buildings.find(b => b.id === id);
const findElevator = (b, id) => b && b.elevators.find(e => e.id === id);

async function handleMutate(req, res) {
  const body = await readBody(req);
  if (body.password !== ADMIN_PASSWORD) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: '密码错误' }));
    return;
  }
  const { op } = body;
  let changed = false;
  if (op === 'saveElevatorStages') {
    const e = findElevator(findBuilding(body.buildingId), body.elevatorId);
    if (e && Array.isArray(body.stages)) { e.stages = body.stages; if ('arrival' in body) e.arrival = body.arrival || ''; changed = true; }
  } else if (op === 'updateElevator') {
    const e = findElevator(findBuilding(body.buildingId), body.elevatorId);
    if (e && body.patch) { Object.assign(e, body.patch); changed = true; }
  } else if (op === 'addElevator') {
    const b = findBuilding(body.buildingId);
    if (b) {
      b.elevators.push({ id: 'e' + Date.now(), name: body.name || '新电梯', location: body.location || '', arrival: '', stages: emptyStages() });
      changed = true;
    }
  } else if (op === 'removeElevator') {
    const b = findBuilding(body.buildingId);
    if (b) { b.elevators = b.elevators.filter(e => e.id !== body.elevatorId); changed = true; }
  } else if (op === 'addBuilding') {
    store.buildings.push({ id: 'b' + Date.now(), name: body.name || '新苑', elevators: [] }); changed = true;
  } else if (op === 'removeBuilding') {
    store.buildings = store.buildings.filter(b => b.id !== body.buildingId); changed = true;
  } else if (op === 'reset') {
    store = seedData(); changed = true;
  }
  if (changed) { saveStore(); broadcast(); }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: changed, state: store }));
}

function handleSSE(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  res.write('retry: 3000\n\n');
  res.write('data: ' + JSON.stringify({ state: store, serverTime: Date.now() }) + '\n\n');
  sseClients.add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);
  req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
}

// ---------------- 入口 ----------------
const server = http.createServer((req, res) => {
  const p = url.parse(req.url).pathname;
  if (p === '/api/state') return sendState(res);
  if (p === '/api/events') return handleSSE(req, res);
  if (p === '/api/mutate' && req.method === 'POST') return handleMutate(req, res);
  if (p.startsWith('/api/')) { res.writeHead(404); res.end('not found'); return; }
  return serveStatic(req, res, p);
});
server.listen(PORT, HOST, () => console.log(`中城绿苑电梯进度平台已启动: http://localhost:${PORT}`));