# Cutroom Studio

AI video editor for short-form creators: drop footage, get a first cut (pauses out, captions on,
UI graphics and sound placed, all kept clear of the speaker's face), refine it by chatting about a
selected part, then export an MP4 or a Premiere Pro project.

## Folders

```
Cutroom/
├── frontend/   Web app (Next.js): dashboard, new-video sheet, editor. Talks only to the backend.
├── backend/    API server (Hono on Node): uploads, analysis, AI director, MP4 render, Premiere export.
└── shared/     Code both sides use: timeline model and edit operations, the video frame renderer
                (the editor preview and the server render draw through the same component),
                caption layout, fonts, brand marks and sound effects.
```

| Path | What it is |
| --- | --- |
| `shared/src/types.ts`, `ops.ts` | Timeline model, `EditOp` contract, validation, applying ops |
| `shared/src/frame/` | `Frame.tsx` (one frame of the edit), `UICard.tsx` (motion graphics), caption layout |
| `shared/src/styles/frame.css` | Styles for the video frame only (used by the renderer and the editor) |
| `shared/assets/` | Brand marks and sound effects, served by the backend at `/brand` and `/sfx` |
| `backend/src/server.ts` | Routes: `upload`, `media/:id`, `analyze`, `jobs/:id`, `director`, `export`, `exports/:id` |
| `backend/src/lib/` | Storage, FFmpeg, speech-to-text, job queue, analysis, render, Premiere export, director |
| `backend/composition/` | Remotion composition the renderer bundles |
| `backend/scripts/` | Face tracking, local transcription, Premiere packager, layer renders, model setup |
| `backend/models/` | YuNet face detector; Whisper turbo after `npm run setup` |
| `frontend/src/ui/` | Dashboard, new-video sheet, editor |
| `frontend/preview/` | Single-file, server-free design preview (`npm run preview:build -w frontend`) |

## Run it

Needs Node 20+, FFmpeg (`ffmpeg` and `ffprobe` on PATH), Python 3 and `zip`.

```bash
npm install                            # installs all three packages
npm run setup                          # Python packages + models (Whisper turbo ~1 GB, YuNet)
cp backend/.env.example backend/.env   # add keys (see below)
npm run dev                            # API on :4000, web app on http://localhost:3000
```

The web app proxies `/api`, `/sfx` and `/brand` to the backend (`BACKEND_URL`, default
`http://127.0.0.1:4000`). Uploads go straight from the browser to the backend
(`NEXT_PUBLIC_API_URL`, default this host on port 4000) so large files are never buffered.

| Backend setting | What it turns on | Without it |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Chat edits planned by the AI director (`DIRECTOR_MODEL`, default `claude-opus-5-5`) | Built-in rule-based planner |
| `STT_API_KEY` | Fast speech-to-text through an OpenAI-compatible API | Local Whisper turbo after `npm run setup` (a few minutes per minute of footage on CPU); no model, no captions |
| `STT_LANGUAGE` | Language hint, e.g. `hi` | English |
| `REMOTION_BROWSER` | Use an existing headless Chrome for rendering | Remotion downloads one on first export |
| `STORAGE_DIR` | Where uploads and exports live | `backend/storage` |

The first export bundles the renderer (about 20–40 s); later exports reuse it.
The model name lives only in backend env and never reaches the browser.

## What works now

- **Uploads** stream to storage with progress (up to 10 GB a file).
- **Analysis** per A-roll: probe, 540p proxy, pause detection, speech-to-text with word timings,
  and a face track on every other frame, so captions and cards are laid out clear of the head.
- **First cut** in the house style: pixel captions with letter-by-letter reveals, punch-ins,
  light glass UI cards, sound design. Notes typed in the new-video sheet ride along
  ("add music", "captions off").
- **Editor**: timeline, selection-scoped chat, change-sets with keep/undo, captions, audio, create.
- **Export**: MP4 (H.264/H.265), ProRes, WebM, GIF, MP3, WAV, 720p–4K, 24–60 fps, whole video or
  a selection; or a **Premiere Pro project (.zip)** with every caption phrase and graphic as its
  own transparent clip, B-roll, music and sound effects on their own tracks.
- **Layout rules**: everything inside a title-safe area (6% sides, 7% top, 10% bottom); each
  caption phrase sized to fit beside, below or above the head for its whole time on screen;
  cards ride beside the head.

## Not real yet

- Stock B-roll search, image/video generation, screen recording, music and SFX libraries:
  jobs are simulated and render as labelled placeholders.
- Auth, database and saved projects (state lives in the browser tab; the dashboard shows samples).
- Jobs run in-process (`backend/src/lib/jobs.ts`); move to Redis + BullMQ workers before launch.
- Storage is local disk (`backend/src/lib/storage.ts`); swap for R2/S3 with the same interface.

## Licences to sort before launch

- **Remotion**: an app that renders videos for users needs the *Remotion for Automators*
  company licence once the company has 4+ people ($0.01 per render, $100/month minimum).
- Stock, music and SFX sources need their own licences once they are wired in.
