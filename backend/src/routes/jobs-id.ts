import { getJob } from '../lib/jobs';


// Progress for one job. Only user-facing fields: no provider, model or command details.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) return Response.json({ error: 'That task has expired. Start it again.' }, { status: 404 });
  return Response.json({
    id: job.id,
    status: job.status,
    steps: job.steps,
    step: job.step,
    progress: job.progress,
    result: job.status === 'done' ? job.result : undefined,
    error: job.status === 'failed' ? (job.type === 'render' ? 'The export stopped before it finished. Try again.' : 'We couldn’t read that footage. Try exporting it as MP4 and upload again.') : undefined,
  });
}
