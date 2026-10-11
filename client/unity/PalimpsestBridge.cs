// Palimpsest — Unity bridge to the Palimpsest API (CONCEPT.md §9).
// Drop into Assets/Scripts/Palimpsest/ of the Restory fork (see INTEGRATION.md).
// License: Apache-2.0. Requires Unity 2021+ (UnityWebRequest + JsonUtility).
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;
using Palimpsest.Sim;

namespace Palimpsest.Client
{
    /// <summary>
    /// Sessions, action streaming and the «Акт реставрации» handshake.
    /// The device is never trusted: the server re-simulates from the seed.
    /// </summary>
    public sealed class PalimpsestBridge : MonoBehaviour
    {
        [Header("API")]
        public string apiBase = "http://localhost:8787";

        [Header("Session")]
        public string playerName = "Мастер";

        public string PlayerId { get; private set; }
        public string PlayerAddress { get; private set; }
        public string SessionId { get; private set; }
        public string Seed { get; private set; }

        private readonly List<RestorationAction> _localLog = new();
        private readonly List<RestorationAction> _pending = new();

        // ---------- DTOs (JsonUtility) ----------
        [Serializable] private class PlayerIn { public string name; }
        [Serializable] private class PlayerOut { public bool ok; public Player player; }
        [Serializable] private class Player { public string id; public string address; public string name; }
        [Serializable] private class SessionIn { public string playerId; public string kind; }
        [Serializable] private class SessionOut { public bool ok; public string sessionId; public string seed; public string reason; }
        [Serializable] private class ActionsIn { public List<ActionDto> actions = new(); }
        [Serializable] private class FinishOut { public bool ok; public string reason; public Artifact artifact; }
        [Serializable] public class Artifact { public string id; public string actionsMerkle; public Score score; public string stateHash; public bool stateHashMatch; }
        [Serializable] public class Score { public int total; public Components components; }
        [Serializable] public class Components { public int accuracy; public int integrity; public int rationality; public int discoveries; }
        [Serializable] public class ActionDto
        {
            public string type;
            public long t;
            public float x, y, r, w, h, strength, thickness;
            public int material, kind;
            public List<float> color = new();
            public List<string> findings = new();
        }

        private void Awake() { SimBootstrap.Ensure(); }

        public IEnumerator CreatePlayer(Action<bool> done = null)
        {
            var body = JsonUtility.ToJson(new PlayerIn { name = playerName });
            yield return Post("/api/player", body, (text) =>
            {
                var outp = JsonUtility.FromJson<PlayerOut>(text);
                if (outp != null && outp.ok)
                {
                    PlayerId = outp.player.id;
                    PlayerAddress = outp.player.address;
                }
                done?.Invoke(outp is { ok: true });
            });
        }

        public IEnumerator StartDaily(Action<bool> done = null)
        {
            if (string.IsNullOrEmpty(PlayerId)) yield return CreatePlayer();
            var body = JsonUtility.ToJson(new SessionIn { playerId = PlayerId, kind = "daily" });
            yield return Post("/api/session", body, (text) =>
            {
                var outp = JsonUtility.FromJson<SessionOut>(text);
                if (outp != null && outp.ok)
                {
                    SessionId = outp.sessionId;
                    Seed = outp.seed;
                    _localLog.Clear();
                    _pending.Clear();
                }
                done?.Invoke(outp is { ok: true });
            });
        }

        /// <summary>Record an action locally and queue it for streaming.</summary>
        public void Push(RestorationAction a)
        {
            _localLog.Add(a);
            _pending.Add(a);
        }

        /// <summary>Flush queued actions to the server (call every few seconds).</summary>
        public IEnumerator FlushPending()
        {
            if (_pending.Count == 0 || string.IsNullOrEmpty(SessionId)) yield break;
            var batch = new List<ActionDto>(_pending.ConvertAll(ToDto));
            _pending.Clear();
            var body = JsonUtility.ToJson(new ActionsIn { actions = batch });
            yield return Post($"/api/session/{SessionId}/actions", body, _ => { });
        }

        /// <summary>«Акт реставрации» — server re-simulates and mints the record.</summary>
        public IEnumerator Finish(Action<FinishOut> done)
        {
            if (string.IsNullOrEmpty(SessionId)) yield break;
            yield return FlushPending();

            // Client-side prediction for UX only — the server is authoritative.
            var predicted = Simulator.Simulate(Seed, _localLog, requireFinish: false);
            var finish = new RestorationAction("finish", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            _localLog.Add(finish);
            var payload = new ActionsIn { actions = new List<ActionDto> { ToDto(finish) } };
            // state hash includes the finish flag; recompute after adding it
            predicted = Simulator.Simulate(Seed, _localLog);
            var body = JsonUtility.ToJson(new FinishRequest
            {
                actions = payload.actions,
                clientStateHash = predicted.Ok ? predicted.StateHash : null,
            });
            yield return Post($"/api/session/{SessionId}/finish", body, (text) =>
            {
                var outp = JsonUtility.FromJson<FinishOut>(text);
                done?.Invoke(outp);
            });
        }

        [Serializable] private class FinishRequest { public List<ActionDto> actions = new(); public string clientStateHash; }

        private static ActionDto ToDto(RestorationAction a)
        {
            var dto = new ActionDto
            {
                type = a.Type,
                t = a.T,
                x = (float)a.X, y = (float)a.Y, r = (float)a.R,
                w = (float)a.W, h = (float)a.H,
                strength = (float)a.Strength, thickness = (float)a.Thickness,
                material = a.Material, kind = a.Kind,
            };
            if (a.Color != null) foreach (var c in a.Color) dto.color.Add((float)c);
            if (a.Findings != null) dto.findings.AddRange(a.Findings);
            return dto;
        }

        private IEnumerator Post(string path, string body, Action<string> onText)
        {
            using var req = new UnityWebRequest(apiBase + path, "POST");
            var raw = System.Text.Encoding.UTF8.GetBytes(body);
            req.uploadHandler = new UploadHandlerRaw(raw);
            req.downloadHandler = new DownloadHandlerBuffer();
            req.SetRequestHeader("Content-Type", "application/json");
            yield return req.SendWebRequest();
            if (req.result == UnityWebRequest.Result.Success)
                onText?.Invoke(req.downloadHandler.text);
            else
                Debug.LogWarning($"[Palimpsest] {path} -> {req.responseCode} {req.error}");
        }
    }

    /// <summary>Placeholder to keep the sim assembly referenced in scenes.</summary>
    public static class SimBootstrap { public static void Ensure() { _ = new Rng("palimpsest:boot"); } }
}
