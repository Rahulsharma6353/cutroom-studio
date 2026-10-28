import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { useStore } from '../frontend/src/store/useStore';
import type { DirectorResponse, Project } from '../shared/src/types';

const originalFetch = globalThis.fetch;
let projectIds: [string, string];
let fixture = 0;

beforeEach(() => {
  projectIds = [`project-${++fixture}-a`, `project-${fixture}-b`];
  const projects: Project[] = projectIds.map((id) => ({
    id, title: id, aspect: '9:16', updated: 'Just now', status: 'Editing', hue: 120, duration: 40,
  }));
  useStore.setState({ ...useStore.getInitialState(), projects }, true);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Keep Zustand, the director client, validation, and timeline editing real. Only
// the server response is controlled so navigation can happen while it is pending.
function delayDirector() {
  let respond!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => { respond = resolve; });
  globalThis.fetch = async () => response;
  return (result: DirectorResponse) => respond(Response.json(result));
}

async function openProject(id: string) {
  const ready = new Promise<void>((resolve) => {
    const unsubscribe = useStore.subscribe((s) => {
      if (s.project?.id === id && s.changeSets.some((change) => change.prompt === 'First cut')) {
        unsubscribe();
        resolve();
      }
    });
  });
  useStore.getState().openProject(id);
  await ready;
}

function editorState() {
  const { project, clips, words, pauses, captions, assets, jobs, changeSets, messages, past, future, playhead } = useStore.getState();
  return { project, clips, words, pauses, captions, assets, jobs, changeSets, messages, past, future, playhead };
}

const edited: DirectorResponse = {
  reply: 'Added the requested image and hid captions.',
  summary: 'Added an image and hid captions',
  ops: [
    { op: 'set_captions_enabled', enabled: false },
    { op: 'insert_clip', trackKind: 'overlay', start: 1, duration: 2, label: 'Director image', assetKind: 'image', origin: 'generated', job: { type: 'image', eta: 5 } },
  ],
};

for (const [name, result] of [
  ['edits', edited],
  ['reply without edits', { reply: 'No changes needed.', summary: '', ops: [] }],
] as const) {
  test(`discards delayed ${name} after opening another project`, async () => {
    await openProject(projectIds[0]);
    const respond = delayDirector();
    const pending = useStore.getState().sendPrompt('Add an image and turn captions off');
    await openProject(projectIds[1]);
    const before = editorState();

    respond(result);
    await pending;

    assert.ok(isDeepStrictEqual(editorState(), before), 'a response for project A must leave project B untouched');
    assert.equal(useStore.getState().thinking, false);
  });
}

test('discards a delayed response after leaving and returning to the same project', async () => {
  await openProject(projectIds[0]);
  const respond = delayDirector();
  const pending = useStore.getState().sendPrompt('Add an image and turn captions off');
  useStore.getState().go('dashboard');
  await openProject(projectIds[1]);
  useStore.getState().go('dashboard');
  await openProject(projectIds[0]);
  const before = editorState();

  respond(edited);
  await pending;

  assert.ok(isDeepStrictEqual(editorState(), before), 'returning to A must not revive its obsolete request');
  assert.equal(useStore.getState().thinking, false);
});

test('applies a successful response while its project remains open', async () => {
  await openProject(projectIds[0]);
  const respond = delayDirector();
  const before = editorState();
  const pending = useStore.getState().sendPrompt('Add an image and turn captions off');
  assert.equal(useStore.getState().thinking, true);

  respond(edited);
  await pending;

  const after = useStore.getState();
  assert.equal(after.project?.id, projectIds[0]);
  assert.equal(after.captions.enabled, false);
  assert.equal(after.clips.filter((clip) => clip.label === 'Director image').length, 1);
  assert.equal(after.assets.length, before.assets.length + 1);
  assert.equal(after.jobs.length, before.jobs.length + 1);
  assert.equal(after.changeSets.at(-1)?.summary, 'Added an image and hid captions');
  assert.equal(after.messages.at(-1)?.text, 'Added the requested image and hid captions.');
  assert.equal(after.past.length, before.past.length + 1);
  assert.equal(after.thinking, false);
});

test('an older response cannot alter a newer pending request in the same project', async () => {
  await openProject(projectIds[0]);
  const respondOld = delayDirector();
  const oldRequest = useStore.getState().sendPrompt('Add an image and turn captions off');
  const respondNew = delayDirector();
  const newRequest = useStore.getState().sendPrompt('Keep the current edit');
  const before = editorState();

  respondOld(edited);
  await oldRequest;

  assert.ok(isDeepStrictEqual(editorState(), before), 'an older response must not alter the current edit');
  assert.equal(useStore.getState().thinking, true, 'the newer request is still pending');
  respondNew({ reply: 'Kept the current edit.', summary: '', ops: [] });
  await newRequest;
  assert.equal(useStore.getState().messages.at(-1)?.text, 'Kept the current edit.');
  assert.equal(useStore.getState().thinking, false);
});

test('deleteProject removes it from the library and leaves the editor if it was open', () => {
  const [a, b] = projectIds;
  useStore.setState({ project: useStore.getState().projects.find((p) => p.id === a)!, view: 'editor' });
  useStore.getState().deleteProject(a);
  const s = useStore.getState();
  assert.deepEqual(s.projects.map((p) => p.id), [b]);
  assert.equal(s.project, null);
  assert.equal(s.view, 'dashboard');
  useStore.getState().deleteProject(b);
  assert.equal(useStore.getState().projects.length, 0);
});
