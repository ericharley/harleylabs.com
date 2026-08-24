#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PORT="${1:-8080}"
echo "Serving SaM Web IDE at http://localhost:${PORT}"
python3 -m http.server "$PORT"
