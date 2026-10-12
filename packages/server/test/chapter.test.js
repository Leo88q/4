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
  assert.equal(getChapterByTheme('Огненная летопись')?.id, 'chapter-4-fire-chronicle',
    'тема DAO «Огненная летопись» теперь играбельна (глава IV)');

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

test('глава IV «Огненная летопись»: пожар архива каталогов, чтение слоёв как диагноз', () => {
  const ch4 = getChapter('chapter-4-fire-chronicle');
  assert.ok(ch4, 'глава IV в реестре');
  assert.equal(ch4.number, 4);
  assert.equal(ch4.theme, 'Огненная летопись', 'тема совпадает с вариантом голосования DAO');
  assert.equal(ch4.seasonId, 'palimpsest-season-v1:2027-Q3');
  assert.match(ch4.hook, /каталог|огн|пожар/i, 'легенда — пожар в архиве каталогов');
  assert.equal(getChapterByTheme('Огненная летопись'), ch4);

  // календарь: сезон 2027-Q3 принадлежит главе IV
  assert.equal(currentChapter(Date.UTC(2027, 7, 1)).id, 'chapter-4-fire-chronicle');
  assert.equal(resolveChapter(null, Date.UTC(2027, 7, 1)).id, 'chapter-4-fire-chronicle');
  assert.equal(resolveChapter('chapter-4-fire-chronicle').id, 'chapter-4-fire-chronicle');

  const card = chapterCard(ch4);
  assert.match(card.weekSeed, /^palimpsest-chapter-v1:chapter-4-fire-chronicle:\d{4}-W\d{2}$/);

  // метрики главы IV: заказ, консервации, эталоны 90, разоблачения, победы
  const ctx = {
    artifacts: [
      { kind: 'chapter', conservation: {}, score: { total: 92 } },
      { conservation: {}, score: { total: 80 } },
      { score: { total: 96 } },
      { score: { total: 70 } },
    ],
    bookEntries: [
      { type: 'verdict', playerId: 'p1', payload: { verdict: 'fake', correct: true } },
      { type: 'verdict', playerId: 'p1', payload: { verdict: 'fake', correct: true } },
      { type: 'verdict', playerId: 'p1', payload: { verdict: 'fake', correct: false } },
      {
        type: 'tournament', playerId: 'p1',
        payload: { event: 'finished', rewards: { places: [{ playerId: 'p1' }] } },
      },
    ],
  };
  const prog = Object.fromEntries(questProgress(ch4, ctx).map((q) => [q.id, q]));
  assert.equal(prog.order.progress, 1);
  assert.equal(prog.conservator4.progress, 2);
  assert.equal(prog.restorer25.progress, 4);
  assert.equal(prog.trinity90.progress, 2, 'эталоны 92 и 96');
  assert.equal(prog.exposer7.progress, 2, 'верные вердикты «подмалёвок»');
  assert.equal(prog.champion4.progress, 1);
  assert.equal(prog.order.reward.title, 'Летописец Огня', 'титул заказа главы');
});

test('глава V «Серая Дымка»: расследование Потемнения, Пентименто и Вернисаж', () => {
  const ch5 = getChapter('chapter-5-gray-haze');
  assert.ok(ch5, 'глава V в реестре');
  assert.equal(ch5.number, 5);
  assert.equal(ch5.theme, 'Серая Дымка', 'тема совпадает с вариантом голосования DAO');
  assert.equal(ch5.seasonId, 'palimpsest-season-v1:2027-Q4');
  assert.match(ch5.hook, /Дымк|расслед/i, 'легенда — расследование причин Потемнения');
  assert.equal(getChapterByTheme('Серая Дымка'), ch5);

  // календарь: сезон 2027-Q4 принадлежит главе V
  assert.equal(currentChapter(Date.UTC(2027, 10, 1)).id, 'chapter-5-gray-haze');
  assert.equal(resolveChapter(null, Date.UTC(2027, 10, 1)).id, 'chapter-5-gray-haze');
  assert.equal(resolveChapter('chapter-5-gray-haze').id, 'chapter-5-gray-haze');

  const card = chapterCard(ch5);
  assert.match(card.weekSeed, /^palimpsest-chapter-v1:chapter-5-gray-haze:\d{4}-W\d{2}$/);

  // метрики главы V: Вернисаж, эталоны 95, пентименто, турниры
  const ctx = {
    artifacts: [
      { kind: 'chapter', score: { total: 96 } },
      { score: { total: 97 } },
      { score: { total: 88 } },
    ],
    bookEntries: [
      { type: 'exhibit', playerId: 'p1' },
      { type: 'exhibit', playerId: 'p1' },
      { type: 'verdict', playerId: 'p1', payload: { verdict: 'fake', correct: true } },
    ],
  };
  const prog = Object.fromEntries(questProgress(ch5, ctx).map((q) => [q.id, q]));
  assert.equal(prog.order.progress, 1);
  assert.equal(prog.exhibitor5.progress, 2);
  assert.equal(prog.restorer30.progress, 3);
  assert.equal(prog.index95x2.progress, 2, '96 и 97');
  assert.equal(prog.exposer10.progress, 1);
  assert.equal(prog.champion5.progress, 0);
  assert.equal(prog.order.reward.title, 'Следопыт Дымки', 'титул заказа главы');
});

test('глава VI «Пентименто»: тайна Мары и Призрака, правда первого акта Книги', () => {
  const ch6 = getChapter('chapter-6-pentimento');
  assert.ok(ch6, 'глава VI в реестре');
  assert.equal(ch6.number, 6);
  assert.equal(ch6.theme, 'Пентименто', 'тема совпадает с вариантом голосования DAO');
  assert.equal(ch6.seasonId, 'palimpsest-season-v1:2028-Q1');
  assert.match(ch6.hook, /Мар|Призрак|подмал/i, 'легенда — тайна Мары и Призрака');
  assert.match(ch6.motto, /правда умирает/, 'голос Манифеста Мары (docs/lore.md §3)');
  assert.equal(getChapterByTheme('Пентименто'), ch6);

  // календарь: сезон 2028-Q1 принадлежит главе VI
  assert.equal(currentChapter(Date.UTC(2028, 1, 1)).id, 'chapter-6-pentimento');
  assert.equal(resolveChapter(null, Date.UTC(2028, 1, 1)).id, 'chapter-6-pentimento');
  assert.equal(resolveChapter('chapter-6-pentimento').id, 'chapter-6-pentimento');

  const card = chapterCard(ch6);
  assert.match(card.weekSeed, /^palimpsest-chapter-v1:chapter-6-pentimento:\d{4}-W\d{2}$/);

  // «Все» механики: заказ, гильдия, Вернисаж, реставрации, пентименто, турниры
  const ctx = {
    artifacts: [
      { kind: 'chapter', score: { total: 91 } },
      { score: { total: 70 } },
      { score: { total: 96 } },
    ],
    bookEntries: [
      { type: 'guild', playerId: 'p1', payload: { event: 'joined' } },
      { type: 'exhibit', playerId: 'p1' },
      { type: 'verdict', playerId: 'p1', payload: { verdict: 'fake', correct: true } },
      { type: 'verdict', playerId: 'p1', payload: { verdict: 'fake', correct: false } },
      {
        type: 'tournament', playerId: 'p1',
        payload: { event: 'finished', rewards: { places: [{ playerId: 'p1' }] } },
      },
    ],
  };
  const prog = Object.fromEntries(questProgress(ch6, ctx).map((q) => [q.id, q]));
  assert.equal(prog.order.progress, 1);
  assert.equal(prog.guildmate.progress, 1);
  assert.equal(prog.guildmate.complete, true);
  assert.equal(prog.exhibitor6.progress, 1);
  assert.equal(prog.restorer40.progress, 3);
  assert.equal(prog.exposer12.progress, 1, 'только верные вердикты');
  assert.equal(prog.champion6.progress, 1);
  assert.equal(prog.order.reward.title, 'Свидетель Призрака', 'титул заказа главы');
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
