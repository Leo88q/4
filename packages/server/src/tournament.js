'use strict';
/**
 * Турниры (CONCEPT.md §4.7): Дуэль (3 реставрации) и Триптих (5 реставраций).
 *
 * Равный старт: все участники играют ОДНИ И ТЕ ЖЕ сиды раундов
 * (palimpsest-tourney-v1:<id>:r<N>). Оценка — только серверная (Index
 * Палимпсеста из пересимуляции), метрика партии — медиана (устойчива к
 * выбросам). Призовой фонд — спонсорский взнос + комиссии Тихого торга
 * (§4.2: 50% комиссии — в призовой фонд), НИКОГДА не взносы участников:
 * вход свободный. Призы 50/30/20 — 1-3 местам. Pay-to-win запрещён.
 */
import { DomainError } from './social/guilds.js';
import { seasonIdFor, grantManifestXp } from './season.js';

export const TOURNAMENT_KINDS = {
  duel: { sessions: 3, label: 'Дуэль' },
  triptych: { sessions: 5, label: 'Триптих' },
};

/** Доли призового фонда: 1-3 места (§4.2). */
export const PRIZE_SPLIT = [0.5, 0.3, 0.2];

export function tournamentSeed(tournamentId, round) {
  return `palimpsest-tourney-v1:${tournamentId}:r${round}`;
}

function median(nums) {
  const a = [...nums].sort((x, y) => x - y);
  const n = a.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

function newId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export async function createTournament(store, { name, kind = 'duel', sponsor = 0 } = {}) {
  const k = TOURNAMENT_KINDS[kind];
  if (!k) throw new DomainError('unknown_kind');
  if (!String(name ?? '').trim()) throw new DomainError('name_required');
  const t = {
    id: newId('tourn'),
    seasonId: seasonIdFor(),
    name: String(name).trim().slice(0, 64),
    kind,
    sessions: k.sessions,
    status: 'registration', // registration → running → finished
    entry: [],
    results: {}, // playerId → [{round, seed, scoreIndex, verified, timeMs, sessionId}]
    prizePool: { sponsor: Math.max(0, Number(sponsor) || 0), fromTreasury: 0, total: Math.max(0, Number(sponsor) || 0) },
    rewards: null,
    createdAt: Date.now(),
  };
  await store.putTournament(t);
  await store.appendBook({
    type: 'tournament',
    playerId: null,
    payload: { event: 'created', tournamentId: t.id, kind, name: t.name, seasonId: t.seasonId },
  });
  return t;
}

export async function enterTournament(store, t, playerId) {
  const player = await store.getPlayer(playerId);
  if (!player) throw new DomainError('unknown_player');
  if (t.status !== 'registration') throw new DomainError('not_open');
  if (t.entry.includes(playerId)) throw new DomainError('already_entered');
  t.entry.push(playerId);
  await store.putTournament(t);
  return t.entry.length;
}

export async function startTournament(store, t) {
  if (t.status !== 'registration') throw new DomainError('not_open');
  if (t.entry.length < 2) throw new DomainError('not_enough_players');
  // Призовой фонд: спонсор + накопленная доля комиссий Тихого торга (не взносы!).
  const treasuryPrize = store.treasury?.prize || 0;
  t.prizePool.fromTreasury = treasuryPrize;
  if (store.treasury) store.treasury.prize = 0;
  t.prizePool.total = t.prizePool.sponsor + treasuryPrize;
  t.status = 'running';
  await store.putTournament(t);
  await store.appendBook({
    type: 'tournament',
    playerId: null,
    payload: { event: 'started', tournamentId: t.id, prizePool: t.prizePool, players: t.entry.length },
  });
  return t;
}

/** Следующий раунд игрока (равный старт: раунд r даёт одинаковый сид всем). */
export function assignRound(t, playerId) {
  if (t.status !== 'running') throw new DomainError('not_running');
  if (!t.entry.includes(playerId)) throw new DomainError('not_entered');
  const played = (t.results[playerId] || []).length;
  if (played >= t.sessions) throw new DomainError('all_sessions_played');
  const round = played + 1;
  return { round, seed: tournamentSeed(t.id, round) };
}

export async function recordRound(store, t, playerId, {
  round, seed, scoreIndex, verified = true, timeMs = 0, sessionId = null, flags = [],
}) {
  if (t.status !== 'running') throw new DomainError('not_running');
  const arr = t.results[playerId] || (t.results[playerId] = []);
  if (arr.some((r) => r.round === round)) throw new DomainError('round_played');
  arr.push({
    round,
    seed,
    scoreIndex: Number(scoreIndex),
    verified: verified !== false,
    timeMs: Number(timeMs) || 0,
    sessionId,
    flags: [...flags],
  });
  arr.sort((a, b) => a.round - b.round);
  const p = await store.getPlayer(playerId);
  if (p) {
    grantManifestXp(p, 'tournament_round');
    await store.putPlayer(p);
  }
  await store.putTournament(t);
  await store.appendBook({
    type: 'tournament_round',
    playerId,
    payload: { tournamentId: t.id, round, scoreIndex: Number(scoreIndex), seed },
  });
  return arr.length;
}

export function isPlayerDone(t, playerId) {
  return (t.results[playerId] || []).length >= t.sessions;
}

export function allDone(t) {
  return t.entry.length >= 2 && t.entry.every((p) => isPlayerDone(t, p));
}

/**
 * Таблица: медиана Index-а по партиям — устойчивая метрика равного старта.
 * Ничья: лучший одиночный результат, затем меньше суммарное время.
 */
export function standings(t) {
  const rows = t.entry.map((playerId) => {
    const rs = t.results[playerId] || [];
    const scores = rs.filter((r) => r.verified !== false).map((r) => r.scoreIndex);
    const timeMs = rs.reduce((acc, r) => acc + (r.timeMs || 0), 0);
    return {
      playerId,
      played: rs.length,
      median: median(scores),
      best: scores.length ? Math.max(...scores) : 0,
      timeMs,
    };
  });
  rows.sort((a, b) => (b.median - a.median) || (b.best - a.best) || (a.timeMs - b.timeMs));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

/**
 * Финиш: призы 50/30/20 из prizePool (спонсор + комиссии), доля гильдии —
 * гильдии победителя (§4.2: 30% комиссий — гильдии-победителю).
 */
export async function finishTournament(store, t) {
  if (t.status !== 'running') throw new DomainError('not_running');
  if (!allDone(t)) throw new DomainError('not_finished');
  const rows = standings(t);
  const rewards = [];
  for (let i = 0; i < PRIZE_SPLIT.length && i < rows.length; i += 1) {
    const amount = Math.round(t.prizePool.total * PRIZE_SPLIT[i]);
    if (amount > 0) {
      const p = await store.getPlayer(rows[i].playerId);
      p.pigments = (p.pigments ?? 0) + amount;
      await store.putPlayer(p);
    }
    rewards.push({ rank: i + 1, playerId: rows[i].playerId, amount });
  }
  // Доля гильдии-победителю из накопленных комиссий.
  let guildShare = 0;
  const winner = rows[0] ? await store.getPlayer(rows[0].playerId) : null;
  if (store.treasury && winner?.guildId) {
    guildShare = store.treasury.guild || 0;
    store.treasury.guild = 0;
    if (guildShare > 0) {
      const guild = await store.getGuild(winner.guildId);
      if (guild) {
        guild.treasury = (guild.treasury ?? 0) + guildShare;
        await store.putGuild(guild);
      }
    }
  }
  t.rewards = { places: rewards, guildShare, guildId: winner?.guildId ?? null };
  t.status = 'finished';
  t.standings = rows;
  // Киноварь победителю — за титул (§6.1).
  if (winner) {
    winner.cinnabar = (winner.cinnabar ?? 0) + 10;
    await store.putPlayer(winner);
  }
  await store.putTournament(t);
  await store.appendBook({
    type: 'tournament',
    playerId: rows[0]?.playerId ?? null,
    payload: {
      event: 'finished',
      tournamentId: t.id,
      winner: rows[0]?.playerId ?? null,
      rewards: t.rewards,
    },
  });
  return t.rewards;
}
