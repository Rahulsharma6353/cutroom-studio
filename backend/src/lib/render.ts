import path from 'node:path';
import { existsSync } from 'node:fs';
import type { AspectRatio, Asset, CaptionSettings, Clip, Look, Word } from '@shared/types';
import { enqueue } from './jobs';
import { BACKEND_ROOT, SHARED_SRC } from './paths';
import { ensureExports } from './storage';

export type ExportFormat = 'MP4 (H.264)' | 'MP4 (H.265)' | 'MOV (ProRes 422)' | 'WebM' | 'GIF' | 'MP3 audio only' | 'WAV audio only';

const CODECS: Record<ExportFormat, { codec: 'h264' | 'h265' | 'prores' | 'vp8' | 'gif' | 'mp3' | 'wav'; ext: string; mime: string }> = {
  'MP4 (H.264)': { codec: 'h264', ext: 'mp4', mime: 'video/mp4' },
  'MP4 (H.265)': { codec: 'h265', ext: 'mp4', mime: 'video/mp4' },
  'MOV (ProRes 422)': { codec: 'prores', ext: 'mov', mime: 'video/quicktime' },
  WebM: { codec: 'vp8', ext: 'webm', mime: 'video/webm' },
  GIF: { codec: 'gif', ext: 'gif', mime: 'image/gif' },
  'MP3 audio only': { codec: 'mp3', ext: 'mp3', mime: 'audio/mpeg' },
  'WAV audio only': { codec: 'wav', ext: 'wav', mime: 'audio/wav' },
};
export const FORMATS = Object.keys(CODECS) as ExportFormat[];
export const formatInfo = (f: ExportFormat) => CODECS[f];


export { frameSize } from './render-size';
import { frameSize } from './render-size';
const CRF: Record<string, number> = { Draft: 30, Standard: 23, High: 18 };

export interface RenderRequest {
  title: string;
  aspect: AspectRatio;
  clips: Clip[];
  assets: Asset[];
  words: Word[];
  captions: CaptionSettings;
  look?: Look;
  format: ExportFormat;
  res: string;
  fps: number;
  quality: string;
  range: { start: number; end: number } | null;
  duration: number;
}

// One webpack bundle per server process; later renders reuse it.
let bundled: Promise<string> | null = null;
export async function getBundle() {
  bundled ??= (async () => {
    const { bundle } = await import('@remotion/bundler');
    return bundle({
      entryPoint: path.join(BACKEND_ROOT, 'composition/index.ts'),
      webpackOverride: (config) => ({
        ...config,
        resolve: {
          ...config.resolve,
          alias: { ...(config.resolve?.alias as object), '@shared': SHARED_SRC },
        },
      }),
    });
  })().catch((e) => {
    bundled = null;
    throw e;
  });
  return bundled;
}

export function browser(): string | undefined {
  const env = process.env.REMOTION_BROWSER;
  if (env && existsSync(env)) return env;
  return undefined; // Remotion downloads its own headless Chrome on first use
}

export function startRender(req: RenderRequest, origin: string) {
  const info = CODECS[req.format];
  return enqueue('render', ['Preparing the renderer', 'Rendering frames', 'Saving the file'], async (ctx) => {
    ctx.step(0);
    const { renderMedia, selectComposition } = await import('@remotion/renderer');
    const serveUrl = await getBundle();
    const fps = req.fps;
    const { width, height } = frameSize(req.aspect, req.res);
    const durationInFrames = Math.max(1, Math.round(req.duration * fps));
    const inputProps = { clips: req.clips, assets: req.assets, words: req.words, captions: req.captions, look: req.look, width, height, fps, durationInFrames, origin };
    const browserExecutable = browser();
    const composition = await selectComposition({ serveUrl, id: 'Timeline', inputProps, browserExecutable });

    ctx.step(1);
    const dir = await ensureExports();
    const file = path.join(dir, `${Date.now().toString(36)}.${info.ext}`);
    const frameRange: [number, number] | null = req.range
      ? [Math.max(0, Math.floor(req.range.start * fps)), Math.min(durationInFrames - 1, Math.ceil(req.range.end * fps) - 1)]
      : null;
    await renderMedia({
      composition,
      serveUrl,
      codec: info.codec,
      outputLocation: file,
      inputProps,
      browserExecutable,
      frameRange,
      crf: ['h264', 'h265', 'vp8'].includes(info.codec) ? CRF[req.quality] ?? 23 : undefined,
      audioBitrate: '192k',
      concurrency: Number(process.env.RENDER_CONCURRENCY) || null,
      onProgress: ({ progress }) => ctx.progress(progress),
    });

    ctx.step(2);
    const slug = req.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'video';
    return { file: path.basename(file), name: `${slug}.${info.ext}`, mime: info.mime };
  });
}
