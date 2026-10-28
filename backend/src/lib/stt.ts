import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Word } from '@shared/types';
import { MODELS, SCRIPTS, PYTHON } from './paths';

/**
 * Speech-to-text with word timestamps through any OpenAI-compatible
 * /audio/transcriptions endpoint (OpenAI Whisper, Groq, a self-hosted faster-whisper server).
 * Returns null when no provider is configured.
 */
const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'erm', 'er', 'hmm', 'ah', 'uhm', 'mm']);

/**
 * Local Whisper models, best first: large-v3 (most accurate, 99 languages) then large-v3-turbo
 * (about 8x faster, a little less accurate outside English). WHISPER_DIR picks one explicitly.
 */
const WHISPER_DIRS = [
  process.env.WHISPER_DIR,
  path.join(MODELS, 'sherpa-onnx-whisper-large-v3'),
  path.join(MODELS, 'sherpa-onnx-whisper-turbo'),
].filter((d): d is string => !!d).map((d) => path.resolve(d));
const hasTokens = (d: string) => { try { return readdirSync(d).some((f) => f.endsWith('tokens.txt')); } catch { return false; } };
const localModel = () => WHISPER_DIRS.find(hasTokens) ?? null;
const localReady = () => localModel() !== null;

/** Which speech-to-text this server uses, for the health check and the editor's messages. */
export function sttInfo(): { mode: 'api' | 'local' | 'none'; model?: string } {
  if (process.env.STT_API_KEY) return { mode: 'api', model: process.env.STT_MODEL || 'whisper-1' };
  const m = localModel();
  return m ? { mode: 'local', model: path.basename(m).replace('sherpa-onnx-', '') } : { mode: 'none' };
}

/** Language: '' or 'auto' detects it; otherwise a Whisper code such as en, hi, gu, mr, ta, es. */
const langOf = (language?: string) => {
  const l = (language ?? process.env.STT_LANGUAGE ?? '').trim().toLowerCase();
  return l === 'auto' ? '' : l;
};

export const sttConfigured = () => !!process.env.STT_API_KEY || localReady();

/** Whisper on this machine via sherpa-onnx: no key needed, slower than an API. */
function transcribeLocal(audioFile: string, language?: string): Promise<Word[]> {
  return new Promise((resolve, reject) => {
    const py = PYTHON;
    const p = spawn(py, [path.join(SCRIPTS, 'transcribe_local.py'), audioFile, localModel()!, '-', langOf(language) || 'auto'], { stdio: ['ignore', 'pipe', 'pipe'] });
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

export async function transcribe(audioFile: string, language?: string): Promise<Word[] | null> {
  const key = process.env.STT_API_KEY;
  if (!key) return localReady() ? transcribeLocal(audioFile, language) : null;
  const base = (process.env.STT_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const form = new FormData();
  form.append('file', new Blob([await readFile(audioFile)], { type: 'audio/mpeg' }), 'audio.mp3');
  form.append('model', process.env.STT_MODEL || 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  if (langOf(language)) form.append('language', langOf(language));
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
