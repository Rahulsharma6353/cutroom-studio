import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { uid } from '../shared/src/util';

// Hold the real render queue so route tests never launch a browser or write exports.
const queue = {
  jobs: new Map<string, unknown>(),
  waiting: { analyze: [] as unknown[], render: [] as unknown[] },
  running: { analyze: 0, render: 1 },
};
const globals = globalThis as typeof globalThis & { __cutroomQueue?: unknown };
const previousQueue = globals.__cutroomQueue;
let POST: typeof import('../backend/src/routes/export').POST;

before(async () => {
  globals.__cutroomQueue = queue;
  POST = (await import('../backend/src/routes/export')).POST;
});

beforeEach(() => {
  queue.jobs.clear();
  queue.waiting.render.length = 0;
});

after(() => {
  if (previousQueue === undefined) delete globals.__cutroomQueue;
  else globals.__cutroomQueue = previousQueue;
});

function exportRequest(ids: unknown[], format = 'Premiere Pro project (.zip)') {
  return new Request('http://localhost:3001/api/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Export validation',
      clips: ids.map((id) => ({ id, trackId: 't-overlay', label: 'Title', start: 0, duration: 1, in: 0, status: 'ready', hue: 0 })),
      assets: [], words: [], captions: { enabled: false }, aspect: '16:9',
      format, res: '720p', fps: 24, duration: 1, quality: 'Draft', range: null,
    }),
  });
}

for (const id of ['x/../../outside', 'x\\..\\..\\outside', '../outside', '..\\outside', '.', '..', '/absolute', 'C:\\outside', 'clip/child', 'clip\\child']) {
  test(`Premiere rejects path-like clip ID ${JSON.stringify(id)} before queuing an export`, async () => {
    const response = await POST(exportRequest([id]));
    assert.equal(response.status, 400);
    assert.equal(queue.jobs.size, 0);
    assert.equal(queue.waiting.render.length, 0);
  });
}

for (const id of ['', null, 123, {}, 'c_' + 'a'.repeat(127)]) {
  test(`Premiere rejects malformed clip ID ${JSON.stringify(id)} before queuing an export`, async () => {
    const response = await POST(exportRequest([id]));
    assert.equal(response.status, 400);
    assert.equal(queue.jobs.size, 0);
  });
}

test('Premiere rejects duplicate clip IDs before creating colliding graphic directories', async () => {
  const response = await POST(exportRequest(['c_same', 'c_same']));
  assert.equal(response.status, 400);
  assert.equal(queue.jobs.size, 0);
});

test('Premiere rejects clip IDs that collide on case-insensitive filesystems', async () => {
  const response = await POST(exportRequest(['c_Same', 'c_same']));
  assert.equal(response.status, 400);
  assert.equal(queue.jobs.size, 0);
});

test('Premiere accepts unique app-generated clip IDs', async () => {
  const response = await POST(exportRequest([uid('c'), uid('c')]));
  assert.equal(response.status, 202);
  const body = await response.json() as { jobId: string };
  assert.equal(typeof body.jobId, 'string');
  assert.equal(queue.jobs.has(body.jobId), true);
  assert.equal(queue.waiting.render.length, 1);
});

test('Premiere accepts bounded letter, digit and underscore IDs', async () => {
  const response = await POST(exportRequest(['c_Layer123', 'c_' + 'a'.repeat(126)]));
  assert.equal(response.status, 202);
});

test('ordinary video export remains available', async () => {
  const response = await POST(exportRequest([uid('c')], 'MP4 (H.264)'));
  assert.equal(response.status, 202);
  assert.equal(queue.waiting.render.length, 1);
});
