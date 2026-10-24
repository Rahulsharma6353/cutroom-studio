#!/usr/bin/env bash
# One-time setup for the server's local helpers:
#   - Python packages for face tracking, local speech-to-text and the Premiere packager
#   - Whisper turbo (int8, ~1 GB) for transcription without an API key
#   - YuNet face detector (ships in models/ already; re-downloaded if missing)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p models

python3 -m pip install --quiet --upgrade sherpa-onnx numpy opencv-python-headless pillow || \
  python3 -m pip install --quiet --upgrade --break-system-packages sherpa-onnx numpy opencv-python-headless pillow

if [ ! -f models/face_detection_yunet_2023mar.onnx ]; then
  curl -fsSL -o models/face_detection_yunet_2023mar.onnx \
    https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
fi

if [ ! -f models/sherpa-onnx-whisper-turbo/turbo-tokens.txt ]; then
  echo "Downloading Whisper turbo (about 1 GB)…"
  curl -fsSL https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-turbo.tar.bz2 | tar -xj -C models
  rm -f models/sherpa-onnx-whisper-turbo/*.onnx.fp32 2>/dev/null || true
fi

echo "Models ready in $(pwd)/models"
