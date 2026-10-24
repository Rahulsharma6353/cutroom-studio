#!/usr/bin/env bash
# Container start: fetch the local Whisper model into the persistent volume once, then serve.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p "${STORAGE_DIR:-./storage}"
if [ -z "${STT_API_KEY:-}" ] && [ -n "${WHISPER_DIR:-}" ] && [ ! -f "$WHISPER_DIR/turbo-tokens.txt" ]; then
  (
    echo "Downloading Whisper turbo (about 1 GB) into $WHISPER_DIR in the background…"
    mkdir -p "$(dirname "$WHISPER_DIR")"
    curl -fsSL https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-turbo.tar.bz2 \
      | tar -xj -C "$(dirname "$WHISPER_DIR")" && rm -f "$WHISPER_DIR"/*.onnx.fp32 && echo "Whisper ready."
  ) &
fi
exec npx tsx src/index.ts
