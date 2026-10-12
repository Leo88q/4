/**
 * Вернисаж — сезонная выставка Мастерских (CONCEPT.md §5.2).
 * Один вернисаж на сезон; от гильдии — один экспонат (работа участника);
 * игроки голосуют по одному голосу; по итогам — награды и запись в Книгу.
 */
import { DomainError } from './guilds.js';
import { guildOfPlayer, guildStats } from './guilds.js';

export const EXHIBITION_ID = 'vernisage-current';
export const PRIZE_POOL = [300, 150, 50]; // Пигменты: 1/2/3 место

export async function currentExhibition(store) {
  let ex = await store.getExhibition(EXHIBITION_ID);
  if (!ex || ex.status === 'closed') {
    ex = {
      id: EXHIBITION_ID,
      season: new Date().toISOString().slice(0, 7),
      entries: [], // [{artifactId, playerId, guildId, title}]
      votes: {}, // playerId -> artifactId
      status: 'open',
      closedAt: null,
      results: null,
    };
    await store.putExhibition(ex);
  }
  return ex;
}

export async function submitExhibit(store, { playerId, artifactId }) {
  const ex = await currentExhibition(store);
  if (ex.status !== 'open') throw new DomainError('exhibition_closed');
  const guild = await guildOfPlayer(store, playerId);
  if (!guild) throw new DomainError('not_in_guild');
  const artifact = await store.getArtifact(artifactId);
  if (!artifact) throw new DomainError('unknown_artifact');
  if (artifact.playerId !== playerId) throw new DomainError('not_your_artifact');
  if (ex.entries.some((e) => e.guildId === guild.id)) throw new DomainError('guild_already_exhibits');
  if (ex.entries.some((e) => e.artifactId === artifactId)) throw new DomainError('already_exhibiting');
  ex.entries.push({
    artifactId,
    playerId,
    guildId: guild.id,
    guildName: guild.name,
    title: artifact.meta.title,
    total: artifact.score.total,
  });
  await store.putExhibition(ex);
  await store.appendBook({
    type: 'exhibit',
    playerId,
    artifactId,
    payload: { event: 'vernissage_submit', guild: guild.name, season: ex.season },
  });
  return ex;
}

export async function vote(store, { playerId, artifactId }) {
  const ex = await currentExhibition(store);
  if (ex.status !== 'open') throw new DomainError('exhibition_closed');
  const player = await store.getPlayer(playerId);
  if (!player) throw new DomainError('unknown_player');
  if (!ex.entries.some((e) => e.artifactId === artifactId)) throw new DomainError('not_exhibiting');
  if (ex.votes[playerId]) throw new DomainError('already_voted');
  ex.votes[playerId] = artifactId;
  await store.putExhibition(ex);
  return ex;
}

export function standings(ex) {
  return ex.entries
    .map((e) => ({
      ...e,
      votes: Object.values(ex.votes).filter((v) => v === e.artifactId).length,
    }))
    .sort((a, b) => b.votes - a.votes || b.total - a.total);
}

/** Close the season: awards to top-3, prestige to their guilds. */
export async function closeExhibition(store) {
  const ex = await currentExhibition(store);
  if (ex.status === 'closed') return ex;
  const ranked = standings(ex);
  const results = [];
  for (let i = 0; i < ranked.length && i < PRIZE_POOL.length; i += 1) {
    const place = ranked[i];
    const prize = PRIZE_POOL[i];
    results.push({ rank: i + 1, artifactId: place.artifactId, playerId: place.playerId, guildId: place.guildId, prize });
    const player = await store.getPlayer(place.playerId);
    if (player) {
      player.pigments = (player.pigments ?? 0) + prize;
      await store.putPlayer(player);
    }
    const guild = await store.getGuild(place.guildId);
    if (guild) {
      guild.awards = (guild.awards ?? 0) + 1;
      await store.putGuild(guild);
    }
    await store.appendBook({
      type: 'award',
      playerId: place.playerId,
      artifactId: place.artifactId,
      payload: { event: 'vernissage_award', rank: i + 1, prize, season: ex.season },
    });
  }
  ex.status = 'closed';
  ex.closedAt = Date.now();
  ex.results = results;
  await store.putExhibition(ex);
  return ex;
}

export async function exhibitionView(store) {
  const ex = await currentExhibition(store);
  const guildRows = [];
  for (const e of ex.entries) {
    const g = await store.getGuild(e.guildId);
    if (g) guildRows.push(await guildStats(store, g));
  }
  return {
    season: ex.season,
    status: ex.status,
    entries: standings(ex),
    totalVotes: Object.keys(ex.votes).length,
    results: ex.results,
  };
}
