import { spawn } from 'node:child_process';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

function run(bin: string, args: string[], onStderr?: (line: string) => void): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let carry = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d: Buffer) => {
      const text = d.toString();
      stderr += text;
      if (stderr.length > 2_000_000) stderr = stderr.slice(-1_000_000);
      if (onStderr) {
        const lines = (carry + text).split(/[\r\n]+/);
        carry = lines.pop() ?? '';
        lines.forEach(onStderr);
      }
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${bin} exited ${code}: ${stderr.slice(-400)}`))));
  });
}

export interface Probe {
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const j = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type: string; width?: number; height?: number; avg_frame_rate?: string; duration?: string; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[] };
  const v = j.streams?.find((s) => s.codec_type === 'video');
  const a = j.streams?.find((s) => s.codec_type === 'audio');
  const [n, d] = (v?.avg_frame_rate ?? '0/1').split('/').map(Number);
  const rot = Math.abs(Number(v?.tags?.rotate ?? v?.side_data_list?.[0]?.rotation ?? 0));
  const swap = rot === 90 || rot === 270;
  return {
    duration: Number(j.format?.duration ?? v?.duration ?? 0),
    width: swap ? v?.height : v?.width,
    height: swap ? v?.width : v?.height,
    fps: d ? Math.round((n / d) * 100) / 100 : undefined,
    hasAudio: !!a,
    hasVideo: !!v,
  };
}

const timeOf = (line: string) => {
  const m = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
};

/** 540p H.264 copy for smooth scrubbing in the browser. */
export async function makeProxy(input: string, output: string, duration: number, onProgress: (p: number) => void) {
  await run(
    FFMPEG,
    ['-y', '-i', input, '-vf', "scale='if(gt(iw,ih),-2,540)':'if(gt(iw,ih),540,-2)'", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output],
    (line) => {
      const t = timeOf(line);
      if (t !== null && duration > 0) onProgress(t / duration);
    },
  );
}

/** Small mono MP3 for speech-to-text (about 21 MB per hour). */
export async function extractAudio(input: string, output: string) {
  await run(FFMPEG, ['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', output]);
}

/** Silences longer than minDur, as pauses the editor can cut. */
export async function detectSilence(input: string, duration: number, onProgress: (p: number) => void, noiseDb = -32, minDur = 0.45) {
  const pauses: { t: number; d: number }[] = [];
  let start: number | null = null;
  await run(FFMPEG, ['-i', input, '-vn', '-af', `silencedetect=noise=${noiseDb}dB:d=${minDur}`, '-f', 'null', '-'], (line) => {
    const s = line.match(/silence_start: (-?[\d.]+)/);
    const e = line.match(/silence_end: ([\d.]+)/);
    if (s) start = Math.max(0, Number(s[1]));
    if (e && start !== null) {
      const end = Math.min(duration, Number(e[1]));
      if (end - start >= minDur) pauses.push({ t: round(start), d: round(end - start) });
      start = null;
    }
    const t = timeOf(line);
    if (t !== null && duration > 0) onProgress(t / duration);
  });
  if (start !== null && duration - start >= minDur) pauses.push({ t: round(start), d: round(duration - start) });
  return pauses;
}

const round = (n: number) => Math.round(n * 100) / 100;
