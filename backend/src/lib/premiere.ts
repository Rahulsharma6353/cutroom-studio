import { spawn } from 'node:child_process';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pixelPhrases } from '@shared/frame/Frame';
import { enqueue } from './jobs';
import { ASSETS, SCRIPTS, PYTHON } from './paths';
import { browser, getBundle, type RenderRequest } from './render';
import { frameSize } from './render-size';
import { ensureExports, mediaPath, readMeta } from './storage';

/**
 * Premiere Pro export: the same edit as the MP4, but as a project an editor can open and change.
 * Captions and every graphic are rendered as separate transparent layers (frame-identical to the
 * MP4, since both come from the same Frame component), then scripts/premiere_package.py writes a
 * Final Cut Pro 7 XML that Premiere imports, with the A-roll cuts, punch-ins, B-roll, music and
 * sound effects on their own tracks. Everything is zipped with the source media.
 */

const slugOf = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'edit';

function run(cmd: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim().split('\n').slice(-3).join(' ') || `${cmd} exited ${code}`))));
  });
}

function joinFolder(folder: string, name: string) {
  const win = /^[A-Za-z]:/.test(folder) || folder.includes('\\');
  const sep = win ? '\\' : '/';
  return `${folder.replace(/[\\/]+/g, sep).replace(/[\\/]+$/, '')}${sep}${name}`;
}

const README = (folder: string, pkg: string, xml: string, hasSource: boolean) => `Premiere Pro project
====================

1. Unzip so that this folder is at:  ${folder ? joinFolder(folder, pkg) : pkg}
   (somewhere else works too: Premiere asks you to locate one file once, then finds the rest).
2. Premiere Pro > File > Import > ${xml}
3. Save the project (Ctrl+S / Cmd+S) to get your .prproj.

Tracks
------
Bottom  Background plate (still PNG), when the style has one.
V1      Your footage${hasSource ? ' (media/ folder)' : ''}, cut at every shot, punch-ins as Motion > Scale.
Above   B-roll, then the film look (grain + vignette, still PNG), every UI graphic, label stack,
        setup line and key line, each kind on its own track and each one its own clip with
        transparency (QuickTime Animation .mov). Full-frame scenes are H.264.
Top     Captions, one clip per phrase (graphics/captions*.mov), when captions are on.
A1-A2   Your voice. Below: music, then sound effects at their mix levels.

The finished MP4 also has slow push-ins inside each shot; here shots hold a fixed scale.
Add Scale keyframes if you want the drift.
`;

export function startPremiereExport(req: RenderRequest, origin: string, folder: string) {
  const steps = ['Preparing the renderer', 'Rendering captions', 'Rendering graphics', 'Building the Premiere project', 'Packing the zip'];
  // Shares the render queue: both drive the headless browser hard.
  return enqueue('render', steps, async (ctx) => {
    ctx.step(0);
    const { renderFrames, selectComposition } = await import('@remotion/renderer');
    const serveUrl = await getBundle();
    const browserExecutable = browser();
    const fps = req.fps;
    const { width, height } = frameSize(req.aspect, req.res);
    const durationInFrames = Math.max(1, Math.round(req.duration * fps));
    const base = { clips: req.clips, assets: req.assets, words: req.words, captions: req.captions, look: req.look, width, height, fps, durationInFrames, origin };

    const exportsDir = await ensureExports();
    const id = `pp_${Date.now().toString(36)}`;
    const work = path.join(exportsDir, id);
    const layersDir = path.join(work, 'layers');
    await mkdir(layersDir, { recursive: true });

    try {
      // Layers to render: captions (whole video), then each overlay graphic over its own time.
      const layers: { name: string; props: Record<string, unknown>; from: number; to: number; track?: string; still?: boolean }[] = [];
      if (req.captions.enabled) layers.push({ name: 'captions', props: { ...base, layer: 'captions' }, from: 0, to: durationInFrames - 1 });
      // Every graphic, label stack, setup line and key line is its own clip; the plate and the film
      // look don't move, so they are one still each.
      const LAYER_TRACKS = ['t-plate', 't-look', 't-overlay', 't-labels', 't-setup', 't-key'];
      for (const c of req.clips.filter((c) => LAYER_TRACKS.includes(c.trackId))) {
        const from = Math.max(0, Math.round(c.start * fps));
        const to = Math.min(durationInFrames - 1, Math.round((c.start + c.duration) * fps) - 1);
        const still = c.trackId === 't-plate' || c.trackId === 't-look';
        if (to >= from) layers.push({ name: `gfx_${c.id}`, props: { ...base, layer: 'graphics', onlyClip: c.id }, from, to: still ? from : to, track: c.trackId, still });
      }
      const totalFrames = layers.reduce((n, l) => n + l.to - l.from + 1, 0) || 1;
      let done = 0;
      const manifest: { name: string; from: number; to: number; dir: string; track?: string; still?: boolean; end?: number }[] = [];
      for (const l of layers) {
        ctx.step(l.name === 'captions' ? 1 : 2);
        const dir = path.join(layersDir, l.name);
        await mkdir(dir, { recursive: true });
        const composition = await selectComposition({ serveUrl, id: 'Timeline', inputProps: l.props, browserExecutable });
        await renderFrames({
          composition, serveUrl, inputProps: l.props, outputDir: dir, imageFormat: 'png', frameRange: [l.from, l.to], browserExecutable,
          concurrency: Number(process.env.RENDER_CONCURRENCY) || null,
          onStart: () => undefined,
          onFrameUpdate: (n) => ctx.progress(Math.min(0.85, ((done + n) / totalFrames) * 0.85)),
        });
        done += l.to - l.from + 1;
        const c = req.clips.find((x) => `gfx_${x.id}` === l.name);
        manifest.push({ name: l.name, from: l.from, to: l.to, dir, track: l.track, still: l.still, end: c ? Math.min(durationInFrames, Math.round((c.start + c.duration) * fps)) : undefined });
      }
      await writeFile(path.join(layersDir, 'manifest.json'), JSON.stringify(manifest));

      ctx.step(3);
      const slug = slugOf(req.title);
      const pkgName = `${slug}_premiere`;
      const pkg = path.join(work, pkgName);
      await mkdir(path.join(pkg, 'media'), { recursive: true });
      // Source media that lives on this server goes into media/, referenced relative to the package.
      const mediaFiles: Record<string, { path: string; frames: number; w?: number; h?: number; audio: boolean; still: boolean }> = {};
      const used = new Set<string>();
      for (const a of req.assets) {
        const m = a.url?.match(/^\/api\/media\/([a-z0-9_]+)/);
        if (!m || !req.clips.some((c) => c.assetId === a.id)) continue;
        const meta = await readMeta(m[1]);
        if (!meta) continue;
        let name = meta.name.replace(/[\\/:*?"<>|]+/g, '_');
        while (used.has(name.toLowerCase())) name = `${path.parse(name).name}_1${path.parse(name).ext}`;
        used.add(name.toLowerCase());
        await copyFile(mediaPath(meta.id, 'original', meta.ext), path.join(pkg, 'media', name));
        const still = meta.mime.startsWith('image/');
        mediaFiles[a.id] = {
          path: `media/${name}`,
          frames: Math.max(1, Math.round((meta.probe?.duration ?? a.duration ?? req.duration) * fps)),
          w: meta.probe?.width, h: meta.probe?.height, audio: !still && (meta.probe?.hasAudio ?? meta.hasAudio ?? true), still,
        };
      }
      const body = { ...req, width, height, mediaFiles };
      await writeFile(path.join(work, 'body.json'), JSON.stringify(body));
      const phrases = req.captions.layout === 'pixel'
        ? pixelPhrases(req.words).map((p) => ({ t0: p.words[0].t, t1: p.end, text: p.words.map((w) => w.w).join(' ') }))
        : [];
      await writeFile(path.join(work, 'phrases.json'), JSON.stringify(phrases));
      const out = await run(PYTHON, [
        path.join(SCRIPTS, 'premiere_package.py'), path.join(work, 'body.json'), layersDir, pkg, path.join(ASSETS, 'sfx'),
        (folder ? joinFolder(folder, pkgName) : `C:/${pkgName}`).replace(/\\/g, '/'), path.join(work, 'phrases.json'),
      ]);
      const xml = out.match(/^xml (.+)$/m)?.[1] ?? 'edit.xml';
      await writeFile(path.join(pkg, 'README.txt'), README(folder, pkgName, xml, Object.keys(mediaFiles).length > 0));
      ctx.progress(0.95);

      ctx.step(4);
      const zip = path.join(exportsDir, `${id}.zip`);
      // zip on Linux/macOS; Windows has no zip command, but its built-in tar writes .zip files.
      if (process.platform === 'win32') await run('tar', ['-a', '-c', '-f', zip, pkgName], work);
      else await run('zip', ['-qr', zip, pkgName], work);
      return { file: path.basename(zip), name: `${pkgName}.zip`, mime: 'application/zip' };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
}
