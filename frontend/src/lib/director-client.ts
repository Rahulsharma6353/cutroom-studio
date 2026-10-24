import { keyHeaders } from './api';
import { planEdit } from '@shared/director-mock';
import type { DirectorRequest, DirectorResponse } from '@shared/types';

declare global {
  interface Window {
    __CUTROOM_OFFLINE__?: boolean;
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Asks the editor for a plan. The browser only ever talks to our own API route;
 * which model answers is a server-side detail the user never sees.
 */
export async function askDirector(req: DirectorRequest): Promise<DirectorResponse> {
  if (typeof window !== 'undefined' && window.__CUTROOM_OFFLINE__) {
    await wait(700 + Math.random() * 500);
    return planEdit(req);
  }
  try {
    const res = await fetch('/api/director', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...keyHeaders() },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return (await res.json()) as DirectorResponse;
  } catch {
    // Keep the editor usable when the server is down; the plan stays local and reversible.
    await wait(400);
    return planEdit(req);
  }
}
