/**
 * Палимпсест — web demo client. Runs the SAME @palimpsest/sim modules as the
 * server (client generates the puzzle from the seed; the server re-simulates
 * without trust — CONCEPT.md §9.3).
 */
import {
  generate, createState, applyAction, score, stateBytes, renderRgba, renderGalleryRgba,
  GRID, FINDINGS,
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
  if (ui.xray) {
    // «Око мастера»: интерактивный диагностический слой поверх канонического вида
    for (let i = 0; i < GRID * GRID; i += 1) {
      const v = sim.varnish[i] / 255;
      let r = 30 + (1 - v) * 90;
      let g = 30 + (1 - v) * 90;
      let b = 40 + (1 - v) * 100;
      if (sim.loss[i] > 20) { r = 200; g = 60; b = 50; }
      if (sim.tear[i] > 20) { r = 80; g = 180; b = 220; }
      if (sim.patch[i] > 20) { r = 120; g = 200; b = 120; }
      if (sim.soft[i] > 20) { r = 220; g = 200; b = 60; }
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
  } else {
    // канонический композитор (@palimpsest/sim/render.js) — байт-в-байт как в
    // Unity-виде (client/unity/PalimpsestSim/Renderer.cs) и проверочных скриптах
    img.data.set(renderRgba({
      paint: puzzle.paint,
      varnish: sim.varnish,
      loss: sim.loss,
      tear: sim.tear,
      patch: sim.patch,
      restored: sim.restored,
      restoredMask: sim.restoredMask,
      newVarnish: sim.newVarnish,
      finished: sim.finished,
    }));
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

async function startSession(kind, extra = {}) {
  const out = await api('/api/session', 'POST', { playerId: ui.player.id, kind, ...extra });
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
  social.myArtifacts.push(a.id);
  renderSocial();
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
    stateHash сверка: ${a.stateHashMatch === null ? 'не запрошена' : (a.stateHashMatch ? 'совпал ✔' : 'расхождение ✘')}
    ${out.tournament ? `<br/>турнирная партия #${out.tournament.round} зачтена` : ''}
    ${out.manifest ? `<br/>Манифест: уровень ${out.manifest.level} · опыт ${out.manifest.xp}` : ''}</div>
    <div class="row"><button id="btnMint">Отчеканить cNFT</button></div>
    <div id="mintInfo" class="mono muted"></div>
    <div class="gallery">
      <div class="gallery-title">Галерейный вид — как работа предстанет перед публикой</div>
      <canvas id="galleryCanvas" width="512" height="512"></canvas>
      <div class="mono muted">декоративная проекция слоёв на живописную подложку эпохи; канонический кадр — источник истины для проверки</div>
    </div>
  `;
  $('btnMint').onclick = async () => {
    const out = await api(`/api/artifact/${a.id}/mint`, 'POST', {});
    if (!out.ok) {
      $('mintInfo').textContent = `минт: ${out.reason}`;
      return;
    }
    $('mintInfo').innerHTML = `cNFT: ${out.mint.assetId} · дерево ${out.mint.tree.slice(0, 16)}… · лист #${out.mint.leafIndex} · Книга #${out.bookSeq}`;
  };
  paintGallery(ui.puzzle, ui.sim);
  refreshMeta();
});


// ---------- галерейная проекция (декоративный вид) ----------
const GALLERY_FILES = {
  'Антика': 'antica.jpg',
  'Тёмное Средневековье': 'dark-age.jpg',
  'Возрождение': 'renaissance.jpg',
  'Барокко': 'baroque.jpg',
  'Импрессионизм': 'impressionism.jpg',
  'Модерн': 'modern.jpg',
};

async function paintGallery(puzzle, sim) {
  const canvas = document.getElementById('galleryCanvas');
  if (!canvas) return;
  const file = GALLERY_FILES[puzzle.epoch] ?? 'modern.jpg';
  const img = new Image();
  img.src = `/assets/gallery/${file}`;
  try { await img.decode(); } catch { return; }
  const off = document.createElement('canvas');
  off.width = 512; off.height = 512;
  const octx = off.getContext('2d');
  octx.drawImage(img, 0, 0, 512, 512);
  const base = octx.getImageData(0, 0, 512, 512);
  const out = renderGalleryRgba(base.data, 512, 512, {
    varnish: sim.varnish,
    loss: sim.loss,
    tear: sim.tear,
    patch: sim.patch,
    restored: sim.restored,
    restoredMask: sim.restoredMask,
    newVarnish: sim.newVarnish,
    finished: sim.finished,
  });
  const gctx = canvas.getContext('2d');
  gctx.putImageData(new ImageData(new Uint8ClampedArray(out.buffer), 512, 512), 0, 0);
}

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

// ---------- social layer ----------
const social = {
  tab: 'guild',
  myArtifacts: [], // артефакты этой сессии браузера
};

document.querySelectorAll('#socialTabs .tool').forEach((btn) => {
  btn.addEventListener('click', () => {
    social.tab = btn.dataset.tab;
    document.querySelectorAll('#socialTabs .tool').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    renderSocial();
  });
});

function needPlayer() {
  if (!ui.player) {
    $('socialBody').textContent = 'сначала войдите в Мастерскую (имя мастера сверху)';
    return false;
  }
  return true;
}

async function renderSocial() {
  const box = $('socialBody');
  if (!ui.player) {
    box.textContent = 'сначала войдите в Мастерскую (имя мастера сверху)';
    return;
  }
  if (social.tab === 'guild') {
    const [guilds, att] = await Promise.all([api('/api/guilds'), api(`/api/attestation/${ui.player.id}`)]);
    box.innerHTML = `
      <p>мой кошелёк: <b>${att.attestation.pigments}</b> пигментов · аттестат: ${att.attestation.rank}</p>
      <div class="row">
        <button id="gCreate">Основать Мастерскую</button>
        <button id="gJoin">Вступить по ID</button>
      </div>
      <ol>${(guilds.rows ?? []).map((r) => `
        <li><b>${r.name}</b> — ${r.status} · престиж ${r.prestige} · участников ${r.members} · работ ${r.works}
        <button data-gid="${r.guildId}" class="joinG">вступить</button></li>`).join('') || '<li>пока пусто</li>'}</ol>`;
    $('gCreate').onclick = async () => {
      const name = prompt('название Мастерской');
      if (!name) return;
      const motto = prompt('девиз', '') ?? '';
      const out = await api('/api/guild', 'POST', { name, motto, playerId: ui.player.id });
      box.insertAdjacentHTML('beforeend', out.ok ? `<p class="mono">основана ${out.guild.name} · id ${out.guild.id}</p>` : `<p>${out.reason}</p>`);
      renderSocial();
    };
    $('gJoin').onclick = async () => {
      const gid = prompt('id Мастерской');
      if (!gid) return;
      const out = await api(`/api/guild/${gid}/join`, 'POST', { playerId: ui.player.id });
      if (!out.ok) box.insertAdjacentHTML('beforeend', `<p>${out.reason}</p>`);
      renderSocial();
    };
    box.querySelectorAll('.joinG').forEach((b) => {
      b.onclick = async () => {
        const out = await api(`/api/guild/${b.dataset.gid}/join`, 'POST', { playerId: ui.player.id });
        if (!out.ok) box.insertAdjacentHTML('beforeend', `<p>${out.reason}</p>`);
        renderSocial();
      };
    });
    return;
  }
  if (social.tab === 'vernisage') {
    const v = (await api('/api/vernissage')).vernissage;
    box.innerHTML = `
      <p>сезон ${v.season} · ${v.status} · голосов: ${v.totalVotes}</p>
      <div class="row"><button id="vSubmit">Выставить свой артефакт</button></div>
      <ol>${v.entries.map((e) => `
        <li>«${e.title}» — ${e.guildName} · индекс ${e.total} · голосов <b>${e.votes}</b>
        <button data-aid="${e.artifactId}" class="voteE">голосовать</button></li>`).join('') || '<li>экспонатов пока нет</li>'}</ol>
      ${v.results ? `<p class="mono">итоги: ${v.results.map((r) => `#${r.rank} +${r.prize} пигм.`).join(', ')}</p>` : ''}`;
    $('vSubmit').onclick = async () => {
      const aid = social.myArtifacts[social.myArtifacts.length - 1] ?? prompt('id артефакта');
      if (!aid) return;
      const out = await api('/api/vernissage/submit', 'POST', { playerId: ui.player.id, artifactId: aid });
      if (!out.ok) box.insertAdjacentHTML('beforeend', `<p>${out.reason}</p>`);
      renderSocial();
    };
    box.querySelectorAll('.voteE').forEach((b) => {
      b.onclick = async () => {
        const out = await api('/api/vernissage/vote', 'POST', { playerId: ui.player.id, artifactId: b.dataset.aid });
        if (!out.ok) box.insertAdjacentHTML('beforeend', `<p>${out.reason}</p>`);
        renderSocial();
      };
    });
    return;
  }
  if (social.tab === 'auction') {
    const rows = (await api('/api/auctions')).rows ?? [];
    box.innerHTML = `
      <div class="row"><button id="aCreate">Выставить артефакт на торг</button></div>
      <ol>${rows.map((a) => `
        <li class="mono">${a.id} · лот ${a.artifactId.slice(0, 12)}… · ставок ${a.bidCount} · ${a.status}
        ${a.status === 'open' ? `<button data-aid="${a.id}" class="bidA">ставка</button>
        <button data-aid="${a.id}" class="settleA">завершить</button>`
        : `· цена ${a.price ?? '—'} (комиссия ${a.fee ?? '—'})`}</li>`).join('') || '<li>торгов нет</li>'}</ol>`;
    $('aCreate').onclick = async () => {
      const aid = social.myArtifacts[social.myArtifacts.length - 1] ?? prompt('id артефакта');
      if (!aid) return;
      const minBid = Number(prompt('минимальная ставка (пигменты)', '10') ?? 10);
      const out = await api('/api/auction', 'POST', { artifactId: aid, sellerId: ui.player.id, minBid, durationMin: 1 });
      if (!out.ok) box.insertAdjacentHTML('beforeend', `<p>${out.reason}</p>`);
      renderSocial();
    };
    box.querySelectorAll('.bidA').forEach((b) => {
      b.onclick = async () => {
        const amount = Number(prompt('ваша ставка (скрыта до конца торга)', '10') ?? 0);
        const out = await api(`/api/auction/${b.dataset.aid}/bid`, 'POST', { playerId: ui.player.id, amount });
        if (!out.ok) box.insertAdjacentHTML('beforeend', `<p>${out.reason}</p>`);
        renderSocial();
      };
    });
    box.querySelectorAll('.settleA').forEach((b) => {
      b.onclick = async () => {
        const out = await api(`/api/auction/${b.dataset.aid}/settle`, 'POST', {});
        if (!out.ok) box.insertAdjacentHTML('beforeend', `<p>${out.reason}</p>`);
        renderSocial();
      };
    });
    return;
  }
  if (social.tab === 'cases') {
    const rows = (await api('/api/cases')).rows ?? [];
    box.innerHTML = rows.length ? rows.map((c) => `
      <div class="case mono">
        <b>Дело ${c.artifactId.slice(0, 12)}…</b> — «${c.title}», индекс ${c.index}<br/>
        улики: флаги [${c.flags.join(', ') || '—'}] · ошибки диагноза: пропущено ${c.diagnosisErrors.missed}, ложных ${c.diagnosisErrors.false}
        · stateHash ${c.stateHashMatch === null ? '—' : (c.stateHashMatch ? 'совпал' : 'РАСХОЖДЕНИЕ')}
        <div class="row">
          <button data-aid="${c.artifactId}" data-v="fake" class="verdict">подмалёвок</button>
          <button data-aid="${c.artifactId}" data-v="authentic" class="verdict">подлинник</button>
        </div>
      </div>`).join('') : '<p>открытых дел нет</p>';
    box.querySelectorAll('.verdict').forEach((b) => {
      b.onclick = async () => {
        const out = await api(`/api/case/${b.dataset.aid}/investigate`, 'POST', {
          playerId: ui.player.id, verdict: b.dataset.v,
        });
        box.insertAdjacentHTML('beforeend', out.ok
          ? `<p>${out.correct ? 'вердикт верен ✔' : 'вердикт ошибочен ✘'} · ${out.reward > 0 ? '+' : ''}${out.reward} пигментов · истина: ${out.truth}</p>`
          : `<p>${out.reason}</p>`);
        renderSocial();
      };
    });
    return;
  }
  if (social.tab === 'season') {
    const [season, tourns, ch, rew, dao] = await Promise.all([
      api(`/api/season?playerId=${ui.player.id}`),
      api('/api/tournaments'),
      api(`/api/chapter?playerId=${ui.player.id}`),
      api(`/api/rewarded?playerId=${ui.player.id}`),
      api('/api/dao'),
    ]);
    const m = season.manifest ?? { level: 0, xp: 0, premium: false };
    const chapterHtml = ch.ok ? `
      <div class="case">
        <img class="chapter-cover" src="/assets/chapters/${ch.chapter.id}.jpg" alt="«${ch.chapter.title}»" />
        <b>Глава ${ch.chapter.number}. «${ch.chapter.title}»</b> — ${ch.chapter.subtitle}<br/>
        <i>${ch.chapter.motto}</i><br/>
        <span class="muted">${ch.chapter.hook}</span><br/>
        <span class="mono">заказ недели: «${ch.chapter.orderTitle}» · сид ${ch.chapter.weekSeed} · бонус +${ch.chapter.orderBonus} пигм.</span>
        <div class="row"><button id="chPlay">Сыграть заказ главы</button></div>
        <ol>${ch.quests.map((q) => `
          <li>${q.title} — ${q.description}<br/>
          <span class="mono">прогресс ${q.progress}/${q.target} · награда ${q.reward.pigments} пигм.${q.reward.title ? ` + титул «${q.reward.title}»` : ''}</span>
          ${q.complete && !q.claimed ? `<button data-qid="${q.id}" class="chClaim">забрать</button>` : (q.claimed ? ' · получено ✔' : '')}</li>`).join('')}</ol>
      </div>` : '';
    const itemsShelf = `
      <div class="items-shelf">
        ${[
          ['solvent', 'Растворитель'],
          ['wipe', 'Салфетка'],
          ['patch', 'Заплатка'],
          ['brush', 'Кисть'],
          ['varnish', 'Лак'],
          ['cinnabar', 'Пигменты'],
        ].map(([file, name]) => `
          <div class="item-card"><img src="/assets/items/${file}.png" alt="${name}" />${name}</div>`).join('')}
      </div>`;
    const rewardCatalog = [
      ['Рама «Кракелюр»', 'frame-crackle'],
      ['Рама «Сусальное золото»', 'frame-gold'],
      ['Тема «Лазурит»', 'theme-lazurite'],
      ['Тема «Пентименто»', 'theme-pentimento'],
      ['Инструмент «Кисть реставратора»', 'brush'],
    ];
    const ownedSet = new Set([...(season.owned ?? []), ...(ch.claimedTitles ?? [])]);
    const catalogHtml = `
      <div class="catalog">
        <div class="gallery-title">Каталог наград Манифеста</div>
        <div class="items-shelf">
          ${rewardCatalog.map(([name, file]) => `
            <div class="item-card${ownedSet.has(name) ? ' owned' : ''}">
              <img src="/assets/items/${file}.png" alt="${name}" />${name}${ownedSet.has(name) ? ' ✔' : ''}
            </div>`).join('')}
        </div>
      </div>`;
    box.innerHTML = `
      ${chapterHtml}
      ${itemsShelf}
      ${catalogHtml}
      ${rew.ok ? `<p class="mono">спонсорский просмотр: осталось ${rew.left}/${rew.dailyCap} (+${rew.grant} пигм.)
        <button id="rWatch">смотреть</button></p>` : ''}
      ${dao.ok ? `
      <div class="case">
        <b>Управление сезоном</b> (proto-DAO Мастерских) · следующая глава: <b>${dao.state.nextTheme ?? '—'}</b>
        <div class=\"row\"><button id=\"dCreate\">Новое предложение</button></div>
        <ol>${dao.state.open.map((p) => `
          <li>${p.title} — голосов Мастерских: ${p.guildVotes} · до ${new Date(p.endsAt).toLocaleDateString('ru')}
          ${p.options.map((o) => `<button data-pid="${p.id}" data-opt="${o}" class="dVote">${o}</button>`).join('')}
          <button data-pid="${p.id}" class="dClose">закрыть</button></li>`).join('') || '<li>открытых предложений нет</li>'}</ol>
      </div>` : ''}
      <p><b>${season.seasonId}</b> · слой Аттестата: <b>${season.tier ?? '—'}</b><br/>
      Манифест: уровень <b>${m.level}</b> · опыт ${m.xp} ${m.premium ? '· глава открыта ✦' : '· глава закрыта'}
      · реставраций ${season.stats.verifiedSessions} · побед ${season.stats.tournamentWins}</p>
      <div class=\"row\">
        <button id=\"mClaim\">Забрать награды</button>
        ${m.premium ? '' : '<button id=\"mUnlock\">Открыть главу (100 киновари)</button>'}
        <button id=\"tCreate\">Новый турнир</button>
      </div>
      <p class=\"mono\">награды: ${(season.owned ?? []).join(' · ') || '—'}</p>
      <ol>${(tourns.rows ?? []).map((t) => `
        <li><b>${t.name}</b> — ${t.kind} · ${t.status} · игроков ${t.players} · фонд ${t.prizePool.total}
          <button data-tid=\"${t.id}\" class=\"tEnter\">заявиться</button>
          <button data-tid=\"${t.id}\" class=\"tPlay\">сыграть партию</button>
          <button data-tid=\"${t.id}\" class=\"tStart\">старт</button>
          <button data-tid=\"${t.id}\" class=\"tFinish\">финиш</button>
          <button data-tid=\"${t.id}\" class=\"tTable\">таблица</button></li>`).join('') || '<li>турниров нет</li>'}</ol>
      <div id=\"tTableBox\" class=\"mono\"></div>`;
    if (ch.ok) {
      $('chPlay').onclick = () => startSession('chapter');
      box.querySelectorAll('.chClaim').forEach((b) => {
        b.onclick = async () => {
          const out = await api('/api/chapter/quest/claim', 'POST', { playerId: ui.player.id, questId: b.dataset.qid });
          box.insertAdjacentHTML('afterbegin', out.ok
            ? `<p>награда главы: +${out.reward.pigments} пигментов${out.reward.title ? ` · титул «${out.reward.title}»` : ''} ✔</p>`
            : `<p>${out.reason}</p>`);
          renderSocial();
        };
      });
    }
    if (rew.ok && $('rWatch')) {
      $('rWatch').onclick = async () => {
        const out = await api('/api/rewarded', 'POST', { playerId: ui.player.id, adToken: 'mock' });
        box.insertAdjacentHTML('afterbegin', out.ok
          ? `<p>спонсорский грант: +${out.granted} пигментов (осталось ${out.left})</p>`
          : `<p>${out.reason === 'daily_cap' ? 'на сегодня лимит просмотров исчерпан' : out.reason}</p>`);
        renderSocial();
      };
    }
    if (dao.ok && $('dCreate')) {
      $('dCreate').onclick = async () => {
        const kind = prompt('тип предложения: theme (тема главы) или sponsor (казна турниров)', 'theme');
        if (!kind) return;
        const out = await api('/api/dao/proposal', 'POST', { kind, authorPlayerId: ui.player.id });
        if (!out.ok) box.insertAdjacentHTML('afterbegin', `<p>${out.reason}</p>`);
        renderSocial();
      };
      box.querySelectorAll('.dVote').forEach((b) => {
        b.onclick = async () => {
          const out = await api(`/api/dao/proposal/${b.dataset.pid}/vote`, 'POST', {
            playerId: ui.player.id, option: b.dataset.opt,
          });
          if (!out.ok) box.insertAdjacentHTML('afterbegin', `<p>${out.reason}</p>`);
          renderSocial();
        };
      });
      box.querySelectorAll('.dClose').forEach((b) => {
        b.onclick = async () => {
          const out = await api(`/api/dao/proposal/${b.dataset.pid}/close`, 'POST', {});
          box.insertAdjacentHTML('afterbegin', out.ok
            ? `<p>решение: ${out.proposal.result.winner}${out.effect?.nextTheme ? ` · следующая глава «${out.effect.nextTheme}»` : ''}${out.effect?.movedToPrize ? ` · в фонд турниров +${out.effect.movedToPrize}` : ''}</p>`
            : `<p>${out.reason}</p>`);
          renderSocial();
        };
      });
    }
    $('mUnlock').onclick = async () => {
      const out = await api('/api/season/manifest/unlock', 'POST', { playerId: ui.player.id });
      box.insertAdjacentHTML('beforeend', out.ok ? '<p>глава открыта ✦</p>' : `<p>${out.reason}</p>`);
      renderSocial();
    };
    $('mClaim').onclick = async () => {
      const level = Number(prompt(`уровень для выдачи (1–${m.level})`, String(m.level)) ?? 0);
      const out = await api('/api/season/manifest/claim', 'POST', { playerId: ui.player.id, level });
      box.insertAdjacentHTML('beforeend', out.ok ? `<p>получено: ${out.claimed.join(' · ')}</p>` : `<p>${out.reason}</p>`);
      renderSocial();
    };
    $('tCreate').onclick = async () => {
      const name = prompt('название турнира');
      if (!name) return;
      const kind = prompt('тип: duel (3 партии) или triptych (5)', 'duel') ?? 'duel';
      const sponsor = Number(prompt('спонсорский фонд (пигменты)', '100') ?? 0);
      const out = await api('/api/tournament', 'POST', { name, kind, sponsor, playerId: ui.player.id });
      if (!out.ok) box.insertAdjacentHTML('beforeend', `<p>${out.reason}</p>`);
      renderSocial();
    };
    const call = (cls, fn) => box.querySelectorAll(cls).forEach((b) => {
      b.onclick = async () => {
        const out = await fn(b.dataset.tid);
        if (out && !out.ok) box.insertAdjacentHTML('beforeend', `<p>${out.reason}</p>`);
        renderSocial();
      };
    });
    call('.tEnter', (tid) => api(`/api/tournament/${tid}/enter`, 'POST', { playerId: ui.player.id }));
    call('.tStart', (tid) => api(`/api/tournament/${tid}/start`, 'POST', {}));
    call('.tFinish', (tid) => api(`/api/tournament/${tid}/finish`, 'POST', {}));
    box.querySelectorAll('.tPlay').forEach((b) => {
      b.onclick = () => startSession('tournament', { tournamentId: b.dataset.tid });
    });
    box.querySelectorAll('.tTable').forEach((b) => {
      b.onclick = async () => {
        const out = await api(`/api/tournament/${b.dataset.tid}`);
        $('tTableBox').innerHTML = out.ok
          ? `<p><b>${out.tournament.name}</b> · фонд ${out.tournament.prizePool.total}</p><ol>${out.standings.map((r) => `#${r.rank} ${r.playerId.slice(0, 10)}… · медиана ${r.median} · партий ${r.played}`).join('') || '<li>партий нет</li>'}</ol>`
          : `<p>${out.reason}</p>`;
      };
    });
  }
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
