/**
 * Палимпсест — web demo client. Runs the SAME @palimpsest/sim modules as the
 * server (client generates the puzzle from the seed; the server re-simulates
 * without trust — CONCEPT.md §9.3).
 */
import {
  generate, createState, applyAction, score, stateBytes, GRID, FINDINGS,
} from '@palimpsest/sim';
import { sha256Hex } from '@palimpsest/common';

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const CELL = canvas.width / GRID;

const ui = {
  player: null,
  session: null,
  puzzle: null,
  sim: null,
  tool: 'solvent',
  xray: false,
  diagnosed: false,
  queue: [],
  lastActionT: 0,
  flushTimer: null,
};

// ---------- API ----------
async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ---------- rendering ----------
function render() {
  if (!ui.puzzle || !ui.sim) {
    ctx.fillStyle = '#1a1713';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const { puzzle, sim } = ui;
  const img = ctx.createImageData(GRID, GRID);
  for (let i = 0; i < GRID * GRID; i += 1) {
    let r = puzzle.paint[i * 3];
    let g = puzzle.paint[i * 3 + 1];
    let b = puzzle.paint[i * 3 + 2];

    if (ui.xray) {
      // «Око мастера»: diagnostic view
      const v = sim.varnish[i] / 255;
      r = 30 + (1 - v) * 90;
      g = 30 + (1 - v) * 90;
      b = 40 + (1 - v) * 100;
      if (sim.loss[i] > 20) { r = 200; g = 60; b = 50; }
      if (sim.tear[i] > 20) { r = 80; g = 180; b = 220; }
      if (sim.patch[i] > 20) { r = 120; g = 200; b = 120; }
      if (sim.soft[i] > 20) { r = 220; g = 200; b = 60; }
    } else {
      // physical view: paint under old varnish, losses as bare ground, tears dark
      const v = sim.varnish[i] / 255;
      r = Math.floor(r * (1 - v * 0.82) + 52 * v);
      g = Math.floor(g * (1 - v * 0.82) + 38 * v);
      b = Math.floor(b * (1 - v * 0.82) + 26 * v);

      const lossNow = sim.loss[i] / 255;
      if (lossNow > 0) {
        const rr = sim.restoredMask[i] > 0 ? sim.restored[i * 3] : 196;
        const gg = sim.restoredMask[i] > 0 ? sim.restored[i * 3 + 1] : 188;
        const bb = sim.restoredMask[i] > 0 ? sim.restored[i * 3 + 2] : 170;
        r = Math.floor(r * (1 - lossNow) + rr * lossNow);
        g = Math.floor(g * (1 - lossNow) + gg * lossNow);
        b = Math.floor(b * (1 - lossNow) + bb * lossNow);
      }
      if (sim.tear[i] > 0 && sim.patch[i] === 0) {
        r = 36; g = 28; b = 24;
      } else if (sim.patch[i] > 0) {
        r = Math.floor(r * 0.6 + 150 * 0.4);
        g = Math.floor(g * 0.6 + 132 * 0.4);
        b = Math.floor(b * 0.6 + 108 * 0.4);
      }
      if (sim.newVarnish > 0 && ui.sim.finished) {
        const nv = sim.newVarnish / 255;
        r = Math.floor(r * (1 - nv * 0.2) + 90 * nv * 0.2);
        g = Math.floor(g * (1 - nv * 0.2) + 70 * nv * 0.2);
      }
    }
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  const off = document.createElement('canvas');
  off.width = GRID; off.height = GRID;
  off.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
}

// ---------- actions ----------
function pushAction(a) {
  const now = Date.now();
  if (now - ui.lastActionT < 60) return false; // shared MIN_ACTION_GAP_MS
  const action = { ...a, t: now };
  ui.lastActionT = now;
  ui.queue.push(action);
  applyAction(ui.sim, ui.puzzle, action);
  render();
  scheduleFlush();
  return true;
}

function scheduleFlush() {
  if (ui.flushTimer) return;
  ui.flushTimer = setTimeout(async () => {
    ui.flushTimer = null;
    if (!ui.session || ui.session.finishedLocally || !ui.queue.length) return;
    const batch = ui.queue.splice(0, ui.queue.length);
    const out = await api(`/api/session/${ui.session.id}/actions`, 'POST', { actions: batch });
    if (!out.ok) {
      // server rejected — restore queue head for transparency
      $('sessionInfo').textContent = `сервер отклонил пакет: ${out.reason}`;
    }
  }, 500);
}

function canvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / rect.width,
    y: (e.clientY - rect.top) / rect.height,
  };
}

let dragging = false;
let patchStart = null;

canvas.addEventListener('mousedown', (e) => {
  if (!ui.session || !ui.diagnosed || ui.sim.finished) return;
  dragging = true;
  const p = canvasPoint(e);
  if (ui.tool === 'patch') {
    patchStart = p;
    return;
  }
  toolAction(p);
});
canvas.addEventListener('mousemove', (e) => {
  if (!dragging || ui.tool === 'patch' || ui.tool === 'xray') return;
  toolAction(canvasPoint(e));
});
window.addEventListener('mouseup', (e) => {
  if (ui.tool === 'patch' && dragging && patchStart) {
    const p = canvasPoint(e);
    pushAction({
      type: 'patch',
      x: Math.min(patchStart.x, p.x),
      y: Math.min(patchStart.y, p.y),
      w: Math.max(0.03, Math.abs(p.x - patchStart.x)),
      h: Math.max(0.03, Math.abs(p.y - patchStart.y)),
      material: Number($('material').value),
    });
    patchStart = null;
  }
  dragging = false;
});

function toolAction(p) {
  const r = 0.09;
  if (ui.tool === 'solvent') {
    pushAction({ type: 'solvent', x: p.x, y: p.y, r, strength: Number($('strength').value) / 100 });
  } else if (ui.tool === 'wipe') {
    pushAction({ type: 'wipe', x: p.x, y: p.y, r });
  } else if (ui.tool === 'brush') {
    const hex = $('brushColor').value;
    const color = [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
    pushAction({ type: 'brush', x: p.x, y: p.y, r: 0.05, color });
  }
}

// ---------- UI wiring ----------
document.querySelectorAll('.tool').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tool === 'xray') {
      ui.xray = !ui.xray;
      btn.classList.toggle('active', ui.xray);
      render();
      return;
    }
    ui.tool = btn.dataset.tool;
    document.querySelectorAll('.tool').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    $('strengthWrap').classList.toggle('hidden', ui.tool !== 'solvent');
    $('colorWrap').classList.toggle('hidden', ui.tool !== 'brush');
    $('materialWrap').classList.toggle('hidden', ui.tool !== 'patch');
  });
});

$('btnEnter').addEventListener('click', async () => {
  const name = $('playerName').value.trim();
  if (!name) return;
  const out = await api('/api/player', 'POST', { name });
  if (!out.ok) return;
  ui.player = out.player;
  $('playerInfo').textContent = `${out.player.name} · ${out.player.address.slice(0, 12)}…`;
  $('btnStart').disabled = false;
  $('btnPrivate').disabled = false;
});

async function startSession(kind) {
  const out = await api('/api/session', 'POST', { playerId: ui.player.id, kind });
  if (!out.ok) return;
  ui.session = { id: out.sessionId, seed: out.seed, startedAt: out.startedAt, finishedLocally: false };
  ui.puzzle = generate(out.seed);
  ui.sim = createState(ui.puzzle);
  ui.diagnosed = false;
  ui.queue = [];
  $('sessionInfo').textContent = `сессия ${out.sessionId} · сид ${out.seed}`;
  $('btnDiagnose').disabled = false;
  $('btnFinish').disabled = true;
  $('resultInfo').textContent = 'зафиксируйте диагноз и реставрируйте…';
  render();
}
$('btnStart').addEventListener('click', () => startSession('daily'));
$('btnPrivate').addEventListener('click', () => startSession('private'));

$('btnDiagnose').addEventListener('click', () => {
  $('diagnoseBox').classList.toggle('hidden');
});
$('btnDiagnoseSend').addEventListener('click', () => {
  const findings = [...document.querySelectorAll('#diagnoseBox input:checked')].map((i) => i.value);
  if (pushAction({ type: 'diagnose', findings: findings.length ? findings : ['varnish_darkening'] })) {
    ui.diagnosed = true;
    $('diagnoseBox').classList.add('hidden');
    $('btnDiagnose').disabled = true;
    $('btnFinish').disabled = false;
    $('sessionInfo').textContent += ' · диагноз зафиксирован';
  }
});

$('btnFinish').addEventListener('click', async () => {
  if (!ui.session || ui.session.finishedLocally) return;
  const actions = [...ui.queue.splice(0), {
    type: 'varnish', kind: 0, thickness: 0.4, t: Date.now() + 70,
  }, { type: 'finish', t: Date.now() + 140 }];
  const out = await api(`/api/session/${ui.session.id}/finish`, 'POST', {
    actions,
    clientStateHash: sha256Hex(stateBytes(ui.sim)),
  });
  if (!out.ok) {
    $('resultInfo').textContent = `отклонено: ${out.reason}`;
    return;
  }
  ui.session.finishedLocally = true;
  ui.sim.finished = true;
  render();
  const a = out.artifact;
  const s = a.score;
  $('resultInfo').innerHTML = `
    <div class="total">Индекс Палимпсеста: <b>${s.total}</b> / 100</div>
    <div class="bars">
      ${bar('точность', s.components.accuracy)}
      ${bar('целостность', s.components.integrity)}
      ${bar('рациональность', s.components.rationality)}
      ${bar('открытия', s.components.discoveries)}
    </div>
    <div class="mono">артефакт ${a.id}<br/>merkle ${a.actionsMerkle.slice(0, 24)}…<br/>
    Книга Слоёв: запись #${a.bookSeq}${a.flags.length ? ` · флаги: ${a.flags.join(', ')}` : ''}<br/>
    stateHash сверка: ${a.stateHashMatch === null ? 'не запрошена' : (a.stateHashMatch ? 'совпал ✔' : 'расхождение ✘')}</div>
  `;
  refreshMeta();
});

function bar(label, v) {
  return `<div class="bar"><span>${label}</span><div class="track"><div style="width:${v}%"></div></div><b>${v}</b></div>`;
}

async function refreshMeta() {
  const [lb, book] = await Promise.all([
    api('/api/leaderboard'),
    api('/api/book'),
  ]);
  $('leaderboard').innerHTML = lb.rows.length
    ? lb.rows.map((r) => `<li><b>${r.total}</b> — ${r.player} · «${r.title}»</li>`).join('')
    : '<li>пока пусто</li>';
  $('bookInfo').innerHTML = book.verified
    ? `цепочка целостна ✔ · записей: ${book.total} · вершина ${book.head.slice(0, 16)}…`
    : `цепочка повреждена ✘ (сломана на #${book.brokenAt})`;
}

async function boot() {
  const daily = await api('/api/daily');
  if (daily.ok) {
    $('orderInfo').innerHTML = `
      «${daily.spec.title}», ок. ${daily.spec.year} · ${daily.spec.epoch}<br/>
      <span class="mono">сид ${daily.seed} · эталон ходов ${daily.spec.par}</span>`;
  }
  render();
  refreshMeta();
}
boot();
