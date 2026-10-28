import { deleteMedia, mediaPath, readMeta, serveFile } from '../lib/storage';


// GET /api/media/:id?v=original|proxy|audio — proxy is the default for video once it exists.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const meta = await readMeta(id);
  if (!meta) return new Response('Not found', { status: 404 });
  const v = new URL(request.url).searchParams.get('v');
  const range = request.headers.get('range');
  if (v === 'audio' && meta.hasAudio) return serveFile(mediaPath(id, 'audio'), 'audio/mpeg', range);
  if ((v === 'proxy' || (!v && meta.mime.startsWith('video/'))) && meta.hasProxy) return serveFile(mediaPath(id, 'proxy'), 'video/mp4', range);
  return serveFile(mediaPath(id, 'original', meta.ext), meta.mime, range);
}

// DELETE /api/media/:id — called when a project is deleted, so its uploads don't pile up.
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!(await readMeta(id))) return new Response(null, { status: 204 });
  return (await deleteMedia(id)) ? new Response(null, { status: 204 }) : Response.json({ error: 'Bad id' }, { status: 400 });
}
