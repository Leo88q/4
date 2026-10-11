/**
 * Full deterministic re-simulation: seed + action log -> verdict.
 * The server runs exactly this to accept or reject a restoration
 * (CONCEPT.md §8). No trust in the client.
 */
import { sha256Hex } from '@palimpsest/common';
import { generate } from './generate.js';
import { createState, stateBytes } from './state.js';
import { applyAction, validateActionLog } from './actions.js';
import { score } from './score.js';

/**
 * @param {string} seedString
 * @param {object[]} actions — full log including a final {type:'finish'}
 * @param {{ requireFinish?: boolean }} [opts]
 */
export function simulate(seedString, actions, opts = {}) {
  const requireFinish = opts.requireFinish !== false;
  const check = validateActionLog(actions);
  if (!check.ok) return { ok: false, reason: check.reason };

  const puzzle = generate(seedString);
  const state = createState(puzzle);
  for (const a of actions) applyAction(state, puzzle, a);

  if (requireFinish && !state.finished) return { ok: false, reason: 'not_finished' };

  const result = score(puzzle, state);
  return {
    ok: true,
    seed: seedString,
    stateHash: sha256Hex(stateBytes(state)),
    score: result,
    finished: state.finished,
    meta: {
      epoch: puzzle.epoch,
      title: puzzle.title,
      year: puzzle.year,
      par: puzzle.par,
    },
  };
}
