# Putting Cutroom live

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
