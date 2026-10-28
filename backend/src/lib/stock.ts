import { probe } from './ffmpeg';
import { mediaPath, saveUpload, writeMeta } from './storage';

/**
 * Stock B-roll from Pexels (free API key: https://www.pexels.com/api/).
 * Search by the words on screen, pick a clip in the project's shape, and store it like an upload,
 * so preview, render and the Premiere export treat it exactly like the user's own footage.
 */
const API = process.env.PEXELS_API_BASE || 'https://api.pexels.com';
const MAX_BYTES = 400 * 1024 ** 2;

export type Orientation = 'portrait' | 'landscape' | 'square';

export interface StockResult {
  id: string;
  url: string;
  name: string;
  duration: number;
  width?: number;
  height?: number;
  credit: string;
  pexelsId: number;
}

interface PexelsFile { id: number; quality: string | null; file_type: string; width: number | null; height: number | null; link: string }
interface PexelsVideo { id: number; width: number; height: number; duration: number; url: string; user?: { name?: string }; video_files: PexelsFile[] }

export class StockError extends Error {
  constructor(public code: 'no-key' | 'not-found' | 'failed', message: string) { super(message); }
}

export const stockKey = () => process.env.PEXELS_API_KEY?.trim() || '';

/** The file closest to 1080 on the short side, never above 4K: sharp enough, quick to download. */
function pickFile(v: PexelsVideo): PexelsFile | null {
  const mp4 = v.video_files.filter((f) => f.file_type === 'video/mp4' && f.width && f.height && (f.link.startsWith('https://') || !!process.env.PEXELS_API_BASE));
  if (!mp4.length) return null;
  const short = (f: PexelsFile) => Math.min(f.width!, f.height!);
  return mp4.filter((f) => Math.max(f.width!, f.height!) <= 3840).sort((a, b) => Math.abs(short(a) - 1080) - Math.abs(short(b) - 1080))[0] ?? null;
}

async function search(query: string, orientation: Orientation, key: string): Promise<PexelsVideo[]> {
  const u = new URL('/videos/search', API);
  u.searchParams.set('query', query);
  u.searchParams.set('orientation', orientation);
  u.searchParams.set('per_page', '15');
  const res = await fetch(u, { headers: { Authorization: key }, signal: AbortSignal.timeout(15000) });
  if (res.status === 401 || res.status === 403) throw new StockError('no-key', 'The Pexels API key was refused. Check PEXELS_API_KEY in backend/.env.');
  if (!res.ok) throw new StockError('failed', `Pexels answered ${res.status}.`);
  return ((await res.json()) as { videos?: PexelsVideo[] }).videos ?? [];
}

export async function fetchStock(opts: { query: string; orientation: Orientation; minDuration: number; exclude: number[] }): Promise<StockResult> {
  const key = stockKey();
  if (!key) throw new StockError('no-key', 'Stock B-roll needs a free Pexels API key. Add PEXELS_API_KEY to backend/.env and restart.');
  const query = opts.query.replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'technology';
  let videos = await search(query, opts.orientation, key);
  // Two-word queries can be too narrow: fall back to the longest single word.
  if (!videos.length && query.includes(' ')) videos = await search(query.split(' ').sort((a, b) => b.length - a.length)[0], opts.orientation, key);
  const fresh = videos.filter((v) => !opts.exclude.includes(v.id));
  const pool = (fresh.length ? fresh : videos).filter((v) => v.duration >= Math.min(opts.minDuration, 4));
  const pick = (pool.length ? pool : videos).find((v) => pickFile(v));
  if (!pick) throw new StockError('not-found', `No stock footage for “${query}”.`);
  const file = pickFile(pick)!;

  const dl = await fetch(file.link, { signal: AbortSignal.timeout(120000) });
  if (!dl.ok || !dl.body) throw new StockError('failed', 'The stock clip didn’t download.');
  const name = `${query} (Pexels ${pick.id}).mp4`;
  const meta = await saveUpload(dl.body, { name, kind: 'broll', mime: 'video/mp4', ext: 'mp4' }, MAX_BYTES);
  let duration = pick.duration;
  let width = file.width ?? pick.width;
  let height = file.height ?? pick.height;
  try {
    const p = await probe(mediaPath(meta.id, 'original', 'mp4'));
    duration = p.duration || duration;
    width = p.width ?? width;
    height = p.height ?? height;
    await writeMeta({ ...meta, probe: { duration, width, height, hasAudio: p.hasAudio } });
  } catch { /* the Pexels numbers are good enough */ }
  const credit = `Video by ${pick.user?.name || 'a Pexels creator'} on Pexels`;
  return { id: meta.id, url: `/api/media/${meta.id}`, name, duration, width, height, credit, pexelsId: pick.id };
}
