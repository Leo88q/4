import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'palimpsest-tourn-'));
const { startServer } = await import('../src/index.js');
const { Store } = await import('../src/store.js');
const { createAuction, placeBid, settleAuction } = await import('../src/social/auction.js');
const {
  TOURNAMENT_KINDS, tournamentSeed, PRIZE_SPLIT, createTournament, enterTournament,
  startTournament, assignRound, recordRound, finishTournament, standings,
} = await import('../src/tournament.js');

test('комиссия Тихого торга → казна 50/30/20; фонд турнира — из комиссий и спонсора, не из взносов', async () => {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'palimpsest-tourn-unit-')));
  await store.putPlayer({ id: 'plr_sell', name: 'Продавец', pigments: 0, address: '0x1' });
  await store.putPlayer({ id: 'plr_buy', name: 'Покупатель', pigments: 500, address: '0x2' });
  await store.putArtifact({
    id: 'art_x', playerId: 'plr_sell', playerName: 'Продавец', playerAddress: '0x1',
    score: { total: 50 }, meta: { title: 'Холст' }, flags: [],
  });

  const a = await createAuction(store, { artifactId: 'art_x', sellerId: 'plr_sell', minBid: 10 });
  await placeBid(store, a.id, { playerId: 'plr_buy', amount: 200 });
  a.endsAt = Date.now() - 1000; // время истекло
  await store.putAuction(a);
  await settleAuction(store, a.id);

  const fee = Math.floor((200 * 500) / 10_000); // 5% = 10
  assert.equal(fee, 10);
  assert.equal(store.treasury.prize, Math.round(fee * 0.5), '50% комиссии — призовой фонд');
  assert.equal(store.treasury.guild, Math.round(fee * 0.3), '30% — гильдиям');
  assert.equal(store.treasury.dev, fee - Math.round(fee * 0.5) - Math.round(fee * 0.3), '20% — развитие');

  const t = await createTournament(store, { name: 'Кубок Смотрителя', kind: 'duel', sponsor: 300 });
  assert.equal(t.sessions, TOURNAMENT_KINDS.duel.sessions);
  await enterTournament(store, t, 'plr_sell');
  await enterTournament(store, t, 'plr_buy');
  // вход свободный: балансы не тронуты
  assert.equal((await store.getPlayer('plr_buy')).pigments, 300);

  await startTournament(store, t);
  assert.equal(t.prizePool.fromTreasury, 5, 'комиссии ушли в фонд');
  assert.equal(t.prizePool.total, 305);
  assert.equal(store.treasury.prize, 0, 'казна призового фонда обнулена');
  // равный старт: один и тот же сид раунда у всех
  assert.equal(assignRound(t, 'plr_sell').seed, tournamentSeed(t.id, 1));
  assert.equal(assignRound(t, 'plr_buy').seed, tournamentSeed(t.id, 1));

  for (let r = 1; r <= t.sessions; r += 1) {
    await recordRound(store, t, 'plr_sell', { round: r, seed: tournamentSeed(t.id, r), scoreIndex: 40 + r, timeMs: 900 });
    await recordRound(store, t, 'plr_buy', { round: r, seed: tournamentSeed(t.id, r), scoreIndex: 60 + r, timeMs: 1100 });
  }

  const rows = standings(t);
  assert.equal(rows[0].playerId, 'plr_buy', 'медиана покупателя выше');
  assert.equal(rows[0].median, 62);

  const rewards = await finishTournament(store, t);
  assert.equal(rewards.places.length, 2);
  assert.equal(rewards.places[0].amount, Math.round(305 * PRIZE_SPLIT[0]));
  assert.equal(rewards.places[1].amount, Math.round(305 * PRIZE_SPLIT[1]));
  const winner = await store.getPlayer('plr_buy');
  assert.equal(winner.pigments, 500 - 200 + Math.round(305 * PRIZE_SPLIT[0]));
  assert.equal(winner.cinnabar, 10, 'титул даёт Киноварь');
  assert.equal(t.status, 'finished');
});

test('API турнира: заявки, партии через сессии, таблица, призы', async (t) => {
  const { server, port } = await startServer({ port: 0 });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${port}`;
  const post = (p, body) => fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  const get = (p) => fetch(base + p).then((r) => r.json());

  const log = (t0) => [
    { type: 'diagnose', findings: ['varnish_darkening'], t: t0 },
    { type: 'solvent', x: 0.5, y: 0.5, r: 0.3, strength: 0.55, t: t0 + 200 },
    { type: 'wipe', x: 0.5, y: 0.5, r: 0.3, t: t0 + 400 },
    { type: 'varnish', kind: 1, thickness: 0.7, t: t0 + 600 },
    { type: 'finish', t: t0 + 800 },
  ];

  const players = [];
  for (const name of ['Мара', 'Пётр', 'Юнона']) {
    const { player } = await post('/api/player', { name });
    players.push(player);
  }

  const created = await post('/api/tournament', { name: 'Триптих осени', kind: 'triptych', sponsor: 100 });
  assert.equal(created.ok, true, JSON.stringify(created));
  const tid = created.tournament.id;
  assert.equal(created.tournament.sessions, TOURNAMENT_KINDS.triptych.sessions);

  for (const p of players) {
    const e = await post(`/api/tournament/${tid}/enter`, { playerId: p.id });
    assert.equal(e.ok, true, JSON.stringify(e));
  }
  const dup = await post(`/api/tournament/${tid}/enter`, { playerId: players[0].id });
  assert.equal(dup.reason, 'already_entered');

  const started = await post(`/api/tournament/${tid}/start`, {});
  assert.equal(started.ok, true);
  assert.equal(started.tournament.prizePool.total, 100, 'фонд = спонсор (взносов нет)');

  const seeds = new Map();
  for (let r = 1; r <= created.tournament.sessions; r += 1) {
    for (const p of players) {
      const ses = await post('/api/session', { playerId: p.id, kind: 'tournament', tournamentId: tid });
      assert.equal(ses.ok, true, JSON.stringify(ses));
      if (!seeds.has(r)) seeds.set(r, ses.seed);
      assert.equal(ses.seed, seeds.get(r), `равный старт: сид раунда ${r} одинаков у всех`);
      const fin = await post(`/api/session/${ses.sessionId}/finish`, { actions: log(1800000200000 + r * 10000) });
      assert.equal(fin.ok, true, JSON.stringify(fin));
      assert.equal(fin.tournament.tournamentId, tid);
      assert.equal(fin.tournament.round, r);
    }
  }

  // лишняя партия невозможна
  const extra = await post('/api/session', { playerId: players[0].id, kind: 'tournament', tournamentId: tid });
  assert.equal(extra.reason, 'all_sessions_played');

  const view = await get(`/api/tournament/${tid}`);
  assert.equal(view.ok, true);
  assert.equal(view.standings.length, 3);
  for (const row of view.standings) assert.equal(row.played, TOURNAMENT_KINDS.triptych.sessions);
  assert.ok(view.standings[0].median >= view.standings[1].median);

  const finT = await post(`/api/tournament/${tid}/finish`, {});
  assert.equal(finT.ok, true, JSON.stringify(finT));
  assert.equal(finT.tournament.status, 'finished');
  const places = finT.tournament.rewards.places;
  assert.equal(places.length, 3);
  assert.equal(places[0].amount, Math.round(100 * PRIZE_SPLIT[0]));
  assert.equal(places[1].amount, Math.round(100 * PRIZE_SPLIT[1]));
  assert.equal(places[2].amount, Math.round(100 * PRIZE_SPLIT[2]));
  // победитель получил и приз, и опыт Манифеста за партии
  const champ = await get(`/api/season?playerId=${places[0].playerId}`);
  assert.ok(champ.manifest.xp >= 5 * 30, 'опыт за 5 турнирных партий');
  assert.ok(champ.stats.tournamentWins >= 1);
});
