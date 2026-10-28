'use client';
import { useEffect, useState } from 'react';

/**
 * Thumbnail frames for timeline clips, made in the browser from the clip's own video:
 * a hidden <video> seeks through the file and each frame is drawn small to a canvas.
 * One strip per file, shared by every clip that uses it, cached for the session.
 */
export interface Strip { step: number; frames: string[]; aspect: number }

const cache = new Map<string, Strip>();
const pending = new Map<string, Promise<Strip | null>>();
const listeners = new Map<string, Set<(s: Strip) => void>>();
let queue: Promise<unknown> = Promise.resolve(); // one decoder at a time keeps scrolling smooth

const THUMB_H = 72; // px, drawn at 2x the tallest row

function build(url: string): Promise<Strip | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    v.src = url;
    const fail = () => resolve(null);
    v.onerror = fail;
    v.onloadedmetadata = async () => {
      const dur = v.duration;
      if (!Number.isFinite(dur) || !v.videoWidth) return fail();
      const aspect = v.videoWidth / v.videoHeight;
      // About one frame a second, at most 90 frames per file.
      const step = Math.max(1, dur / 90);
      const canvas = document.createElement('canvas');
      canvas.height = THUMB_H;
      canvas.width = Math.round(THUMB_H * aspect);
      const ctx = canvas.getContext('2d');
      if (!ctx) return fail();
      const frames: string[] = [];
      const strip: Strip = { step, frames, aspect };
      for (let t = 0; t < dur; t += step) {
        await new Promise<void>((done) => {
          const timer = setTimeout(done, 1500);
          v.onseeked = () => { clearTimeout(timer); done(); };
          v.currentTime = Math.min(dur - 0.05, t + 0.01);
        });
        try {
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          frames.push(canvas.toDataURL('image/jpeg', 0.6));
        } catch {
          return fail(); // cross-origin footage without CORS: no thumbnails, clips stay plain
        }
        // Show what we have so far while the rest decodes.
        if (frames.length % 8 === 1) { cache.set(url, { ...strip, frames: [...frames] }); listeners.get(url)?.forEach((f) => f(cache.get(url)!)); }
      }
      v.removeAttribute('src');
      v.load();
      resolve(strip);
    };
  });
}

export function useFilmstrip(url: string | undefined): Strip | null {
  const [strip, setStrip] = useState<Strip | null>(() => (url ? cache.get(url) ?? null : null));
  useEffect(() => {
    if (!url || typeof document === 'undefined') return;
    const set = (s: Strip) => setStrip(s);
    if (!listeners.has(url)) listeners.set(url, new Set());
    listeners.get(url)!.add(set);
    if (cache.has(url)) setStrip(cache.get(url)!);
    if (!pending.has(url)) {
      const p = (queue = queue.then(() => build(url))) as Promise<Strip | null>;
      pending.set(url, p);
      p.then((s) => { if (s) { cache.set(url, s); listeners.get(url)?.forEach((f) => f(s)); } });
    }
    return () => { listeners.get(url)?.delete(set); };
  }, [url]);
  return strip;
}
