import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'palimpsest-dao-'));
const { startServer } = await import('../src/index.js');
const { Store } = await import('../src/store.js');
const { createGuild } = await import('../src/social/guilds.js');
const {
  createProposal, voteProposal, closeProposal, tally, proposalView, PROPOSAL_KINDS,
} = await import('../src/dao.js');

test('proto-DAO: вес голоса = престиж Мастерской, тема следующей главы', async () => {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'palimpsest-dao-unit-')));
  // p1 — мастер с эталонной работой (престиж выше), p2 — новичок
  await store.putPlayer({ id: 'p1', name: 'Мара', pigments: 0, address: '0x1' });
  await store.putPlayer({ id: 'p2', name: 'Кай', pigments: 0, address: '0x2' });
  await store.putArtifact({
    id: 'art_1', playerId: 'p1', playerName: 'Мара', playerAddress: '0x1',
    score: { total: 92 }, meta: { title: 'Портрет' }, kind: 'private', flags: [],
  });
  await store.putArtifact({
    id: 'art_2', playerId: 'p2', playerName: 'Кай', playerAddress: '0x2',
    score: { total: 20 }, meta: { title: 'Набросок' }, kind: 'private', flags: [],
  });
  const g1 = await createGuild(store, { name: 'Схрон', playerId: 'p1' });
  const g2 = await createGuild(store, { name: 'Пепел', playerId: 'p2' });

  const p = await createProposal(store, {
    kind: 'theme', authorPlayerId: 'p1',
    options: ['Чёрный лак', 'Соль и влага'],
  });
  assert.equal(p.status, 'open');

  await voteProposal(store, p.id, { playerId: 'p2', option: 'Соль и влага' });
  await voteProposal(store, p.id, { playerId: 'p1', option: 'Чёрный лак' });
  // одна Мастерская — один голос
  await assert.rejects(
    () => voteProposal(store, p.id, { playerId: 'p1', option: 'Соль и влага' }),
    /guild_already_voted/,
  );

  const rows = tally(p);
  assert.equal(rows[0].option, 'Чёрный лак', 'престиж Мары перевешивает');
  assert.ok(rows[0].weight > rows[1].weight, 'вес = престиж');

  const { proposal, effect } = await closeProposal(store, p.id);
  assert.equal(proposal.result.winner, 'Чёрный лак');
  assert.equal(effect.nextTheme, 'Чёрный лак');
  assert.equal(store.dao.nextTheme, 'Чёрный лак');
  // повторное закрытие нельзя
  await assert.rejects(() => closeProposal(store, p.id), /proposal_closed/);
});

test('proto-DAO: спонсорство переносит казну развития в призовой фонд', async () => {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'palimpsest-dao-sponsor-')));
  await store.putPlayer({ id: 'p1', name: 'Мара', pigments: 0, address: '0x1' });
  await createGuild(store, { name: 'Схрон', playerId: 'p1' });
  store.treasury.dev = 100;
  store.treasury.prize = 5;

  const p = await createProposal(store, { kind: 'sponsor', authorPlayerId: 'p1' });
  await voteProposal(store, p.id, { playerId: 'p1', option: '100%' });
  const { effect } = await closeProposal(store, p.id);
  assert.equal(effect.movedToPrize, 100);
  assert.equal(store.treasury.dev, 0);
  assert.equal(store.treasury.prize, 105);
});

test('API proto-DAO: предложение, голоса Мастерских, ничья по времени, закрытие', async (t) => {
  const { server, port } = await startServer({ port: 0 });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${port}`;
  const post = (p, body) => fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  const get = (p) => fetch(base + p).then((r) => r.json());

  const { player: p1 } = await post('/api/player', { name: 'Мара' });
  const { player: p2 } = await post('/api/player', { name: 'Кай' });
  await post('/api/guild', { name: 'Схрон', playerId: p1.id });
  await post('/api/guild', { name: 'Пепел', playerId: p2.id });

  // без Мастерской голосовать нельзя
  const { player: loner } = await post('/api/player', { name: 'Одиночка' });
  const lonely = await post('/api/dao/proposal', { kind: 'theme', authorPlayerId: loner.id });
  assert.equal(lonely.reason, 'not_in_guild');

  const created = await post('/api/dao/proposal', {
    kind: 'theme', authorPlayerId: p1.id, options: ['Чёрный лак', 'Огненная летопись'],
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  const pid = created.proposal.id;
  assert.equal(created.proposal.status, 'open');

  const v1 = await post(`/api/dao/proposal/${pid}/vote`, { playerId: p1.id, option: 'Чёрный лак' });
  assert.equal(v1.ok, true, JSON.stringify(v1));
  const v2 = await post(`/api/dao/proposal/${pid}/vote`, { playerId: p2.id, option: 'Огненная летопись' });
  assert.equal(v2.ok, true);
  const dup = await post(`/api/dao/proposal/${pid}/vote`, { playerId: p2.id, option: 'Чёрный лак' });
  assert.equal(dup.reason, 'guild_already_voted');

  // престиж обеих Мастерских равен (1) — ничья → побеждает раньше проголосовавший
  const closed = await post(`/api/dao/proposal/${pid}/close`, {});
  assert.equal(closed.ok, true, JSON.stringify(closed));
  assert.equal(closed.proposal.result.winner, 'Чёрный лак');
  assert.equal(closed.effect.nextTheme, 'Чёрный лак');

  const dao = await get('/api/dao');
  assert.equal(dao.state.nextTheme, 'Чёрный лак');
  assert.ok(dao.state.closed.some((x) => x.id === pid));

  const book = await get('/api/book');
  const events = book.entries.filter((e) => e.type === 'dao').map((e) => e.payload.event);
  assert.ok(events.includes('proposal_opened') && events.includes('proposal_closed'));
  assert.ok(PROPOSAL_KINDS.theme.options.length >= 2);
});
