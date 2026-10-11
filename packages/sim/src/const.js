/**
 * Shared constants of the restoration simulation (Restory.Sim v1).
 * Mirrored by client/unity/PalimpsestSim — keep in lockstep, bump SIM_VERSION.
 */
export const SIM_VERSION = 1;

/** Grid resolution of a puzzle (N×N cells). */
export const GRID = 32;

/** Scoring weights in percent (CONCEPT.md §4.3). */
export const WEIGHTS = Object.freeze({
  accuracy: 40,
  integrity: 25,
  rationality: 15,
  discoveries: 20,
});

/** Anti-cheat timing (also enforced by the server). */
export const MIN_ACTION_GAP_MS = 60;
export const SESSION_TTL_MS = 30 * 60 * 1000;
export const MAX_ACTIONS = 800;

/** Action schema version accepted by the simulator. */
export const ACTION_SCHEMA = Object.freeze({
  diagnose: ['findings'],
  solvent: ['x', 'y', 'r', 'strength'],
  wipe: ['x', 'y', 'r'],
  patch: ['x', 'y', 'w', 'h', 'material'],
  brush: ['x', 'y', 'r', 'color'],
  varnish: ['kind', 'thickness'],
  finish: [],
});

export const FINDINGS = Object.freeze([
  'varnish_darkening',
  'loss',
  'tear',
  'water_stain',
  'old_restoration',
]);

export const MATERIALS = Object.freeze([
  { id: 0, name: 'бумага', quality: 0.55 },
  { id: 1, name: 'лён', quality: 0.85 },
  { id: 2, name: 'шёлк', quality: 1.0 },
]);

export const VARNISH_KINDS = Object.freeze([
  { id: 0, name: 'мастикс', tint: 24 },
  { id: 1, name: 'шеллак', tint: 64 },
  { id: 2, name: 'синтетика', tint: 10 },
]);
