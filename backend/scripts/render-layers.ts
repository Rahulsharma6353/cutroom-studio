// Renders from an export body JSON (same shape the /api/export route takes):
//   stills  <body> <origin> <outDir> <t1,t2,...>      full frames as PNG, for checking
//   layers  <body> <origin> <outDir>                  transparent PNG sequences for Premiere:
//                                                      captions (whole video) + one per graphic
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderFrames, renderStill, selectComposition } from '@remotion/renderer';
import { frameSize } from '../src/lib/render-size';

const [mode, bodyFile, origin, outDir, list] = process.argv.slice(2);
const body = JSON.parse(readFileSync(bodyFile, 'utf8'));
const root = process.cwd();
const browserExecutable = process.env.REMOTION_BROWSER || undefined;

async function main() {
  mkdirSync(outDir, { recursive: true });
  const serveUrl = await bundle({
    entryPoint: path.join(root, 'composition/index.ts'),
    webpackOverride: (c) => ({ ...c, resolve: { ...c.resolve, alias: { ...(c.resolve?.alias as object), '@shared': path.join(root, '../shared/src') } } }),
  });
  const fps = body.fps;
  const { width, height } = frameSize(body.aspect, body.res);
  const durationInFrames = Math.round(body.duration * fps);
  const base = { clips: body.clips, assets: body.assets, words: body.words, captions: body.captions, look: body.look, width, height, fps, durationInFrames, origin };

  if (mode === 'stills') {
    const comp = await selectComposition({ serveUrl, id: 'Timeline', inputProps: base, browserExecutable });
    for (const t of list.split(',').map(Number)) {
      const file = path.join(outDir, `still_${t.toFixed(2)}.png`);
      await renderStill({ composition: comp, serveUrl, inputProps: base, output: file, frame: Math.round(t * fps), browserExecutable });
      console.log('still', file);
    }
    return;
  }

  // Layers: captions over the whole video, then each graphic over its own time range.
  const jobs: { name: string; props: Record<string, unknown>; from: number; to: number }[] = [
    { name: 'captions', props: { ...base, layer: 'captions' }, from: 0, to: durationInFrames - 1 },
  ];
  for (const c of body.clips.filter((c: { trackId: string }) => c.trackId === 't-overlay')) {
    jobs.push({ name: `gfx_${c.id}`, props: { ...base, layer: 'graphics', onlyClip: c.id }, from: Math.round(c.start * fps), to: Math.min(durationInFrames - 1, Math.round((c.start + c.duration) * fps) - 1) });
  }
  const manifest: { name: string; from: number; to: number; dir: string }[] = [];
  for (const j of jobs) {
    const dir = path.join(outDir, j.name);
    mkdirSync(dir, { recursive: true });
    const comp = await selectComposition({ serveUrl, id: 'Timeline', inputProps: j.props, browserExecutable });
    await renderFrames({
      composition: comp, serveUrl, inputProps: j.props, outputDir: dir, imageFormat: 'png', frameRange: [j.from, j.to],
      browserExecutable, onStart: () => undefined, onFrameUpdate: () => undefined,
      concurrency: Number(process.env.RENDER_CONCURRENCY) || null,
    });
    manifest.push({ name: j.name, from: j.from, to: j.to, dir });
    console.log('layer', j.name, j.from, j.to);
  }
  writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
