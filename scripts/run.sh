#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "==> Downloading dati (incrementale)"
python3 scripts/fetch_data.py "$@"
echo "==> Costruzione dataset"
python3 scripts/build_dataset.py
echo "==> Fatto. Avvia un server locale con: python3 -m http.server"
