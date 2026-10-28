import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

// Real storage in a throwaway folder: deleting a project removes its uploads, and ids can't escape.
let dir: string;
let storage: typeof import('../backend/src/lib/storage');
let route: typeof import('../backend/src/routes/media-id');

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'cutroom-media-'));
  process.env.STORAGE_DIR = dir;
  storage = await import('../backend/src/lib/storage');
  route = await import('../backend/src/routes/media-id');
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });

test('DELETE /api/media/:id removes the upload and everything made from it', async () => {
  const body = new Blob(['not really video']).stream();
  const meta = await storage.saveUpload(body, { name: 'take.mp4', kind: 'aroll', mime: 'video/mp4', ext: 'mp4' } as never, 1024);
  const folder = path.dirname(storage.mediaPath(meta.id, 'original', meta.ext));
  await stat(folder);
  const res = await route.DELETE(new Request('http://x', { method: 'DELETE' }), params(meta.id));
  assert.equal(res.status, 204);
  await assert.rejects(stat(folder));
  assert.equal(await storage.readMeta(meta.id), null);
});

test('DELETE of an unknown id is a no-op, and bad ids never reach the filesystem', async () => {
  assert.equal((await route.DELETE(new Request('http://x', { method: 'DELETE' }), params('m_unknown123'))).status, 204);
  assert.equal(await storage.deleteMedia('../../etc'), false);
  assert.equal(await storage.deleteMedia('..'), false);
});
