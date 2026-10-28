import { saveUpload, writeMeta } from './storage';

/**
 * AI image cutaways through any OpenAI-compatible /images/generations endpoint
 * (OpenAI gpt-image-1 by default). IMAGE_API_KEY turns it on.
 */
const BASE = (process.env.IMAGE_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const MODEL = process.env.IMAGE_MODEL || 'gpt-image-1';

export const imageKey = () => process.env.IMAGE_API_KEY?.trim() || '';

export class ImageError extends Error {
  constructor(public code: 'no-key' | 'refused' | 'failed', message: string) { super(message); }
}

export type Shape = 'portrait' | 'landscape' | 'square';

function sizeFor(shape: Shape) {
  if (MODEL.startsWith('dall-e-3')) return shape === 'portrait' ? '1024x1792' : shape === 'landscape' ? '1792x1024' : '1024x1024';
  return shape === 'portrait' ? '1024x1536' : shape === 'landscape' ? '1536x1024' : '1024x1024';
}

export async function generateImage(prompt: string, shape: Shape, label: string) {
  const key = imageKey();
  if (!key) throw new ImageError('no-key', 'AI images need IMAGE_API_KEY in backend/.env (an OpenAI API key works).');
  const body: Record<string, unknown> = { model: MODEL, prompt: prompt.slice(0, 1800), size: sizeFor(shape), n: 1 };
  if (MODEL.startsWith('dall-e')) body.response_format = 'b64_json';
  else if (MODEL.startsWith('gpt-image')) body.quality = process.env.IMAGE_QUALITY || 'medium';
  const res = await fetch(`${BASE}/images/generations`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: { b64_json?: string; url?: string }[]; error?: { message?: string } };
  if (res.status === 401 || res.status === 403) throw new ImageError('no-key', 'The image API key was refused. Check IMAGE_API_KEY in backend/.env.');
  if (res.status === 400 && /safety|policy|moderation/i.test(json.error?.message ?? '')) throw new ImageError('refused', 'The image service declined this line.');
  if (!res.ok) throw new ImageError('failed', `Image service answered ${res.status}${json.error?.message ? `: ${json.error.message}` : ''}`);
  const item = json.data?.[0];
  let bytes: Uint8Array | null = null;
  if (item?.b64_json) bytes = Buffer.from(item.b64_json, 'base64');
  else if (item?.url) { const r = await fetch(item.url, { signal: AbortSignal.timeout(60000) }); if (r.ok) bytes = new Uint8Array(await r.arrayBuffer()); }
  if (!bytes?.length) throw new ImageError('failed', 'The image service returned no picture.');
  const png = bytes[0] === 0x89 && bytes[1] === 0x50;
  const ext = png ? 'png' : 'jpg';
  const name = `${label.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'image'} (AI).${ext}`;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes!); c.close(); } });
  const meta = await saveUpload(stream, { name, kind: 'image', mime: png ? 'image/png' : 'image/jpeg', ext }, 50 * 1024 ** 2);
  const [w, h] = sizeFor(shape).split('x').map(Number);
  await writeMeta({ ...meta, probe: { duration: 0, width: w, height: h, hasAudio: false } });
  return { id: meta.id, url: `/api/media/${meta.id}`, name, width: w, height: h };
}
