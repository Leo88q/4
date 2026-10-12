/**
 * «Дыхание времени» (CONCEPT.md §4.1, шаг 4: тип лака влияет на старение).
 *
 * Deterministic aging profile of a finished artifact. Not a game penalty:
 * it is the promise of the lore — a restoration commits the artifact to a
 * future, and that future can be projected (and later verified) by anyone.
 * Mirrors Mechanic_VarnishFade of the Restory fork on the platform level.
 */
import { hashObject } from '@palimpsest/common';

/** Per-year aging rates by varnish kind (see VARNISH_KINDS in const.js). */
export const VARNISH_AGING = Object.freeze({
  0: { name: 'мастикс', yellowing: 0.008, brittleness: 0.004 },
  1: { name: 'шеллак', yellowing: 0.016, brittleness: 0.008 },
  2: { name: 'синтетика', yellowing: 0.004, brittleness: 0.012 },
});

export const YEARS = 365.25 * 24 * 3600 * 1000;

/**
 * Extract the conservation decision (final varnish) from an action log.
 * @param {object[]} actions
 * @returns {{ kind: number, thickness: number } | null}
 */
export function conservationOf(actions) {
  let last = null;
  for (const a of actions) {
    if (a && a.type === 'varnish') {
      last = { kind: a.kind, thickness: Math.max(0, Math.min(1, a.thickness)) };
    }
  }
  return last;
}

/**
 * Aging projection for an artifact at a point in time.
 * @param {{ createdAt: number, conservation?: object|null, seed: string }} artifact
 * @param {number} [asOf] — default: now
 */
export function ageArtifact(artifact, asOf = Date.now()) {
  const cons = artifact.conservation ?? null;
  const profile = cons ? VARNISH_AGING[cons.kind] : null;
  const years = Math.max(0, (asOf - artifact.createdAt) / YEARS);

  // tiny per-artifact variation, deterministic from the seed (±12%)
  const jitter = 0.88 + (parseInt(hashObject({ s: artifact.seed }).slice(0, 4), 16) % 245) / 1000;

  const thicknessFactor = cons ? 0.5 + cons.thickness : 1;
  const yellowing = profile
    ? Math.min(1, profile.yellowing * years * thicknessFactor * jitter)
    : Math.min(1, 0.022 * years * jitter); // без консервации стареет быстрее
  const brittleness = profile
    ? Math.min(1, profile.brittleness * years * jitter)
    : Math.min(1, 0.015 * years * jitter);

  return {
    asOf,
    years: Math.round(years * 100) / 100,
    conservation: cons ? { ...cons, varnish: profile.name } : null,
    yellowing: Math.round(yellowing * 1000) / 1000,
    brittleness: Math.round(brittleness * 1000) / 1000,
    care: careAdvice(yellowing, brittleness, cons),
  };
}

function careAdvice(yellowing, brittleness, cons) {
  if (!cons) return 'без консервации артефакт стареет быстрее — рекомендуется «Покрытие»';
  if (brittleness > 0.35) return 'холст становится хрупким: нужен осмотр Смотрителя';
  if (yellowing > 0.25) return 'лак заметно желтеет — планируйте «Снятие Покрова» в будущем';
  return 'состояние стабильное, осмотр не требуется';
}

/**
 * Standard projection table (now + 10/25/50 years) for artifact cards.
 * @param {object} artifact
 */
export function agingProjection(artifact) {
  const now = Date.now();
  return {
    now: ageArtifact(artifact, now),
    in10y: ageArtifact(artifact, now + 10 * YEARS),
    in25y: ageArtifact(artifact, now + 25 * YEARS),
    in50y: ageArtifact(artifact, now + 50 * YEARS),
  };
}
