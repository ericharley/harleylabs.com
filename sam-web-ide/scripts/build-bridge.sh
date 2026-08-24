#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SAM_JAR="$ROOT/jar/SaM-2.6.3.jar"
SRC="$ROOT/bridge-src/edu/cornell/cs/sam/ui/WebSamGUI.java"
BUILD_DIR="$ROOT/.build/bridge-classes"
OUT_JAR="$ROOT/jar/sam-web-bridge.jar"

for tool in javac jar; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: '$tool' was not found. Install a JDK (Java 8 or newer)." >&2
    exit 1
  fi
done

if [[ ! -f "$SAM_JAR" ]]; then
  echo "error: missing $SAM_JAR" >&2
  echo "Place SaM-2.6.3.jar in the jar/ directory first." >&2
  exit 1
fi

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

javac \
  -Xlint:-options \
  -source 8 \
  -target 8 \
  -classpath "$SAM_JAR" \
  -d "$BUILD_DIR" \
  "$SRC"

rm -f "$OUT_JAR"
jar cf "$OUT_JAR" -C "$BUILD_DIR" .

echo "Built: $OUT_JAR"
