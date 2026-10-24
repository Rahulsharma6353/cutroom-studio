import { planEdit } from './director-mock';
import { applyOps, TRACK_IDS, timelineDuration, validateOps } from './ops';
import { captionsFromPreset, TEMPLATES } from './sample';
import type { AspectRatio, Asset, CaptionSettings, Clip, Look, Pause, Template, Word } from './types';
import { uid } from './util';

/** One A-roll clip per sentence (split at the middle of each pause), so the first cut already reads as an edit. */
export function baseTimeline(aroll: Asset, pauses: Pause[], dur: number, words: Word[] = []): Clip[] {
  const clips: Clip[] = [];
  let start = 0;
  const cuts = pauses.map((p) => p.t + p.d / 2);
  // Takes without pauses still get a cut at each sentence end, for jump cuts and alternate punch-ins.
  words.forEach((w, i) => {
    const next = words[i + 1];
    if (!next || !/[.!?]$/.test(w.w)) return;
    const at = (w.t + w.d + next.t) / 2;
    if (!cuts.some((c) => Math.abs(c - at) < 0.4)) cuts.push(at);
  });
  const bounds = [...cuts.sort((a, b) => a - b).filter((b) => b > 0.05 && b < dur - 0.05), dur];
  bounds.forEach((end) => {
    clips.push({ id: uid('c'), trackId: TRACK_IDS.aroll, assetId: aroll.id, label: aroll.name, start, duration: end - start, in: start, status: 'ready', hue: aroll.hue });
    start = end;
  });
  return clips;
}

export interface FirstCut {
  clips: Clip[];
  words: Word[];
  pauses: Pause[];
  captions: CaptionSettings;
  look: Look;
  assets: Asset[];
  summary: string;
  duration: number;
}

/**
 * The template's first cut, usable in the browser and on the server.
 * `request` overrides the template's own first-pass recipe.
 */
export function firstCut(opts: { aroll: Asset; words: Word[]; pauses: Pause[]; duration: number; aspect: AspectRatio; template: Template | string; request?: string }): FirstCut {
  const template = typeof opts.template === 'string' ? TEMPLATES.find((t) => t.id === opts.template) ?? TEMPLATES[0] : opts.template;
  const clips = baseTimeline(opts.aroll, opts.pauses, opts.duration, opts.words);
  const before = { clips, words: opts.words, pauses: opts.pauses, captions: captionsFromPreset(template.captionPreset, true) };
  const plan = planEdit({ prompt: opts.request ?? template.firstPass, selection: null, duration: opts.duration, context: { words: opts.words, pauses: opts.pauses, clips, aspect: opts.aspect } });
  const out = applyOps(before, validateOps(plan.ops, null, opts.duration), uid('cs'));
  return {
    clips: out.clips, words: out.words, pauses: out.pauses,
    captions: { ...captionsFromPreset(template.captionPreset, true) },
    look: template.look,
    assets: out.assets,
    summary: plan.summary,
    duration: timelineDuration(out.clips),
  };
}
