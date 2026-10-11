// Palimpsest — Restory.Sim v1 (C# port of packages/sim/src/state.js).
using System;

namespace Palimpsest.Sim
{
    public sealed class RestorationState
    {
        public readonly int N = Puzzle.Grid;
        public byte[] Varnish;
        public byte[] Soft;
        public byte[] Loss;
        public byte[] Tear;
        public byte[] Patch;
        public byte[] PatchQuality;
        public byte[] Restored;   // N*N*3
        public byte[] RestoredMask;
        public byte[] Overpaint;
        public int NewVarnish;
        public int NewVarnishKind = -1;
        public bool Finished;
        public System.Collections.Generic.List<RestorationAction> Actions = new();
        public System.Collections.Generic.List<string> Discoveries = new();
        public long? StartedAt;
        public long? FinishedAt;

        public static RestorationState Create(Puzzle puzzle)
        {
            int n = Puzzle.Grid;
            return new RestorationState
            {
                Varnish = (byte[])puzzle.Varnish0.Clone(),
                Soft = new byte[n * n],
                Loss = (byte[])puzzle.Loss0.Clone(),
                Tear = (byte[])puzzle.Tear0.Clone(),
                Patch = new byte[n * n],
                PatchQuality = new byte[n * n],
                Restored = new byte[n * n * 3],
                RestoredMask = new byte[n * n],
                Overpaint = new byte[n * n],
            };
        }

        /// <summary>Quantized snapshot — must match stateBytes() in JS exactly.</summary>
        public byte[] StateBytes()
        {
            int cells = N * N;
            var output = new byte[cells * 8 + 4];
            int o = 0;
            Buffer.BlockCopy(Varnish, 0, output, o, cells); o += cells;
            Buffer.BlockCopy(Loss, 0, output, o, cells); o += cells;
            Buffer.BlockCopy(Tear, 0, output, o, cells); o += cells;
            Buffer.BlockCopy(Patch, 0, output, o, cells); o += cells;
            Buffer.BlockCopy(Restored, 0, output, o, cells * 3); o += cells * 3;
            Buffer.BlockCopy(RestoredMask, 0, output, o, cells); o += cells;
            output[o] = (byte)NewVarnish; o += 1;
            output[o] = (byte)(NewVarnishKind < 0 ? 255 : NewVarnishKind); o += 1;
            output[o] = (byte)(Finished ? 1 : 0); o += 1;
            output[o] = (byte)(Discoveries.Count & 0xff); o += 1;
            return output;
        }
    }
}
