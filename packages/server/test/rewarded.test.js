import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'palimpsest-rewarded-'));
const { startServer } = await import('../src/index.js');
const { REWARDED, rewardedState, watchedToday } = await import('../src/rewarded.js');

test('rewarded: честные ограничения — только Пигменты, лимит в день', () => {
  assert.equal(REWARDED.dailyCap, 3);
  // pay-to-win запрещён: грант не покупает Индекс и Киноварь
  assert.ok(!('cinnabar' in REWARDED) && !('score' in REWARDED));

  const entries = [
    { type: 'rewarded', playerId: 'p1', payload: { date: '2026-10-12' } },
    { type: 'rewarded', playerId: 'p1', payload: { date: '2026-10-12' } },
    { type: 'rewarded', playerId: 'p1', payload: { date: '2026-10-11' } },
    { type: 'rewarded', playerId: 'p2', payload: { date: '2026-10-12' } },
  ];
  const now = Date.UTC(2026, 9, 12, 12);
  assert.equal(watchedToday(entries, 'p1', now), 2, 'вчера не считается');
  const st = rewardedState(entries, 'p1', now);
  assert.equal(st.watchedToday, 2);
  assert.equal(st.left, 1);
  assert.equal(st.grant, REWARDED.pigmentGrant);
});

test('API rewarded: гранты, дневной лимит, запись в Книгу', async (t) => {
  const { server, port } = await startServer({ port: 0 });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${port}`;
  const post = (p, body) => fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  const get = (p) => fetch(base + p).then((r) => r.json());

  const { player } = await post('/api/player', { name: 'Зритель' });
  const st0 = await get(`/api/rewarded?playerId=${player.id}`);
  assert.equal(st0.ok, true);
  assert.equal(st0.left, REWARDED.dailyCap);

  for (let i = 1; i <= REWARDED.dailyCap; i += 1) {
    const g = await post('/api/rewarded', { playerId: player.id, adToken: 'mock' });
    assert.equal(g.ok, true, JSON.stringify(g));
    assert.equal(g.granted, REWARDED.pigmentGrant);
    assert.equal(g.left, REWARDED.dailyCap - i);
    assert.equal(g.pigments, i * REWARDED.pigmentGrant, 'только Пигменты');
  }

  const over = await post('/api/rewarded', { playerId: player.id });
  assert.equal(over.reason, 'daily_cap');

  const book = await get('/api/book');
  const grants = book.entries.filter((e) => e.type === 'rewarded' && e.playerId === player.id);
  assert.equal(grants.length, REWARDED.dailyCap, 'каждый грант в Книге');
});
