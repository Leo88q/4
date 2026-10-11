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
