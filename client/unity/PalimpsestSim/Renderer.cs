// Palimpsest — canonical compositor (v2, C# port of packages/sim/src/render.js).
// MUST mix layers byte-for-byte identically to the JS reference: same IEEE-754
// double expressions in the same operation order, Math.Floor everywhere.
// The web demo, this Unity view and verification scripts all share one formula.
// License: Apache-2.0.
using System;

namespace Palimpsest.Sim
{
    public static class PuzzleRenderer
    {
        /// <summary>
        /// RGBA frame (N*N*4). Physical view: paint under old varnish, losses as
        /// bare ground (or restored layer), tears dark, patches as birch-toned
        /// cloth, new varnish as warm film (only after finish).
        /// </summary>
        public static byte[] RenderRgba(
            byte[] paint, byte[] varnish, byte[] loss, byte[] tear,
            byte[] patch = null, byte[] restored = null, byte[] restoredMask = null,
            int newVarnish = 0, bool finished = false)
        {
            int n = Puzzle.Grid;
            var outp = new byte[n * n * 4];
            for (int i = 0; i < n * n; i++)
            {
                double r = paint[i * 3];
                double g = paint[i * 3 + 1];
                double b = paint[i * 3 + 2];

                // старый лак: тёплая плёнка
                double v = varnish[i] / 255.0;
                r = Math.Floor(r * (1 - v * 0.82) + 52 * v);
                g = Math.Floor(g * (1 - v * 0.82) + 38 * v);
                b = Math.Floor(b * (1 - v * 0.82) + 26 * v);

                // утраты: грунт (196,188,170) или восстановленный слой
                double lossNow = loss[i] / 255.0;
                if (lossNow > 0)
                {
                    double rr = (restoredMask != null && restoredMask[i] > 0) ? restored[i * 3] : 196;
                    double gg = (restoredMask != null && restoredMask[i] > 0) ? restored[i * 3 + 1] : 188;
                    double bb = (restoredMask != null && restoredMask[i] > 0) ? restored[i * 3 + 2] : 170;
                    r = Math.Floor(r * (1 - lossNow) + rr * lossNow);
                    g = Math.Floor(g * (1 - lossNow) + gg * lossNow);
                    b = Math.Floor(b * (1 - lossNow) + bb * lossNow);
                }

                // разрывы без заплаты — тьма; заплата — берёзовый лоскут
                byte pAt = patch != null ? patch[i] : (byte)0;
                if (tear[i] > 0 && pAt == 0)
                {
                    r = 36; g = 28; b = 24;
                }
                else if (pAt > 0)
                {
                    r = Math.Floor(r * 0.6 + 150 * 0.4);
                    g = Math.Floor(g * 0.6 + 132 * 0.4);
                    b = Math.Floor(b * 0.6 + 108 * 0.4);
                }

                // новый лак — тёплая плёнка, только после завершения
                if (newVarnish > 0 && finished)
                {
                    double nv = newVarnish / 255.0;
                    r = Math.Floor(r * (1 - nv * 0.2) + 90 * nv * 0.2);
                    g = Math.Floor(g * (1 - nv * 0.2) + 70 * nv * 0.2);
                }

                outp[i * 4] = (byte)Math.Max(0, Math.Min(255, r));
                outp[i * 4 + 1] = (byte)Math.Max(0, Math.Min(255, g));
                outp[i * 4 + 2] = (byte)Math.Max(0, Math.Min(255, b));
                outp[i * 4 + 3] = 255;
            }
            return outp;
        }

        /// <summary>First frame — what the restorer sees when the order arrives.</summary>
        public static byte[] RenderInitialRgba(Puzzle puzzle)
        {
            return RenderRgba(puzzle.Paint, puzzle.Varnish0, puzzle.Loss0, puzzle.Tear0);
        }

        /// <summary>Frame from the working state (after an action).</summary>
        public static byte[] RenderStateRgba(Puzzle puzzle, RestorationState state)
        {
            return RenderRgba(
                puzzle.Paint, state.Varnish, state.Loss, state.Tear,
                state.Patch, state.Restored, state.RestoredMask,
                state.NewVarnish, state.Finished);
        }
    }
}
