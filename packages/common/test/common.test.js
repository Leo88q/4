import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex, canonicalJSON, hashObject } from '../src/sha256.js';
import { dailySeedString, Rng, expandSeed, mixChainEntropy } from '../src/seed.js';
import { buildMerkle, merkleProof, verifyMerkleProof } from '../src/merkle.js';

test('sha256 matches FIPS vectors and node:crypto', () => {
  assert.equal(
    sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  const samples = ['x', 'палімпсест', 'a'.repeat(200), JSON.stringify({ a: 1, b: [1, 2] })];
  for (const s of samples) {
    assert.equal(sha256Hex(s), createHash('sha256').update(s, 'utf8').digest('hex'));
  }
});

test('canonicalJSON is order-independent', () => {
  assert.equal(canonicalJSON({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(hashObject({ a: 1, b: [{ y: 2, x: 3 }] }), hashObject({ b: [{ x: 3, y: 2 }], a: 1 }));
});

test('daily seed format', () => {
  assert.equal(dailySeedString('2026-10-11'), 'palimpsest-daily-v1:2026-10-11');
  assert.throws(() => dailySeedString('11.10.2026'));
  assert.equal(mixChainEntropy('s', ''), 's');
  assert.equal(mixChainEntropy('s', 'ab'), 's+chain:ab');
});

test('Rng is deterministic and seed-expanded', () => {
  const a = new Rng('palimpsest-daily-v1:2026-10-11');
  const b = new Rng('palimpsest-daily-v1:2026-10-11');
  for (let i = 0; i < 100; i += 1) assert.equal(a.nextU32(), b.nextU32());
  const c = new Rng('palimpsest-daily-v1:2026-10-12');
  assert.notEqual(a.nextU32(), c.nextU32());
  assert.equal(expandSeed('s').length, 4);
  const f = new Rng('s');
  for (let i = 0; i < 50; i += 1) {
    const v = f.nextFloat();
    assert.ok(v >= 0 && v < 1);
  }
});

test('Rng reference vector (locked for the C# port)', () => {
  const r = new Rng('palimpsest-daily-v1:2026-10-11');
  const first = Array.from({ length: 8 }, () => r.nextU32());
  // Updated only with a deliberate version bump — client/unity reads the same values.
  assert.deepEqual(first, [
    585903251, 1990282106, 1106169909, 280201634, 1749580363, 1860188125, 4203996187, 1586463658,
  ]);
});

test('merkle root + proofs', () => {
  const leaves = ['a', 'b', 'c', 'd', 'e'];
  const { root } = buildMerkle(leaves);
  assert.equal(root.length, 64);
  for (let i = 0; i < leaves.length; i += 1) {
    const proof = merkleProof(leaves, i);
    assert.ok(verifyMerkleProof(leaves[i], proof, root));
    assert.ok(!verifyMerkleProof(`${leaves[i]}!`, proof, root));
  }
  assert.equal(buildMerkle(leaves).root, root);
  assert.equal(buildMerkle([]).root, buildMerkle([]).root);
  // determinism across leaf content
  assert.notEqual(buildMerkle(['a', 'b']).root, buildMerkle(['a', 'b', 'c']).root);
});
