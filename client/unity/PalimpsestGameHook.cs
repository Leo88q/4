// Palimpsest — game hook for the Restory fork (integration slice).
// NEW FILE — added by The Palimpsest Authors, not part of upstream Restory.
// License: Apache-2.0 (see repository NOTICE).
//
// Bridges upstream single-player flow to the Palimpsest platform:
//   * BeginDaily()      — opens a server session for the daily order
//   * NotifyFinish()    — called from declareFinishController.declareFinish()
//                         (patched upstream file, see MODIFICATIONS.md)
//   * OnActCompleted    — UI hook with the server-side Индекс Палимпсеста
//
// Per-mechanic telemetry: each Mechanic_* controller can call
// PalimpsestGameHook.Push(...) with a RestorationAction as its mechanics get
// wired; until then the hook sends the aggregate act (diagnose + finish) and
// the upstream ScoringManager score travels as a rationality hint.
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using Palimpsest.Sim;
using Palimpsest.Client;

public sealed class PalimpsestGameHook : MonoBehaviour
{
    public static PalimpsestGameHook Instance { get; private set; }

    [Header("Palimpsest")]
    public PalimpsestBridge bridge;

    /// <summary>Server-side result of the «Акт реставрации».</summary>
    public static event Action<PalimpsestBridge.Artifact> OnActCompleted;

    private readonly List<RestorationAction> _sessionLog = new();
    private bool _dailyOpen;

    private void Awake()
    {
        if (Instance != null && Instance != this) { Destroy(gameObject); return; }
        Instance = this;
        DontDestroyOnLoad(gameObject);
        if (bridge == null) bridge = gameObject.AddComponent<PalimpsestBridge>();
    }

    /// <summary>Start the daily-order session (call from the menu / level load).</summary>
    public void BeginDaily()
    {
        StartCoroutine(bridge.StartDaily(ok =>
        {
            _dailyOpen = ok;
            _sessionLog.Clear();
            if (ok) Debug.Log($"[Palimpsest] сессия открыта, сид {bridge.Seed}");
        }));
    }

    /// <summary>Per-mechanic telemetry (used by Mechanic_* controllers).</summary>
    public void Push(RestorationAction action)
    {
        _sessionLog.Add(action);
        bridge.Push(action);
    }

    /// <summary>
    /// Called by the patched declareFinishController.declareFinish().
    /// Mirrors the local act to the server, which re-simulates and is
    /// authoritative. Upstream ScoringManager score is sent as a hint only.
    /// </summary>
    public static void NotifyFinish()
    {
        if (Instance == null)
        {
            Debug.LogWarning("[Palimpsest] NotifyFinish без активного хука — пропущено");
            return;
        }
        Instance.StartCoroutine(Instance.FinishAct());
    }

    private IEnumerator FinishAct()
    {
        if (!_dailyOpen)
        {
            // offline / tutorial run: open an ad-hoc private session so the
            // act still lands in the Книга Слоёв
            yield return bridge.StartDaily(ok => _dailyOpen = ok);
        }

        float upstreamScore = ScoringManager.Instance != null ? ScoringManager.Instance.playerScore : 0f;
        int tasksDone = ScoringManager.Instance != null ? ScoringManager.Instance.tasksCompleted : 0;
        int tasksTotal = ScoringManager.Instance != null ? ScoringManager.Instance.totalTask : 0;
        Debug.Log($"[Palimpsest] upstream score={upstreamScore} tasks={tasksDone}/{tasksTotal}");

        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (_sessionLog.Count == 0)
        {
            // fallback for runs without telemetry hooks (integration slice)
            bridge.Push(new RestorationAction("diagnose", now)
            {
                Findings = new[] { "varnish_darkening" },
            });
        }
        bridge.Push(new RestorationAction("finish", now + 120));

        yield return bridge.Finish(result =>
        {
            if (result != null && result.ok)
            {
                Debug.Log($"[Palimpsest] Акт принят: индекс {result.artifact.score.total}, merkle {result.artifact.actionsMerkle}");
                OnActCompleted?.Invoke(result.artifact);
            }
            else
            {
                Debug.LogWarning($"[Palimpsest] Акт отклонён: {result?.reason}");
            }
            _dailyOpen = false;
        });
    }
}
