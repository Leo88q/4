// Palimpsest — telemetry recorder: projects real Restory mechanics onto the
// canonical action vocabulary of Restory.Sim (packages/sim/src/actions.js).
// NEW FILE — added by The Palimpsest Authors, not part of upstream Restory.
// License: Apache-2.0 (see repository NOTICE).
//
// Integration model (see INTEGRATION.md, «Проекция телеметрии»):
//   real mechanic event -> canonical action -> session log -> server
//   re-simulates the canonical puzzle and is authoritative for the score.
//
// One-liners from patched Mechanic_* files call into this class; it handles
// coordinate normalization (camera viewport -> [0,1]) and rate throttling
// (MIN_ACTION_GAP_MS = 60 ms, same rule the server enforces).
using System;
using UnityEngine;
using Palimpsest.Sim;
using Palimpsest.Client;

public static class PalimpsestTelemetry
{
    public const float DefaultRadius = 0.09f;

    /// <summary>Last color chosen in the ColorPicker (fallback: earth pigment).</summary>
    public static Color CurrentColor = new Color32(122, 92, 70, 255);

    private static long _lastT;

    private static long NextTimestamp()
    {
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (now - _lastT < ActionRules.MinActionGapMs) now = _lastT + ActionRules.MinActionGapMs;
        _lastT = now;
        return now;
    }

    /// <summary>World position -> normalized [0,1] painting coordinates.</summary>
    public static void Normalize(Vector3 worldPos, out float x, out float y)
    {
        Camera cam = Camera.main;
        if (cam == null) { x = 0.5f; y = 0.5f; return; }
        Vector3 vp = cam.WorldToViewportPoint(worldPos);
        x = Mathf.Clamp01(vp.x);
        y = Mathf.Clamp01(vp.y);
    }

    private static void Push(RestorationAction action)
    {
        if (PalimpsestGameHook.Instance != null) PalimpsestGameHook.Instance.Push(action);
    }

    /// <summary>Varnish removal stroke (Mechanic_VarnishRemoval/Brush).</summary>
    public static void RecordSolventStroke(Vector3 worldPos, float strength = 0.55f)
    {
        Normalize(worldPos, out float x, out float y);
        Push(new RestorationAction("solvent", NextTimestamp())
        {
            X = x, Y = y, R = DefaultRadius, Strength = strength,
        });
    }

    /// <summary>Wipe stroke — same gesture, softer phase (projected from Brush).</summary>
    public static void RecordWipeStroke(Vector3 worldPos)
    {
        Normalize(worldPos, out float x, out float y);
        Push(new RestorationAction("wipe", NextTimestamp()) { X = x, Y = y, R = DefaultRadius });
    }

    /// <summary>Color touch-up of a paint loss (Mechanic_Color/PaintDamage fixed).</summary>
    public static void RecordBrush(Vector3 worldPos, Color color)
    {
        Normalize(worldPos, out float x, out float y);
        Push(new RestorationAction("brush", NextTimestamp())
        {
            X = x, Y = y, R = 0.05f,
            Color = new[] { (double)Mathf.Round(color.r * 255f), (double)Mathf.Round(color.g * 255f), (double)Mathf.Round(color.b * 255f) },
        });
    }

    /// <summary>Patch placed (Mechanic_Patching) or stitch sewn (Mechanic_Locking).</summary>
    public static void RecordPatch(Vector3 worldPos, float w = 0.08f, float h = 0.08f, int material = 1)
    {
        Normalize(worldPos, out float x, out float y);
        Push(new RestorationAction("patch", NextTimestamp())
        {
            X = Mathf.Clamp01(x - w / 2f), Y = Mathf.Clamp01(y - h / 2f),
            W = w, H = h, Material = material,
        });
    }

    /// <summary>New varnish layer (Mechanic_VarnishApplication).</summary>
    public static void RecordVarnish(int kind = 0, float thickness = 0.4f)
    {
        Push(new RestorationAction("varnish", NextTimestamp()) { Kind = kind, Thickness = thickness });
    }

    /// <summary>Diagnosis fixed before the first intervention (Mechanic_Container).</summary>
    public static void RecordDiagnose(string[] findings)
    {
        Push(new RestorationAction("diagnose", NextTimestamp()) { Findings = findings ?? Array.Empty<string>() });
    }
}
