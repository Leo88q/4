import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simulate, generate, createState, applyAction, stateBytes, score } from '@palimpsest/sim';
import { sha256Hex, hashObject } from '@palimpsest/common';

// isolate persistence before the server config is loaded
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'palimpsest-'));
const { startServer } = await import('../src/index.js');

const T0 = 1800000000000;

function actionsLog(seed, { good = true } = {}) {
  const puzzle = generate(seed);
  const acts = [];
  let t = T0;
  const push = (a) => { acts.push({ ...a, t }); t += 200; };
  push({ type: 'diagnose', findings: good ? puzzle.findings : ['varnish_darkening'] });
  push({ type: 'solvent', x: 0.5, y: 0.5, r: 0.3, strength: good ? 0.55 : 1.0 });
  push({ type: 'wipe', x: 0.5, y: 0.5, r: 0.3 });
  push({ type: 'varnish', kind: 0, thickness: 0.4 });
  push({ type: 'finish' });
  return acts;
}

test('API: full restoration flow is server-authoritative', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'palimpsest-'));
  const { server, port, store } = await startServer({ port: 0 });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${port}`;
  const post = (p, body) => fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  const get = (p) => fetch(base + p).then((r) => r.json());

  void dataDir;

  const health = await get('/api/health');
  assert.equal(health.ok, true);

  const daily = await get('/api/daily');
  assert.equal(daily.ok, true);
  assert.match(daily.seed, /^palimpsest-daily-v1:\d{4}-\d{2}-\d{2}/);
  assert.equal(daily.spec.findings, undefined, 'ground truth must not leak to clients');

  const { player } = await post('/api/player', { name: 'Мара' });
  assert.ok(player.address.length >= 32);

  const ses = await post('/api/session', { playerId: player.id, kind: 'daily' });
  assert.equal(ses.ok, true);

  const acts = actionsLog(ses.seed, { good: true });
  const client = simulate(ses.seed, acts);
  assert.equal(client.ok, true);

  const fin = await post(`/api/session/${ses.sessionId}/finish`, {
    actions: acts,
    clientStateHash: client.stateHash,
  });
  assert.equal(fin.ok, true, JSON.stringify(fin));
  assert.ok(fin.artifact.score.total >= 0 && fin.artifact.score.total <= 100);
  assert.equal(fin.artifact.stateHashMatch, true);
  assert.equal(fin.artifact.actionsMerkle.length, 64);
  assert.ok(Number.isInteger(fin.artifact.bookSeq));

  const art = await get(`/api/artifact/${fin.artifact.id}`);
  assert.equal(art.ok, true);
  assert.equal(art.provenance.merkleRoot, fin.artifact.actionsMerkle);

  const meta = await get(`/api/artifact/${fin.artifact.id}/metadata`);
  assert.equal(meta.symbol, 'PLSMT');
  assert.equal(meta.properties.seed, ses.seed);

  const lb = await get('/api/leaderboard');
  assert.ok(lb.rows.some((r) => r.player === 'Мара'));

  const att = await get(`/api/attestation/${player.id}`);
  assert.equal(att.attestation.works, 1);
  assert.equal(att.attestation.name, 'Мара');

  const book = await get('/api/book');
  assert.equal(book.verified, true);
  assert.ok(book.total >= 1);

  // tamper with the book -> verification fails
  store.book.entries[0].payload.total = 100;
  const book2 = await get('/api/book');
  assert.equal(book2.verified, false);
  assert.equal(book2.brokenAt, 0);
});

test('API: anti-cheat rejects too-fast logs and flags client mismatch', async (t) => {
  const { server, port } = await startServer({ port: 0 });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${port}`;
  const post = (p, body) => fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

  const { player } = await post('/api/player', { name: 'Лис' });
  const ses = await post('/api/session', { playerId: player.id, kind: 'private' });

  // 10ms gaps -> too_fast
  const fast = [
    { type: 'diagnose', findings: [], t: T0 },
    { type: 'finish', t: T0 + 10 },
  ];
  const rejected = await post(`/api/session/${ses.sessionId}/actions`, { actions: fast });
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason, /too_fast/);

  const acts = actionsLog(ses.seed, { good: false });
  const client = simulate(ses.seed, acts);
  const fin = await post(`/api/session/${ses.sessionId}/finish`, {
    actions: acts,
    clientStateHash: sha256Hex('tampered'),
  });
  assert.equal(fin.ok, true);
  assert.equal(fin.artifact.stateHashMatch, false);
  assert.ok(fin.artifact.flags.includes('client_mismatch'));

  // second finish on the same session is impossible
  const again = await post(`/api/session/${ses.sessionId}/finish`, { actions: acts });
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'already_finished');
  void client;
});

test('sim scoring is reachable through replay parity', () => {
  const seed = 'palimpsest-daily-v1:2026-10-11';
  const puzzle = generate(seed);
  const acts = actionsLog(seed);
  const a = simulate(seed, acts);
  const state = createState(puzzle);
  for (const act of acts) applyAction(state, puzzle, act);
  const b = score(puzzle, state);
  assert.equal(a.score.total, b.total);
  assert.equal(a.stateHash, sha256Hex(stateBytes(state)));
  assert.equal(hashObject(acts).length, 64);
});
