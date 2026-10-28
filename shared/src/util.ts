let counter = 0;
export const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}`;

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function timecode(sec: number, frames = false): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  const base = `${m}:${r.toString().padStart(2, '0')}`;
  if (!frames) return base;
  const f = Math.floor((s % 1) * 30);
  return `${base}:${f.toString().padStart(2, '0')}`;
}

export function hashHue(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

// Stand-in "footage" swatch used wherever there is no real media yet.
export function swatch(hue: number, alt = 0): string {
  const h2 = (hue + 28 + alt) % 360;
  return `linear-gradient(155deg, hsl(${hue} 42% 34%) 0%, hsl(${h2} 38% 18%) 100%)`;
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

import type { AspectRatio } from './types';

/** Nearest supported aspect ratio for footage of this size. */
export function aspectOf(width?: number, height?: number): AspectRatio | null {
  if (!width || !height) return null;
  const r = width / height;
  const opts: [AspectRatio, number][] = [['16:9', 16 / 9], ['4:3', 4 / 3], ['1:1', 1], ['4:5', 4 / 5], ['3:4', 3 / 4], ['9:16', 9 / 16]];
  return opts.reduce((best, o) => (Math.abs(Math.log(o[1] / r)) < Math.abs(Math.log(best[1] / r)) ? o : best))[0];
}

/** dB ↔ linear gain (0 dB = 1). Below −60 dB counts as silent. */
export const dbToGain = (db = 0) => (db <= -60 ? 0 : Math.pow(10, db / 20));
export const fmtDb = (db = 0) => (db <= -60 ? '−∞ dB' : `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`);

/**
 * Clips as they should play and render: hidden tracks dropped, muted tracks silent, and each
 * clip's volume including its track's volume. Preview, MP4 render and Premiere export all use this.
 */
export function playableClips<T extends { trackId: string; gainDb?: number }>(clips: T[], tracks: Record<string, { hidden?: boolean; muted?: boolean; gainDb?: number }> | undefined): T[] {
  if (!tracks) return clips;
  return clips
    .filter((c) => !tracks[c.trackId]?.hidden)
    .map((c) => {
      const t = tracks[c.trackId];
      if (!t || (!t.muted && !t.gainDb)) return c;
      return { ...c, gainDb: t.muted ? -100 : (c.gainDb ?? 0) + (t.gainDb ?? 0) };
    });
}
