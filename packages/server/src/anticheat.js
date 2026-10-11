/**
 * Anti-cheat (CONCEPT.md §8): rate limits, pace analysis, daily caps.
 * Structural action validation lives in @palimpsest/sim (validateActionLog).
 */
import { config } from './config.js';

const buckets = new Map();

/** Token-bucket rate limit per key (IP). */
export function rateLimit(key, opts = config.rateLimit) {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: opts.maxPosts, ts: now };
  const refill = ((now - b.ts) / opts.windowMs) * opts.maxPosts;
  b.tokens = Math.min(opts.maxPosts, b.tokens + refill);
  b.ts = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return { ok: false, reason: 'rate_limited' };
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return { ok: true };
}

/** Haste heuristics for a finished session. */
export function analyzePace(session, result) {
  const flags = [];
  const elapsed = session.actions.length
    ? session.actions[session.actions.length - 1].t - session.actions[0].t
    : 0;
  if (elapsed < 15_000) flags.push('haste');
  if (session.actions.length < 5) flags.push('thin_log');
  if (result.score.diagnostics.elapsedMs < 15_000) flags.push('haste_finish');
  const gaps = session.actions.slice(1).map((a, i) => a.t - session.actions[i].t);
  if (gaps.length > 10 && gaps.every((g) => g === 60)) flags.push('metronome');
  return flags;
}

export function resetRateLimits() {
  buckets.clear();
}
