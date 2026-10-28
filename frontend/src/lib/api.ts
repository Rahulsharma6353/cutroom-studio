import type { AssetKind, FaceSample, Pause, Word, CalmSample } from '@shared/types';

/** Browser-side calls to our own API. The preview build has no server and skips all of this. */
export const online = () => typeof window !== 'undefined' && !window.__CUTROOM_OFFLINE__;

/** Studio passcode (when the server sets CUTROOM_PASSCODE): kept in this browser, sent with every call. */
const KEY = 'cutroom-key';
export const accessKey = () => { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } };
export const setAccessKey = (k: string) => { try { localStorage.setItem(KEY, k); } catch { /* private window: asked again next time */ } };
export const keyHeaders = (): Record<string, string> => (accessKey() ? { 'x-cutroom-key': accessKey() } : {});

/**
 * Uploads go straight to the API server (large files must not pass through the web server's
 * proxy, which buffers request bodies). Everything else uses same-origin /api, proxied.
 */
const UPLOAD_BASE = (process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:4000` : '')).replace(/\/$/, '');

export interface Uploaded {
  id: string;
  url: string;
  name: string;
  size: number;
  kind: AssetKind;
}

export function uploadFile(file: File, kind: AssetKind, onProgress?: (p: number) => void): Promise<Uploaded> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${UPLOAD_BASE}/api/upload`);
    xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
    xhr.setRequestHeader('x-file-kind', kind);
    if (accessKey()) xhr.setRequestHeader('x-cutroom-key', accessKey());
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      const body = JSON.parse(xhr.responseText || '{}');
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as Uploaded);
      else reject(new Error(body.error ?? 'Upload failed.'));
    };
    xhr.onerror = () => reject(new Error('The upload stopped. Check your connection and try again.'));
    xhr.send(file);
  });
}

export interface JobStatus<R = unknown> {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  steps: string[];
  step: number;
  progress: number;
  result?: R;
  error?: string;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...keyHeaders() }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong. Try again.');
  return json as T;
}

/** Polls a server job until it finishes, reporting each update. */
export async function waitForJob<R>(jobId: string, onUpdate: (j: JobStatus<R>) => void, signal?: AbortSignal): Promise<R> {
  for (;;) {
    if (signal?.aborted) throw new Error('cancelled');
    const res = await fetch(`/api/jobs/${jobId}`, { cache: 'no-store', headers: keyHeaders() });
    const j = (await res.json()) as JobStatus<R>;
    if (!res.ok) throw new Error(j.error ?? 'That task has expired.');
    onUpdate(j);
    if (j.status === 'done') return j.result as R;
    if (j.status === 'failed') throw new Error(j.error ?? 'That task failed.');
    await new Promise((r) => setTimeout(r, 700));
  }
}

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
  calm?: CalmSample[];
  hasVideo?: boolean;
}

export interface BrollAnalysis { duration: number; width?: number; height?: number; hasVideo: boolean; calm: CalmSample[]; faces?: FaceSample[] }

/** Deletes an upload on the server (best effort: a missing file is fine). */
export const deleteMedia = (id: string) => fetch(`/api/media/${id}`, { method: 'DELETE', headers: keyHeaders() }).then(() => undefined, () => undefined);

export const startAnalysis = (id: string, language = 'auto') => post<{ jobId: string; steps: string[] }>('/api/analyze', { id, language });
export const startBrollAnalysis = (id: string) => post<{ jobId: string; steps: string[] }>('/api/analyze', { id, light: true });
export const startExport = (body: unknown) => post<{ jobId: string; steps: string[] }>('/api/export', body);
