import { generateImage, ImageError, imageKey, type Shape } from '../lib/imagegen';

const SHAPES: Shape[] = ['portrait', 'landscape', 'square'];

/** POST {prompt, shape, label} → a stored AI image, or {error, code}. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { prompt?: string; shape?: string; label?: string } | null;
  if (!body?.prompt || typeof body.prompt !== 'string') return Response.json({ error: 'Describe the picture.' }, { status: 400 });
  const shape = SHAPES.includes(body.shape as Shape) ? (body.shape as Shape) : 'portrait';
  try {
    return Response.json(await generateImage(body.prompt, shape, String(body.label ?? 'image')));
  } catch (err) {
    const e = err instanceof ImageError ? err : new ImageError('failed', 'Image generation failed. Check the internet connection.');
    return Response.json({ error: e.message, code: e.code }, { status: e.code === 'no-key' ? 503 : e.code === 'refused' ? 422 : 502 });
  }
}

export const imagesReady = () => !!imageKey();
