/**
 * Тихий торг — аукцион запечатанных ставок (CONCEPT.md §5.3).
 * Ставки скрыты до завершения; валюта — Пигменты; комиссия платформы 5%
 * уходит в призовой фонд (учитывается как fundRaised). Провенанс артефакта
 * публичен (Книга) — он и формирует цену.
 */
import { DomainError } from './guilds.js';

export const FEE_BPS = 500; // 5%
export const DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000;

function newId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export async function createAuction(store, { artifactId, sellerId, minBid = 10, durationMin = null }) {
  const seller = await store.getPlayer(sellerId);
  if (!seller) throw new DomainError('unknown_player');
  const artifact = await store.getArtifact(artifactId);
  if (!artifact) throw new DomainError('unknown_artifact');
  if (artifact.playerId !== sellerId) throw new DomainError('not_your_artifact');
  const open = (await store.listAuctions()).find(
    (a) => a.artifactId === artifactId && a.status === 'open',
  );
  if (open) throw new DomainError('already_on_auction');
  const bid = Math.max(1, Math.floor(Number(minBid) || 0));
  const duration = durationMin ? Math.max(60_000, durationMin * 60_000) : DEFAULT_DURATION_MS;
  const auction = {
    id: newId('auc'),
    artifactId,
    sellerId,
    minBid: bid,
    startsAt: Date.now(),
    endsAt: Date.now() + duration,
    bids: [], // sealed until settled: [{playerId, amount, t}]
    status: 'open',
    winnerId: null,
    price: 0,
    fee: 0,
  };
  await store.putAuction(auction);
  await store.appendBook({
    type: 'auction',
    playerId: sellerId,
    artifactId,
    payload: { event: 'opened', minBid: bid, auctionId: auction.id },
  });
  return auction;
}

export async function placeBid(store, auctionId, { playerId, amount }) {
  const auction = await store.getAuction(auctionId);
  if (!auction) throw new DomainError('unknown_auction');
  if (auction.status !== 'open') throw new DomainError('auction_closed');
  if (Date.now() > auction.endsAt) throw new DomainError('auction_expired');
  if (playerId === auction.sellerId) throw new DomainError('seller_cannot_bid');
  const player = await store.getPlayer(playerId);
  if (!player) throw new DomainError('unknown_player');
  const value = Math.floor(Number(amount) || 0);
  const top = auction.bids.reduce((m, b) => Math.max(m, b.amount), 0);
  if (value < auction.minBid || value <= top) throw new DomainError('bid_too_low');
  if ((player.pigments ?? 0) < value) throw new DomainError('not_enough_pigments');
  auction.bids.push({ playerId, amount: value, t: Date.now() });
  await store.putAuction(auction);
  return auction;
}

/** Settle: highest sealed bid wins; pigments move seller <- buyer (fee to fund). */
export async function settleAuction(store, auctionId) {
  const auction = await store.getAuction(auctionId);
  if (!auction) throw new DomainError('unknown_auction');
  if (auction.status !== 'open') throw new DomainError('auction_closed');
  if (Date.now() < auction.endsAt) throw new DomainError('auction_not_ended');

  if (auction.bids.length === 0) {
    auction.status = 'settled';
    await store.putAuction(auction);
    await store.appendBook({
      type: 'auction',
      playerId: auction.sellerId,
      artifactId: auction.artifactId,
      payload: { event: 'closed_no_bids', auctionId: auction.id },
    });
    return auction;
  }

  const winner = auction.bids.reduce((a, b) => (b.amount > a.amount ? b : a));
  const fee = Math.floor((winner.amount * FEE_BPS) / 10_000);
  const buyer = await store.getPlayer(winner.playerId);
  const seller = await store.getPlayer(auction.sellerId);
  if (!buyer || !seller) throw new DomainError('unknown_player');

  buyer.pigments = Math.max(0, (buyer.pigments ?? 0) - winner.amount);
  seller.pigments = (seller.pigments ?? 0) + (winner.amount - fee);
  await store.putPlayer(buyer);
  await store.putPlayer(seller);

  // §4.2: из комиссии 50% — призовой фонд турниров, 30% — гильдиям, 20% — развитие.
  if (store.treasury) {
    const prize = Math.round(fee * 0.5);
    const guild = Math.round(fee * 0.3);
    store.treasury.prize += prize;
    store.treasury.guild += guild;
    store.treasury.dev += fee - prize - guild;
    await store.save();
  }

  // владение артефактом переходит (виртуальная купля-продажа)
  const artifact = await store.getArtifact(auction.artifactId);
  if (artifact) {
    artifact.ownerId = winner.playerId;
    artifact.ownerName = buyer.name;
    await store.putArtifact(artifact);
  }

  auction.status = 'settled';
  auction.winnerId = winner.playerId;
  auction.price = winner.amount;
  auction.fee = fee;
  await store.putAuction(auction);
  await store.appendBook({
    type: 'auction',
    playerId: winner.playerId,
    artifactId: auction.artifactId,
    payload: {
      event: 'settled',
      auctionId: auction.id,
      price: winner.amount,
      fee,
      seller: auction.sellerId,
    },
  });
  return auction;
}

/** Sealed view: outsiders see only the tempo of the room, not the bids. */
export function auctionView(auction) {
  return {
    id: auction.id,
    artifactId: auction.artifactId,
    sellerId: auction.sellerId,
    minBid: auction.minBid,
    startsAt: auction.startsAt,
    endsAt: auction.endsAt,
    status: auction.status,
    bidCount: auction.bids.length,
    winnerId: auction.status === 'settled' ? auction.winnerId : null,
    price: auction.status === 'settled' ? auction.price : null,
    fee: auction.status === 'settled' ? auction.fee : null,
  };
}

export async function auctionListView(store) {
  const all = await store.listAuctions();
  return all
    .map(auctionView)
    .sort((a, b) => b.startsAt - a.startsAt)
    .slice(0, 30);
}
