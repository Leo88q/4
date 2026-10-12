'use strict';
/**
 * Сезоны, Манифест (Battle Pass) и иерархия Аттестата.
 *
 * Концепция §4.6: сезон ≈ 3 месяца — нарративная глава. Базовый контент
 * бесплатен; платная часть Манифеста даёт ТОЛЬКО косметику и статус (темы,
 * инструменты, залы для Аттестата) и НЕ влияет на оценку реставраций.
 * Иерархия Аттестата: Бронза → Серебро → Золото → Лазурит (лучший за сезон).
 */

export const SEASON_DAYS = 90;

export function seasonIdFor(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `palimpsest-season-v1:${d.getUTCFullYear()}-Q${q}`;
}

/** Источники опыта Манифеста. Опыт — только за подтверждённую деятельность. */
export const MANIFEST_XP = {
  session: 20,          // завершённая реставрация
  tournament_round: 30, // сыгранная партия турнира
  p2p: 10,              // подтверждённая пиринговая реставрация
  exhibit: 15,          // показанная на Вернисаже работа
};

export const MANIFEST_MAX_LEVEL = 12;

export function xpForLevel(level) {
  return 100 * level;
}

export function levelForXp(xp) {
  let lvl = 0;
  while (lvl < MANIFEST_MAX_LEVEL && xp >= xpForLevel(lvl + 1)) lvl += 1;
  return lvl;
}

export function ensureManifest(player, nowMs = Date.now()) {
  const seasonId = seasonIdFor(nowMs);
  if (!player.manifest || player.manifest.seasonId !== seasonId) {
    player.manifest = { seasonId, xp: 0, level: 0, premium: false, claimed: [] };
  }
  return player.manifest;
}

export function grantManifestXp(player, kind, nowMs = Date.now()) {
  const m = ensureManifest(player, nowMs);
  const gained = MANIFEST_XP[kind] || 0;
  m.xp += gained;
  m.level = levelForXp(m.xp);
  return { gained, xp: m.xp, level: m.level };
}

/**
 * Награды Манифеста — только косметика/статус.
 * free — базовый трек; premium — платная глава (темы, инструменты, залы).
 */
export const MANIFEST_REWARDS = {
  free: {
    1: ['Тема «Охра»'],
    2: ['Пигменты ×50'],
    3: ['Рама «Кракелюр»'],
    5: ['Пигменты ×100'],
    7: ['Тема «Грунт»'],
    9: ['Пигменты ×150'],
    12: ['Зал «Открытый склад» (Аттестат)'],
  },
  premium: {
    1: ['Тема «Лазурит»'],
    3: ['Инструмент «Кисть реставратора»'],
    5: ['Рама «Сусальное золото»'],
    7: ['Тема «Пентименто»'],
    9: ['Инструмент «Шпатель Смотрителя»'],
    12: ['Зал «Лазурит» (Аттестат)'],
  },
};

export function rewardsForLevel(level, premium) {
  const out = [];
  for (const [lvl, items] of Object.entries(MANIFEST_REWARDS.free)) {
    if (level >= Number(lvl)) out.push(...items);
  }
  if (premium) {
    for (const [lvl, items] of Object.entries(MANIFEST_REWARDS.premium)) {
      if (level >= Number(lvl)) out.push(...items);
    }
  }
  return out;
}

/** Забрать награды за уровни; возвращает только что выданные (без дублей). */
export function claimManifestRewards(player, level) {
  const m = ensureManifest(player);
  if (level > m.level) throw new Error('level_not_reached');
  const owned = new Set(rewardsForLevel(level, m.premium));
  const already = new Set();
  for (const c of m.claimed) for (const r of c.items) already.add(r);
  const fresh = [...owned].filter((r) => !already.has(r));
  if (fresh.length === 0) throw new Error('nothing_to_claim');
  m.claimed.push({ level, items: fresh });
  player.cosmetics = player.cosmetics || [];
  for (const r of fresh) player.cosmetics.push(r);
  return fresh;
}

export function unlockManifestPremium(player, nowMs = Date.now()) {
  const m = ensureManifest(player, nowMs);
  if (m.premium) throw new Error('already_unlocked');
  m.premium = true;
  return m;
}

/**
 * Проекция записей Книги на сезонные события игрока.
 * Типы Книги: act (реставрация), tournament_round, tournament/finished,
 * exhibit (Вернисаж), verdict (Пентименто).
 */
export function seasonEntriesFromBook(bookEntries = [], playerId) {
  const out = [];
  for (const e of bookEntries) {
    // финиш турнира несёт победителя в playerId, но места занимают все призёры
    if (e.type === 'tournament' && e.payload?.event === 'finished') {
      const place = (e.payload.rewards?.places ?? []).find((p) => p.playerId === playerId);
      if (place && place.rank <= 3) {
        out.push({ type: 'tournament_top3' });
        if (place.rank === 1) out.push({ type: 'tournament_win' });
      }
      continue;
    }
    if (e.playerId !== playerId) continue;
    if (e.type === 'act') out.push({ type: 'session', verified: true });
    if (e.type === 'tournament_round') out.push({ type: 'tournament_round' });
    if (e.type === 'exhibit') out.push({ type: 'exhibit' });
  }
  return out;
}

/** Сезонная статистика игрока (производится из журнала). */
export function seasonStats(entries = []) {
  const stats = {
    verifiedSessions: 0,
    p2pVerified: 0,
    tournamentRounds: 0,
    tournamentTop3: 0,
    tournamentWins: 0,
    exhibited: 0,
  };
  for (const e of entries) {
    if (e.type === 'session' && e.verified !== false) stats.verifiedSessions += 1;
    if (e.type === 'p2p_verified') stats.p2pVerified += 1;
    if (e.type === 'tournament_round') stats.tournamentRounds += 1;
    if (e.type === 'tournament_top3') stats.tournamentTop3 += 1;
    if (e.type === 'tournament_win') stats.tournamentWins += 1;
    if (e.type === 'exhibit') stats.exhibited += 1;
  }
  return stats;
}

export const AWARD_TIERS = ['Бронзовый слой', 'Серебряный слой', 'Золотой слой', 'Лазуритовый слой'];

/**
 * Иерархия Аттестата за сезон.
 * Лазурит — только лучший за сезон: победа в турнире и весомый вклад.
 */
export function awardTier(stats = {}, champion = false) {
  const s = { ...seasonStats(), ...stats };
  if (champion && s.tournamentWins >= 1 && s.verifiedSessions >= 20) return 'Лазуритовый слой';
  if (s.tournamentWins >= 1 || s.verifiedSessions >= 50) return 'Золотой слой';
  if (s.tournamentTop3 >= 1 || s.verifiedSessions >= 20 || s.p2pVerified >= 10) return 'Серебряный слой';
  if (s.verifiedSessions >= 5 || s.p2pVerified >= 3) return 'Бронзовый слой';
  return null;
}
