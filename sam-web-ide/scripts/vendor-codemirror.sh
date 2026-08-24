#!/usr/bin/env bash
set -euo pipefail
VERSION="5.65.16"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/codemirror"
BASE="https://cdn.jsdelivr.net/npm/codemirror@${VERSION}"
mkdir -p "$DEST/addon/selection" "$DEST/addon/edit"
curl -fsSL "$BASE/lib/codemirror.js" -o "$DEST/codemirror.js"
curl -fsSL "$BASE/lib/codemirror.css" -o "$DEST/codemirror.css"
curl -fsSL "$BASE/addon/selection/active-line.js" -o "$DEST/addon/selection/active-line.js"
curl -fsSL "$BASE/addon/edit/matchbrackets.js" -o "$DEST/addon/edit/matchbrackets.js"
curl -fsSL "$BASE/addon/edit/closebrackets.js" -o "$DEST/addon/edit/closebrackets.js"
curl -fsSL "$BASE/LICENSE" -o "$DEST/LICENSE"
echo "Vendored CodeMirror $VERSION under vendor/codemirror/."
