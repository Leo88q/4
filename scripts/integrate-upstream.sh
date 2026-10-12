#!/usr/bin/env bash
# Builds the Palimpsest Unity fork from upstream Restory:
#   1) fetches upstream at the pinned commit (scripts/fetch-upstream.sh);
#   2) copies the Palimpsest drop-in modules into Assets/Scripts/Palimpsest/;
#   3) patches upstream mechanics with telemetry/act hooks, each modified file
#      carrying a "Modified by The Palimpsest Authors" notice (Apache 2.0 §4(b));
#   4) writes MODIFICATIONS.md + attribution NOTICE inside the fork.
#
# Idempotent: safe to run repeatedly. The fork lives in third_party/restory
# (git-ignored); releases must ship with LICENSE.txt + the attribution block.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORK="${ROOT_DIR}/third_party/restory"
ASSETS="${FORK}/Assets/Scripts"
DEST="${ASSETS}/Palimpsest"

bash "${ROOT_DIR}/scripts/fetch-upstream.sh" >/dev/null

mkdir -p "${DEST}"
cp "${ROOT_DIR}/client/unity/PalimpsestSim/"*.cs "${DEST}/"
cp "${ROOT_DIR}/client/unity/PalimpsestBridge.cs" "${DEST}/"
cp "${ROOT_DIR}/client/unity/PalimpsestGameHook.cs" "${DEST}/"
cp "${ROOT_DIR}/client/unity/PalimpsestTelemetry.cs" "${DEST}/"
cp "${ROOT_DIR}/client/unity/PalimpsestAbout.cs" "${DEST}/"
cp "${ROOT_DIR}/client/unity/test-vectors.json" "${DEST}/"
cp "${ROOT_DIR}/NOTICE" "${FORK}/PALIMPSEST_NOTICE.txt"

python3 - "${ASSETS}" <<'PY'
import sys, os

assets = sys.argv[1]

NOTICE = (
    "// Modified by The Palimpsest Authors (Apache License 2.0, section 4(b)):\r\n"
    "//  - {what}\r\n"
)

# Each patch: (relative path, what changed, unique marker, old snippet, new snippet).
# Snippets use \n; the patcher adapts to the file's line endings. A patch is
# skipped when its marker is already present (idempotency).
PATCHES = [
    (
        "Mechanic_DeclareFinish/declareFInishController.cs",
        "declareFinish() notifies PalimpsestGameHook (server-authoritative act)",
        "PalimpsestGameHook.NotifyFinish",
        "    public void declareFinish()\n    {\n",
        "    public void declareFinish()\n    {\n        PalimpsestGameHook.NotifyFinish(); // Palimpsest: Акт реставрации -> сервер\n",
    ),
    (
        "Mechanic_VarnishRemoval/Brush.cs",
        "Update() reports varnish-removal / varnish-apply strokes to PalimpsestTelemetry",
        "RecordSolventStroke",
        "                spriteRenderer.enabled = Input.GetMouseButton(0);",
        "                spriteRenderer.enabled = Input.GetMouseButton(0);\n"
        "                if (Input.GetMouseButton(0)) // Palimpsest:телеметрия мазка\n"
        "                {\n"
        "                    if (isVarnishRemove) PalimpsestTelemetry.RecordSolventStroke(transform.position);\n"
        "                    else if (isVarnishApply) PalimpsestTelemetry.RecordVarnish();\n"
        "                }",
    ),
    (
        "Mechanic_Color/PaintDamage.cs",
        "IsFixed reports a restored paint loss (brush action) to PalimpsestTelemetry",
        "PalimpsestTelemetry.RecordBrush",
        "            if (isFixed)\n                gameObject.SetActive(false);",
        "            if (isFixed)\n            {\n"
        "                gameObject.SetActive(false);\n"
        "                PalimpsestTelemetry.RecordBrush(transform.position, PalimpsestTelemetry.CurrentColor); // Palimpsest\n"
        "            }",
    ),
    (
        "Mechanic_Patching/PatchingMechanic.cs",
        "PlacePatch() reports the placed patch to PalimpsestTelemetry",
        "PalimpsestTelemetry.RecordPatch(touchPos",
        "        patchingTotalScore += UpdatePatchScore();",
        "        PalimpsestTelemetry.RecordPatch(touchPos, 0.08f, 0.08f, 1); // Palimpsest: заплатка\n"
        "        patchingTotalScore += UpdatePatchScore();",
    ),
    (
        "Mechanic_Locking/StitchingMechanic.cs",
        "CreateStitch() reports the stitch to PalimpsestTelemetry",
        "PalimpsestTelemetry.RecordPatch(hit.point",
        "            worldAnchor = hit.point;",
        "            worldAnchor = hit.point;\n"
        "            PalimpsestTelemetry.RecordPatch(hit.point, 0.06f, 0.06f, 2); // Palimpsest: шов",
    ),
]

def patch(path, what, marker, old, new):
    with open(path, "r", encoding="utf-8", newline="") as f:
        src = f.read()
    if marker in src:
        print(f"already patched: {path}")
        return
    crlf = "\r\n" in src
    o = old.replace("\n", "\r\n") if crlf else old
    n = new.replace("\n", "\r\n") if crlf else new
    if o not in src:
        sys.exit(f"ERROR: anchor not found in {path}: {old[:60]!r}")
    src = src.replace(o, n, 1)
    notice = NOTICE.format(what=what)
    if not crlf:
        notice = notice.replace("\r\n", "\n")
    anchor = "using System.Collections;"
    if anchor in src:
        src = src.replace(anchor, notice + anchor, 1)
    else:
        src = notice + src
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(src)
    print(f"patched: {path}")

for rel, what, marker, old, new in PATCHES:
    patch(os.path.join(assets, rel), what, marker, old, new)
PY

cat > "${DEST}/MODIFICATIONS.md" <<'EOF'
# Изменения форка (Apache License 2.0, §4(b))

Файлы ниже изменены авторами «Палимпсеста»; в каждом есть заголовок
«Modified by The Palimpsest Authors» с описанием изменения:

| Файл | Изменение |
|---|---|
| `Mechanic_DeclareFinish/declareFInishController.cs` | `declareFinish()` вызывает `PalimpsestGameHook.NotifyFinish()` |
| `Mechanic_VarnishRemoval/Brush.cs` | мазки растворителем/лаком → телеметрия |
| `Mechanic_Color/PaintDamage.cs` | восстановление утраты краски → телеметрия |
| `Mechanic_Patching/PatchingMechanic.cs` | установка заплатки → телеметрия |
| `Mechanic_Locking/StitchingMechanic.cs` | шов → телеметрия |

Остальное в `Assets/Scripts/Palimpsest/` — новые файлы (симуляция, мост, хук,
телеметрия). Модель проекции телеметрии — в `PalimpsestTelemetry.cs` и
`client/unity/INTEGRATION.md`. Копия уведомления об атрибуции:
`PALIMPSEST_NOTICE.txt` в корне проекта. Лицензия upstream: `LICENSE.txt`.
EOF

echo "integrated: ${DEST}"
grep -rn "PalimpsestTelemetry\.\|PalimpsestGameHook.NotifyFinish" \
  "${ASSETS}/Mechanic_DeclareFinish/declareFInishController.cs" \
  "${ASSETS}/Mechanic_VarnishRemoval/Brush.cs" \
  "${ASSETS}/Mechanic_Color/PaintDamage.cs" \
  "${ASSETS}/Mechanic_Patching/PatchingMechanic.cs" \
  "${ASSETS}/Mechanic_Locking/StitchingMechanic.cs" | sed 's/.*Scripts\///'
