// Palimpsest — Restory.Sim v1 (C# port of packages/sim/src/actions.js).
// Irreversible action application + structural log validation.
using System;
using System.Collections.Generic;
using System.Linq;

namespace Palimpsest.Sim
{
    public sealed class RestorationAction
    {
        public string Type = "";
        public long T;
        public double X, Y, R, W, H, Strength, Thickness;
        public int Material, Kind;
        public double[] Color = Array.Empty<double>();
        public string[] Findings = Array.Empty<string>();

        public RestorationAction() { }
        public RestorationAction(string type, long t) { Type = type; T = t; }
    }

    public static class ActionRules
    {
        public const int MinActionGapMs = 60;
        public const int MaxActions = 800;

        public static readonly Dictionary<string, string[]> Schema = new()
        {
            ["diagnose"] = new[] { "findings" },
            ["solvent"] = new[] { "x", "y", "r", "strength" },
            ["wipe"] = new[] { "x", "y", "r" },
            ["patch"] = new[] { "x", "y", "w", "h", "material" },
            ["brush"] = new[] { "x", "y", "r", "color" },
            ["varnish"] = new[] { "kind", "thickness" },
            ["finish"] = Array.Empty<string>(),
        };

        public static readonly (string Name, double Quality)[] Materials =
        {
            ("бумага", 0.55), ("лён", 0.85), ("шёлк", 1.0),
        };

        public static readonly (string Name, int Tint)[] VarnishKinds =
        {
            ("мастикс", 24), ("шеллак", 64), ("синтетика", 10),
        };

        /// <summary>null when valid, otherwise a reason string.</summary>
        public static string Validate(IReadOnlyList<RestorationAction> actions, long startedAtFloor = 0)
        {
            if (actions == null || actions.Count == 0) return "empty_log";
            if (actions.Count > MaxActions) return "too_many_actions";
            long prevT = startedAtFloor;
            foreach (var a in actions)
            {
                if (a == null) return "bad_action";
                if (!Schema.ContainsKey(a.Type)) return $"unknown_type:{a.Type}";
                foreach (var k in Schema[a.Type])
                {
                    bool present = k switch
                    {
                        "findings" => a.Findings != null && a.Type == "diagnose",
                        "color" => a.Color != null && a.Color.Length == 3,
                        "material" => true,
                        "kind" => true,
                        _ => true,
                    };
                    if (!present) return $"missing:{a.Type}.{k}";
                }
                if (a.T < prevT) return "time_travel";
                if (prevT != 0 && a.T - prevT < MinActionGapMs) return $"too_fast:{a.Type}";
                prevT = a.T;
                foreach (var v in new[] { a.X, a.Y, a.R, a.W, a.H, a.Strength, a.Thickness })
                {
                    if (double.IsNaN(v) || v < -0.01 || v > 1.5) return "bad_number";
                }
                if (a.Type == "brush")
                {
                    if (a.Color.Length != 3 || a.Color.Any(c => double.IsNaN(c) || c < 0 || c > 255))
                        return "bad_color";
                }
                if (a.Type == "diagnose" && a.Findings.Length > 8) return "bad_findings";
                if (a.Type == "patch" && (a.Material < 0 || a.Material > 2)) return "bad_material";
                if (a.Type == "varnish" && (a.Kind < 0 || a.Kind > 2)) return "bad_kind";
            }
            return null;
        }

        private static int Cell(double v, int n) => Math.Max(0, Math.Min(n - 1, (int)Math.Floor(v * n)));

        public static void Apply(RestorationState s, Puzzle puzzle, RestorationAction a)
        {
            int n = s.N;
            switch (a.Type)
            {
                case "diagnose":
                    s.Discoveries = a.Findings.Distinct().Where(f => !string.IsNullOrEmpty(f)).ToList();
                    break;
                case "solvent":
                {
                    int gx = Cell(a.X, n), gy = Cell(a.Y, n);
                    int rad = Math.Max(1, (int)Math.Floor(a.R * n + 0.5));
                    double strength = Math.Max(0, Math.Min(1, a.Strength));
                    for (int y = Math.Max(0, gy - rad); y <= Math.Min(n - 1, gy + rad); y++)
                    for (int x = Math.Max(0, gx - rad); x <= Math.Min(n - 1, gx + rad); x++)
                    {
                        int dx = x - gx, dy = y - gy;
                        double d = Math.Sqrt(dx * dx + dy * dy);
                        if (d > rad) continue;
                        double fall = 1 - d / (rad + 1);
                        int i = y * n + x;
                        s.Soft[i] = (byte)Math.Min(255, Math.Floor(s.Soft[i] + strength * 255 * fall));
                        if (strength > 0.8)
                            s.Loss[i] = (byte)Math.Min(255, Math.Floor(s.Loss[i] + (strength - 0.8) * 255 * fall * 1.2));
                    }
                    break;
                }
                case "wipe":
                {
                    int gx = Cell(a.X, n), gy = Cell(a.Y, n);
                    int rad = Math.Max(1, (int)Math.Floor(a.R * n + 0.5));
                    for (int y = Math.Max(0, gy - rad); y <= Math.Min(n - 1, gy + rad); y++)
                    for (int x = Math.Max(0, gx - rad); x <= Math.Min(n - 1, gx + rad); x++)
                    {
                        int dx = x - gx, dy = y - gy;
                        double d = Math.Sqrt(dx * dx + dy * dy);
                        if (d > rad) continue;
                        double fall = 1 - d / (rad + 1);
                        int i = y * n + x;
                        int lift = (int)Math.Floor(s.Soft[i] * fall);
                        s.Varnish[i] = (byte)Math.Max(0, s.Varnish[i] - lift);
                        s.Soft[i] = (byte)Math.Max(0, s.Soft[i] - (int)Math.Floor(120 * fall));
                    }
                    break;
                }
                case "patch":
                {
                    int x0 = Cell(a.X, n), y0 = Cell(a.Y, n);
                    int w = Math.Max(1, (int)Math.Floor(a.W * n + 0.5));
                    int h = Math.Max(1, (int)Math.Floor(a.H * n + 0.5));
                    int q = (int)Math.Floor(Materials[a.Material].Quality * 255);
                    for (int y = y0; y <= Math.Min(n - 1, y0 + h); y++)
                    for (int x = x0; x <= Math.Min(n - 1, x0 + w); x++)
                    {
                        int i = y * n + x;
                        s.Patch[i] = 255;
                        if (s.PatchQuality[i] < q) s.PatchQuality[i] = (byte)q;
                        s.Tear[i] = (byte)Math.Max(0, s.Tear[i] - 255);
                    }
                    break;
                }
                case "brush":
                {
                    int gx = Cell(a.X, n), gy = Cell(a.Y, n);
                    int rad = Math.Max(1, (int)Math.Floor(a.R * n + 0.5));
                    byte cr = (byte)Math.Max(0, Math.Min(255, (int)Math.Floor(a.Color[0] + 0.5)));
                    byte cg = (byte)Math.Max(0, Math.Min(255, (int)Math.Floor(a.Color[1] + 0.5)));
                    byte cb = (byte)Math.Max(0, Math.Min(255, (int)Math.Floor(a.Color[2] + 0.5)));
                    for (int y = Math.Max(0, gy - rad); y <= Math.Min(n - 1, gy + rad); y++)
                    for (int x = Math.Max(0, gx - rad); x <= Math.Min(n - 1, gx + rad); x++)
                    {
                        int dx = x - gx, dy = y - gy;
                        double d = Math.Sqrt(dx * dx + dy * dy);
                        if (d > rad) continue;
                        int i = y * n + x;
                        s.Restored[i * 3] = cr;
                        s.Restored[i * 3 + 1] = cg;
                        s.Restored[i * 3 + 2] = cb;
                        s.RestoredMask[i] = 255;
                        if (puzzle.Loss0[i] == 0) s.Overpaint[i] = 255;
                    }
                    break;
                }
                case "varnish":
                    s.NewVarnishKind = a.Kind;
                    s.NewVarnish = (int)Math.Floor(VarnishKinds[a.Kind].Tint + Math.Max(0, Math.Min(1, a.Thickness)) * 120);
                    break;
                case "finish":
                    s.Finished = true;
                    s.FinishedAt = a.T;
                    break;
                default:
                    throw new ArgumentException($"unknown action {a.Type}");
            }
            s.Actions.Add(a);
            if (s.StartedAt == null) s.StartedAt = a.T;
        }

        public static RestorationState Replay(Puzzle puzzle, IReadOnlyList<RestorationAction> actions)
        {
            var state = RestorationState.Create(puzzle);
            foreach (var a in actions) Apply(state, puzzle, a);
            return state;
        }
    }
}
