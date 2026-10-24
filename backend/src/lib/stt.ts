import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Word } from '@shared/types';
import { MODELS, SCRIPTS } from './paths';

/**
 * Speech-to-text with word timestamps through any OpenAI-compatible
 * /audio/transcriptions endpoint (OpenAI Whisper, Groq, a self-hosted faster-whisper server).
 * Returns null when no provider is configured.
 */
const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'erm', 'er', 'hmm', 'ah', 'uhm', 'mm']);

/** Local fallback model (scripts/setup-models.sh downloads it). */
const WHISPER_DIR = path.resolve(process.env.WHISPER_DIR || path.join(MODELS, 'sherpa-onnx-whisper-turbo'));
const localReady = () => existsSync(path.join(WHISPER_DIR, 'turbo-tokens.txt'));

export const sttConfigured = () => !!process.env.STT_API_KEY || localReady();

/** Whisper turbo on this machine via sherpa-onnx: no key needed, slower than an API. */
function transcribeLocal(audioFile: string): Promise<Word[]> {
  return new Promise((resolve, reject) => {
    const py = process.env.PYTHON_PATH || 'python3';
    const p = spawn(py, [path.join(SCRIPTS, 'transcribe_local.py'), audioFile, WHISPER_DIR, '-', process.env.STT_LANGUAGE || 'en'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`local speech-to-text failed: ${err.trim().split('\n').at(-1) ?? code}`));
      try {
        const json = JSON.parse(out) as { words: Word[] };
        resolve(json.words.map((w, i) => ({ ...w, id: `w${i}`, filler: FILLERS.has(w.w.toLowerCase().replace(/[^a-z]/g, '')) })));
      } catch (e) {
        reject(e);
      }
    });
  });
}

export async function transcribe(audioFile: string): Promise<Word[] | null> {
  const key = process.env.STT_API_KEY;
  if (!key) return localReady() ? transcribeLocal(audioFile) : null;
  const base = (process.env.STT_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const form = new FormData();
  form.append('file', new Blob([await readFile(audioFile)], { type: 'audio/mpeg' }), 'audio.mp3');
  form.append('model', process.env.STT_MODEL || 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  if (process.env.STT_LANGUAGE) form.append('language', process.env.STT_LANGUAGE);
  // Whisper drops "um"/"uh" unless the prompt shows them; this keeps fillers so they can be cut.
  form.append('prompt', 'Umm, so, uh, like, you know, I mean, hmm.');

  const res = await fetch(`${base}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form });
  if (!res.ok) throw new Error(`speech-to-text failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { words?: { word: string; start: number; end: number }[] };
  return (json.words ?? []).map((w, i) => {
    const text = w.word.trim();
    return {
      id: `w${i}`,
      t: Math.round(w.start * 100) / 100,
      d: Math.max(0.05, Math.round((w.end - w.start) * 100) / 100),
      w: text,
      filler: FILLERS.has(text.toLowerCase().replace(/[^a-z]/g, '')),
    };
  });
}
