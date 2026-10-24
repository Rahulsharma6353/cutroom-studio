import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ASSETS } from './lib/paths';
import * as analyze from './routes/analyze';
import * as director from './routes/director';
import * as exportRoute from './routes/export';
import * as exportsId from './routes/exports-id';
import * as jobsId from './routes/jobs-id';
import * as mediaId from './routes/media-id';
import * as upload from './routes/upload';

/**
 * Cutroom API. Route handlers take a web Request and return a Response, so they stay
 * framework-agnostic; this file only wires them to paths.
 */
const app = new Hono();
const params = (id: string) => ({ params: Promise.resolve({ id }) });

app.use('/api/*', cors({ origin: (o) => o, allowHeaders: ['content-type', 'x-file-name', 'x-file-kind', 'x-cutroom-key', 'range'], exposeHeaders: ['content-range', 'accept-ranges', 'content-length', 'content-disposition'] }));

// Optional studio passcode: when CUTROOM_PASSCODE is set, anything that costs compute (upload,
// analysis, the AI editor, renders, job status) needs it. Media and finished files stay
// reachable by their unguessable ids, so <video> tags and the renderer work without headers.
const PASS = process.env.CUTROOM_PASSCODE?.trim();
const keyOk = (c: { req: { header: (n: string) => string | undefined } }) => !PASS || c.req.header('x-cutroom-key') === PASS;
app.use('/api/*', async (c, next) => {
  const open = c.req.method === 'OPTIONS' || c.req.path === '/api/health' || (c.req.method === 'GET' && /^\/api\/(media|exports)\//.test(c.req.path));
  if (!open && !keyOk(c)) return c.json({ error: 'This studio needs its passcode.' }, 401);
  await next();
});

app.post('/api/upload', (c) => upload.POST(c.req.raw));
app.post('/api/analyze', (c) => analyze.POST(c.req.raw));
app.post('/api/director', (c) => director.POST(c.req.raw));
app.post('/api/export', (c) => exportRoute.POST(c.req.raw));
app.get('/api/jobs/:id', (c) => jobsId.GET(c.req.raw, params(c.req.param('id'))));
app.get('/api/media/:id', (c) => mediaId.GET(c.req.raw, params(c.req.param('id'))));
app.get('/api/exports/:id', (c) => exportsId.GET(c.req.raw, params(c.req.param('id'))));
app.get('/api/health', (c) => c.json({ ok: true, locked: !keyOk(c) }));

// Brand marks and sound effects: the renderer loads them from here, the editor through its proxy.
const MIME: Record<string, string> = { '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.jpg': 'image/jpeg' };
app.get('/:dir{(sfx|brand)}/:file', async (c) => {
  const file = path.join(ASSETS, c.req.param('dir'), path.basename(c.req.param('file')));
  try {
    await stat(file);
  } catch {
    return c.notFound();
  }
  return new Response(await readFile(file), { headers: { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'public, max-age=86400' } });
});

const port = Number(process.env.PORT) || 4000;
serve({ fetch: app.fetch, port, hostname: process.env.HOST || '0.0.0.0' }, (info) => {
  // The renderer fetches media and assets from this server.
  process.env.RENDER_MEDIA_ORIGIN ||= `http://127.0.0.1:${info.port}`;
  console.log(`Cutroom API on http://localhost:${info.port}`);
});
