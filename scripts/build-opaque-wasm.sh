#!/usr/bin/env bash
# ============================================================
# build-opaque-wasm.sh
# Builds the OPAQUE client WASM module and commits artifacts
# to ui/scripts/opaque-client/.
#
# Run manually only when opaque-client-wasm/src/ changes.
# CI does NOT rebuild — committed artifacts are used directly.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
WASM_CRATE="$ROOT_DIR/opaque-client-wasm"
OUT_DIR="$ROOT_DIR/ui/scripts/opaque-client"

echo "[opaque-wasm] Checking wasm-pack..."
if ! command -v wasm-pack &>/dev/null; then
  echo "[opaque-wasm] wasm-pack not found. Installing..."
  cargo install wasm-pack
fi

echo "[opaque-wasm] Building (release)..."
cd "$WASM_CRATE"
wasm-pack build \
  --target web \
  --release \
  --out-dir "$OUT_DIR" \
  --no-pack

echo "[opaque-wasm] Cleaning wasm-pack metadata..."
# Remove files that should not be committed or are not needed at runtime.
rm -f "$OUT_DIR/.gitignore"
rm -f "$OUT_DIR/package.json"
rm -f "$OUT_DIR/README.md"

echo "[opaque-wasm] Done. Artifacts written to ui/scripts/opaque-client/"
echo "[opaque-wasm] Commit the following files:"
ls -lh "$OUT_DIR"
