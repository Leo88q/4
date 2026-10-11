/**
 * Книга Слоёв (Book of Layers) — mock chain mode.
 *
 * A tamper-evident, append-only hash chain: every entry links the previous
 * one, so a rewritten history is detectable via verify(). In production this
 * is replaced by on-chain commitments (chain/programs/palimpsest_book);
 * the entry schema stays identical.
 */
import { hashObject, sha256Hex } from '@palimpsest/common';

export const GENESIS = sha256Hex('palimpsest:book:genesis');

export class Book {
  /** @param {object[]} [entries] */
  constructor(entries = []) {
    this.entries = entries;
  }

  head() {
    return this.entries.length ? this.entries[this.entries.length - 1].hash : GENESIS;
  }

  /**
   * @param {{ type: string, playerId: string|null, artifactId?: string|null, payload: object }} rec
   */
  append(rec) {
    const seq = this.entries.length;
    const entry = {
      seq,
      ts: Date.now(),
      type: rec.type,
      playerId: rec.playerId ?? null,
      artifactId: rec.artifactId ?? null,
      payload: rec.payload,
      prevHash: this.head(),
      hash: '',
    };
    // canonical hash over the entry without its own hash field
    entry.hash = hashObject({
      seq: entry.seq,
      ts: entry.ts,
      type: entry.type,
      playerId: entry.playerId,
      artifactId: entry.artifactId,
      payload: entry.payload,
      prevHash: entry.prevHash,
    });
    this.entries.push(entry);
    return entry;
  }

  /** @returns {{ ok: boolean, brokenAt: number|null }} */
  verify() {
    let prev = GENESIS;
    for (let i = 0; i < this.entries.length; i += 1) {
      const e = this.entries[i];
      const expect = hashObject({
        seq: e.seq, ts: e.ts, type: e.type, playerId: e.playerId,
        artifactId: e.artifactId, payload: e.payload, prevHash: e.prevHash,
      });
      if (e.prevHash !== prev || e.hash !== expect) return { ok: false, brokenAt: i };
      prev = e.hash;
    }
    return { ok: true, brokenAt: null };
  }
}
