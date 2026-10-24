import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';
import type { AssetKind } from '@shared/types';
import { BACKEND_ROOT } from './paths';

/**
 * Local-disk storage. Same interface the S3/R2 adapter will implement:
 * put a stream, get a path or byte range, read/write a small JSON meta file.
 */
export const ROOT = path.resolve(process.env.STORAGE_DIR || path.join(BACKEND_ROOT, 'storage'));
const MEDIA = path.join(ROOT, 'media');
export const EXPORTS = path.join(ROOT, 'exports');

const ID = /^[a-z0-9_]{6,40}$/;
export const validId = (id: string) => ID.test(id);
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;

export interface MediaMeta {
  id: string;
  name: string;
  size: number;
  kind: AssetKind;
  mime: string;
  ext: string;
  createdAt: string;
  probe?: { duration: number; width?: number; height?: number; fps?: number; hasAudio: boolean };
  hasProxy?: boolean;
  hasAudio?: boolean;
}

export type Variant = 'original' | 'proxy' | 'audio';

export function mediaPath(id: string, variant: Variant, ext = 'bin'): string {
  if (!validId(id)) throw new Error('bad id');
  const file = variant === 'original' ? `original.${ext}` : variant === 'proxy' ? 'proxy.mp4' : 'audio.mp3';
  return path.join(MEDIA, id, file);
}

export async function saveUpload(body: ReadableStream<Uint8Array>, meta: Omit<MediaMeta, 'id' | 'size' | 'createdAt'>, maxBytes: number): Promise<MediaMeta> {
  const id = newId('m');
  const dir = path.join(MEDIA, id);
  await mkdir(dir, { recursive: true });
  const target = mediaPath(id, 'original', meta.ext);
  const tmp = `${target}.part`;
  let size = 0;
  const counter = async function* (src: AsyncIterable<Uint8Array>) {
    for await (const chunk of src) {
      size += chunk.byteLength;
      if (size > maxBytes) throw new Error('too large');
      yield chunk;
    }
  };
  await pipeline(Readable.fromWeb(body as never), counter, createWriteStream(tmp));
  await rename(tmp, target);
  const full: MediaMeta = { ...meta, id, size, createdAt: new Date().toISOString() };
  await writeMeta(full);
  return full;
}

export async function readMeta(id: string): Promise<MediaMeta | null> {
  if (!validId(id)) return null;
  try {
    return JSON.parse(await readFile(path.join(MEDIA, id, 'meta.json'), 'utf8')) as MediaMeta;
  } catch {
    return null;
  }
}

export async function writeMeta(meta: MediaMeta) {
  await writeFile(path.join(MEDIA, meta.id, 'meta.json'), JSON.stringify(meta, null, 2));
}

export async function ensureExports() {
  await mkdir(EXPORTS, { recursive: true });
  return EXPORTS;
}

/** Streams a file with HTTP Range support so video elements can seek. */
export async function serveFile(file: string, mime: string, range: string | null, extraHeaders: Record<string, string> = {}): Promise<Response> {
  let info;
  try {
    info = await stat(file);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const total = info.size;
  const base = { 'accept-ranges': 'bytes', 'content-type': mime, 'cache-control': 'private, max-age=3600', ...extraHeaders };
  const m = range?.match(/bytes=(\d*)-(\d*)/);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? parseInt(m[1], 10) : total - parseInt(m[2], 10);
    let end = m[1] && m[2] ? parseInt(m[2], 10) : total - 1;
    start = Math.max(0, start);
    end = Math.min(total - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${total}` } });
    const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers: { ...base, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${total}` } });
  }
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { status: 200, headers: { ...base, 'content-length': String(total) } });
}
