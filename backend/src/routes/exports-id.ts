import path from 'node:path';
import { getJob } from '../lib/jobs';
import { EXPORTS, serveFile } from '../lib/storage';


// GET /api/exports/:jobId — the finished file from a render job, as a download.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = getJob(id);
  const r = job?.status === 'done' ? (job.result as { file: string; name: string; mime: string }) : null;
  if (!r) return new Response('This export is no longer available. Export again.', { status: 404 });
  const inline = new URL(request.url).searchParams.has('inline');
  return serveFile(path.join(EXPORTS, path.basename(r.file)), r.mime, request.headers.get('range'), {
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${r.name}"`,
  });
}
