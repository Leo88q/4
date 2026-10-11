#!/usr/bin/env bash
# Builds the Palimpsest Unity fork from upstream Restory:
#   1) fetches upstream at the pinned commit (scripts/fetch-upstream.sh);
#   2) copies the Palimpsest drop-in modules into Assets/Scripts/Palimpsest/;
#   3) patches declareFinishController.declareFinish() to call the hook and
#      marks the file as modified (Apache License 2.0 §4(b));
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
cp "${ROOT_DIR}/client/unity/PalimpsestAbout.cs" "${DEST}/"
cp "${ROOT_DIR}/client/unity/test-vectors.json" "${DEST}/"
cp "${ROOT_DIR}/NOTICE" "${FORK}/PALIMPSEST_NOTICE.txt"

# ---- patch declareFinishController (modification notice + hook call) ----
python3 - "${ASSETS}/Mechanic_DeclareFinish/declareFInishController.cs" <<'PY'
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8", newline="") as f:
    src = f.read()

notice = (
    "// Modified by The Palimpsest Authors (Apache License 2.0, section 4(b)):\r\n"
    "//  - declareFinish() now notifies PalimpsestGameHook (server-authoritative act)\r\n"
)
if "Modified by The Palimpsest Authors" not in src:
    # insert the modification notice right after the upstream license block
    marker = "using System.Collections;\r\n"
    src = src.replace(marker, notice + marker, 1)

hook_line = "        PalimpsestGameHook.NotifyFinish(); // Palimpsest: Акт реставрации -> сервер\r\n"
if "PalimpsestGameHook.NotifyFinish" not in src:
    anchor = "    public void declareFinish()\r\n    {\r\n"
    if anchor not in src:
        anchor = anchor.replace("\r\n", "\n")
        hook_line = hook_line.replace("\r\n", "\n")
    if anchor not in src:
        sys.exit("ERROR: declareFinish() anchor not found — upstream changed")
    src = src.replace(anchor, anchor + hook_line, 1)

with open(path, "w", encoding="utf-8", newline="") as f:
    f.write(src)
print("patched:", path)
PY

cat > "${DEST}/MODIFICATIONS.md" <<'EOF'
# Изменения форка (Apache License 2.0, §4(b))

Файл `Assets/Scripts/Mechanic_DeclareFinish/declareFInishController.cs` изменён
авторами «Палимпсеста» (см. заголовок «Modified by The Palimpsest Authors» в
файле): в `declareFinish()` добавлен вызов `PalimpsestGameHook.NotifyFinish()`,
передающий Акт реставрации на сервер.

Остальное в `Assets/Scripts/Palimpsest/` — новые файлы, не модифицирующие
upstream-код. Копия уведомления об атрибуции: `PALIMPSEST_NOTICE.txt` в корне
проекта. Лицензия upstream: `LICENSE.txt`.
EOF

echo "integrated: ${DEST}"
grep -n "PalimpsestGameHook.NotifyFinish" "${ASSETS}/Mechanic_DeclareFinish/declareFInishController.cs"
