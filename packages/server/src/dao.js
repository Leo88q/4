'use strict';
/**
 * proto-DAO Мастерских (CONCEPT.md §10, Global Launch) — открытое управление
 * сезонами: Мастерские выдвигают предложения и голосуют за следующую главу
 * и распределение казны. Один голос на Мастерскую, вес = престиж (guildStats).
 *
 * Голосование — об управлении контентом, а не о деньгах игроков: никаких
 * обещаний доходности, казна — игровые комиссии (§6.3/§6.4).
 */
import { DomainError, guildOfPlayer, guildStats } from './social/guilds.js';
import { getChapterByTheme } from './chapter.js';

export const PROPOSAL_KINDS = {
  theme: {
    label: 'Тема следующей главы',
    options: ['Чёрный лак', 'Соль и влага', 'Огненная летопись', 'Серая Дымка'],
  },
  sponsor: { label: 'Спонсорство турниров из казны развития', options: ['50%', '100%'] },
};

export const DEFAULT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 дня на голосование

function newId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export async function createProposal(store, { kind, title, options, authorPlayerId, windowMs } = {}) {
  const spec = PROPOSAL_KINDS[kind];
  if (!spec) throw new DomainError('unknown_kind');
  const author = await store.getPlayer(authorPlayerId);
  if (!author) throw new DomainError('unknown_player');
  const guild = await guildOfPlayer(store, authorPlayerId);
  if (!guild) throw new DomainError('not_in_guild');
  const opts = Array.isArray(options) && options.length >= 2 ? options.map(String) : spec.options;
  const p = {
    id: newId('prop'),
    kind,
    title: String(title ?? spec.label).slice(0, 96),
    options: opts,
    authorGuildId: guild.id,
    authorPlayerId,
    votes: {}, // guildId -> {option, weight, playerId, t}
    status: 'open', // open -> closed
    createdAt: Date.now(),
    endsAt: Date.now() + (Number(windowMs) || DEFAULT_WINDOW_MS),
    result: null,
  };
  await store.putProposal(p);
  await store.appendBook({
    type: 'dao',
    playerId: authorPlayerId,
    payload: { event: 'proposal_opened', proposalId: p.id, kind, title: p.title, options: opts },
  });
  return p;
}

export async function voteProposal(store, proposalId, { playerId, option } = {}) {
  const p = await store.getProposal(proposalId);
  if (!p) throw new DomainError('unknown_proposal');
  if (p.status !== 'open') throw new DomainError('proposal_closed');
  if (Date.now() > p.endsAt) throw new DomainError('proposal_expired');
  if (!p.options.includes(option)) throw new DomainError('unknown_option');
  const guild = await guildOfPlayer(store, playerId);
  if (!guild) throw new DomainError('not_in_guild');
  if (p.votes[guild.id]) throw new DomainError('guild_already_voted');
  const stats = await guildStats(store, guild);
  p.votes[guild.id] = {
    option,
    weight: Math.max(1, stats.prestige),
    playerId,
    t: Date.now(),
  };
  await store.putProposal(p);
  return p;
}

/** Подсчёт: вес = престиж Мастерской; ничья — раньше проголосовавший вариант. */
export function tally(p) {
  const sums = new Map();
  const times = new Map();
  for (const v of Object.values(p.votes)) {
    sums.set(v.option, (sums.get(v.option) ?? 0) + v.weight);
    if (!times.has(v.option)) times.set(v.option, v.t);
  }
  const rows = p.options.map((option) => ({
    option,
    weight: sums.get(option) ?? 0,
    votes: Object.values(p.votes).filter((v) => v.option === option).length,
  }));
  rows.sort((a, b) => (b.weight - a.weight) || ((times.get(a.option) ?? 0) - (times.get(b.option) ?? 0)));
  return rows;
}

/**
 * Закрытие: итог записывается в Книгу; тема становится «следующей главой»,
 * спонсорство переносит долю казны развития в призовой фонд турниров.
 */
export async function closeProposal(store, proposalId) {
  const p = await store.getProposal(proposalId);
  if (!p) throw new DomainError('unknown_proposal');
  if (p.status !== 'open') throw new DomainError('proposal_closed');
  const rows = tally(p);
  const winner = rows[0] ?? null;
  p.status = 'closed';
  p.result = { winner: winner?.option ?? null, tally: rows, closedAt: Date.now() };
  await store.putProposal(p);

  let effect = null;
  if (p.kind === 'theme' && winner) {
    store.dao = store.dao ?? {};
    store.dao.nextTheme = winner.option;
    // выбор Мастерской активирует главу с этой темой (если она есть в реестре)
    const chapter = getChapterByTheme(winner.option);
    if (chapter) {
      store.dao.activeChapterId = chapter.id;
      effect = { nextTheme: winner.option, nextChapterId: chapter.id };
    } else {
      effect = { nextTheme: winner.option };
    }
    await store.save(); // dao изменился — фиксируем (важно для PgStore)
  }
  if (p.kind === 'sponsor' && winner && store.treasury) {
    const share = winner.option === '100%' ? 1 : 0.5;
    const moved = Math.round((store.treasury.dev ?? 0) * share);
    store.treasury.dev -= moved;
    store.treasury.prize += moved;
    effect = { movedToPrize: moved };
    await store.save();
  }
  await store.appendBook({
    type: 'dao',
    playerId: p.authorPlayerId,
    payload: {
      event: 'proposal_closed',
      proposalId: p.id,
      kind: p.kind,
      winner: winner?.option ?? null,
      tally: rows,
      effect,
    },
  });
  return { proposal: p, effect };
}

export function proposalView(p) {
  return {
    id: p.id,
    kind: p.kind,
    title: p.title,
    options: p.options,
    status: p.status,
    endsAt: p.endsAt,
    guildVotes: Object.keys(p.votes).length,
    tally: tally(p),
    result: p.result,
  };
}

export async function daoState(store) {
  const all = await store.listProposals();
  return {
    nextTheme: store.dao?.nextTheme ?? null,
    activeChapterId: store.dao?.activeChapterId ?? null,
    open: all.filter((p) => p.status === 'open').map(proposalView),
    closed: all.filter((p) => p.status === 'closed').slice(-5).map(proposalView),
  };
}
