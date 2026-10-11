// Palimpsest — Restory.Sim v1 (C# port of packages/sim/src/generate.js).
// Deterministic puzzle generation from a seed. Doubles everywhere to stay
// IEEE-754 bit-compatible with the JS reference. License: Apache-2.0.
using System;

namespace Palimpsest.Sim
{
    public sealed class Epoch
    {
        public readonly string Name;
        public readonly int[][] Colors; // [r,g,b]
        public Epoch(string name, int[][] colors) { Name = name; Colors = colors; }
    }

    public sealed class Puzzle
    {
        public const int Grid = 32;
        public string Seed;
        public string EpochName;
        public string Title;
        public int Year;
        public int Par;
        public byte[] Paint;    // Grid*Grid*3
        public byte[] Varnish0; // Grid*Grid
        public byte[] Loss0;
        public byte[] Tear0;
        public bool HasWater;
        public bool HasOldRestoration;
        public string[] Findings;
    }

    public static class PuzzleGenerator
    {
        public static readonly Epoch[] Epochs =
        {
            new Epoch("Антика", new int[][] { C(194,152,92), C(166,124,82), C(214,188,138), C(122,96,70), C(232,206,156) }),
            new Epoch("Тёмное Средневековье", new int[][] { C(92,61,38), C(168,128,48), C(58,42,34), C(140,108,62), C(204,172,96) }),
            new Epoch("Возрождение", new int[][] { C(112,78,62), C(180,132,96), C(86,102,120), C(206,178,132), C(152,92,78) }),
            new Epoch("Барокко", new int[][] { C(64,48,42), C(148,104,66), C(96,84,72), C(188,156,110), C(110,64,52) }),
            new Epoch("Импрессионизм", new int[][] { C(122,148,172), C(196,186,148), C(152,168,122), C(222,198,166), C(98,118,142) }),
            new Epoch("Модерн", new int[][] { C(176,142,102), C(120,128,116), C(202,172,138), C(88,96,104), C(188,152,96) }),
        };

        private static int[][] C(int r, int g, int b) => new int[][] { new[] { r, g, b } };

        private static readonly string[] Titles =
        {
            "Портрет неизвестной", "Портрет неизвестного", "Пейзаж с рекой", "Натюрморт с фруктами",
            "Сцена ярмарки", "Дама в голубом", "Монах у окна", "Рыбаки", "Всадник", "Цветы в вазе",
            "Вид на гавань", "Святой с книгой", "Дети в саду", "Старик у камина", "Танец под окном",
        };

        /// <summary>Value noise over the grid (seeded lattice, bilinear + smoothstep).</summary>
        private static double[] ValueNoise(Rng rng, int lattice)
        {
            var g = new double[(lattice + 1) * (lattice + 1)];
            for (int i = 0; i < g.Length; i++) g[i] = rng.NextFloat();
            var output = new double[Puzzle.Grid * Puzzle.Grid];
            for (int y = 0; y < Puzzle.Grid; y++)
            {
                for (int x = 0; x < Puzzle.Grid; x++)
                {
                    double fx = (double)x / Puzzle.Grid * lattice;
                    double fy = (double)y / Puzzle.Grid * lattice;
                    int ix = Math.Min(lattice - 1, (int)Math.Floor(fx));
                    int iy = Math.Min(lattice - 1, (int)Math.Floor(fy));
                    double tx = fx - ix;
                    double ty = fy - iy;
                    double sx = tx * tx * (3 - 2 * tx);
                    double sy = ty * ty * (3 - 2 * ty);
                    double v00 = g[iy * (lattice + 1) + ix];
                    double v10 = g[iy * (lattice + 1) + ix + 1];
                    double v01 = g[(iy + 1) * (lattice + 1) + ix];
                    double v11 = g[(iy + 1) * (lattice + 1) + ix + 1];
                    output[y * Puzzle.Grid + x] = v00 + (v10 - v00) * sx + (v01 - v00) * sy + (v00 - v10 - v01 + v11) * sx * sy;
                }
            }
            return output;
        }

        public static Puzzle Generate(string seedString)
        {
            int n = Puzzle.Grid;
            var rng = new Rng(seedString);
            var epoch = Epochs[rng.NextInt(Epochs.Length)];
            string title = Titles[rng.NextInt(Titles.Length)];
            int year = 1400 + rng.NextInt(500);

            double[] shape = ValueNoise(rng, 4);
            double[] shade = ValueNoise(rng, 6);
            var paint = new byte[n * n * 3];
            int span = epoch.Colors.Length;
            for (int i = 0; i < n * n; i++)
            {
                double idxF = shape[i] * span;
                int[] p0 = epoch.Colors[Math.Min(span - 1, (int)Math.Floor(idxF)) % span];
                int[] p1 = epoch.Colors[Math.Min(span - 1, (int)Math.Floor(idxF) + 1) % span];
                int frac = (int)Math.Floor((idxF - Math.Floor(idxF)) * 255);
                int sh = 190 + (int)Math.Floor(shade[i] * 90);
                for (int c = 0; c < 3; c++)
                {
                    double mixed = (p0[c] * (255 - frac) + p1[c] * frac + 127) / 255.0;
                    int v = (int)Math.Floor(mixed * sh / 240.0);
                    paint[i * 3 + c] = (byte)Math.Max(0, Math.Min(255, v));
                }
            }

            double[] vn = ValueNoise(rng, 5);
            var varnish0 = new byte[n * n];
            for (int i = 0; i < n * n; i++) varnish0[i] = (byte)(140 + Math.Floor(vn[i] * 115));

            var loss0 = new byte[n * n];
            int blobCount = 2 + rng.NextInt(3);
            for (int bl = 0; bl < blobCount; bl++)
            {
                int cx = rng.NextInt(n);
                int cy = rng.NextInt(n);
                int rad = 2 + rng.NextInt(3);
                for (int y = Math.Max(0, cy - rad * 2); y <= Math.Min(n - 1, cy + rad * 2); y++)
                {
                    for (int x = Math.Max(0, cx - rad * 2); x <= Math.Min(n - 1, cx + rad * 2); x++)
                    {
                        int dx = x - cx, dy = y - cy;
                        int d = (int)Math.Floor(Math.Sqrt(dx * dx + dy * dy));
                        int v = Math.Max(0, 255 - d * 70);
                        if (v > loss0[y * n + x]) loss0[y * n + x] = (byte)v;
                    }
                }
            }

            var tear0 = new byte[n * n];
            int tearCount = 1 + rng.NextInt(2);
            for (int t = 0; t < tearCount; t++)
            {
                bool vertical = rng.NextInt(2) == 0;
                int pos = 2 + rng.NextInt(n - 4);
                for (int s = 0; s < n; s++)
                {
                    pos = Math.Max(0, Math.Min(n - 1, pos + (rng.NextInt(3) - 1)));
                    int x = vertical ? pos : s;
                    int y = vertical ? s : pos;
                    tear0[y * n + x] = 255;
                }
            }

            bool hasWater = rng.NextInt(10) < 4;
            bool hasOldRestoration = rng.NextInt(10) < 3;

            var findings = new System.Collections.Generic.List<string> { "varnish_darkening" };
            if (Array.Exists(loss0, v => v > 0)) findings.Add("loss");
            if (Array.Exists(tear0, v => v > 0)) findings.Add("tear");
            if (hasWater) findings.Add("water_stain");
            if (hasOldRestoration) findings.Add("old_restoration");

            return new Puzzle
            {
                Seed = seedString,
                EpochName = epoch.Name,
                Title = title,
                Year = year,
                Paint = paint,
                Varnish0 = varnish0,
                Loss0 = loss0,
                Tear0 = tear0,
                HasWater = hasWater,
                HasOldRestoration = hasOldRestoration,
                Findings = findings.ToArray(),
                Par = 26 + blobCount * 4 + tearCount * 6 + 8,
            };
        }
    }
}
