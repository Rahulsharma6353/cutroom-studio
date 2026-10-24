# Putting Cutroom Studio live

## Current release: Vercel + an existing server

The source is the private repository `fluxpediawork/cutroom-studio`, branch `main`.
GitHub Actions runs tests, all package type checks and a production frontend build.

The owner chose an existing server for video processing. Do not create paid Render
or Railway resources. The server hostname, deployment method and HTTPS API origin
must be confirmed before the backend is deployed there.

1. On the chosen server, build `backend/Dockerfile` with the repository root as the
   Docker build context. Keep persistent data mounted at `/data`, expose the API
   through HTTPS and route its health check to `/api/health`.
2. Set `CUTROOM_PASSCODE` in the backend's environment and keep it private. Use
   `STORAGE_DIR=/data/storage`, `WHISPER_DIR=/data/models/sherpa-onnx-whisper-turbo`,
   `HOST=0.0.0.0`, and an available `PORT`. Start with `RENDER_CONCURRENCY=1`.
   Local Whisper downloads into the persistent disk; wait for `Whisper ready.` in
   the logs before testing captions. AI provider keys are optional and belong only
   in the backend's environment settings.
3. In Vercel, import the repository as `cutroom-studio`, with Root Directory `frontend`
   and inclusion of files outside that directory enabled. Use Node 22.
4. Set `BACKEND_URL` and `NEXT_PUBLIC_API_URL` in Vercel to the backend server's HTTPS
   origin, for Production and Preview. Redeploy after setting them: the upload origin
   is included in the browser bundle at build time.
5. Verify the live health endpoint, studio passcode, a short real upload, analysis,
   a chat edit and an MP4 download. A deployed frontend with an offline backend is
   not a completed deployment of this editor.

Projects and job status still have the session/process limitations described in
README.md. Vercel's GitHub app must be granted access to this private repository
before Git-based deployment can be connected.

## Original Railway deployment alternative

Two parts, two hosts:

| Part | Host | Why |
|---|---|---|
| Website (`frontend/`) | **Vercel** | Next.js app, global CDN |
| Render server (`backend/`) | **Railway** (Docker) | needs FFmpeg, Python, Whisper, headless Chrome and long jobs, which Vercel functions can't run |

## 1. Render server on Railway

1. railway.com → New project → Deploy from GitHub repo → pick this repo.
   `railway.json` at the root tells Railway to build `backend/Dockerfile`.
2. Service → Settings → **Volumes** → add a volume mounted at `/data` (uploads, exports and the Whisper model live there).
3. Service → **Variables**:
   - `CUTROOM_PASSCODE` = a passcode only you know (locks uploads, renders and the AI editor)
   - `ANTHROPIC_API_KEY` = optional, for the AI editor (otherwise the built-in planner runs)
   - `STT_API_KEY` = optional; without it the server downloads Whisper turbo (~1 GB) into the volume on first start
4. Settings → Networking → **Generate domain**. Copy it, e.g. `https://cutroom-api.up.railway.app`.
   Check `https://…/api/health` returns `{"ok":true,…}`.

Recommended: at least 4 GB RAM / 2 vCPU (renders run headless Chrome).

## 2. Website on Vercel

1. vercel.com → Add New → Project → import this repo.
2. **Root Directory: `frontend`** (Vercel reads `frontend/vercel.json`; keep "Include files outside the root directory" on — the app compiles `../shared`).
3. Environment variables (Production + Preview):
   - `BACKEND_URL` = the Railway domain (API calls and media are proxied to it)
   - `NEXT_PUBLIC_API_URL` = the same Railway domain (large uploads go straight to it)
4. Deploy. Open the site, enter the passcode once per browser.

Every push to `main` redeploys both.
