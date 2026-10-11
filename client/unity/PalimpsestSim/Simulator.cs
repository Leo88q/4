// Palimpsest — Restory.Sim v1 (C# port of packages/sim/src/simulate.js).
using System;
using System.Collections.Generic;
using System.Security.Cryptography;

namespace Palimpsest.Sim
{
    public sealed class SimResult
    {
        public bool Ok;
        public string Reason;
        public string StateHash;
        public ScoreResult Score;
        public bool Finished;
        public Puzzle Puzzle;
    }

    public static class Simulator
    {
        /// <summary>Full deterministic re-simulation — the same verdict the server computes.</summary>
        public static SimResult Simulate(string seedString, IReadOnlyList<RestorationAction> actions, bool requireFinish = true)
        {
            string reason = ActionRules.Validate(actions);
            if (reason != null) return new SimResult { Ok = false, Reason = reason };

            var puzzle = PuzzleGenerator.Generate(seedString);
            var state = RestorationState.Create(puzzle);
            foreach (var a in actions) ActionRules.Apply(state, puzzle, a);

            if (requireFinish && !state.Finished)
                return new SimResult { Ok = false, Reason = "not_finished" };

            return new SimResult
            {
                Ok = true,
                StateHash = Sha256Hex(state.StateBytes()),
                Score = Scoring.Score(puzzle, state),
                Finished = state.Finished,
                Puzzle = puzzle,
            };
        }

        public static string Sha256Hex(byte[] data)
        {
            using var sha = SHA256.Create();
            byte[] d = sha.ComputeHash(data);
            var sb = new System.Text.StringBuilder(d.Length * 2);
            foreach (byte b in d) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }

        public static string Sha256Hex(string utf8) =>
            Sha256Hex(System.Text.Encoding.UTF8.GetBytes(utf8));
    }
}
