'use strict';
/**
 * Нарративные главы сезона (CONCEPT.md §4.6, docs/lore.md).
 *
 * Глава I «Великое Потемнение» («Серая Дымка») — базовый контент главы
 * бесплатен (заказы, квесты, награды); платная часть Манифеста остаётся
 * косметикой. Квесты главы выполняются обычной игрой; прогресс считается
 * из Книги Слоёв и артефактов (без отдельных счётчиков — журнал источник истины).
 */
import { seasonIdFor } from './season.js';

export const CHAPTERS = [
  {
    id: 'chapter-1-darkening',
    number: 1,
    seasonId: 'palimpsest-season-v1:2026-Q4',
    title: 'Великое Потемнение',
    subtitle: 'Серая Дымка',
    motto: 'Каждый слой должен быть записан.',
    hook: 'Двенадцать лет над городами стояла промышленная мгла. Лаки окислялись '
      + 'за ночь, холсты становились ломкими, а Кракелюр стал именем нарицательным. '
      + 'Из опечатанных Схронов вышли первые мастера Манифеста — чинить мало, '
      + 'нужно документировать. Ваша Мастерская принимает первые заказы после Дымки.',
    lore: 'docs/lore.md §2 «Великое Потемнение»',
    orderTitle: 'Из Схрона: полотно после Дымки',
    weekSeedPrefix: 'palimpsest-chapter-v1:chapter-1-darkening',
    quests: [
      {
        id: 'order',
        title: 'Заказ главы',
        description: 'Завершить реставрацию заказа главы (раз в неделю единый холст для всех)',
        target: 1,
        reward: { pigments: 60, title: 'Свидетель Потемнения' },
      },
      {
        id: 'restorer',
        title: 'Пять слоёв',
        description: 'Завершить 5 реставраций',
        target: 5,
        reward: { pigments: 100 },
      },
      {
        id: 'masterpiece',
        title: 'Эталон после Дымки',
        description: 'Реставрация с Индексом Палимпсеста ≥ 90',
        target: 1,
        reward: { pigments: 150 },
      },
      {
        id: 'detective',
        title: 'Голос Смотрителя',
        description: 'Раскрыть подмалёвок в Пентименто (верный вердикт «подмалёвок»)',
        target: 1,
        reward: { pigments: 120 },
      },
      {
        id: 'curator',
        title: 'Публичный слой',
        description: 'Показать работу на Вернисаже',
        target: 1,
        reward: { pigments: 80 },
      },
      {
        id: 'champion',
        title: 'Имя на стене',
        description: 'Победить в турнире',
        target: 1,
        reward: { pigments: 200 },
      },
    ],
  },
];

/** Бонус Пигментов за завершение заказа главы. */
export const CHAPTER_ORDER_BONUS = 25;

export function currentChapter(nowMs = Date.now()) {
  const seasonId = seasonIdFor(nowMs);
  return CHAPTERS.find((c) => c.seasonId === seasonId) ?? CHAPTERS[CHAPTERS.length - 1];
}

export function getChapter(id) {
  return CHAPTERS.find((c) => c.id === id) ?? null;
}

/** ISO-неделя (YYYY-Www) — недельный общий холст главы. */
export function isoWeek(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const day = (d.getUTCDay() + 6) % 7; // пн=0
  d.setUTCDate(d.getUTCDate() - day + 3); // четверг этой недели
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Сид заказа главы: один на всех, обновляется раз в неделю. */
export function chapterWeekSeed(chapter, nowMs = Date.now()) {
  return `${chapter.weekSeedPrefix}:${isoWeek(nowMs)}`;
}

/**
 * Прогресс квестов из журнала и артефактов.
 * @param {object} chapter
 * @param {{artifacts?: object[], bookEntries?: object[]}} ctx
 */
export function questProgress(chapter, ctx = {}) {
  const artifacts = ctx.artifacts ?? [];
  const book = ctx.bookEntries ?? [];
  const done = {
    order: artifacts.filter((a) => a.kind === 'chapter').length,
    restorer: artifacts.length,
    masterpiece: artifacts.filter((a) => (a.score?.total ?? 0) >= 90).length,
    detective: book.filter((e) => e.type === 'verdict'
      && e.payload?.verdict === 'fake' && e.payload?.correct === true).length,
    curator: book.filter((e) => e.type === 'exhibit').length,
    champion: book.filter((e) => e.type === 'tournament'
      && e.payload?.event === 'finished' && e.payload?.rewards?.places?.[0]?.playerId === e.playerId).length,
  };
  return chapter.quests.map((q) => ({
    id: q.id,
    title: q.title,
    description: q.description,
    target: q.target,
    progress: Math.min(done[q.id] ?? 0, q.target),
    complete: (done[q.id] ?? 0) >= q.target,
    reward: q.reward,
  }));
}

/** Публичная карточка главы (без служебных полей). */
export function chapterCard(chapter) {
  return {
    id: chapter.id,
    number: chapter.number,
    title: chapter.title,
    subtitle: chapter.subtitle,
    motto: chapter.motto,
    hook: chapter.hook,
    lore: chapter.lore,
    orderTitle: chapter.orderTitle,
    weekSeed: chapterWeekSeed(chapter),
    orderBonus: CHAPTER_ORDER_BONUS,
  };
}
