/**
 * Chain SDK (JS): builds the exact commitment payloads the Anchor program
 * consumes, and provides the mock-chain adapter used by the server until the
 * program is deployed. Kept dependency-free on purpose.
 */
import { hashObject, buildMerkle, sha256Hex } from '@palimpsest/common';

/**
 * Payload for palimpsest_book::commit_act — must stay in lockstep with
 * chain/programs/palimpsest_book/src/lib.rs.
 *
 * @param {{ artifactId: string, stateHash: string, actionHashes: string[], total: number, uri: string }} act
 */
export function commitActPayload(act) {
  if (act.total < 0 || act.total > 100) throw new Error('total must be 0..=100');
  if (act.artifactId.length > 64) throw new Error('artifact_id too long');
  if (act.uri.length > 128) throw new Error('uri too long');
  return {
    name: 'commit_act',
    args: {
      artifact_id: act.artifactId,
      state_hash: act.stateHash,
      actions_merkle: buildMerkle(act.actionHashes).root,
      total: act.total,
      uri: act.uri,
    },
  };
}

/** @param {{ artifactId: string, noteHash: string }} n */
export function appendNotePayload(n) {
  return {
    name: 'append_note',
    args: { artifact_id: n.artifactId, note_hash: n.noteHash },
  };
}

/** @param {{ works: number, scoreSum: number, best: number, fakesExposed: number }} att */
export function attestationDigest(att) {
  return hashObject(att);
}

/**
 * Convert hex strings to the [u8;32] arrays the Rust program expects.
 * @param {string} hexStr
 */
export function hexToBytes32(hexStr) {
  if (hexStr.length !== 64) throw new Error('expected 32 bytes hex');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) out[i] = parseInt(hexStr.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export { buildMerkle, sha256Hex, hashObject };
