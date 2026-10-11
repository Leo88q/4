/**
 * Mutable working state of a restoration. Every action mutates layers;
 * nothing can be undone (CONCEPT.md §4.2) — reversibility lives in Git,
 * not in the paint.
 */
import { GRID } from './const.js';

/**
 * @param {object} puzzle — output of generate()
 */
export function createState(puzzle) {
  return {
    seed: puzzle.seed,
    N: GRID,
    varnish: Uint8Array.from(puzzle.varnish0),
    soft: new Uint8Array(GRID * GRID), // solvent softening, 0..255
    loss: Uint8Array.from(puzzle.loss0),
    tear: Uint8Array.from(puzzle.tear0),
    patch: new Uint8Array(GRID * GRID),
    patchQuality: new Uint8Array(GRID * GRID),
    restored: new Uint8Array(GRID * GRID * 3),
    restoredMask: new Uint8Array(GRID * GRID),
    overpaint: new Uint8Array(GRID * GRID),
    newVarnish: 0,
    newVarnishKind: -1,
    discoveries: /** @type {string[]} */ ([]),
    finished: false,
    actions: /** @type {object[]} */ ([]),
    startedAt: null,
    finishedAt: null,
  };
}

/**
 * Quantized snapshot of the final layers — the client and the server must
 * agree on this hash (server-authoritative check, CONCEPT.md §8).
 * @param {object} state
 * @returns {Uint8Array}
 */
export function stateBytes(state) {
  const out = new Uint8Array(
    state.varnish.length * 8 + 4,
  );
  let o = 0;
  out.set(state.varnish, o); o += state.varnish.length;
  out.set(state.loss, o); o += state.loss.length;
  out.set(state.tear, o); o += state.tear.length;
  out.set(state.patch, o); o += state.patch.length;
  out.set(state.restored, o); o += state.restored.length;
  out.set(state.restoredMask, o); o += state.restoredMask.length;
  out[o] = state.newVarnish; o += 1;
  out[o] = state.newVarnishKind < 0 ? 255 : state.newVarnishKind; o += 1;
  out[o] = state.finished ? 1 : 0; o += 1;
  out[o] = state.discoveries.length & 0xff; o += 1;
  return out.slice(0, o);
}
