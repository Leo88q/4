/**
 * Seeds and deterministic RNG.
 *
 * The seed string is the single source of truth for a restoration puzzle
 * (CONCEPT.md §7.4). sfc32 uses only uint32 arithmetic so the C# Unity port
 * (client/unity/PalimpsestSim) reproduces every value bit-exactly.
 */
import { sha256 } from './sha256.js';

export const DAILY_SEED_VERSION = 'palimpsest-daily-v1';

/**
 * @param {Date|string} [date] — Date or 'YYYY-MM-DD'
 * @returns {string} e.g. 'palimpsest-daily-v1:2026-10-11'
 */
export function dailySeedString(date = new Date()) {
  const iso = typeof date === 'string' ? date : date.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`bad date: ${iso}`);
  return `${DAILY_SEED_VERSION}:${iso}`;
}

/** @param {string} seedString @returns {string} date part of a daily seed */
export function dailySeedDate(seedString) {
  return seedString.slice(DAILY_SEED_VERSION.length + 1);
}

/**
 * Mix the public daily seed with an on-chain randomness commitment
 * (commit-reveal, CONCEPT.md §7.4). Empty chain entropy = raw seed
 * (pre-launch / test mode).
 * @param {string} seedString
 * @param {string} [chainEntropyHex]
 */
export function mixChainEntropy(seedString, chainEntropyHex = '') {
  if (!chainEntropyHex) return seedString;
  return `${seedString}+chain:${chainEntropyHex}`;
}

/**
 * Expand a seed string into four uint32 words.
 * @param {string} seedString
 * @returns {[number, number, number, number]}
 */
export function expandSeed(seedString) {
  const d = sha256(new TextEncoder().encode(seedString));
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return [dv.getUint32(0), dv.getUint32(4), dv.getUint32(8), dv.getUint32(12)];
}

/**
 * sfc32 — small fast counter PRNG, warmup 15 rounds.
 * Deterministic across JS / C# / any uint32 implementation.
 */
export class Rng {
  /** @param {string|number[]} seed — seed string or four uint32 words */
  constructor(seed) {
    const w = typeof seed === 'string' ? expandSeed(seed) : seed;
    if (w.length !== 4) throw new Error('Rng needs 4 words');
    this.a = w[0] >>> 0; this.b = w[1] >>> 0; this.c = w[2] >>> 0; this.d = w[3] >>> 0;
    for (let i = 0; i < 15; i += 1) this.nextU32();
  }

  /** @returns {number} uint32 */
  nextU32() {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = (this.b ^ (this.b >>> 9)) >>> 0;
    this.b = (this.c + ((this.c << 3) >>> 0)) >>> 0;
    this.c = (((this.c << 21) >>> 0) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** @returns {number} float in [0, 1) */
  nextFloat() {
    return this.nextU32() / 4294967296;
  }

  /** @param {number} n @returns {number} int in [0, n) */
  nextInt(n) {
    return this.nextU32() % n;
  }

  /** @param {number} min @param {number} max @returns {number} int in [min, max] */
  nextRange(min, max) {
    return min + this.nextInt(max - min + 1);
  }
}
