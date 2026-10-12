import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'palimpsest-chapter-'));
const { startServer } = await import('../src/index.js');
const {
  CHAPTERS, currentChapter, getChapter, getChapterByTheme, resolveChapter,
  chapterCard, chapterWeekSeed, isoWeek,
  questProgress, CHAPTER_ORDER_BONUS,
} = await import('../src/chapter.js');

test('глава I «Великое Потемнение»: карточка и недельный сид заказа', () => {
  const ch = currentChapter();
  assert.equal(ch.id, 'chapter-1-darkening');
  assert.equal(ch.title, 'Великое Потемнение');
  assert.match(ch.hook, /Серая Дымка|Дымк|Схрон/i, 'легенда — голос мира docs/lore.md §2');
  assert.ok(ch.quests.length >= 5);

  const card = chapterCard(ch);
  assert.equal(card.number, 1);
  assert.equal(card.orderBonus, CHAPTER_ORDER_BONUS);
  assert.match(card.weekSeed, /^palimpsest-chapter-v1:chapter-1-darkening:\d{4}-W\d{2}$/);

  // детерминизм недели: в пределах одной недели сид один, у разных глав — разный
  const t = Date.UTC(2026, 9, 12);
  assert.equal(isoWeek(t), isoWeek(t + 2 * 86400000));
  assert.equal(chapterWeekSeed(ch, t), chapterWeekSeed(ch, t + 2 * 86400000));
  assert.notEqual(chapterWeekSeed(ch, t), chapterWeekSeed(ch, t + 14 * 86400000));
  assert.equal(getChapter('chapter-1-darkening'), ch);
  assert.equal(getChapter('nope'), null);
});

test('глава II «Чёрный лак»: реестр, метрики квестов, выбор DAO важнее календаря', () => {
  const ch2 = getChapter('chapter-2-black-lacquer');
  assert.ok(ch2, 'глава II в реестре');
  assert.equal(ch2.theme, 'Чёрный лак', 'тема совпадает с вариантом голосования DAO');
  assert.equal(ch2.seasonId, 'palimpsest-season-v1:2027-Q1');
  assert.match(ch2.hook, /лак|слой/i);

  // календарь: со следующего сезона глава II становится текущей
  assert.equal(currentChapter(Date.UTC(2027, 1, 1)).id, 'chapter-2-black-lacquer');
  // выбор Мастерских активирует главу сразу, вне календаря
  assert.equal(resolveChapter('chapter-2-black-lacquer').id, 'chapter-2-black-lacquer');
  assert.equal(resolveChapter(null).id, 'chapter-1-darkening', 'без выбора — сезон 2026-Q4');
  assert.equal(getChapterByTheme('Чёрный лак'), ch2);
  assert.equal(getChapterByTheme('Огненная летопись'), null, 'тема без главы — null');

  // глава III «Соль и влага» — третья тема голосования DAO тоже играбельна
  const ch3 = getChapter('chapter-3-salt-water');
  assert.ok(ch3, 'глава III в реестре');
  assert.equal(ch3.theme, 'Соль и влага');
  assert.equal(ch3.seasonId, 'palimpsest-season-v1:2027-Q2');
  assert.equal(getChapterByTheme('Соль и влага'), ch3);
  assert.equal(currentChapter(Date.UTC(2027, 4, 1)).id, 'chapter-3-salt-water');

  // метрики главы II: консервация, эталон 95, три разоблачения, гильдия, два титула
  const ctx = {
    artifacts: [
      { kind: 'chapter', score: { total: 70 }, conservation: { kind: 1, thickness: 0.5 } },
      { kind: 'private', score: { total: 96 }, conservation: { kind: 0, thickness: 0.3 } },
      { kind: 'private', score: { total: 40 } },
    ],
    bookEntries: [
      { type: 'verdict', playerId: 'p', payload: { verdict: 'fake', correct: true } },
      { type: 'verdict', playerId: 'p', payload: { verdict: 'fake', correct: true } },
      { type: 'verdict', playerId: 'p', payload: { verdict: 'fake', correct: true } },
      { type: 'guild', playerId: 'p', payload: { event: 'joined' } },
      {
        type: 'tournament',
        playerId: 'p',
        payload: { event: 'finished', rewards: { places: [{ rank: 1, playerId: 'p' }] } },
      },
    ],
  };
  const byId = Object.fromEntries(questProgress(ch2, ctx).map((q) => [q.id, q]));
  assert.equal(byId.order.progress, 1);
  assert.equal(byId.conservator.progress, 2);
  assert.equal(byId.conservator.complete, true);
  assert.equal(byId.restorer10.progress, 3);
  assert.equal(byId.masterpiece95.progress, 1, '96 ≥ 95');
  assert.equal(byId.exposer.progress, 3);
  assert.equal(byId.exposer.complete, true);
  assert.equal(byId.guildmate.complete, true);
  assert.equal(byId.champion2.progress, 1, 'одна победа из двух');
});

test('квесты главы: прогресс считается из Книги и артефактов', () => {
  const ch = CHAPTERS[0];
  const ctx = {
    artifacts: [
      { kind: 'private', score: { total: 55 } },
      { kind: 'chapter', score: { total: 72 } },
      { kind: 'daily', score: { total: 91 } },
    ],
    bookEntries: [
      { type: 'verdict', playerId: 'p', payload: { verdict: 'fake', correct: true } },
      { type: 'verdict', playerId: 'p', payload: { verdict: 'fake', correct: false } },
      { type: 'exhibit', playerId: 'p' },
      {
        type: 'tournament',
        playerId: 'p',
        payload: { event: 'finished', rewards: { places: [{ rank: 1, playerId: 'p' }] } },
      },
    ],
  };
  const byId = Object.fromEntries(questProgress(ch, ctx).map((q) => [q.id, q]));
  assert.equal(byId.order.progress, 1);
  assert.equal(byId.order.complete, true);
  assert.equal(byId.restorer.progress, 3, 'три завершённые реставрации');
  assert.equal(byId.masterpiece.progress, 1, 'одна эталонная (91 ≥ 90)');
  assert.equal(byId.detective.progress, 1, 'только верные вердикты');
  assert.equal(byId.curator.progress, 1);
  assert.equal(byId.champion.progress, 1);
  // квесты главы бесплатны — награды не зависят от премиума
  for (const q of ch.quests) assert.equal(q.reward.premium, undefined);
});

test('API главы: заказ недели, бонус, выдача квеста один раз', async (t) => {
  const { server, port } = await startServer({ port: 0 });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${port}`;
  const post = (p, body) => fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  const get = (p) => fetch(base + p).then((r) => r.json());

  const { player } = await post('/api/player', { name: 'Мара' });

  const view = await get(`/api/chapter?playerId=${player.id}`);
  assert.equal(view.ok, true, JSON.stringify(view));
  assert.equal(view.chapter.id, 'chapter-1-darkening');
  const orderQuest = view.quests.find((q) => q.id === 'order');
  assert.equal(orderQuest.claimed, false);

  // взять квест до выполнения нельзя
  const early = await post('/api/chapter/quest/claim', { playerId: player.id, questId: 'order' });
  assert.equal(early.reason, 'quest_not_complete');

  // заказ главы: общий сид недели, артефакт kind=chapter, бонус пигментов
  const ses = await post('/api/session', { playerId: player.id, kind: 'chapter' });
  assert.equal(ses.ok, true, JSON.stringify(ses));
  assert.equal(ses.seed, view.chapter.weekSeed, 'единый холст недели');
  const T0 = 1800000300000;
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
  assert.equal(fin.artifact.kind, 'chapter');

  const att = await get(`/api/attestation/${player.id}`);
  assert.equal(
    att.attestation.pigments,
    fin.artifact.score.total + CHAPTER_ORDER_BONUS,
    'заказ главы даёт сезонный бонус к Пигментам',
  );

  // квест «Заказ главы» выполнен — выдача ровно один раз
  const view2 = await get(`/api/chapter?playerId=${player.id}`);
  const order2 = view2.quests.find((q) => q.id === 'order');
  assert.equal(order2.progress, 1);
  assert.equal(order2.complete, true);

  const claim = await post('/api/chapter/quest/claim', { playerId: player.id, questId: 'order' });
  assert.equal(claim.ok, true, JSON.stringify(claim));
  assert.equal(claim.reward.pigments, 60);
  assert.ok(claim.cosmetics.includes('Титул «Свидетель Потемнения»'));

  const again = await post('/api/chapter/quest/claim', { playerId: player.id, questId: 'order' });
  assert.equal(again.reason, 'already_claimed');

  // запись о выдаче — в Книге
  const book = await get('/api/book');
  const entry = book.entries.find((e) => e.type === 'chapter' && e.payload?.event === 'quest_claimed');
  assert.ok(entry, 'Книга фиксирует выдачу награды главы');
  assert.equal(entry.payload.questId, 'order');
});
