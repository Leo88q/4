import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, createState, applyAction, replay, score, simulate, validateActionLog, stateBytes, GRID } from '../src/index.js';
import { sha256Hex } from '@palimpsest/common';

const SEED = 'palimpsest-daily-v1:2026-10-11';
const T0 = 1800000000000;

function log(actions) {
  let t = T0;
  return actions.map((a) => {
    const out = { ...a, t };
    t += 100;
    return out;
  });
}

test('generation is deterministic per seed and differs across seeds', () => {
  const a = generate(SEED);
  const b = generate(SEED);
  const c = generate('palimpsest-daily-v1:2026-10-12');
  assert.equal(sha256Hex(a.paint), sha256Hex(b.paint));
  assert.equal(sha256Hex(a.varnish0), sha256Hex(b.varnish0));
  assert.notEqual(sha256Hex(a.paint), sha256Hex(c.paint));
  assert.equal(a.N, GRID);
  assert.ok(a.title.length > 0);
  assert.ok(a.findings.includes('varnish_darkening'));
});

test('over-solvent irreversibly burns paint', () => {
  const puzzle = generate(SEED);
  const gentle = replay(puzzle, log([
    { type: 'solvent', x: 0.5, y: 0.5, r: 0.2, strength: 0.5 },
  ]));
  const harsh = replay(puzzle, log([
    { type: 'solvent', x: 0.5, y: 0.5, r: 0.2, strength: 1.0 },
  ]));
  const burned = Array.from(harsh.loss).reduce((s, v, i) => s + Math.max(0, v - puzzle.loss0[i]), 0);
  const gentleBurn = Array.from(gentle.loss).reduce((s, v, i) => s + Math.max(0, v - puzzle.loss0[i]), 0);
  assert.ok(burned > gentleBurn, 'harsh solvent must create more loss');
  assert.equal(gentleBurn, 0);
});

test('validateActionLog catches cheats', () => {
  assert.equal(validateActionLog([{ type: 'finish', t: 100 }, { type: 'finish', t: 120 }]).ok, false); // too fast
  assert.equal(validateActionLog([{ type: 'nuke', t: 100 }]).ok, false);
  assert.equal(validateActionLog([{ type: 'brush', t: 100, x: 0.5, y: 0.5, r: 0.1, color: [1, 2, 300] }]).ok, false);
  assert.equal(validateActionLog([{ type: 'patch', t: 100, x: 0, y: 0, w: 0.1, h: 0.1, material: 9 }]).ok, false);
  assert.equal(validateActionLog(log([{ type: 'finish' }])).ok, true);
});

/** Craft a near-perfect restoration log from ground truth (test-only oracle). */
function perfectLog(puzzle) {
  const actions = [{ type: 'diagnose', findings: puzzle.findings }];
  for (let y = 0; y < GRID; y += 6) {
    for (let x = 0; x < GRID; x += 6) {
      actions.push({ type: 'solvent', x: (x + 3) / GRID, y: (y + 3) / GRID, r: 0.14, strength: 0.55 });
      actions.push({ type: 'wipe', x: (x + 3) / GRID, y: (y + 3) / GRID, r: 0.14 });
    }
  }
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const i = y * GRID + x;
      if (puzzle.tear0[i] > 0) {
        actions.push({ type: 'patch', x: x / GRID, y: y / GRID, w: 1 / GRID, h: 1 / GRID, material: 2 });
      }
      if (puzzle.loss0[i] > 0) {
        actions.push({
          type: 'brush',
          x: (x + 0.5) / GRID,
          y: (y + 0.5) / GRID,
          r: 0.02,
          color: [puzzle.paint[i * 3], puzzle.paint[i * 3 + 1], puzzle.paint[i * 3 + 2]],
        });
      }
    }
  }
  actions.push({ type: 'varnish', kind: 0, thickness: 0.4 });
  actions.push({ type: 'finish' });
  return actions;
}

test('skillful restoration beats careless one', () => {
  const puzzle = generate(SEED);
  const good = simulate(SEED, log(perfectLog(puzzle)));
  const bad = simulate(SEED, log([
    { type: 'solvent', x: 0.5, y: 0.5, r: 0.3, strength: 1.0 },
    { type: 'varnish', kind: 1, thickness: 0.9 },
    { type: 'finish' },
  ]));
  assert.equal(good.ok, true);
  assert.equal(bad.ok, true);
  assert.ok(good.score.total > 60, `good total ${good.score.total}`);
  assert.ok(bad.score.total < 45, `bad total ${bad.score.total}`);
  assert.ok(good.score.total > bad.score.total + 25);
  assert.equal(good.score.total, Math.max(0, Math.min(100, good.score.total)));
});

test('simulate requires finish and is deterministic', () => {
  const puzzle = generate(SEED);
  const actions = log(perfectLog(puzzle).slice(0, -1));
  assert.equal(simulate(SEED, actions).reason, 'not_finished');
  const full = log(perfectLog(puzzle));
  const r1 = simulate(SEED, full);
  const r2 = simulate(SEED, full);
  assert.equal(r1.stateHash, r2.stateHash);
  assert.equal(r1.score.total, r2.score.total);
  assert.equal(r1.stateHash.length, 64);
});

test('stateBytes covers all layers', () => {
  const puzzle = generate(SEED);
  const state = createState(puzzle);
  assert.equal(stateBytes(state).length, GRID * GRID * 8 + 4);
});
