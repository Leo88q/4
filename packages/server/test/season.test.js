import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'palimpsest-season-'));
const { startServer } = await import('../src/index.js');
const {
  seasonIdFor, ensureManifest, grantManifestXp, levelForXp, xpForLevel,
  rewardsForLevel, claimManifestRewards, unlockManifestPremium, awardTier,
  seasonEntriesFromBook, MANIFEST_MAX_LEVEL, MANIFEST_REWARDS,
} = await import('../src/season.js');

test('сезон: id по кварталу, опыт и уровни Манифеста', () => {
  assert.match(seasonIdFor(Date.UTC(2026, 9, 12)), /^palimpsest-season-v1:2026-Q4$/);
  assert.match(seasonIdFor(Date.UTC(2027, 0, 1)), /^palimpsest-season-v1:2027-Q1$/);

  const player = { id: 'p' };
  const m = ensureManifest(player, Date.UTC(2026, 9, 12));
  assert.equal(m.seasonId, 'palimpsest-season-v1:2026-Q4');
  assert.equal(m.level, 0);

  grantManifestXp(player, 'session'); // +20
  grantManifestXp(player, 'session'); // +40
  assert.equal(player.manifest.xp, 40);
  assert.equal(player.manifest.level, 0, 'до 100 опыта уровень не растёт');
  for (let i = 0; i < 3; i += 1) grantManifestXp(player, 'session'); // 100
  assert.equal(player.manifest.level, 1);
  assert.equal(levelForXp(xpForLevel(12)), MANIFEST_MAX_LEVEL);

  // новый сезон обнуляет Манифест (глава меняется)
  const next = ensureManifest(player, Date.UTC(2027, 0, 1));
  assert.equal(next.seasonId, 'palimpsest-season-v1:2027-Q1');
  assert.equal(next.xp, 0);
});

test('Манифест: премиум — только косметика, выдача без дублей', () => {
  const player = { id: 'p' };
  grantManifestXp(player, 'session');
  for (let i = 0; i < 4; i += 1) grantManifestXp(player, 'session'); // level 1

  // бесплатный трек отдаёт базовые награды; премиум добавляет косметику
  const free = rewardsForLevel(1, false);
  const prem = rewardsForLevel(1, true);
  assert.ok(prem.length > free.length);
  // pay-to-win запрещён: премиум-трек не содержит валюты и очков
  for (const items of Object.values(MANIFEST_REWARDS.premium)) {
    for (const item of items) {
      assert.ok(!/Пигменты|Киноварь|Index|опыт/i.test(item), `премиум-награда «${item}» даёт силу`);
    }
  }

  const claimed1 = claimManifestRewards(player, 1);
  assert.ok(claimed1.length >= 1);
  // второй раз на тот же уровень — нечего забирать (без дублей)
  assert.throws(() => claimManifestRewards(player, 1), /nothing_to_claim/);
  assert.throws(() => claimManifestRewards(player, 5), /level_not_reached/);

  unlockManifestPremium(player);
  assert.equal(player.manifest.premium, true);
  assert.throws(() => unlockManifestPremium(player), /already_unlocked/);
  // после разблокировки доступны премиум-награды уже достигнутого уровня
  const extra = claimManifestRewards(player, 1);
  assert.ok(extra.includes('Тема «Лазурит»'));
  assert.ok(player.cosmetics.includes('Тема «Лазурит»'));
});

test('иерархия Аттестата: Бронза → Серебро → Золото → Лазурит', () => {
  assert.equal(awardTier({ verifiedSessions: 1 }), null);
  assert.equal(awardTier({ verifiedSessions: 5 }), 'Бронзовый слой');
  assert.equal(awardTier({ verifiedSessions: 20 }), 'Серебряный слой');
  assert.equal(awardTier({ verifiedSessions: 50 }), 'Золотой слой');
  assert.equal(awardTier({ tournamentWins: 1 }), 'Золотой слой');
  // Лазурит — только лучший за сезон (титул + весомый вклад)
  assert.notEqual(awardTier({ tournamentWins: 1, verifiedSessions: 5 }), 'Лазуритовый слой');
  assert.equal(awardTier({ tournamentWins: 1, verifiedSessions: 20 }, true), 'Лазуритовый слой');
});

test('проекция Книги на сезонные события', () => {
  const book = [
    { type: 'act', playerId: 'p1' },
    { type: 'tournament_round', playerId: 'p1' },
    { type: 'exhibit', playerId: 'p1' },
    {
      type: 'tournament',
      playerId: 'p1',
      payload: { event: 'finished', rewards: { places: [{ rank: 1, playerId: 'p1' }, { rank: 2, playerId: 'p2' }] } },
    },
    { type: 'act', playerId: 'p2' },
  ];
  const s1 = seasonEntriesFromBook(book, 'p1');
  const s2 = seasonEntriesFromBook(book, 'p2');
  assert.equal(s1.filter((e) => e.type === 'session').length, 1);
  assert.equal(s1.filter((e) => e.type === 'tournament_win').length, 1);
  assert.equal(s2.filter((e) => e.type === 'tournament_top3').length, 1);
  assert.equal(s2.filter((e) => e.type === 'tournament_win').length, 0);
});

test('API сезона: /api/season, разблокировка за Киноварь, забор наград', async (t) => {
  const { server, port } = await startServer({ port: 0 });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${port}`;
  const post = (p, body) => fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  const get = (p) => fetch(base + p).then((r) => r.json());

  const { player } = await post('/api/player', { name: 'Татьяна' });
  const season = await get(`/api/season?playerId=${player.id}`);
  assert.equal(season.ok, true);
  assert.match(season.seasonId, /^palimpsest-season-v1:/);
  assert.equal(season.manifest.level, 0);
  assert.ok(Array.isArray(season.xpSources));

  // премиум стоит 100 Киновари — свежий игрок получить его не может
  const unlock = await post('/api/season/manifest/unlock', { playerId: player.id });
  assert.equal(unlock.reason, 'not_enough_cinnabar');

  // реставрация приносит опыт Манифеста
  const T0 = 1800000100000;
  const ses = await post('/api/session', { playerId: player.id, kind: 'private' });
  const fin = await post(`/api/session/${ses.sessionId}/finish`, {
    actions: [
      { type: 'diagnose', findings: ['varnish_darkening'], t: T0 },
      { type: 'solvent', x: 0.5, y: 0.5, r: 0.3, strength: 0.55, t: T0 + 200 },
      { type: 'wipe', x: 0.5, y: 0.5, r: 0.3, t: T0 + 400 },
      { type: 'varnish', kind: 1, thickness: 0.7, t: T0 + 600 },
      { type: 'finish', t: T0 + 800 },
    ],
  });
  assert.equal(fin.ok, true, JSON.stringify(fin));
  assert.equal(fin.manifest.xp, 20, 'сессия даёт 20 опыта');

  const season2 = await get(`/api/season?playerId=${player.id}`);
  assert.equal(season2.manifest.xp, 20);
  assert.equal(season2.stats.verifiedSessions, 1);

  // забрать награду уровня, которого нет — отказ
  const claim = await post('/api/season/manifest/claim', { playerId: player.id, level: 1 });
  assert.equal(claim.reason, 'level_not_reached');
});
