import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'palimpsest-social-'));
const { startServer } = await import('../src/index.js');

const T0 = 1800000000000;

function log(t, acts) {
  return acts.map((a, i) => ({ ...a, t: t + i * 200 }));
}

async function makePlayer(post, name) {
  const { player } = await post('/api/player', { name });
  return player;
}

async function makeArtifacts(post, get, player, seed, count = 1) {
  const ids = [];
  for (let i = 0; i < count; i += 1) {
    const ses = await post('/api/session', { playerId: player.id, kind: 'private' });
    const acts = log(T0 + i * 10000, [
      { type: 'diagnose', findings: ['varnish_darkening'] },
      { type: 'solvent', x: 0.5, y: 0.5, r: 0.3, strength: 0.55 },
      { type: 'wipe', x: 0.5, y: 0.5, r: 0.3 },
      { type: 'varnish', kind: 0, thickness: 0.4 },
      { type: 'finish' },
    ]);
    const fin = await post(`/api/session/${ses.sessionId}/finish`, { actions: acts });
    assert.equal(fin.ok, true, JSON.stringify(fin));
    ids.push(fin.artifact.id);
    void seed; void get;
  }
  return ids;
}

test('social layer: Мастерские, Вернисаж, Тихий торг, Пентименто', async (t) => {
  const { server, port } = await startServer({ port: 0 });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${port}`;
  const post = (p, body) => fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  const get = (p) => fetch(base + p).then((r) => r.json());

  // ---------- игроки и артефакты ----------
  const mara = await makePlayer(post, 'Мара');
  const lisa = await makePlayer(post, 'Лис');
  const irma = await makePlayer(post, 'Ирма');

  const [maraArt] = await makeArtifacts(post, get, mara);
  const [lisaArt] = await makeArtifacts(post, get, lisa);
  await makeArtifacts(post, get, irma); // Пигменты заработаны реставрациями

  // экономика: Пигменты за реставрации
  const att = await get(`/api/attestation/${mara.id}`);
  assert.ok(att.attestation.pigments > 0, 'реставрация должна начислять Пигменты');

  // ---------- Мастерские ----------
  const founded = await post('/api/guild', { name: 'Северный свет', motto: 'Слои не горят', playerId: mara.id });
  assert.equal(founded.ok, true, JSON.stringify(founded));
  const gid = founded.guild.id;

  const dup = await post('/api/guild', { name: 'Дубль', playerId: mara.id });
  assert.equal(dup.reason, 'already_in_guild');

  const joined = await post(`/api/guild/${gid}/join`, { playerId: irma.id });
  assert.equal(joined.ok, true);
  assert.equal(joined.guild.members.length, 2);

  const gl = await get('/api/guilds');
  assert.ok(gl.rows.some((r) => r.name === 'Северный свет' && r.rank === 1));

  // ---------- Вернисаж ----------
  const submit = await post('/api/vernissage/submit', { playerId: mara.id, artifactId: maraArt });
  assert.equal(submit.ok, true, JSON.stringify(submit));
  const notMember = await post('/api/vernissage/submit', { playerId: lisa.id, artifactId: lisaArt });
  assert.equal(notMember.reason, 'not_in_guild');

  const vote1 = await post('/api/vernissage/vote', { playerId: lisa.id, artifactId: maraArt });
  assert.equal(vote1.ok, true);
  const vote2 = await post('/api/vernissage/vote', { playerId: lisa.id, artifactId: maraArt });
  assert.equal(vote2.reason, 'already_voted');

  const vern = await get('/api/vernissage');
  assert.equal(vern.vernissage.entries[0].votes, 1);
  assert.equal(vern.vernissage.totalVotes, 1);

  const pigBefore = (await get(`/api/attestation/${mara.id}`)).attestation.pigments;
  const closed = await post('/api/vernissage/close', {});
  assert.equal(closed.ok, true);
  assert.equal(closed.results[0].prize, 300);
  const pigAfter = (await get(`/api/attestation/${mara.id}`)).attestation.pigments;
  assert.equal(pigAfter, pigBefore + 300, 'призовой фонд начисляется победителю');

  // ---------- Тихий торг ----------
  const pig = async (id) => (await get(`/api/attestation/${id}`)).attestation.pigments;
  const irmaP = await pig(irma.id);
  const lisaP = await pig(lisa.id);
  assert.ok(irmaP > 0 && lisaP > 0, 'реставрации начисляют Пигменты');

  const auc = await post('/api/auction', { artifactId: maraArt, sellerId: mara.id, minBid: 5, durationMin: 0.001 });
  assert.equal(auc.ok, true, JSON.stringify(auc));
  const aid = auc.auction.id;

  const lowBid = await post(`/api/auction/${aid}/bid`, { playerId: irma.id, amount: 1 });
  assert.equal(lowBid.reason, 'bid_too_low');
  const sellerBid = await post(`/api/auction/${aid}/bid`, { playerId: mara.id, amount: 500 });
  assert.equal(sellerBid.reason, 'seller_cannot_bid');

  const b1amt = Math.floor(irmaP / 2);
  const b2amt = Math.min(lisaP, b1amt + 5);
  const b1 = await post(`/api/auction/${aid}/bid`, { playerId: irma.id, amount: b1amt });
  assert.equal(b1.ok, true, JSON.stringify(b1));
  const b2 = await post(`/api/auction/${aid}/bid`, { playerId: lisa.id, amount: b2amt });
  assert.equal(b2.ok, true, JSON.stringify(b2));

  // запечатанные ставки: снаружи видно только количество
  const view = await get(`/api/auction/${aid}`);
  assert.equal(view.auction.bidCount, 2);
  assert.equal(view.auction.price, null);

  await new Promise((r) => setTimeout(r, 50));
  const early = await post(`/api/auction/${aid}/settle`, {});
  assert.equal(early.reason, 'auction_not_ended');
  // полноценный сеттлмент с переводом владения — в отдельном тесте ниже

  // ---------- Пентименто ----------
  const cases = await get('/api/cases');
  assert.ok(cases.rows.length >= 1, 'должно быть хотя бы одно дело');
  const caseId = cases.rows[0].artifactId;

  // владелец не может расследовать своё дело
  const artifact = await get(`/api/artifact/${caseId}`);
  const ownerId = artifact.artifact.playerId;
  const conflict = await post(`/api/case/${caseId}/investigate`, { playerId: ownerId, verdict: 'fake' });
  assert.equal(conflict.reason, 'conflict_of_interest');

  const detective = [mara.id, lisa.id, irma.id].find((id) => id !== ownerId);
  const verdict = await post(`/api/case/${caseId}/investigate`, { playerId: detective, verdict: 'fake' });
  assert.equal(verdict.ok, true, JSON.stringify(verdict));
  // повторное дело нельзя
  const again = await post(`/api/case/${caseId}/investigate`, { playerId: lisa.id, verdict: 'authentic' });
  assert.equal(again.reason, 'already_resolved');

  // Книга выросла на события социального слоя
  const book = await get('/api/book');
  const types = new Set(book.entries.map((e) => e.type));
  for (const type of ['guild', 'exhibit', 'award', 'auction', 'verdict']) {
    assert.ok(types.has(type), `Книга должна знать события ${type}`);
  }
  assert.equal(book.verified, true);
});

test('auction settlement transfers ownership and takes the 5% fee', async (t) => {
  const { server, port, store } = await startServer({ port: 0 });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${port}`;
  const post = (p, body) => fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  const get = (p) => fetch(base + p).then((r) => r.json());

  const seller = await makePlayer(post, 'Таврион');
  const buyer = await makePlayer(post, 'Соня');
  const [art] = await makeArtifacts(post, get, seller);
  await makeArtifacts(post, get, buyer); // Пигменты покупателя

  const buyerPig = (await get(`/api/attestation/${buyer.id}`)).attestation.pigments;
  const bidAmount = Math.floor(buyerPig / 2);
  const auc = await post('/api/auction', { artifactId: art, sellerId: seller.id, minBid: 5, durationMin: 0.001 });
  const aid = auc.auction.id;
  const bid = await post(`/api/auction/${aid}/bid`, { playerId: buyer.id, amount: bidAmount });
  assert.equal(bid.ok, true, JSON.stringify(bid));

  // время действия заканчивается не раньше чем через 60с (защита от снайперов),
  // поэтому для теста искусственно сдвигаем endsAt в сохранённой сессии
  const auction = await store.getAuction(aid);
  auction.endsAt = Date.now() - 1;
  await store.putAuction(auction);

  const sellerBefore = (await get(`/api/attestation/${seller.id}`)).attestation.pigments;
  const buyerBefore = (await get(`/api/attestation/${buyer.id}`)).attestation.pigments;

  const settled = await post(`/api/auction/${aid}/settle`, {});
  assert.equal(settled.ok, true, JSON.stringify(settled));
  assert.equal(settled.auction.price, bidAmount);
  assert.equal(settled.auction.fee, Math.floor(bidAmount * 0.05)); // 5%

  const sellerAfter = (await get(`/api/attestation/${seller.id}`)).attestation.pigments;
  const buyerAfter = (await get(`/api/attestation/${buyer.id}`)).attestation.pigments;
  assert.equal(sellerAfter, sellerBefore + bidAmount - Math.floor(bidAmount * 0.05));
  assert.equal(buyerAfter, buyerBefore - bidAmount);

  const artAfter = await get(`/api/artifact/${art}`);
  assert.equal(artAfter.artifact.ownerId, buyer.id, 'владение переходит покупателю');
});
