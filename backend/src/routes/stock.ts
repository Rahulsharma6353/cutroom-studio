import { fetchStock, StockError, stockKey, type Orientation } from '../lib/stock';

const ORIENT: Orientation[] = ['portrait', 'landscape', 'square'];

/** POST {query, orientation, minDuration?, exclude?} → a stored stock clip, or {error, code}. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { query?: string; orientation?: string; minDuration?: number; exclude?: number[] } | null;
  if (!body?.query || typeof body.query !== 'string') return Response.json({ error: 'Say what the B-roll should show.' }, { status: 400 });
  const orientation = ORIENT.includes(body.orientation as Orientation) ? (body.orientation as Orientation) : 'portrait';
  const exclude = Array.isArray(body.exclude) ? body.exclude.filter((n) => Number.isInteger(n)).slice(0, 200) : [];
  try {
    const r = await fetchStock({ query: body.query, orientation, minDuration: Math.max(0, Math.min(30, Number(body.minDuration) || 0)), exclude });
    return Response.json(r);
  } catch (err) {
    const e = err instanceof StockError ? err : new StockError('failed', 'Stock search failed. Check the internet connection.');
    return Response.json({ error: e.message, code: e.code }, { status: e.code === 'no-key' ? 503 : e.code === 'not-found' ? 404 : 502 });
  }
}

export const stockReady = () => !!stockKey();
