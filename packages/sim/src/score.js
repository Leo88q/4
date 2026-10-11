/**
 * Server-side scoring: Индекс Палимпсеста, 0..100 (CONCEPT.md §4.3).
 * All components computed in integer basis points (0..10000) for
 * deterministic agreement between the JS reference and the C# port.
 */
import { WEIGHTS } from './const.js';

const clampBp = (v) => Math.max(0, Math.min(10000, Math.round(v)));

/**
 * @param {object} puzzle — from generate()
 * @param {object} state — final state after replay
 * @returns {{ total: number, components: object, diagnostics: object }}
 */
export function score(puzzle, state) {
  const N = state.N;
  const total = N * N;

  // ---- accuracy: color of restored losses + coverage + no overpaint ----
  let errSum = 0;
  let lossCells = 0;
  let uncovered = 0;
  let overpaintCells = 0;
  for (let i = 0; i < total; i += 1) {
    if (puzzle.loss0[i] > 0) {
      lossCells += 1;
      if (state.restoredMask[i] === 0) {
        uncovered += 1;
        errSum += 765; // untouched loss counts as maximum error
      } else {
        const dr = Math.abs(state.restored[i * 3] - puzzle.paint[i * 3]);
        const dg = Math.abs(state.restored[i * 3 + 1] - puzzle.paint[i * 3 + 1]);
        const db = Math.abs(state.restored[i * 3 + 2] - puzzle.paint[i * 3 + 2]);
        errSum += dr + dg + db;
      }
    } else if (state.restoredMask[i] > 0) {
      overpaintCells += 1;
    }
  }
  const meanErr = lossCells > 0 ? errSum / lossCells / 765 : 0;
  const coverageFrac = lossCells > 0 ? uncovered / lossCells : 0;
  const overFrac = overpaintCells / total;
  const accuracy = clampBp(10000 - meanErr * 10000 - coverageFrac * 3000 - overFrac * 2500);

  // ---- integrity: no new damage, tears closed, conservation done ----
  let newLoss = 0;
  let tearLeft = 0;
  let tearCells = 0;
  let patchedTears = 0;
  let patchQualitySum = 0;
  for (let i = 0; i < total; i += 1) {
    if (state.loss[i] > puzzle.loss0[i]) newLoss += state.loss[i] - puzzle.loss0[i];
    if (puzzle.tear0[i] > 0) {
      tearCells += 1;
      if (state.tear[i] === 0 && state.patch[i] > 0) {
        patchedTears += 1;
        patchQualitySum += state.patchQuality[i];
      }
    }
    if (state.tear[i] > 0) tearLeft += state.tear[i];
  }
  const newLossFrac = newLoss / (255 * total);
  const tearFrac = tearCells > 0 ? tearLeft / (255 * tearCells) : 0;
  const meanQ = patchedTears > 0 ? patchQualitySum / patchedTears / 255 : 0;
  const patchBonus = tearCells > 0 ? Math.min(1000, (patchedTears / tearCells) * 1000 * meanQ) : 0;
  const missingVarnishPenalty = state.newVarnish > 0 ? 0 : 2000;
  const integrity = clampBp(
    10000 - newLossFrac * 4500 - tearFrac * 3500 - missingVarnishPenalty + patchBonus,
  );

  // ---- rationality: action economy + no haste ----
  const count = state.actions.length;
  const overPar = count > puzzle.par ? (count - puzzle.par) * 180 : 0;
  const elapsed = state.startedAt !== null && state.finishedAt !== null
    ? state.finishedAt - state.startedAt
    : 60000;
  const hastePenalty = elapsed < 15000 ? 2500 : 0;
  const rationality = clampBp(10000 - Math.min(5000, overPar) - hastePenalty);

  // ---- discoveries: F1 of diagnosis vs hidden ground truth ----
  const truth = new Set(puzzle.findings);
  const said = new Set(state.discoveries);
  let tp = 0;
  for (const f of said) if (truth.has(f)) tp += 1;
  const fp = said.size - tp;
  const fn = truth.size - tp;
  let discoveries = 0;
  if (said.size === 0 && truth.size === 0) {
    discoveries = 10000;
  } else if (said.size > 0) {
    const precision = tp / (tp + fp);
    const recall = truth.size > 0 ? tp / (truth.size) : 1;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    discoveries = clampBp(f1 * 10000);
  }

  const totalScore = Math.round(
    (WEIGHTS.accuracy * accuracy
      + WEIGHTS.integrity * integrity
      + WEIGHTS.rationality * rationality
      + WEIGHTS.discoveries * discoveries) / 10000,
  );

  return {
    total: totalScore,
    components: {
      accuracy: Math.round(accuracy / 100),
      integrity: Math.round(integrity / 100),
      rationality: Math.round(rationality / 100),
      discoveries: Math.round(discoveries / 100),
    },
    diagnostics: {
      lossCells,
      uncovered,
      overpaintCells,
      newLoss,
      tearCells,
      patchedTears,
      actions: count,
      elapsedMs: elapsed,
      findings: { tp, fp, fn },
    },
  };
}
