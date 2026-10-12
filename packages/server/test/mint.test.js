import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'palimpsest-mint-'));
const { startServer } = await import('../src/index.js');
const { mockTreeId, mockAssetId, metadataHash } = await import('@palimpsest/chain-sdk/bubblegum');

const T0 = 1800000040000;

function log(t) {
  return [
    { type: 'diagnose', findings: ['varnish_darkening'], t },
    { type: 'solvent', x: 0.5, y: 0.5, r: 0.3, strength: 0.55, t: t + 200 },
    { type: 'wipe', x: 0.5, y: 0.5, r: 0.3, t: t + 400 },
    { type: 'varnish', kind: 1, thickness: 0.7, t: t + 600 },
    { type: 'finish', t: t + 800 },
  ];
}

test('cNFT mint flow: plan, Книга, one mint per artifact', async (t) => {
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
  const ses = await post('/api/session', { playerId: player.id, kind: 'private' });
  const fin = await post(`/api/session/${ses.sessionId}/finish`, { actions: log(T0) });
  assert.equal(fin.ok, true, JSON.stringify(fin));
  const artId = fin.artifact.id;

  const mint = await post(`/api/artifact/${artId}/mint`, {});
  assert.equal(mint.ok, true, JSON.stringify(mint));
  assert.equal(mint.mint.provider, 'mock');
  assert.equal(mint.mint.tree, mockTreeId());
  assert.equal(mint.mint.leafIndex, 0);
  assert.equal(mint.mint.assetId, mockAssetId(mockTreeId(), 0));
  assert.equal(mint.mint.metadataHash, metadataHash(mint.metadata));
  assert.equal(mint.metadata.properties.conservation.kind, 1, 'консервация попадает в метаданные');
  assert.ok(Number.isInteger(mint.bookSeq));

  // повторный минт невозможен
  const again = await post(`/api/artifact/${artId}/mint`, {});
  assert.equal(again.reason, 'already_minted');

  // второй артефакт получает следующий leaf index
  const ses2 = await post('/api/session', { playerId: player.id, kind: 'private' });
  const fin2 = await post(`/api/session/${ses2.sessionId}/finish`, { actions: log(T0 + 10000) });
  const mint2 = await post(`/api/artifact/${fin2.artifact.id}/mint`, {});
  assert.equal(mint2.mint.leafIndex, 1);
  assert.notEqual(mint2.mint.assetId, mint.mint.assetId);

  // карточка артефакта несёт минт и старение
  const card = await get(`/api/artifact/${artId}`);
  assert.equal(card.artifact.mint.assetId, mint.mint.assetId);
  assert.ok(card.aging.in25y.yellowing > 0);

  // метаданные по DAS-формату доступны отдельно
  const meta = await get(`/api/artifact/${artId}/metadata`);
  assert.equal(meta.symbol, 'PLSMT');
  assert.equal(meta.properties.provenance_root, fin.artifact.actionsMerkle);

  // Книга знает о минтах и остаётся целостной
  const book = await get('/api/book');
  assert.equal(book.verified, true);
  const mintEntries = book.entries.filter((e) => e.type === 'mint');
  assert.equal(mintEntries.length, 2);
  assert.equal(mintEntries.find((e) => e.artifactId === artId).payload.assetId, mint.mint.assetId);
});
