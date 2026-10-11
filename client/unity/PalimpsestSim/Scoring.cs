// Palimpsest — Restory.Sim v1 (C# port of packages/sim/src/score.js).
// Индекс Палимпсеста 0..100. MidpointRounding.AwayFromZero mirrors JS Math.round.
using System;
using System.Collections.Generic;

namespace Palimpsest.Sim
{
    public sealed class ScoreResult
    {
        public int Total;
        public int Accuracy, Integrity, Rationality, Discoveries;
        public int LossCells, Uncovered, OverpaintCells, TearCells, PatchedTears, Actions;
        public long ElapsedMs;
    }

    public static class Scoring
    {
        private const int WAccuracy = 40, WIntegrity = 25, WRationality = 15, WDiscoveries = 20;

        private static int ClampBp(double v) =>
            (int)Math.Max(0, Math.Min(10000, Math.Round(v, MidpointRounding.AwayFromZero)));

        private static int RoundJs(double v) => (int)Math.Round(v, MidpointRounding.AwayFromZero);

        public static ScoreResult Score(Puzzle puzzle, RestorationState state)
        {
            int n = state.N;
            int total = n * n;

            long errSum = 0;
            int lossCells = 0, uncovered = 0, overpaintCells = 0;
            for (int i = 0; i < total; i++)
            {
                if (puzzle.Loss0[i] > 0)
                {
                    lossCells++;
                    if (state.RestoredMask[i] == 0)
                    {
                        uncovered++;
                        errSum += 765;
                    }
                    else
                    {
                        errSum += Math.Abs(state.Restored[i * 3] - puzzle.Paint[i * 3]);
                        errSum += Math.Abs(state.Restored[i * 3 + 1] - puzzle.Paint[i * 3 + 1]);
                        errSum += Math.Abs(state.Restored[i * 3 + 2] - puzzle.Paint[i * 3 + 2]);
                    }
                }
                else if (state.RestoredMask[i] > 0) overpaintCells++;
            }
            double meanErr = lossCells > 0 ? (double)errSum / lossCells / 765 : 0;
            double coverageFrac = lossCells > 0 ? (double)uncovered / lossCells : 0;
            double overFrac = (double)overpaintCells / total;
            int accuracy = ClampBp(10000 - meanErr * 10000 - coverageFrac * 3000 - overFrac * 2500);

            int newLoss = 0, tearLeft = 0, tearCells = 0, patchedTears = 0, patchQualitySum = 0;
            for (int i = 0; i < total; i++)
            {
                if (state.Loss[i] > puzzle.Loss0[i]) newLoss += state.Loss[i] - puzzle.Loss0[i];
                if (puzzle.Tear0[i] > 0)
                {
                    tearCells++;
                    if (state.Tear[i] == 0 && state.Patch[i] > 0)
                    {
                        patchedTears++;
                        patchQualitySum += state.PatchQuality[i];
                    }
                }
                if (state.Tear[i] > 0) tearLeft += state.Tear[i];
            }
            double newLossFrac = (double)newLoss / (255 * total);
            double tearFrac = tearCells > 0 ? (double)tearLeft / (255 * tearCells) : 0;
            double meanQ = patchedTears > 0 ? (double)patchQualitySum / patchedTears / 255 : 0;
            double patchBonus = tearCells > 0 ? Math.Min(1000, (double)patchedTears / tearCells * 1000 * meanQ) : 0;
            double missingVarnishPenalty = state.NewVarnish > 0 ? 0 : 2000;
            int integrity = ClampBp(10000 - newLossFrac * 4500 - tearFrac * 3500 - missingVarnishPenalty + patchBonus);

            int count = state.Actions.Count;
            int overPar = count > puzzle.Par ? (count - puzzle.Par) * 180 : 0;
            long elapsed = state.StartedAt != null && state.FinishedAt != null
                ? state.FinishedAt.Value - state.StartedAt.Value
                : 60000;
            double hastePenalty = elapsed < 15000 ? 2500 : 0;
            int rationality = ClampBp(10000 - Math.Min(5000, overPar) - hastePenalty);

            var truth = new HashSet<string>(puzzle.Findings);
            var said = new HashSet<string>(state.Discoveries);
            int tp = 0;
            foreach (var f in said) if (truth.Contains(f)) tp++;
            int fp = said.Count - tp;
            double discoveriesBp;
            if (said.Count == 0 && truth.Count == 0) discoveriesBp = 10000;
            else if (said.Count > 0)
            {
                double precision = (double)tp / (tp + fp);
                double recall = truth.Count > 0 ? (double)tp / truth.Count : 1;
                double f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
                discoveriesBp = ClampBp(f1 * 10000);
            }
            else discoveriesBp = 0;
            int discoveries = ClampBp(discoveriesBp);

            int totalScore = RoundJs(
                (WAccuracy * accuracy + WIntegrity * integrity + WRationality * rationality + WDiscoveries * discoveries) / 10000.0);

            return new ScoreResult
            {
                Total = totalScore,
                Accuracy = RoundJs(accuracy / 100.0),
                Integrity = RoundJs(integrity / 100.0),
                Rationality = RoundJs(rationality / 100.0),
                Discoveries = RoundJs(discoveries / 100.0),
                LossCells = lossCells,
                Uncovered = uncovered,
                OverpaintCells = overpaintCells,
                TearCells = tearCells,
                PatchedTears = patchedTears,
                Actions = count,
                ElapsedMs = elapsed,
            };
        }
    }
}
