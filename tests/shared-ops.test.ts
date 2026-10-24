import assert from 'node:assert/strict';
import test from 'node:test';
import { applyOps, timelineDuration, TRACK_IDS, type TimelineState } from '../shared/src/ops';
import { captionsFromPreset } from '../shared/src/sample';
import type { EditOp } from '../shared/src/types';

function timeline(): TimelineState {
  return {
    clips: [{ id: 'speech', trackId: TRACK_IDS.aroll, assetId: 'source', label: 'Speech', start: 0, duration: 12, in: 0, status: 'ready', hue: 0 }],
    words: [
      { id: 'before', t: 1, d: 0.25, w: 'Before' },
      { id: 'cut-one', t: 3, d: 0.25, w: 'Cut' },
      { id: 'cut-two', t: 6, d: 0.25, w: 'Cut' },
      { id: 'after', t: 8, d: 0.25, w: 'After' },
      { id: 'later', t: 10, d: 0.25, w: 'Later' },
    ],
    pauses: [{ t: 1.5, d: 0.25 }, { t: 3.5, d: 0.25 }, { t: 8.5, d: 0.25 }],
    captions: captionsFromPreset('minimal', true),
  };
}

const ranges = [
  { name: 'overlapping', cuts: [{ start: 4, end: 7 }, { start: 2, end: 5 }] },
  { name: 'nested', cuts: [{ start: 2, end: 7 }, { start: 3, end: 4 }] },
  { name: 'touching', cuts: [{ start: 4, end: 7 }, { start: 2, end: 4 }] },
];

for (const { name, cuts } of ranges) {
  test(`${name} ripple ranges delete their union and preserve surrounding speech`, () => {
    const ops: EditOp[] = cuts.map((cut) => ({ op: 'ripple_delete', ...cut }));
    const result = applyOps(timeline(), ops, 'change');

    assert.equal(timelineDuration(result.clips), 7);
    assert.deepEqual(result.clips.map(({ start, duration, in: sourceIn }) => ({ start, duration, sourceIn })), [
      { start: 0, duration: 2, sourceIn: 0 },
      { start: 2, duration: 5, sourceIn: 7 },
    ]);
    assert.deepEqual(result.words, [
      { id: 'before', t: 1, d: 0.25, w: 'Before' },
      { id: 'after', t: 3, d: 0.25, w: 'After' },
      { id: 'later', t: 5, d: 0.25, w: 'Later' },
    ]);
    assert.deepEqual(result.pauses, [{ t: 1.5, d: 0.25 }, { t: 3.5, d: 0.25 }]);
    assert.deepEqual(ops, cuts.map((cut) => ({ op: 'ripple_delete', ...cut })));
  });

  test(`${name} ripple ranges map insert and zoom times through their union`, () => {
    const ops: EditOp[] = [
      { op: 'insert_clip', trackKind: 'broll', start: 8, duration: 2, label: 'After cut', assetKind: 'broll', origin: 'stock' },
      ...cuts.map((cut): EditOp => ({ op: 'ripple_delete', ...cut })),
      { op: 'insert_clip', trackKind: 'overlay', start: 1, duration: 8, label: 'Across cut', assetKind: 'graphic', origin: 'generated' },
      { op: 'insert_clip', trackKind: 'sfx', start: 6, duration: 0.5, label: 'Inside cut', assetKind: 'sfx', origin: 'library' },
      { op: 'set_zoom', start: 8, end: 10, zoom: 1.2 },
    ];
    const result = applyOps(timeline(), ops, 'change');

    assert.deepEqual(result.clips.filter((clip) => clip.trackId !== TRACK_IDS.aroll).map(({ label, start, duration }) => ({ label, start, duration })), [
      { label: 'After cut', start: 3, duration: 2 },
      { label: 'Across cut', start: 1, duration: 3 },
      { label: 'Inside cut', start: 2, duration: 0.5 },
    ]);
    assert.deepEqual(result.clips.filter((clip) => clip.zoom === 1.2).map(({ start, duration, in: sourceIn }) => ({ start, duration, sourceIn })), [
      { start: 3, duration: 2, sourceIn: 8 },
    ]);
  });
}

test('separate ripple ranges preserve speech between the cuts', () => {
  const state = timeline();
  state.words.push({ id: 'between', t: 5, d: 0.25, w: 'Between' });
  const result = applyOps(state, [
    { op: 'ripple_delete', start: 6, end: 7 },
    { op: 'ripple_delete', start: 2, end: 4 },
    { op: 'insert_clip', trackKind: 'broll', start: 8, duration: 2, label: 'After both', assetKind: 'broll', origin: 'stock' },
  ], 'change');

  assert.equal(timelineDuration(result.clips), 9);
  assert.deepEqual(result.words, [
    { id: 'before', t: 1, d: 0.25, w: 'Before' },
    { id: 'after', t: 5, d: 0.25, w: 'After' },
    { id: 'later', t: 7, d: 0.25, w: 'Later' },
    { id: 'between', t: 3, d: 0.25, w: 'Between' },
  ]);
  assert.deepEqual(result.clips.filter((clip) => clip.trackId === TRACK_IDS.aroll).map(({ start, duration, in: sourceIn }) => ({ start, duration, sourceIn })), [
    { start: 0, duration: 2, sourceIn: 0 },
    { start: 2, duration: 2, sourceIn: 4 },
    { start: 4, duration: 5, sourceIn: 7 },
  ]);
  assert.deepEqual(result.clips.filter((clip) => clip.trackId === TRACK_IDS.broll).map(({ start, duration }) => ({ start, duration })), [
    { start: 5, duration: 2 },
  ]);
});
