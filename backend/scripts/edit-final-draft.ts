// Builds the "final_draft" edit: Pixel talk captions, brand UI cards, pages scene, sound design.
// Usage: tsx scripts/edit-final-draft.ts <words.json> <faces.json> <mediaUrl> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { captionsFromPreset, TEMPLATES } from '@shared/sample';
import type { Asset, Clip, GraphicSpec, Word } from '@shared/types';
import { pixelPhrases } from '@shared/frame/Frame';

const [wordsFile, facesFile, url, out] = process.argv.slice(2);
const media = JSON.parse(readFileSync(wordsFile, 'utf8')) as { duration: number; words: Word[] };
const faces = JSON.parse(readFileSync(facesFile, 'utf8'));
const words = media.words.map((w) => ({ ...w }));
// Sentence case for caption display.
const recase: Record<number, string> = { 31: 'they', 102: 'Whatever', 114: 'build', 121: 'Because' };
for (const [i, v] of Object.entries(recase)) words[Number(i)].w = v;

const DUR = 52.83;
const SHOTS = [0, 8.833, 11.6, 17.167, 23.167, 29.433, 32.133, 37.3, 42.567, 46.033, DUR];
const aroll: Asset = { id: 'a_draft', name: 'final_draft.mp4', kind: 'aroll', origin: 'upload', duration: DUR, url, hue: 200, faces };

let n = 0;
const id = (p: string) => `${p}${++n}`;
const clips: Clip[] = [];
for (let i = 0; i < SHOTS.length - 1; i++) {
  clips.push({ id: id('v'), trackId: 't-aroll', assetId: aroll.id, label: `Shot ${i + 1}`, start: SHOTS[i], duration: SHOTS[i + 1] - SHOTS[i], in: SHOTS[i], status: 'ready', hue: 200 });
}

const gfx = (label: string, start: number, end: number, graphic: GraphicSpec) =>
  clips.push({ id: id('g'), trackId: 't-overlay', label, start, duration: end - start, in: 0, status: 'ready', hue: 210, graphic });
const sfx = (label: string, t: number, d: number) =>
  clips.push({ id: id('s'), trackId: 't-sfx', label, start: Math.max(0, +t.toFixed(3)), duration: d, in: 0, status: 'ready', hue: 220 });

// 1 million vs 10K: two profile cards, one each side of the face.
gfx('1M creator', 0.9, 7.0, { component: 'UI', ui: 'profile', text: 'bigcreator', value: '1,000,000', place: 'left' });
gfx('10K creator', 3.2, 7.0, { component: 'UI', ui: 'profile', text: 'smallcreator', value: '10,000', place: 'right' });
// They see value / trust / money: notifications, each on its word.
gfx('Value, trust, money', 10.9, 14.0, { component: 'UI', ui: 'notify', text: 'they see', items: ['Value', 'Trust', 'Money'], times: [0.21, 1.14, 2.36], place: 'right' });
// Fluxpedia logo on "Fluxpedia".
gfx('Fluxpedia', 18.8, 19.85, { component: 'UI', ui: 'logo', text: 'Fluxpedia', place: 'right' });
// One channel, then media IPs.
// He sways right on "media IPs", so the network lands on the left as the single channel leaves the right.
gfx('One channel', 19.85, 21.5, { component: 'UI', ui: 'network', text: '', times: [0, 99], place: 'right' });
gfx('Media IPs', 21.72, 23.167, { component: 'UI', ui: 'network', variant: 'ips', text: '', times: [0, 0.45], place: 'left' });
// Black section: the pages scene, rows on the words that name them.
gfx('Pages', 23.167, 29.433, { component: 'UI', ui: 'pages', text: '', times: [0.05, 2.19, 4.3, 5.7] });
// You don't need millions of followers: card counts up, then gets crossed out.
gfx('Followers not required', 31.85, 34.75, { component: 'UI', ui: 'profile', text: 'yourpage', value: '1,000,000', strike: true, place: 'right' });
// You don't need every video to hit a million.
gfx('Not every reel hits 1M', 34.85, 37.25, { component: 'UI', ui: 'videos', text: 'Reels', strike: true, place: 'left' });
// Build some distribution of your own: growth.
gfx('Distribution growing', 46.5, 48.8, { component: 'UI', ui: 'chart', text: 'Accounts reached', value: '+312%', place: 'auto' });

// ---- Sound design, timed to what appears on screen ----
for (const t of SHOTS.slice(1, -1)) if (t !== 23.167 && t !== 29.433) sfx('Whoosh', t - 0.3, 0.75);
sfx('Riser', 21.95, 1.4);
sfx('Hit', 23.167, 0.5);
sfx('Whoosh', 29.13, 0.75);
for (const c of clips.filter((c) => c.trackId === 't-overlay')) {
  const g = c.graphic!;
  if (g.ui === 'pages') {
    (g.times ?? []).forEach((dt, i) => sfx(i < 3 ? 'Pop' : 'Click', c.start + dt, 0.14));
    continue;
  }
  if (g.ui === 'notify') { (g.times ?? []).forEach((dt) => sfx('Ding', c.start + dt, 0.6)); continue; }
  sfx('Pop', c.start, 0.14);
  if (g.ui === 'videos') for (let i = 0; i < 6; i++) sfx('Click', c.start + 0.2 + i * 0.12, 0.06);
  if (g.ui === 'network' && g.variant === 'ips') sfx('Whoosh', c.start + 0.3, 0.75);
  if (g.ui === 'chart') sfx('Riser', c.start + 0.2, 1.4);
  if (g.strike) sfx('Hit', c.start + (g.ui === 'videos' ? 0.3 + 6 * 0.12 + 0.45 : 1.6), 0.5);
}
// Captions: typing under big words, a pop when a blue box lands.
for (const p of pixelPhrases(words)) {
  if (p.big) {
    const len = p.big.w.replace(/\W/g, '').length;
    for (let i = 0; i < len; i += 2) sfx('Type', p.big.t + i * 0.045, 0.05);
  }
  p.boxed.forEach((w) => { if (w !== p.big) sfx('Pop', w.t, 0.14); });
}
clips.sort((a, b) => a.start - b.start);

const template = TEMPLATES.find((t) => t.id === 'pixel-talk')!;
const body = {
  title: 'final_draft edit', aspect: '4:3', clips, assets: [aroll], words, captions: captionsFromPreset('pixel', true), look: template.look,
  format: 'MP4 (H.264)', res: '1080p', fps: 30, quality: 'High', range: null, duration: DUR,
};
writeFileSync(out, JSON.stringify(body, null, 1));
const count = (k: string) => clips.filter((c) => c.trackId === k).length;
console.log(`shots ${count('t-aroll')}, graphics ${count('t-overlay')}, sfx ${count('t-sfx')}, phrases ${pixelPhrases(words).length}`);
