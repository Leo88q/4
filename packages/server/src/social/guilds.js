/**
 * Мастерские (гильдии) — CONCEPT.md §5.1.
 * До 50 человек; коллекция — работы участников; престиж выводит в статус
 * «Музей». Основание и вступление дописываются в Книгу Слоёв.
 */

export const MAX_MEMBERS = 50;
export const MUSEUM_THRESHOLD = 500;

export class DomainError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

function newId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/** Best works of a member (max 5) count toward prestige. */
export async function guildStats(store, guild) {
  let works = 0;
  let prestige = (guild.awards ?? 0) * 100;
  for (const m of guild.members) {
    const arts = await store.artifactsByPlayer(m.playerId);
    works += arts.length;
    const best = arts
      .map((a) => a.score.total)
      .sort((x, y) => y - x)
      .slice(0, 5);
    prestige += best.reduce((s, v) => s + v, 0);
  }
  return {
    guildId: guild.id,
    name: guild.name,
    motto: guild.motto,
    owner: guild.ownerId,
    members: guild.members.length,
    works,
    awards: guild.awards ?? 0,
    prestige,
    status: prestige >= MUSEUM_THRESHOLD ? 'Музей' : 'Мастерская',
  };
}

export async function guildOfPlayer(store, playerId) {
  const all = await store.listGuilds();
  return all.find((g) => g.members.some((m) => m.playerId === playerId)) ?? null;
}

export async function createGuild(store, { name, motto = '', playerId }) {
  const clean = String(name ?? '').trim().slice(0, 32);
  if (!clean) throw new DomainError('name_required');
  const player = await store.getPlayer(playerId);
  if (!player) throw new DomainError('unknown_player');
  if (await guildOfPlayer(store, playerId)) throw new DomainError('already_in_guild');
  const guild = {
    id: newId('gld'),
    name: clean,
    motto: String(motto ?? '').trim().slice(0, 80),
    ownerId: playerId,
    members: [{ playerId, role: 'мастер', joinedAt: Date.now() }],
    awards: 0,
    createdAt: Date.now(),
  };
  await store.putGuild(guild);
  await store.appendBook({
    type: 'guild',
    playerId,
    guildId: guild.id,
    payload: { event: 'founded', name: clean },
  });
  return guild;
}

export async function joinGuild(store, guildId, playerId) {
  const guild = await store.getGuild(guildId);
  if (!guild) throw new DomainError('unknown_guild');
  const player = await store.getPlayer(playerId);
  if (!player) throw new DomainError('unknown_player');
  if (await guildOfPlayer(store, playerId)) throw new DomainError('already_in_guild');
  if (guild.members.length >= MAX_MEMBERS) throw new DomainError('guild_full');
  guild.members.push({ playerId, role: 'мастер', joinedAt: Date.now() });
  await store.putGuild(guild);
  await store.appendBook({
    type: 'guild',
    playerId,
    guildId,
    payload: { event: 'joined', name: guild.name },
  });
  return guild;
}

export async function leaveGuild(store, guildId, playerId) {
  const guild = await store.getGuild(guildId);
  if (!guild) throw new DomainError('unknown_guild');
  const idx = guild.members.findIndex((m) => m.playerId === playerId);
  if (idx < 0) throw new DomainError('not_a_member');
  if (guild.ownerId === playerId && guild.members.length > 1) {
    throw new DomainError('owner_must_transfer'); // v1: владелец не выходит, пока есть участники
  }
  guild.members.splice(idx, 1);
  await store.putGuild(guild);
  await store.appendBook({
    type: 'guild',
    playerId,
    guildId,
    payload: { event: 'left', name: guild.name },
  });
  return guild;
}

/** Prestige leaderboard of all guilds. */
export async function guildLeaderboard(store) {
  const all = await store.listGuilds();
  const rows = [];
  for (const g of all) rows.push(await guildStats(store, g));
  rows.sort((a, b) => b.prestige - a.prestige || a.name.localeCompare(b.name));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}
