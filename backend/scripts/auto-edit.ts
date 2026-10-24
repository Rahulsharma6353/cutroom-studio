// Usage: tsx scripts/auto-edit.ts <words.json> <mediaUrl> <template> <edits.json|-> <out.json>
// First cut with the same code the app uses, then optional chat edits [{start,end,prompt}],
// written out as an export request body.
import { readFileSync, writeFileSync } from 'node:fs';
import { firstCut } from '@shared/autoEdit';
import { planEdit } from '@shared/director-mock';
import { applyOps, timelineDuration, validateOps } from '@shared/ops';
import type { Asset } from '@shared/types';

const [wordsFile, url, template, editsFile, out, request, facesFile, aspect] = process.argv.slice(2);
const media = JSON.parse(readFileSync(wordsFile, 'utf8'));
const faces = facesFile ? JSON.parse(readFileSync(facesFile, 'utf8')) : undefined;
const aroll: Asset = { id: 'a_main', name: 'Main take', kind: 'aroll', origin: 'upload', duration: media.duration, url, hue: 30, faces };
const cut = firstCut({ aroll, words: media.words, pauses: media.pauses, duration: media.duration, aspect: (aspect || '9:16') as never, template, request: request || undefined });
let state = { clips: cut.clips, words: cut.words, pauses: cut.pauses, captions: cut.captions };
const assets = [aroll, ...cut.assets];
console.log('first cut:', cut.summary);
const edits: { start: number; end: number; prompt: string }[] = editsFile && editsFile !== '-' ? JSON.parse(readFileSync(editsFile, 'utf8')) : [];
for (const e of edits) {
  const dur = timelineDuration(state.clips);
  const sel = { start: e.start, end: e.end };
  const plan = planEdit({ prompt: e.prompt, selection: sel, duration: dur, context: { words: state.words, pauses: state.pauses, clips: state.clips, aspect: '9:16' } });
  const res = applyOps(state, validateOps(plan.ops, sel, dur), `cs_${e.start}`);
  state = { clips: res.clips, words: res.words, pauses: res.pauses, captions: res.captions };
  assets.push(...res.assets);
  console.log(`edit ${e.start}-${e.end} "${e.prompt}":`, plan.summary || plan.reply);
}
const duration = timelineDuration(state.clips);
writeFileSync(out, JSON.stringify({ title: 'Edit test', aspect: aspect || '9:16', ...state, assets, look: cut.look, format: 'MP4 (H.264)', res: '1080p', fps: 30, quality: 'High', range: null, duration }, null, 1));
console.log('clips:', state.clips.map((c) => `${c.trackId.slice(2)}@${c.start.toFixed(2)}+${c.duration.toFixed(2)}${c.graphic ? ' ' + c.graphic.component : ''}`).join(', '));
