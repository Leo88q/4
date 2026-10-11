#!/usr/bin/env bash
# Fetches the upstream google/restory sources at a pinned commit.
#
# License compliance (Apache License 2.0):
#   * upstream sources are fetched, never re-licensed;
#   * upstream LICENSE.txt travels with the sources (cloned repo);
#   * attribution: see NOTICE and README.md in the repository root;
#   * Google trademarks are not used in product naming or marketing.
set -euo pipefail

PIN="67b94f143ecbe925cea111644b69c3167ce74964"
REPO_URL="https://github.com/google/restory"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${ROOT_DIR}/third_party/restory"

if [ -d "${TARGET_DIR}/.git" ]; then
  CURRENT="$(git -C "${TARGET_DIR}" rev-parse HEAD)"
  if [ "${CURRENT}" = "${PIN}" ]; then
    echo "upstream already fetched at ${PIN}"
  else
    echo "upstream present at ${CURRENT}, checking out pinned ${PIN}"
    git -C "${TARGET_DIR}" fetch --depth 1 origin "${PIN}"
    git -C "${TARGET_DIR}" checkout --detach "${PIN}"
  fi
else
  mkdir -p "${TARGET_DIR}"
  git -C "${TARGET_DIR}" init --quiet
  git -C "${TARGET_DIR}" remote add origin "${REPO_URL}"
  git -C "${TARGET_DIR}" fetch --depth 1 origin "${PIN}"
  git -C "${TARGET_DIR}" checkout --detach --quiet FETCH_HEAD
fi

test -f "${TARGET_DIR}/LICENSE.txt" || { echo "ERROR: upstream LICENSE.txt missing" >&2; exit 1; }

cat <<EOF
Upstream Restory fetched:
  path:    ${TARGET_DIR}
  commit:  $(git -C "${TARGET_DIR}" rev-parse HEAD)
  license: $(head -n 1 "${TARGET_DIR}/LICENSE.txt")

Attribution checklist (Apache 2.0):
  [x] LICENSE.txt retained with the sources
  [x] NOTICE at the repository root credits Google LLC and the Restory authors
  [ ] Any distributed build must keep NOTICE + "About" screen attribution
  [ ] Never name or market the product as "Google ..." or "... by Google"
EOF
