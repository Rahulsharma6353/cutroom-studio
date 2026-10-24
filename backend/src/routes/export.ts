import { startPremiereExport } from '../lib/premiere';
import { FORMATS, startRender, type RenderRequest } from '../lib/render';

const PREMIERE = 'Premiere Pro project (.zip)';


const RES = ['720p', '1080p', '1440p', '4K'];
const FPS = [24, 25, 30, 60];

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as (Omit<RenderRequest, 'format'> & { format: string; folder?: string }) | null;
  if (!body?.clips?.length || !body.captions || !body.aspect) return Response.json({ error: 'There’s nothing on the timeline to export yet.' }, { status: 400 });
  const premiere = body.format === PREMIERE;
  if ((!premiere && !FORMATS.includes(body.format as RenderRequest['format'])) || !RES.includes(body.res) || !FPS.includes(body.fps)) {
    return Response.json({ error: 'Pick a format, resolution and frame rate from the list.' }, { status: 400 });
  }
  if (!(body.duration > 0) || body.duration > 60 * 30) return Response.json({ error: 'Exports are limited to 30 minutes.' }, { status: 400 });

  if (premiere) {
    // Premiere uses clip IDs as layer directory names. Reject path syntax and collisions
    // before enqueueing work, including collisions on case-insensitive filesystems.
    const ids = new Set<string>();
    if (!Array.isArray(body.clips) || body.clips.some((clip) => {
      const id = clip?.id;
      if (typeof id !== 'string' || id.length < 1 || id.length > 128 || /[^A-Za-z0-9_]/.test(id)) return true;
      const key = id.toLowerCase();
      if (ids.has(key)) return true;
      ids.add(key);
      return false;
    })) return Response.json({ error: 'Each clip needs a unique ID of up to 128 letters, numbers or underscores.' }, { status: 400 });
  }

  // Only media stored on this server can be rendered; browser-only files become placeholders.
  const assets = (body.assets ?? []).map((a) => (a.url?.startsWith('/api/media/') ? a : { ...a, url: undefined }));
  const origin = process.env.RENDER_MEDIA_ORIGIN || new URL(request.url).origin;
  const folder = typeof body.folder === 'string' ? body.folder.trim().slice(0, 300) : '';
  const job = premiere
    ? startPremiereExport({ ...body, assets, format: 'MP4 (H.264)' }, origin, folder)
    : startRender({ ...body, assets, format: body.format as RenderRequest['format'] }, origin);
  return Response.json({ jobId: job.id, steps: job.steps }, { status: 202 });
}
