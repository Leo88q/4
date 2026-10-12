// Palimpsest — canonical puzzle playfield for the Restory fork (v2).
// Renders the EXACT puzzle the server generated from the seed (Palimpsest.Sim),
// so the client can no longer show a different picture than the one being
// scored. Drop into any Unity scene: PalimpsestPuzzleView.Spawn(seed, ...).
// Uses only: UnityEngine + PalimpsestSim/*.cs (no Restory types).
// License: Apache-2.0. Not an officially supported Google product.
using System;
using UnityEngine;

namespace Palimpsest.Unity
{
    /// <summary>
    /// Канонический пазл из сида: генерация → композит → Texture2D → действия
    /// через Simulator. Каждое действие дублируется в PalimpsestTelemetry
    /// (проекция Mechanic_*), счёт остаётся серверным (CONCEPT.md §8).
    /// </summary>
    public sealed class PalimpsestPuzzleView : MonoBehaviour
    {
        public const int Upscale = 16; // 32×32 → 512×512 point-filtered

        public string Seed { get; private set; }
        public Sim.Puzzle Puzzle { get; private set; }
        public Sim.RestorationState State { get; private set; }

        private Texture2D _texture;
        private Renderer _quad;

        /// <summary>Spawn the canonical playfield for a seed (daily/private/tournament).</summary>
        public static PalimpsestPuzzleView Spawn(string seed, Transform parent = null)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
            go.name = $"Palimpsest Puzzle [{seed}]";
            if (parent != null) go.transform.SetParent(parent, false);
            var view = go.AddComponent<PalimpsestPuzzleView>();
            view.Load(seed);
            return view;
        }

        /// <summary>(Re)generate the puzzle from the seed and paint the first frame.</summary>
        public void Load(string seed)
        {
            Seed = seed;
            Puzzle = Sim.PuzzleGenerator.Generate(seed);
            State = Sim.RestorationState.Create(Puzzle);
            _texture = new Texture2D(Sim.Puzzle.Grid * Upscale, Sim.Puzzle.Grid * Upscale, TextureFormat.RGBA32, false)
            {
                filterMode = FilterMode.Point,
                wrapMode = TextureWrapMode.Clamp,
            };
            _quad = GetComponent<Renderer>();
            if (_quad != null)
            {
                // простейший материал; в форке его можно заменить шейдером Restory
                var shader = Shader.Find("Unlit/Texture") ?? Shader.Find("Sprites/Default");
                _quad.material = new Material(shader) { mainTexture = _texture };
            }
            RepaintFrame();
        }

        /// <summary>
        /// Apply one canonical action (solvent/wipe/varnish/patch/finish…).
        /// Returns false when the simulator rejects the move (rules live there).
        /// finish передаётся в Bridge ровно один раз — через
        /// PalimpsestGameHook.NotifyFinish (см. кнопку «завершить»).
        /// </summary>
        public bool ApplyAction(Sim.RestorationAction action, bool forwardToHook = true)
        {
            try
            {
                Sim.ActionRules.Apply(State, Puzzle, action);
            }
            catch (Exception)
            {
                return false;
            }
            RepaintFrame();
            if (forwardToHook) ForwardToHook(action);
            return true;
        }

        /// <summary>Current canonical frame (N*N*4 RGBA) — same bytes as the web demo.</summary>
        public byte[] FrameBytes()
        {
            return Sim.PuzzleRenderer.RenderStateRgba(Puzzle, State);
        }

        /// <summary>Server-parity snapshot of the working state (stateHash feed).</summary>
        public byte[] StateBytes()
        {
            return State.StateBytes();
        }

        // ---- rendering ----

        private void RepaintFrame()
        {
            if (_texture == null) return;
            byte[] rgba = FrameBytes();
            int n = Sim.Puzzle.Grid;
            var expanded = new Color32[n * Upscale * n * Upscale];
            for (int y = 0; y < n; y++)
            {
                for (int x = 0; x < n; x++)
                {
                    int i = y * n + x;
                    var c = new Color32(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], 255);
                    for (int dy = 0; dy < Upscale; dy++)
                    {
                        int row = (y * Upscale + dy) * n * Upscale;
                        for (int dx = 0; dx < Upscale; dx++) expanded[row + x * Upscale + dx] = c;
                    }
                }
            }
            _texture.SetPixels32(expanded);
            _texture.Apply(false);
        }

        // ---- единый конвейер действий: GameHook.Push → Bridge (INTEGRATION.md) ----
        // v2: пазл — источник канонических действий; проекция Mechanic_*
        // (PalimpsestTelemetry) нужна только для нативной механики (v1) и здесь
        // не используется, чтобы лог не задваивался.

        private void ForwardToHook(Sim.RestorationAction a)
        {
            if (PalimpsestGameHook.Instance != null) PalimpsestGameHook.Instance.Push(a);
        }

        // ---- minimal in-game tools (OnGUI debug panel; fork may replace) ----

        private void OnGUI()
        {
            if (Puzzle == null) return;
            GUILayout.BeginArea(new Rect(10, 10, 320, 220), GUI.skin.box);
            GUILayout.Label($"«{Puzzle.Title}» — {Puzzle.EpochName}, {Puzzle.Year}");
            GUILayout.Label($"эталон ходов: {Puzzle.Par} · сид {Seed}");
            GUILayout.Label(State.Finished ? "реставрация завершена" : "инструменты: клик по холсту");
            if (!State.Finished)
            {
                if (GUILayout.Button("диагноз")) ApplyAction(new Sim.RestorationAction("diagnose", NowMs()) { Findings = Puzzle.Findings });
                if (GUILayout.Button("лак (финиш)")) ApplyAction(new Sim.RestorationAction("varnish", NowMs()) { Kind = 0, Thickness = 0.4 });
                if (GUILayout.Button("завершить"))
                {
                    // локально закрываем состояние; finish уходит в Bridge один раз
                    ApplyAction(new Sim.RestorationAction("finish", NowMs()), forwardToHook: false);
                    PalimpsestGameHook.NotifyFinish();
                }
            }
            GUILayout.EndArea();
        }

        private void Update()
        {
            if (State == null || State.Finished) return;
            if (!Input.GetMouseButton(0)) return;
            var cam = Camera.main;
            if (cam == null) return;
            var ray = cam.ScreenPointToRay(Input.mousePosition);
            // пазл лежит в плоскости Z=0 канваса — точка пересечения → нормализованные [0,1]
            if (Math.Abs(ray.direction.z) < 1e-6) return;
            float t = -ray.origin.z / ray.direction.z;
            if (t < 0) return;
            Vector3 hit = ray.origin + ray.direction * t;
            Bounds b = _quad != null ? _quad.bounds : new Bounds(transform.position, Vector3.one);
            float nx = Mathf.InverseLerp(b.min.x, b.max.x, hit.x);
            float ny = Mathf.InverseLerp(b.min.y, b.max.y, hit.y);
            if (Input.GetKeyDown(KeyCode.LeftShift))
                ApplyAction(new Sim.RestorationAction("wipe", NowMs()) { X = nx, Y = ny, R = 0.15 });
            else
                ApplyAction(new Sim.RestorationAction("solvent", NowMs()) { X = nx, Y = ny, R = 0.15, Strength = 0.5 });
        }

        private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }
}
