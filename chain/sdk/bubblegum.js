/**
 * cNFT minting for artifacts — Metaplex Bubblegum (CONCEPT.md §7.1).
 *
 * Two layers:
 *   * `buildMetadata` / `metadataHash` / `mockAssetId` — pure, dependency-light
 *     helpers used by the server in mock mode and by tests;
 *   * `buildMintV1` — the REAL Bubblegum `mintV1` instruction via
 *     `@metaplex-foundation/mpl-bubblegum` (offline: builds without RPC;
 *     sending requires a deployed tree + configured connection).
 *
 * Metadata follows the artifact card (CONCEPT.md, Приложение C) and carries
 * the provenance root, the seed and the «Дыхание времени» snapshot.
 */
import { hashObject, sha256Hex } from '@palimpsest/common';
import { agingProjection, conservationOf } from '@palimpsest/sim';

export const BUBBLEGUM_PROGRAM = 'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY';

/** Standard compressed-tree preset: 2^14 = 16384 leaves, canopy 10. */
export const TREE_PRESET = Object.freeze({
  maxDepth: 14,
  maxBufferSize: 64,
  canopyDepth: 10,
  capacity: 1 << 14,
});

/**
 * Canonical cNFT metadata for a finished artifact.
 * @param {object} artifact — as stored by the server
 * @param {{ uri?: string }} [opts]
 */
export function buildMetadata(artifact, opts = {}) {
  const aging = agingProjection(artifact).now;
  const cons = artifact.conservation ?? null;
  return {
    name: `«${artifact.meta.title}», ок. ${artifact.meta.year} — Акт реставрации ${artifact.id}`,
    symbol: 'PLSMT',
    description: `Восстановлено мастером ${artifact.playerName}. Книга Слоёв: ${artifact.provenanceCid}`,
    image: opts.uri ?? artifact.provenanceCid ?? '',
    attributes: [
      { trait_type: 'Эпоха', value: artifact.meta.epoch },
      { trait_type: 'Индекс Палимпсеста', value: artifact.score.total },
      { trait_type: 'Консервация', value: cons ? `${aging.conservation?.varnish ?? '—'}, слой ${cons.thickness}` : 'без консервации' },
      { trait_type: 'Пожелтение (сейчас)', value: aging.yellowing },
      { trait_type: 'Хрупкость (сейчас)', value: aging.brittleness },
      { trait_type: 'Мастер', value: artifact.playerAddress },
    ],
    properties: {
      provenance_root: artifact.actionsMerkle,
      provenance_cid: artifact.provenanceCid,
      seed: artifact.seed,
      conservation: cons,
    },
  };
}

/** Deterministic hash of the canonical metadata (leaf commitment input). */
export function metadataHash(metadata) {
  return hashObject(metadata);
}

/**
 * Mock asset id (local book mode): deterministic stand-in for the on-chain
 * derived asset id, clearly namespaced. Real ids are derived on-chain / via DAS.
 */
export function mockAssetId(treeId, leafIndex) {
  return `asset_${sha256Hex(`palimpsest:mock-asset:${treeId}:${leafIndex}`).slice(0, 32)}`;
}

/** The single mock tree of a local deployment. */
export function mockTreeId() {
  return `tree_${sha256Hex('palimpsest:mock-tree:v1').slice(0, 32)}`;
}

/**
 * Mint plan consumed by the server (mock mode) and by relayers (solana mode):
 * everything needed to mint plus the commitment values for the Книга.
 * @param {object} artifact @param {number} leafIndex
 */
export function planMint(artifact, leafIndex, opts = {}) {
  const treeId = opts.treeId ?? mockTreeId();
  const metadata = buildMetadata(artifact, opts);
  const uri = opts.uri ?? `ar://mock-${metadataHash(metadata).slice(0, 32)}`;
  metadata.image = uri;
  return {
    provider: opts.provider ?? 'mock',
    tree: treeId,
    leafIndex,
    assetId: opts.provider === 'bubblegum' && opts.realAssetId
      ? opts.realAssetId
      : mockAssetId(treeId, leafIndex),
    uri,
    metadataHash: metadataHash(metadata),
    metadata,
    leafCommitment: hashObject({ metadataHash: metadataHash(metadata), owner: artifact.playerAddress, leafIndex }),
    treePreset: TREE_PRESET,
  };
}

/**
 * REAL Bubblegum mintV1 — builds the exact on-chain instruction offline.
 * Requires `umi` (from @metaplex-foundation/umi-bundle-defaults) with an
 * identity; sending needs a created merkle tree + RPC.
 *
 * @param {object} umi
 * @param {{ payer: object, leafOwner: string, merkleTree: string, metadata: object }} input
 */
export async function buildMintV1(umi, input) {
  const { mintV1 } = await import('@metaplex-foundation/mpl-bubblegum');
  const builder = mintV1(umi, {
    leafOwner: umi.identity.publicKey, // caller sets real owner below when different
    merkleTree: input.merkleTree,
    metadata: {
      name: input.metadata.name.slice(0, 32),
      symbol: input.metadata.symbol.slice(0, 10),
      uri: input.metadata.image ?? input.uri ?? '',
      sellerFeeBasisPoints: 0,
      primarySaleHappened: false,
      isMutable: true,
      editionNonce: null,
      tokenStandard: null,
      collection: null,
      uses: null,
      tokenProgramVersion: 0,
      creators: [{ address: umi.identity.publicKey, verified: true, share: 100 }],
    },
  });
  return builder;
}

export { hashObject, sha256Hex, agingProjection };
