import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'palimpsest-pg-'));
const { PGlite } = await import('@electric-sql/pglite');
const { PgStore } = await import('../src/store.postgres.js');
const { startServer } = await import('../src/index.js');
const { simulate, generate } = await import('@palimpsest/sim');

const T0 = 1800000000000;

function actionsLog(seed) {
  const puzzle = generate(seed);
  let t = T0;
  return [
    { type: 'diagnose', findings: puzzle.findings, t }, 
    { type: 'solvent', x: 0.5, y: 0.5, r: 0.3, strength: 0.55, t: (t += 200) },
    { type: 'wipe', x: 0.5, y: 0.5, r: 0.3, t: (t += 200) },
    { type: 'varnish', kind: 0, thickness: 0.4, t: (t += 200) },
    { type: 'finish', t: (t += 200) },
  ];
}

test('PostgreSQL store (PGlite): full flow, persistence, book chain', async (t) => {
  const db = new PGlite();
  const store = new PgStore(db);
  await store.load();

  const { server, port } = await startServer({ port: 0, store });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${port}`;
  const post = (p, body) => fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  const get = (p) => fetch(base + p).then((r) => r.json());

  const { player } = await post('/api/player', { name: 'Ирма' });
  const ses = await post('/api/session', { playerId: player.id, kind: 'daily' });
  const acts = actionsLog(ses.seed);
  const client = simulate(ses.seed, acts);
  const fin = await post(`/api/session/${ses.sessionId}/finish`, {
    actions: acts,
    clientStateHash: client.stateHash,
  });
  assert.equal(fin.ok, true, JSON.stringify(fin));
  assert.equal(fin.artifact.stateHashMatch, true);
  assert.ok(Number.isInteger(fin.artifact.bookSeq));

  const art = await get(`/api/artifact/${fin.artifact.id}`);
  assert.equal(art.ok, true);
  assert.equal(art.provenance.merkleRoot, fin.artifact.actionsMerkle);

  const lb = await get('/api/leaderboard');
  assert.ok(lb.rows.some((r) => r.player === 'Ирма'));

  const att = await get(`/api/attestation/${player.id}`);
  assert.equal(att.attestation.works, 1);
  assert.equal(att.attestation.name, 'Ирма');

  const book = await get('/api/book');
  assert.equal(book.verified, true);
  assert.ok(book.total >= 1);

  // rows really landed in SQL
  const { rows } = await db.query("SELECT COUNT(*)::int AS n FROM artifacts");
  assert.equal(rows[0].n, 1);

  // durability: a fresh store over the same database rebuilds the book intact
  const store2 = new PgStore(db);
  await store2.load();
  assert.equal(store2.book.verify().ok, true);
  assert.equal(store2.book.entries.length, store.book.entries.length);
  const reloaded = await store2.getArtifact(fin.artifact.id);
  assert.equal(reloaded.id, fin.artifact.id);

  // tamper detection survives the SQL round-trip
  store2.book.entries[0].payload.total = 100;
  assert.equal(store2.book.verify().ok, false);
});

test('PostgreSQL store: сезонные слои — торг/казна, турниры, DAO, rewarded, глава', async (t) => {
  const db = new PGlite();
  const store = new PgStore(db);
  await store.load();
  const { createGuild } = await import('../src/social/guilds.js');
  const { createAuction, placeBid, settleAuction } = await import('../src/social/auction.js');
  const {
    createTournament, enterTournament, startTournament, recordRound, finishTournament,
    tournamentSeed,
  } = await import('../src/tournament.js');
  const { createProposal, voteProposal, closeProposal } = await import('../src/dao.js');
  const { chapterWeekSeed, resolveChapter } = await import('../src/chapter.js');

  await store.putPlayer({ id: 'pg_a', name: 'Мара', pigments: 300, address: '0xa' });
  await store.putPlayer({ id: 'pg_b', name: 'Кай', pigments: 500, address: '0xb' });
  const art = (id, playerId, total, extra = {}) => ({
    id, playerId, playerName: 'Мара', playerAddress: '0xa', kind: 'private',
    date: '2026-10-12', seed: 's', score: { total }, meta: { title: id },
    flags: [], createdAt: Date.now(), ...extra,
  });
  await store.putArtifact(art('art_pg1', 'pg_a', 60));
  await store.putArtifact(art('art_pg2', 'pg_a', 92, { conservation: { kind: 1, thickness: 0.5 } }));

  // ---- Тихий торг: комиссия 50/30/20 в казну ----
  const auc = await createAuction(store, { artifactId: 'art_pg1', sellerId: 'pg_a', minBid: 10 });
  await placeBid(store, auc.id, { playerId: 'pg_b', amount: 200 });
  // PgStore отдаёт копии документов — перечитываем перед правкой
  const auc2 = await store.getAuction(auc.id);
  auc2.endsAt = Date.now() - 1000;
  await store.putAuction(auc2);
  await settleAuction(store, auc.id);
  const fee = Math.floor((200 * 500) / 10_000);
  assert.equal(store.treasury.prize, Math.round(fee * 0.5));

  // ---- турнир: фонд из казны, призы 50/30/20, долговременность ----
  const trn = await createTournament(store, { name: 'Кубок', kind: 'duel', sponsor: 100 });
  await enterTournament(store, trn, 'pg_a');
  await enterTournament(store, trn, 'pg_b');
  await startTournament(store, trn);
  assert.equal(trn.prizePool.fromTreasury, Math.round(fee * 0.5), 'фонд = спонсор + комиссии');
  for (let r = 1; r <= trn.sessions; r += 1) {
    for (const [pid, sc] of [['pg_a', 50], ['pg_b', 70]]) {
      await recordRound(store, trn, pid, {
        round: r, seed: tournamentSeed(trn.id, r), scoreIndex: sc, timeMs: 100,
      });
    }
  }
  await finishTournament(store, trn);
  assert.equal(trn.status, 'finished');

  // ---- DAO: голос Мастерской активирует главу II ----
  await createGuild(store, { name: 'Схрон', playerId: 'pg_a' });
  const prop = await createProposal(store, {
    kind: 'theme', authorPlayerId: 'pg_a', options: ['Чёрный лак', 'Соль и влага'],
  });
  await voteProposal(store, prop.id, { playerId: 'pg_a', option: 'Чёрный лак' });
  await closeProposal(store, prop.id);
  assert.equal(store.dao.activeChapterId, 'chapter-2-black-lacquer');

  // ---- долговременность: свежий PgStore над той же БД видит всё ----
  const store2 = new PgStore(db);
  await store2.load();
  assert.equal(store2.treasury.prize, 0, 'казна призового фонда обнулена и сохранена');
  assert.equal(store2.treasury.dev, fee - Math.round(fee * 0.5) - Math.round(fee * 0.3));
  assert.equal(store2.dao.activeChapterId, 'chapter-2-black-lacquer', 'решение DAO пережило перезагрузку');
  const trn2 = await store2.getTournament(trn.id);
  assert.equal(trn2.status, 'finished');
  assert.equal(trn2.rewards.places[0].playerId, 'pg_b');
  const prop2 = await store2.getProposal(prop.id);
  assert.equal(prop2.status, 'closed');
  assert.equal((await store2.getPlayer('pg_b')).cinnabar, 10, 'Киноварь чемпиону сохранена');

  // ---- API поверх PgStore: rewarded и заказ главы ----
  const { server, port } = await startServer({ port: 0, store: store2 });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${port}`;
  const post = (p, body) => fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  const get = (p) => fetch(base + p).then((r) => r.json());

  const rew = await post('/api/rewarded', { playerId: 'pg_a' });
  assert.equal(rew.ok, true, JSON.stringify(rew));
  assert.equal(rew.granted, 20);

  const ch = await get(`/api/chapter?playerId=pg_a`);
  assert.equal(ch.chapter.id, 'chapter-2-black-lacquer', 'глава из решения DAO');
  const ses = await post('/api/session', { playerId: 'pg_a', kind: 'chapter' });
  assert.equal(ses.seed, chapterWeekSeed(resolveChapter(store2.dao.activeChapterId)));
});
