import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { MODELS, SCRIPTS } from './paths';
import type { CalmSample, FaceSample, Pause, Word } from '@shared/types';
import { detectSilence, extractAudio, makeProxy, probe } from './ffmpeg';
import { enqueue } from './jobs';
import { mediaPath, readMeta, writeMeta } from './storage';
import { transcribe, sttConfigured } from './stt';

export interface Analysis {
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  pauses: Pause[];
  words: Word[];
  transcript: 'speech' | 'none' | 'failed';
  proxyUrl: string;
  faces: FaceSample[];
  /** Busy/calm and brightness grid over time, for placing text where it reads. */
  calm: CalmSample[];
  hasVideo: boolean;
}

/** Light analysis for B-roll: shape and calm areas only. */
export interface BrollAnalysis { duration: number; width?: number; height?: number; hasVideo: boolean; calm: CalmSample[]; faces: FaceSample[] }

/** Where the footage is busy or calm (scripts/calm_map.py). Optional: empty means text uses default spots. */
function calmMap(file: string): Promise<CalmSample[]> {
  return new Promise((resolve) => {
    const p = spawn(process.env.PYTHON_PATH || 'python3', [path.join(SCRIPTS, 'calm_map.py'), file, '-', '0.5'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => resolve([]));
    p.on('close', () => {
      try { resolve(JSON.parse(out) as CalmSample[]); } catch { resolve([]); }
    });
  });
}

const YUNET = path.join(MODELS, 'face_detection_yunet_2023mar.onnx');

/**
 * Face track. With the YuNet model present (models/), every other frame is checked and smoothed,
 * so captions and cards can keep clear of the head as it moves; otherwise a coarser OpenCV
 * Haar track every 0.25 s. Optional: an empty track just means text uses default spots.
 */
function trackFaces(file: string): Promise<FaceSample[]> {
  return new Promise((resolve) => {
    const py = process.env.PYTHON_PATH || 'python3';
    const args = existsSync(YUNET)
      ? [path.join(SCRIPTS, 'faces_yunet.py'), file, YUNET, '-', '2']
      : [path.join(SCRIPTS, 'faces.py'), file, '0.25'];
    const p = spawn(py, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => resolve([]));
    p.on('close', () => {
      try {
        resolve(JSON.parse(out) as FaceSample[]);
      } catch {
        resolve([]);
      }
    });
  });
}

export const ANALYZE_STEPS = ['Reading footage', 'Making a preview copy', 'Finding pauses and your face', 'Transcribing speech'];

export async function startAnalysis(id: string) {
  const meta = await readMeta(id);
  if (!meta) throw new Error('not found');

  return enqueue<Analysis>('analyze', ANALYZE_STEPS, async (ctx) => {
    const src = mediaPath(id, 'original', meta.ext);

    ctx.step(0);
    const p = await probe(src);
    if (!p.hasVideo && !p.hasAudio) throw new Error('This file has no video or audio we can read.');
    meta.probe = { duration: p.duration, width: p.width, height: p.height, fps: p.fps, hasAudio: p.hasAudio };

    ctx.step(1);
    if (p.hasVideo) {
      await makeProxy(src, mediaPath(id, 'proxy'), p.duration, ctx.progress);
      meta.hasProxy = true;
    }

    ctx.step(2);
    let pauses: Pause[] = [];
    const look = meta.hasProxy ? mediaPath(id, 'proxy') : src;
    const facesP = p.hasVideo ? trackFaces(look) : Promise.resolve([]);
    const calmP = p.hasVideo ? calmMap(look) : Promise.resolve([]);
    if (p.hasAudio) {
      pauses = await detectSilence(src, p.duration, ctx.progress);
      await extractAudio(src, mediaPath(id, 'audio'));
      meta.hasAudio = true;
    }
    const [faces, calm] = await Promise.all([facesP, calmP]);
    await writeMeta(meta);

    ctx.step(3);
    let words: Word[] = [];
    let transcript: Analysis['transcript'] = 'none';
    if (p.hasAudio && sttConfigured()) {
      try {
        words = (await transcribe(mediaPath(id, 'audio'))) ?? [];
        transcript = 'speech';
      } catch (err) {
        console.error('[stt]', err);
        transcript = 'failed';
      }
    }
    return { duration: p.duration, width: p.width, height: p.height, fps: p.fps, pauses, words, transcript, proxyUrl: `/api/media/${id}`, faces, calm, hasVideo: p.hasVideo };
  });
}

export function startBrollAnalysis(id: string) {
  return (async () => {
    const meta = await readMeta(id);
    if (!meta) throw new Error('not found');
    return enqueue<BrollAnalysis>('analyze', ['Reading footage', 'Mapping calm areas and faces'], async (ctx) => {
      const src = mediaPath(id, 'original', meta.ext);
      ctx.step(0);
      const p = await probe(src);
      ctx.step(1);
      const [calm, faces] = p.hasVideo ? await Promise.all([calmMap(src), trackFaces(src)]) : [[], []];
      return { duration: p.duration, width: p.width, height: p.height, hasVideo: p.hasVideo, calm, faces };
    });
  })();
}
