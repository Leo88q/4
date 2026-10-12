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
    theme: 'Великое Потемнение',
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
  {
    id: 'chapter-2-black-lacquer',
    number: 2,
    seasonId: 'palimpsest-season-v1:2027-Q1',
    theme: 'Чёрный лак',
    title: 'Чёрный лак',
    subtitle: 'Тёмный слой',
    motto: 'Не стирай слой — запиши его.',
    hook: 'Рецепты растворителей утрачены вместе со школами — но не со слоями. '
      + 'Чёрный лак Потемнения стал главным врагом и главным учителем: под ним '
      + 'находят чужие реставрации, имена и подмалёвки Серых Кистей. Мастерская '
      + 'берёт заказы на самый тёмный слой эпохи — и отвечает за него перед Книгой.',
    lore: 'docs/lore.md §2–3 «Великое Потемнение», «Мастерские и Манифест Слоёв»',
    orderTitle: 'Из Схрона: полотно под чёрным лаком',
    weekSeedPrefix: 'palimpsest-chapter-v1:chapter-2-black-lacquer',
    quests: [
      {
        id: 'order',
        metric: 'order',
        title: 'Заказ главы',
        description: 'Завершить реставрацию заказа главы (раз в неделю единый холст для всех)',
        target: 1,
        reward: { pigments: 60, title: 'Носитель Чёрного лака' },
      },
      {
        id: 'conservator',
        metric: 'conservations',
        title: 'Дыхание времени',
        description: 'Завершить 2 реставрации с консервацией (новый лак зафиксирован)',
        target: 2,
        reward: { pigments: 90 },
      },
      {
        id: 'restorer10',
        metric: 'restorations',
        title: 'Десять слоёв',
        description: 'Завершить 10 реставраций',
        target: 10,
        reward: { pigments: 120 },
      },
      {
        id: 'masterpiece95',
        metric: 'index95',
        title: 'Совершенный слой',
        description: 'Реставрация с Индексом Палимпсеста ≥ 95',
        target: 1,
        reward: { pigments: 200 },
      },
      {
        id: 'exposer',
        metric: 'fakes_exposed',
        title: 'Три тени',
        description: 'Раскрыть 3 подмалёвка в Пентименто',
        target: 3,
        reward: { pigments: 150 },
      },
      {
        id: 'guildmate',
        metric: 'guild_events',
        title: 'Манифест',
        description: 'Состоять в Мастерской (вступить или основать)',
        target: 1,
        reward: { pigments: 80 },
      },
      {
        id: 'champion2',
        metric: 'tournament_wins',
        title: 'Дважды на стене',
        description: 'Победить в двух турнирах',
        target: 2,
        reward: { pigments: 250 },
      },
    ],
  },
  {
    id: 'chapter-3-salt-water',
    number: 3,
    seasonId: 'palimpsest-season-v1:2027-Q2',
    theme: 'Соль и влага',
    title: 'Соль и влага',
    subtitle: 'После воды',
    motto: 'Вода забирает слой — Книга оставляет.',
    hook: 'После мглы пришла вода: паводки, соляные разводы, плесень на грунте. '
      + 'Разрывы и потёки стали письмом эпохи — их не замазывают, их читают. '
      + 'Мастерская спасает то, что Дымка не добила, и записывает каждый '
      + 'водяной слой в Книгу — пока соль не добралась до краски.',
    lore: 'docs/lore.md §2 «Великое Потемнение» (последствия), §4 «Книга Слоёв»',
    orderTitle: 'Из Схрона: полотно после паводка',
    weekSeedPrefix: 'palimpsest-chapter-v1:chapter-3-salt-water',
    quests: [
      {
        id: 'order',
        metric: 'order',
        title: 'Заказ главы',
        description: 'Завершить реставрацию заказа главы (раз в неделю единый холст для всех)',
        target: 1,
        reward: { pigments: 60, title: 'Хранитель Влаги' },
      },
      {
        id: 'conservator3',
        metric: 'conservations',
        title: 'Тихая консервация',
        description: 'Завершить 3 реставрации с консервацией',
        target: 3,
        reward: { pigments: 100 },
      },
      {
        id: 'restorer20',
        metric: 'restorations',
        title: 'Двадцать слоёв',
        description: 'Завершить 20 реставраций',
        target: 20,
        reward: { pigments: 150 },
      },
      {
        id: 'exhibitor3',
        metric: 'exhibits',
        title: 'Три Вернисажа',
        description: 'Показать 3 работы на Вернисаже',
        target: 3,
        reward: { pigments: 120 },
      },
      {
        id: 'exposer5',
        metric: 'fakes_exposed',
        title: 'Пять теней',
        description: 'Раскрыть 5 подмалёвков в Пентименто',
        target: 5,
        reward: { pigments: 180 },
      },
      {
        id: 'champion3',
        metric: 'tournament_wins',
        title: 'Трижды на стене',
        description: 'Победить в трёх турнирах',
        target: 3,
        reward: { pigments: 300 },
      },
    ],
  },
  {
    id: 'chapter-4-fire-chronicle',
    number: 4,
    seasonId: 'palimpsest-season-v1:2027-Q3',
    theme: 'Огненная летопись',
    title: 'Огненная летопись',
    subtitle: 'Пепельный слой',
    motto: 'Огонь пишет слой — Книга читает его.',
    hook: 'Пожар в архиве каталогов сжёг описи, но не слои: копоть, подпалины и '
      + 'вздувшийся лак стали летописью огня на самих полотнах. Мастерская читает '
      + 'огненный слой как диагноз и восстанавливает утраченные каталоги — '
      + 'то есть провенанс: имя, путь и судьбу каждой работы.',
    lore: 'docs/lore.md §8 «Огненная летопись» (пожар в архиве каталогов)',
    orderTitle: 'Из Схрона: полотно из архива каталогов',
    weekSeedPrefix: 'palimpsest-chapter-v1:chapter-4-fire-chronicle',
    quests: [
      {
        id: 'order',
        metric: 'order',
        title: 'Заказ главы',
        description: 'Завершить реставрацию заказа главы (раз в неделю единый холст для всех)',
        target: 1,
        reward: { pigments: 60, title: 'Летописец Огня' },
      },
      {
        id: 'conservator4',
        metric: 'conservations',
        title: 'Диагноз горения',
        description: 'Завершить 4 реставрации с консервацией (новый лак зафиксирован)',
        target: 4,
        reward: { pigments: 110 },
      },
      {
        id: 'restorer25',
        metric: 'restorations',
        title: 'Двадцать пять слоёв',
        description: 'Завершить 25 реставраций',
        target: 25,
        reward: { pigments: 160 },
      },
      {
        id: 'trinity90',
        metric: 'index90',
        title: 'Три эталона',
        description: 'Три реставрации с Индексом Палимпсеста ≥ 90',
        target: 3,
        reward: { pigments: 180 },
      },
      {
        id: 'exposer7',
        metric: 'fakes_exposed',
        title: 'Семь почерков',
        description: 'Раскрыть 7 подмалёвков в Пентименто',
        target: 7,
        reward: { pigments: 210 },
      },
      {
        id: 'champion4',
        metric: 'tournament_wins',
        title: 'Четырежды на стене',
        description: 'Победить в четырёх турнирах',
        target: 4,
        reward: { pigments: 320 },
      },
    ],
  },
  {
    id: 'chapter-5-gray-haze',
    number: 5,
    seasonId: 'palimpsest-season-v1:2027-Q4',
    theme: 'Серая Дымка',
    title: 'Серая Дымка',
    subtitle: 'Расследование',
    motto: 'У Дымки есть причина — и у причины есть слой.',
    hook: 'Серую Дымку приняли за стихию — но слои помнят поставщиков, рецепты '
      + 'и даты. Мастерская ведёт расследование Потемнения: читает пентименто '
      + 'и провенанс, сводит Вернисажи и показания Смотрителей. Дымка была '
      + 'не случайностью — это человеческая история, и её тоже нужно записать в Книгу.',
    lore: 'docs/lore.md §8 «Серая Дымка» (расследование причин Потемнения)',
    orderTitle: 'Из Схрона: дело о Серой Дымке',
    weekSeedPrefix: 'palimpsest-chapter-v1:chapter-5-gray-haze',
    quests: [
      {
        id: 'order',
        metric: 'order',
        title: 'Заказ главы',
        description: 'Завершить реставрацию заказа главы (раз в неделю единый холст для всех)',
        target: 1,
        reward: { pigments: 60, title: 'Следопыт Дымки' },
      },
      {
        id: 'exhibitor5',
        metric: 'exhibits',
        title: 'Открытые показания',
        description: 'Показать 5 работ на Вернисаже',
        target: 5,
        reward: { pigments: 140 },
      },
      {
        id: 'restorer30',
        metric: 'restorations',
        title: 'Тридцать слоёв',
        description: 'Завершить 30 реставраций',
        target: 30,
        reward: { pigments: 170 },
      },
      {
        id: 'index95x2',
        metric: 'index95',
        title: 'Два свидетельства',
        description: 'Две реставрации с Индексом Палимпсеста ≥ 95',
        target: 2,
        reward: { pigments: 200 },
      },
      {
        id: 'exposer10',
        metric: 'fakes_exposed',
        title: 'Десять почерков',
        description: 'Раскрыть 10 подмалёвков в Пентименто',
        target: 10,
        reward: { pigments: 220 },
      },
      {
        id: 'champion5',
        metric: 'tournament_wins',
        title: 'Пять имён на стене',
        description: 'Победить в пяти турнирах',
        target: 5,
        reward: { pigments: 350 },
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

/** Глава по теме (голосование DAO: «Чёрный лак» → глава II). */
export function getChapterByTheme(theme) {
  return CHAPTERS.find((c) => c.theme === theme) ?? null;
}

/**
 * Активная глава: выбор Мастерских (DAO) имеет приоритет над календарём
 * сезона; без выбора — глава текущего сезона.
 */
export function resolveChapter(activeChapterId, nowMs = Date.now()) {
  return (activeChapterId ? getChapter(activeChapterId) : null) ?? currentChapter(nowMs);
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
 * Метрики — производные (без счётчиков): журнал и артефакты — источник истины.
 * @param {object} chapter
 * @param {{artifacts?: object[], bookEntries?: object[]}} ctx
 */
export function questProgress(chapter, ctx = {}) {
  const artifacts = ctx.artifacts ?? [];
  const book = ctx.bookEntries ?? [];
  const fakes = book.filter((e) => e.type === 'verdict'
    && e.payload?.verdict === 'fake' && e.payload?.correct === true).length;
  const wins = book.filter((e) => e.type === 'tournament'
    && e.payload?.event === 'finished' && e.payload?.rewards?.places?.[0]?.playerId === e.playerId).length;
  const metrics = {
    order: artifacts.filter((a) => a.kind === 'chapter').length,
    restorer: artifacts.length,
    restorations: artifacts.length,
    masterpiece: artifacts.filter((a) => (a.score?.total ?? 0) >= 90).length,
    index90: artifacts.filter((a) => (a.score?.total ?? 0) >= 90).length,
    index95: artifacts.filter((a) => (a.score?.total ?? 0) >= 95).length,
    detective: fakes,
    fakes_exposed: fakes,
    curator: book.filter((e) => e.type === 'exhibit').length,
    exhibits: book.filter((e) => e.type === 'exhibit').length,
    guild_events: book.filter((e) => e.type === 'guild').length,
    conservations: artifacts.filter((a) => a.conservation != null).length,
    champion: wins,
    tournament_wins: wins,
  };
  return chapter.quests.map((q) => {
    const value = metrics[q.metric ?? q.id] ?? 0;
    return {
      id: q.id,
      title: q.title,
      description: q.description,
      target: q.target,
      progress: Math.min(value, q.target),
      complete: value >= q.target,
      reward: q.reward,
    };
  });
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
