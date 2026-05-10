#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT"/{scripts,src,languages,.github/workflows}
echo "Scaffold complete."
