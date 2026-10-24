# Cutroom render server (Railway, Render, Fly, any Docker host).
# Build from the repo root:  docker build -f backend/Dockerfile .
FROM node:22-bookworm-slim

# FFmpeg for probing/proxies/encodes, Python for faces, calm maps, local Whisper and the Premiere
# packager, zip for packages, and the shared libraries Remotion's headless Chrome needs.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-pip zip curl bzip2 ca-certificates \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libasound2 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxkbcommon0 libpango-1.0-0 libcairo2 \
      fonts-noto-core fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir --break-system-packages sherpa-onnx numpy opencv-python-headless pillow

WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace backend --workspace shared --include-workspace-root --no-audit --no-fund

COPY shared shared
COPY backend backend

WORKDIR /app/backend
# Remotion's own headless Chrome, baked into the image so the first render doesn't download it.
RUN node --input-type=module -e "import { ensureBrowser } from '@remotion/renderer'; await ensureBrowser();"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    STORAGE_DIR=/data/storage \
    WHISPER_DIR=/data/models/sherpa-onnx-whisper-turbo \
    RENDER_CONCURRENCY=2
EXPOSE 4000
CMD ["bash", "scripts/start.sh"]
