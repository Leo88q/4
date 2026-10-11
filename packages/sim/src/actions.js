/**
 * Action schema + deterministic application of each restoration step.
 * Action log format (JSON):
 *   { type, t (unix ms), ...fields }
 * Coordinates are normalized floats in [0,1]; radius too. Quantization to
 * grid cells is integer math — identical in the C# port.
 */
import { ACTION_SCHEMA, MIN_ACTION_GAP_MS, MAX_ACTIONS, MATERIALS, VARNISH_KINDS } from './const.js';
import { createState } from './state.js';

/**
 * Structural + timing validation of an action log (shared with server anti-cheat).
 * @param {object[]} actions
 * @param {{ startedAt?: number }} [session]
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateActionLog(actions, session = {}) {
  if (!Array.isArray(actions) || actions.length === 0) return { ok: false, reason: 'empty_log' };
  if (actions.length > MAX_ACTIONS) return { ok: false, reason: 'too_many_actions' };
  let prevT = session.startedAt ?? 0;
  for (const a of actions) {
    if (!a || typeof a !== 'object') return { ok: false, reason: 'bad_action' };
    if (!(a.type in ACTION_SCHEMA)) return { ok: false, reason: `unknown_type:${a.type}` };
    for (const field of ACTION_SCHEMA[a.type]) {
      if (!(field in a)) return { ok: false, reason: `missing:${a.type}.${field}` };
    }
    if (!Number.isFinite(a.t)) return { ok: false, reason: 'bad_timestamp' };
    if (a.t < prevT) return { ok: false, reason: 'time_travel' };
    if (a.t - prevT < MIN_ACTION_GAP_MS && prevT !== 0) {
      return { ok: false, reason: `too_fast:${a.type}` };
    }
    prevT = a.t;
    for (const k of ['x', 'y', 'r', 'w', 'h', 'strength', 'thickness']) {
      if (k in a && !Number.isFinite(a[k])) return { ok: false, reason: `bad_number:${k}` };
      if (k in a && (a[k] < -0.01 || a[k] > 1.5)) return { ok: false, reason: `out_of_range:${k}` };
    }
    if (a.type === 'brush') {
      if (!Array.isArray(a.color) || a.color.length !== 3 || a.color.some((c) => !Number.isFinite(c) || c < 0 || c > 255)) {
        return { ok: false, reason: 'bad_color' };
      }
    }
    if (a.type === 'diagnose') {
      if (!Array.isArray(a.findings) || a.findings.length > 8) return { ok: false, reason: 'bad_findings' };
    }
    if (a.type === 'patch' && ![0, 1, 2].includes(a.material)) return { ok: false, reason: 'bad_material' };
    if (a.type === 'varnish' && ![0, 1, 2].includes(a.kind)) return { ok: false, reason: 'bad_kind' };
  }
  return { ok: true };
}

/** @param {number} v @param {number} n */
function cell(v, n) {
  return Math.max(0, Math.min(n - 1, Math.floor(v * n)));
}

/**
 * Apply one action to the state (mutating). Throws on structural errors —
 * call validateActionLog first for friendly results.
 * @param {object} state
 * @param {object} puzzle
 * @param {object} action
 */
export function applyAction(state, puzzle, action) {
  const N = state.N;
  switch (action.type) {
    case 'diagnose': {
      state.discoveries = [...new Set(action.findings)].filter((f) => typeof f === 'string');
      break;
    }
    case 'solvent': {
      const gx = cell(action.x, N);
      const gy = cell(action.y, N);
      const rad = Math.max(1, Math.round(action.r * N));
      const strength = Math.max(0, Math.min(1, action.strength));
      for (let y = Math.max(0, gy - rad); y <= Math.min(N - 1, gy + rad); y += 1) {
        for (let x = Math.max(0, gx - rad); x <= Math.min(N - 1, gx + rad); x += 1) {
          const d = Math.sqrt((x - gx) * (x - gx) + (y - gy) * (y - gy));
          if (d > rad) continue;
          const fall = 1 - d / (rad + 1);
          const i = y * N + x;
          state.soft[i] = Math.min(255, Math.floor(state.soft[i] + strength * 255 * fall));
          if (strength > 0.8) {
            // too much solvent burns the paint — irreversible
            state.loss[i] = Math.min(255, Math.floor(state.loss[i] + (strength - 0.8) * 255 * fall * 1.2));
          }
        }
      }
      break;
    }
    case 'wipe': {
      const gx = cell(action.x, N);
      const gy = cell(action.y, N);
      const rad = Math.max(1, Math.round(action.r * N));
      for (let y = Math.max(0, gy - rad); y <= Math.min(N - 1, gy + rad); y += 1) {
        for (let x = Math.max(0, gx - rad); x <= Math.min(N - 1, gx + rad); x += 1) {
          const d = Math.sqrt((x - gx) * (x - gx) + (y - gy) * (y - gy));
          if (d > rad) continue;
          const fall = 1 - d / (rad + 1);
          const i = y * N + x;
          const lift = Math.floor(state.soft[i] * fall);
          state.varnish[i] = Math.max(0, state.varnish[i] - lift);
          state.soft[i] = Math.max(0, state.soft[i] - Math.floor(120 * fall));
        }
      }
      break;
    }
    case 'patch': {
      const x0 = cell(action.x, N);
      const y0 = cell(action.y, N);
      const w = Math.max(1, Math.round(action.w * N));
      const h = Math.max(1, Math.round(action.h * N));
      const q = Math.floor(MATERIALS[action.material].quality * 255);
      for (let y = y0; y <= Math.min(N - 1, y0 + h); y += 1) {
        for (let x = x0; x <= Math.min(N - 1, x0 + w); x += 1) {
          const i = y * N + x;
          state.patch[i] = 255;
          if (state.patchQuality[i] < q) state.patchQuality[i] = q;
          state.tear[i] = Math.max(0, state.tear[i] - 255);
        }
      }
      break;
    }
    case 'brush': {
      const gx = cell(action.x, N);
      const gy = cell(action.y, N);
      const rad = Math.max(1, Math.round(action.r * N));
      const [cr, cg, cb] = action.color.map((c) => Math.max(0, Math.min(255, Math.round(c))));
      for (let y = Math.max(0, gy - rad); y <= Math.min(N - 1, gy + rad); y += 1) {
        for (let x = Math.max(0, gx - rad); x <= Math.min(N - 1, gx + rad); x += 1) {
          const d = Math.sqrt((x - gx) * (x - gx) + (y - gy) * (y - gy));
          if (d > rad) continue;
          const i = y * N + x;
          state.restored[i * 3] = cr;
          state.restored[i * 3 + 1] = cg;
          state.restored[i * 3 + 2] = cb;
          state.restoredMask[i] = 255;
          if (puzzle.loss0[i] === 0) state.overpaint[i] = 255;
        }
      }
      break;
    }
    case 'varnish': {
      const kind = VARNISH_KINDS[action.kind];
      state.newVarnishKind = action.kind;
      state.newVarnish = Math.floor(kind.tint + Math.max(0, Math.min(1, action.thickness)) * 120);
      break;
    }
    case 'finish': {
      state.finished = true;
      state.finishedAt = action.t;
      break;
    }
    default:
      throw new Error(`unknown action ${action.type}`);
  }
  state.actions.push(action);
  if (state.startedAt === null && Number.isFinite(action.t)) state.startedAt = action.t;
  return state;
}

/**
 * Replay a full log. @param {object} puzzle @param {object[]} actions
 */
export function replay(puzzle, actions) {
  // eslint-disable-next-line no-use-before-define
  const state = createState(puzzle);
  for (const a of actions) applyAction(state, puzzle, a);
  return state;
}

export { ACTION_SCHEMA, MIN_ACTION_GAP_MS, MAX_ACTIONS, MATERIALS, VARNISH_KINDS };
