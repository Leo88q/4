/**
 * Binary Merkle tree over action-log hashes — the audit spine of the
 * Book of Layers (CONCEPT.md §7.2). Promote-style: an unpaired node at a
 * level is carried up unchanged. Leaves are domain-separated.
 */
import { sha256, sha256Hex, utf8 } from './sha256.js';

const LEAF_PREFIX = 0x00;
const NODE_PREFIX = 0x01;

/** @param {string|Uint8Array} leaf */
function leafHash(leaf) {
  const bytes = typeof leaf === 'string' ? utf8(leaf) : leaf;
  const buf = new Uint8Array(bytes.length + 1);
  buf[0] = LEAF_PREFIX;
  buf.set(bytes, 1);
  return sha256(buf);
}

/** @param {Uint8Array} left @param {Uint8Array} right */
function nodeHash(left, right) {
  const buf = new Uint8Array(1 + left.length + right.length);
  buf[0] = NODE_PREFIX;
  buf.set(left, 1);
  buf.set(right, 1 + left.length);
  return sha256(buf);
}

/**
 * @param {Array<string|Uint8Array>} leaves
 * @returns {{ root: string, leafHashes: string[], layers: string[][] }}
 */
export function buildMerkle(leaves) {
  if (!leaves.length) return { root: sha256Hex('palimpsest:empty-merkle'), leafHashes: [], layers: [] };
  /** @type {Uint8Array[]} */
  let level = leaves.map(leafHash);
  const layers = [level.map((h) => h64(h))];
  while (level.length > 1) {
    /** @type {Uint8Array[]} */
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) next.push(nodeHash(level[i], level[i + 1]));
      else next.push(level[i]);
    }
    level = next;
    layers.push(level.map((h) => h64(h)));
  }
  return { root: h64(level[0]), leafHashes: layers[0], layers };
}

/**
 * @param {Array<string|Uint8Array>} leaves
 * @param {number} index
 * @returns {{ index: number, path: Array<{ side: 'left'|'right', hash: string }> }}
 */
export function merkleProof(leaves, index) {
  const { layers } = buildMerkle(leaves);
  if (index < 0 || index >= leaves.length) throw new Error('proof index out of range');
  const path = [];
  let i = index;
  for (let lvl = 0; lvl < layers.length - 1; lvl += 1) {
    const level = layers[lvl];
    const isRight = i % 2 === 1;
    const sibling = isRight ? i - 1 : i + 1;
    if (sibling < level.length) path.push({ side: isRight ? 'left' : 'right', hash: level[sibling] });
    i = Math.floor(i / 2);
  }
  return { index, path };
}

/**
 * @param {string|Uint8Array} leaf
 * @param {{ index: number, path: Array<{ side: string, hash: string }> }} proof
 * @param {string} rootHex
 */
export function verifyMerkleProof(leaf, proof, rootHex) {
  let acc = leafHash(leaf);
  for (const step of proof.path) {
    const sibling = fromHex(step.hash);
    acc = step.side === 'left' ? nodeHash(sibling, acc) : nodeHash(acc, sibling);
  }
  return h64(acc) === rootHex;
}

/** @param {Uint8Array} b */
function h64(b) {
  let out = '';
  for (const x of b) out += x.toString(16).padStart(2, '0');
  return out;
}

/** @param {string} hexStr */
function fromHex(hexStr) {
  const out = new Uint8Array(hexStr.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hexStr.slice(i * 2, i * 2 + 2), 16);
  return out;
}
