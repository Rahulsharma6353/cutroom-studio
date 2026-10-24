import { startAnalysis, startBrollAnalysis } from '../lib/analyze';
import { validId } from '../lib/storage';


export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { id?: string; light?: boolean } | null;
  if (!body?.id || !validId(body.id)) return Response.json({ error: 'Upload the footage first.' }, { status: 400 });
  try {
    const job = body.light ? await startBrollAnalysis(body.id) : await startAnalysis(body.id);
    return Response.json({ jobId: job.id, steps: job.steps }, { status: 202 });
  } catch {
    return Response.json({ error: 'That upload wasn’t found. Upload it again.' }, { status: 404 });
  }
}
