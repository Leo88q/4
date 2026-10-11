/**
 * Solana instruction builders for `palimpsest_book` (Anchor).
 *
 * Data layout is Anchor/Borsh:
 *   [8-byte discriminator][borsh(args)]
 *   discriminator = first 8 bytes of sha256("global:<instruction_name>")
 *
 * These builders are offline (no RPC): they produce TransactionInstruction
 * objects ready for any Connection. Unit tests lock the byte layout against
 * the Rust declaration in chain/programs/palimpsest_book/src/lib.rs.
 */
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { sha256, utf8 } from '@palimpsest/common';

/** Anchor global discriminator. @param {string} name */
export function discriminator(name) {
  return sha256(utf8(`global:${name}`)).slice(0, 8);
}

/** Borsh string: u32 LE length + UTF-8 bytes. */
function encodeString(s) {
  const bytes = utf8(s);
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, true);
  out.set(bytes, 4);
  return out;
}

function concat(parts) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** @param {string} hexStr */
export function hexToBytes32(hexStr) {
  if (!/^[0-9a-f]{64}$/i.test(hexStr)) throw new Error('expected 32-byte hex');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) out[i] = parseInt(hexStr.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * PDA of an Act account: seeds = ["act", book, artifact_id] (matches lib.rs).
 * @param {PublicKey} programId @param {PublicKey} book @param {string} artifactId
 */
export function findActPda(programId, book, artifactId) {
  return PublicKey.findProgramAddressSync(
    [utf8('act'), book.toBytes(), utf8(artifactId)],
    programId,
  );
}

/** PDA of an Attestation account: seeds = ["attestation", owner]. */
export function findAttestationPda(programId, owner) {
  return PublicKey.findProgramAddressSync(
    [utf8('attestation'), owner.toBytes()],
    programId,
  );
}

/**
 * Instruction data for commit_act.
 * @param {{ artifactId: string, stateHashHex: string, actionsMerkleHex: string, total: number, uri: string }} args
 * @returns {Uint8Array}
 */
export function encodeCommitAct(args) {
  if (args.total < 0 || args.total > 100) throw new Error('total must be 0..=100');
  if (args.artifactId.length > 64) throw new Error('artifact_id too long');
  if (args.uri.length > 128) throw new Error('uri too long');
  return concat([
    discriminator('commit_act'),
    encodeString(args.artifactId),
    hexToBytes32(args.stateHashHex),
    hexToBytes32(args.actionsMerkleHex),
    Uint8Array.of(args.total),
    encodeString(args.uri),
  ]);
}

/** @param {{ artifactId: string, noteHashHex: string }} args */
export function encodeAppendNote(args) {
  return concat([
    discriminator('append_note'),
    encodeString(args.artifactId),
    hexToBytes32(args.noteHashHex),
  ]);
}

/**
 * Full instruction for palimpsest_book::commit_act.
 * @param {{ programId: PublicKey, book: PublicKey, master: PublicKey, authority: PublicKey,
 *           artifactId: string, stateHashHex: string, actionsMerkleHex: string,
 *           total: number, uri: string }} p
 */
export function buildCommitActInstruction(p) {
  const [act] = findActPda(p.programId, p.book, p.artifactId);
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      { pubkey: p.book, isSigner: false, isWritable: true },
      { pubkey: act, isSigner: false, isWritable: true },
      { pubkey: p.master, isSigner: false, isWritable: false },
      { pubkey: p.authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(encodeCommitAct(p)),
  });
}

/** Instruction for palimpsest_book::append_note. */
export function buildAppendNoteInstruction(p) {
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      { pubkey: p.book, isSigner: false, isWritable: true },
      { pubkey: p.author, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(encodeAppendNote(p)),
  });
}

/** Instruction for palimpsest_book::record_work (reputation counters). */
export function buildRecordWorkInstruction(p) {
  const [attestation] = findAttestationPda(p.programId, p.master);
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      { pubkey: attestation, isSigner: false, isWritable: true },
      { pubkey: p.master, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(concat([discriminator('record_work'), Uint8Array.of(p.total)])),
  });
}

export { Keypair, PublicKey, SystemProgram, TransactionInstruction };
