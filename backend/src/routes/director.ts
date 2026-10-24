import { direct } from '../lib/director';
import type { DirectorRequest } from '@shared/types';


export async function POST(request: Request) {
  let body: DirectorRequest;
  try {
    body = (await request.json()) as DirectorRequest;
  } catch {
    return Response.json({ error: 'That request couldn’t be read. Try again.' }, { status: 400 });
  }
  if (!body?.prompt || typeof body.duration !== 'number') {
    return Response.json({ error: 'Describe the change you want.' }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    // No key configured: the client falls back to its local planner.
    return Response.json({ error: 'Editor is offline.' }, { status: 503 });
  }
  try {
    return Response.json(await direct(body));
  } catch (err) {
    // Log internally; never leak provider or model details to the browser.
    console.error('[director]', err);
    return Response.json({ error: 'Couldn’t plan that change. Try again or rephrase.' }, { status: 502 });
  }
}
