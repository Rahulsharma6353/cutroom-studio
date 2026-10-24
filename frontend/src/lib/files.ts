import type { AssetKind } from '@shared/types';
import type { UploadedFile } from '../store/useStore';

export function guessKind(file: File, fallback: AssetKind = 'broll'): AssetKind {
  if (file.type.startsWith('audio/')) return 'music';
  if (file.type.startsWith('image/')) return 'image';
  if (/\.(docx?|txt|md|pdf)$/i.test(file.name)) return 'script';
  return fallback;
}

function readMeta(url: string, type: string): Promise<{ duration?: number; ratio?: number }> {
  return new Promise((resolve) => {
    if (!type.startsWith('video/') && !type.startsWith('audio/')) return resolve({});
    const el = document.createElement(type.startsWith('video/') ? 'video' : 'audio');
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      const v = el as HTMLVideoElement;
      resolve({ duration: Number.isFinite(el.duration) ? el.duration : undefined, ratio: v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : undefined });
    };
    el.onerror = () => resolve({});
    el.src = url;
  });
}

/** Reads files locally for instant preview; real uploads stream to storage in the background. */
export async function toUploaded(files: FileList | File[], kind?: AssetKind): Promise<UploadedFile[]> {
  return Promise.all(
    Array.from(files).map(async (f) => {
      const k = kind ?? guessKind(f, f.type.startsWith('video/') ? 'aroll' : 'broll');
      const url = f.type.startsWith('video/') || f.type.startsWith('image/') || f.type.startsWith('audio/') ? URL.createObjectURL(f) : undefined;
      const { duration, ratio } = url ? await readMeta(url, f.type) : {};
      return { file: f, name: f.name, size: f.size, kind: k, url, duration, ratio };
    }),
  );
}
