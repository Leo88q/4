import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMetadata, metadataHash, mockAssetId, mockTreeId, planMint, buildMintV1, TREE_PRESET, BUBBLEGUM_PROGRAM,
} from '../bubblegum.js';

const artifact = {
  id: 'art_demo',
  seed: 'palimpsest-daily-v1:2026-10-11',
  playerName: 'Мара',
  playerAddress: 'addr123',
  meta: { title: 'Портрет неизвестной', year: 1890, epoch: 'Модерн' },
  score: { total: 87 },
  actionsMerkle: 'a'.repeat(64),
  provenanceCid: 'ar://demo',
  conservation: { kind: 1, thickness: 0.7 },
  createdAt: Date.now(),
};

test('metadata is canonical and carries provenance + conservation', () => {
  const m = buildMetadata(artifact);
  assert.equal(m.symbol, 'PLSMT');
  assert.equal(m.properties.provenance_root, artifact.actionsMerkle);
  assert.equal(m.properties.seed, artifact.seed);
  assert.deepEqual(m.properties.conservation, { kind: 1, thickness: 0.7 });
  assert.match(m.name, /Акт реставрации art_demo/);
  const attrs = Object.fromEntries(m.attributes.map((a) => [a.trait_type, a.value]));
  assert.equal(attrs['Индекс Палимпсеста'], 87);
  assert.ok(Number.isFinite(attrs['Пожелтение (сейчас)']));
  assert.equal(metadataHash(m), metadataHash(buildMetadata(artifact)));
  assert.notEqual(metadataHash(m), metadataHash(buildMetadata({ ...artifact, seed: 'other' })));
});

test('mock asset ids are deterministic and namespaced', () => {
  const t = mockTreeId();
  assert.equal(mockAssetId(t, 0), mockAssetId(t, 0));
  assert.notEqual(mockAssetId(t, 0), mockAssetId(t, 1));
  assert.match(mockAssetId(t, 5), /^asset_[0-9a-f]{32}$/);
});

test('mint plan is complete and committed', () => {
  const plan = planMint(artifact, 3);
  assert.equal(plan.provider, 'mock');
  assert.equal(plan.leafIndex, 3);
  assert.equal(plan.assetId, mockAssetId(mockTreeId(), 3));
  assert.equal(plan.metadataHash, metadataHash(plan.metadata));
  assert.equal(plan.leafCommitment.length, 64);
  assert.equal(plan.treePreset.capacity, TREE_PRESET.capacity);
  assert.equal(TREE_PRESET.capacity, 1 << TREE_PRESET.maxDepth);
});

test('real Bubblegum mintV1 builds offline (locked layout)', async () => {
  const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
  const { keypairIdentity, generateSigner } = await import('@metaplex-foundation/umi');
  const umi = createUmi('http://localhost:8899');
  const payer = generateSigner(umi);
  umi.use(keypairIdentity(payer));
  const merkleTree = generateSigner(umi).publicKey;

  const builder = await buildMintV1(umi, {
    merkleTree,
    metadata: buildMetadata(artifact),
  });
  const ixs = builder.getInstructions();
  assert.equal(ixs.length, 1);
  assert.equal(ixs[0].programId.toString(), BUBBLEGUM_PROGRAM);
  assert.equal(ixs[0].keys.length, 9);
  assert.ok(ixs[0].data.length > 100, 'mintV1 data must encode metadata');
});
