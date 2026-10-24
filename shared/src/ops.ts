import type { Asset, CaptionSettings, Clip, EditOp, Job, Pause, Selection, TrackKind, Word } from './types';
import { captionsFromPreset } from './sample';
import { hashHue, uid } from './util';

export const TRACK_IDS: Record<TrackKind, string> = {
  overlay: 't-overlay',
  broll: 't-broll',
  aroll: 't-aroll',
  captions: 't-captions',
  sfx: 't-sfx',
  music: 't-music',
  plate: 't-plate',
  look: 't-look',
  labels: 't-labels',
  setup: 't-setup',
  key: 't-key',
};

const EPS = 0.02;

/**
 * Server-side guard (also run on the client): drops or clamps any op that reaches
 * outside the user's selection, so a bad AI answer can never touch the rest of the edit.
 */
export function validateOps(ops: EditOp[], selection: Selection | null, duration: number): EditOp[] {
  const lo = selection ? selection.start : 0;
  const hi = selection ? selection.end : duration;
  const out: EditOp[] = [];
  for (const op of ops) {
    switch (op.op) {
      case 'insert_clip': {
        const start = Math.max(lo, op.start);
        const end = Math.min(hi, op.start + op.duration);
        if (end - start < 0.2) continue;
        out.push({ ...op, start, duration: end - start });
        break;
      }
      case 'ripple_delete':
      case 'set_zoom': {
        const start = Math.max(lo, op.start);
        const end = Math.min(hi, op.end);
        if (end - start < 0.05) continue;
        out.push({ ...op, start, end });
        break;
      }
      default:
        // Caption style changes are project-wide by design; only allow them without a selection
        // or when the user explicitly asked about captions (the director decides that).
        out.push(op);
    }
  }
  return out;
}

export interface TimelineState {
  clips: Clip[];
  words: Word[];
  pauses: Pause[];
  captions: CaptionSettings;
}

export interface ApplyResult extends TimelineState {
  assets: Asset[];
  jobs: Job[];
}

function splitAt(clips: Clip[], t: number): Clip[] {
  const out: Clip[] = [];
  for (const c of clips) {
    if (t > c.start + EPS && t < c.start + c.duration - EPS && c.trackId === TRACK_IDS.aroll) {
      const leftDur = t - c.start;
      out.push({ ...c, duration: leftDur });
      out.push({ ...c, id: uid('c'), start: t, in: c.in + leftDur, duration: c.duration - leftDur });
    } else out.push(c);
  }
  return out;
}

function rippleDelete(state: TimelineState, start: number, end: number): TimelineState {
  const len = end - start;
  const clips: Clip[] = [];
  for (const c of state.clips) {
    const cs = c.start;
    const ce = c.start + c.duration;
    if (ce <= start + EPS) clips.push(c);
    else if (cs >= end - EPS) clips.push({ ...c, start: cs - len });
    else {
      if (cs < start) clips.push({ ...c, duration: start - cs });
      if (ce > end) {
        clips.push({ ...c, id: cs < start ? uid('c') : c.id, start, in: c.in + (end - cs), duration: ce - end });
      }
    }
  }
  const words = state.words
    .filter((w) => w.t < start - EPS || w.t >= end - EPS)
    .map((w) => (w.t >= end - EPS ? { ...w, t: w.t - len } : w));
  const pauses = state.pauses
    .filter((p) => p.t + p.d <= start + EPS || p.t >= end - EPS)
    .map((p) => (p.t >= end - EPS ? { ...p, t: p.t - len } : p));
  return { ...state, clips, words, pauses };
}

export function applyOps(state: TimelineState, ops: EditOp[], changeSetId: string): ApplyResult {
  let s: TimelineState = { ...state };
  const assets: Asset[] = [];
  const jobs: Job[] = [];

  // Delete the union of overlapping/touching ranges, and use that same union
  // when mapping later operations so no cut is counted more than once.
  const ranges = ops.filter((o): o is Extract<EditOp, { op: 'ripple_delete' }> => o.op === 'ripple_delete').sort((a, b) => a.start - b.start);
  const deletes: Selection[] = [];
  for (const range of ranges) {
    const previous = deletes[deletes.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else deletes.push({ start: range.start, end: range.end });
  }
  // Ripple deletes run from the end backwards so earlier coordinates stay valid.
  deletes.reverse();
  for (const d of deletes) s = rippleDelete(s, d.start, d.end);

  // Every op is planned against the timeline as it was before this change;
  // map its times through the cuts so inserts land on the same words afterwards.
  const map = (t: number) => {
    let shift = 0;
    for (const d of deletes) {
      if (t >= d.end) shift += d.end - d.start;
      else if (t > d.start) shift += t - d.start;
    }
    return t - shift;
  };

  for (const raw of ops) {
    let op = raw;
    if (op.op === 'insert_clip') {
      const a = map(op.start);
      const b = map(op.start + op.duration);
      // SFX keep their length; everything else follows the cut.
      const duration = op.trackKind === 'sfx' ? op.duration : b - a;
      if (duration < 0.15) continue;
      op = { ...op, start: a, duration };
    } else if (op.op === 'set_zoom') {
      op = { ...op, start: map(op.start), end: map(op.end) };
      if (op.end - op.start < 0.1) continue;
    }
    if (op.op === 'insert_clip') {
      const hue = hashHue(op.label);
      const assetId = uid('a');
      assets.push({ id: assetId, name: op.label, kind: op.assetKind, origin: op.origin, duration: op.duration, hue, credit: op.credit });
      const clipId = uid('c');
      let jobId: string | undefined;
      if (op.job) {
        jobId = uid('j');
        jobs.push({ id: jobId, type: op.job.type, label: op.label, progress: 0, eta: op.job.eta, clipId, status: 'queued' });
      }
      s.clips = [
        ...s.clips,
        {
          id: clipId,
          trackId: TRACK_IDS[op.trackKind],
          assetId,
          label: op.label,
          start: op.start,
          duration: op.duration,
          in: 0,
          status: op.job ? 'queued' : 'ready',
          jobId,
          changeSetId,
          graphic: op.graphic,
          hue,
        },
      ];
    } else if (op.op === 'set_zoom') {
      let clips = splitAt(s.clips, op.start);
      clips = splitAt(clips, op.end);
      s.clips = clips.map((c) =>
        c.trackId === TRACK_IDS.aroll && c.start >= op.start - EPS && c.start + c.duration <= op.end + EPS
          ? { ...c, zoom: op.zoom, changeSetId }
          : c,
      );
    } else if (op.op === 'set_caption_preset') {
      s.captions = captionsFromPreset(op.presetId, true);
    } else if (op.op === 'set_captions_enabled') {
      s.captions = { ...s.captions, enabled: op.enabled };
    }
  }
  return { ...s, assets, jobs };
}

export function timelineDuration(clips: Clip[]): number {
  return clips.filter((c) => c.trackId === TRACK_IDS.aroll).reduce((m, c) => Math.max(m, c.start + c.duration), 0);
}
