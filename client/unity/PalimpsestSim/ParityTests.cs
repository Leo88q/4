// Palimpsest — parity tests: the C# port must reproduce the JS reference
// vectors in TestVectors.g.cs bit-for-bit. Run with Unity Test Framework (NUnit)
// or `dotnet test` in a plain NUnit project that includes PalimpsestSim/*.cs.
using System.Collections.Generic;
using NUnit.Framework;

namespace Palimpsest.Sim
{
    public class ParityTests
    {
        [Test]
        public void RngMatchesReference()
        {
            var rng = new Rng(TestVectors.Seed);
            for (int i = 0; i < TestVectors.Rng8.Length; i++)
                Assert.AreEqual(TestVectors.Rng8[i], rng.NextU32(), $"u32 #{i}");
        }

        [Test]
        public void PuzzleMatchesReference()
        {
            var p = PuzzleGenerator.Generate(TestVectors.Seed);
            Assert.AreEqual(TestVectors.Epoch, p.EpochName);
            Assert.AreEqual(TestVectors.Title, p.Title);
            Assert.AreEqual(TestVectors.Year, p.Year);
            Assert.AreEqual(TestVectors.Par, p.Par);
            CollectionAssert.AreEqual(TestVectors.Findings, p.Findings);
            Assert.AreEqual(TestVectors.PaintRoll, Roll(p.Paint));
            Assert.AreEqual(TestVectors.Varnish0Roll, Roll(p.Varnish0));
            Assert.AreEqual(TestVectors.Loss0Roll, Roll(p.Loss0));
            Assert.AreEqual(TestVectors.Tear0Roll, Roll(p.Tear0));
        }

        [Test]
        public void SimulateMatchesReference()
        {
            var actions = BuildVectorLog();
            var result = Simulator.Simulate(TestVectors.Seed, actions);
            Assert.IsTrue(result.Ok, result.Reason);
            Assert.AreEqual(TestVectors.ExpectedTotal, result.Score.Total);
            Assert.AreEqual(TestVectors.ExpectedAccuracy, result.Score.Accuracy);
            Assert.AreEqual(TestVectors.ExpectedIntegrity, result.Score.Integrity);
            Assert.AreEqual(TestVectors.ExpectedRationality, result.Score.Rationality);
            Assert.AreEqual(TestVectors.ExpectedDiscoveries, result.Score.Discoveries);
            Assert.AreEqual(TestVectors.ExpectedStateHash, result.StateHash);
            Assert.AreEqual(TestVectors.ExpectedStateBytesLen, result.Puzzle != null
                ? ActionRules.Replay(result.Puzzle, actions).StateBytes().Length
                : -1);
        }

        /// <summary>The exact log from scripts/gen-vectors.js.</summary>
        private static List<RestorationAction> BuildVectorLog()
        {
            long t = TestVectors.ActionT0;
            var log = new List<RestorationAction>();

            var diagnose = new RestorationAction("diagnose", t) { Findings = TestVectors.Findings };
            log.Add(diagnose); t += 200;

            log.Add(new RestorationAction("solvent", t) { X = 0.5, Y = 0.5, R = 0.3, Strength = 0.55 }); t += 200;
            log.Add(new RestorationAction("wipe", t) { X = 0.5, Y = 0.5, R = 0.3 }); t += 200;
            log.Add(new RestorationAction("varnish", t) { Kind = 0, Thickness = 0.4 }); t += 200;
            log.Add(new RestorationAction("finish", t));
            return log;
        }

        private static uint Roll(byte[] bytes)
        {
            uint h = 0;
            foreach (byte b in bytes) h = unchecked(h * 31 + b);
            return h;
        }
    }
}
