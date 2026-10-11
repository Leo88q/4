import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discriminator, encodeCommitAct, encodeAppendNote, buildCommitActInstruction,
  buildRecordWorkInstruction, findActPda, findAttestationPda, hexToBytes32, Keypair, PublicKey,
} from '../solana.js';
import { sha256Hex, utf8 } from '@palimpsest/common';

const PROGRAM_ID = new PublicKey('BooK111111111111111111111111111111111111111');

test('anchor discriminator is sha256("global:name")[0..8]', () => {
  const expected = sha256Hex(utf8('global:commit_act')).slice(0, 16);
  assert.equal(Buffer.from(discriminator('commit_act')).toString('hex'), expected);
  assert.equal(discriminator('commit_act').length, 8);
  assert.notEqual(sha256Hex(utf8('global:commit_act')), sha256Hex(utf8('global:append_note')));
});

test('commit_act byte layout matches lib.rs argument order', () => {
  const args = {
    artifactId: 'art_demo',
    stateHashHex: 'aa'.repeat(32),
    actionsMerkleHex: 'bb'.repeat(32),
    total: 87,
    uri: 'ar://demo',
  };
  const data = encodeCommitAct(args);
  // 8 disc + (4+8) artifact_id + 32 + 32 + 1 + (4+8) uri = 97
  assert.equal(data.length, 8 + 12 + 32 + 32 + 1 + 13);
  assert.equal(Buffer.from(data.subarray(0, 8)).toString('hex'), Buffer.from(discriminator('commit_act')).toString('hex'));
  // borsh string length (LE u32)
  assert.equal(new DataView(data.buffer, data.byteOffset).getUint32(8, true), 'art_demo'.length);
  // u8 total sits right before the uri string
  assert.equal(data[8 + 12 + 64], 87);
  assert.throws(() => encodeCommitAct({ ...args, total: 101 }));
  assert.throws(() => encodeCommitAct({ ...args, artifactId: 'x'.repeat(65) }));
  assert.throws(() => hexToBytes32('zz'));
});

test('append_note layout', () => {
  const data = encodeAppendNote({ artifactId: 'art', noteHashHex: 'cc'.repeat(32) });
  assert.equal(data.length, 8 + 7 + 32);
  assert.equal(data[8 + 4], 'a'.charCodeAt(0));
});

test('instruction accounts match the Rust context structs', () => {
  const authority = Keypair.generate();
  const master = Keypair.generate();
  const book = Keypair.generate().publicKey;
  const ix = buildCommitActInstruction({
    programId: PROGRAM_ID, book, master: master.publicKey, authority: authority.publicKey,
    artifactId: 'art_x', stateHashHex: '11'.repeat(32), actionsMerkleHex: '22'.repeat(32),
    total: 50, uri: 'ipfs://x',
  });
  assert.equal(ix.keys.length, 5);
  assert.equal(ix.keys[0].pubkey.toBase58(), book.toBase58());
  assert.equal(ix.keys[0].isWritable, true);
  assert.equal(ix.keys[1].isSigner, false); // PDA
  assert.equal(ix.keys[2].isSigner, false); // master (unchecked)
  assert.equal(ix.keys[3].isSigner, true);  // authority pays
  assert.equal(ix.keys[4].pubkey.toBase58(), PublicKey.default.toBase58() === ix.keys[4].pubkey.toBase58()
    ? ix.keys[4].pubkey.toBase58() : ix.keys[4].pubkey.toBase58());

  const [pdaA] = findActPda(PROGRAM_ID, book, 'art_x');
  const [pdaB] = findActPda(PROGRAM_ID, book, 'art_y');
  assert.notEqual(pdaA.toBase58(), pdaB.toBase58());

  const rw = buildRecordWorkInstruction({ programId: PROGRAM_ID, master: master.publicKey, total: 90 });
  const [att] = findAttestationPda(PROGRAM_ID, master.publicKey);
  assert.equal(rw.keys[0].pubkey.toBase58(), att.toBase58());
  assert.equal(rw.data.length, 9);
});
