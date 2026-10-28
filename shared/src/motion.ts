import type { GraphicSpec, Word } from './types';

/**
 * Motion-graphic B-roll: when there is no footage to cut away to, the line being spoken becomes a
 * full-frame animated card in the style's colours. A number becomes a counting stat, "A vs B" a
 * split, a run of short items a step list, anything else kinetic type with its key word lit up.
 */

const STOP = new Set(('a an the and or but so to of in on at for with that this it its is are was were be been being you your i my me we our they them he she his her will can could would should just not do does did have has had there here what which who when where why how than then also very really about into from up down out over more most some any all one get got go going like make made know think want need see look really actually basically literally take takes took thing things hai ka ki ke ko se mein aur ye wo toh bhi na').split(' '));

const clean = (w: string) => w.replace(/^[^\p{L}\p{N}$₹€£]+|[^\p{L}\p{N}%]+$/gu, '');
const title = (s: string) => (/[A-Z]/.test(s) ? s : s.charAt(0).toUpperCase() + s.slice(1));
const isNum = (w: string) => /\d/.test(w) && /^[$₹€£]?[\d,.]+[%kKmMbBx]?$/.test(clean(w));

function spoken(words: Word[], a: number, b: number): string[] {
  return words.filter((w) => !w.filler && w.t >= a - 0.05 && w.t < b).map((w) => clean(w.w)).filter(Boolean);
}

/** The words a viewer should read: the strongest run of up to 4 words inside one sentence (stopwords trimmed off the ends). */
function keyPhrase(raw: string[], max = 4): string {
  const content = (w: string) => w.length > 2 && !STOP.has(w.toLowerCase()) && !isNum(w);
  // Sentences: a run never crosses a full stop ("…picks the music. Second…").
  const sentences: string[][] = [[]];
  for (const r of raw) {
    const w = clean(r);
    if (w) sentences[sentences.length - 1].push(w);
    if (/[.!?…]["')\]]*$/.test(r)) sentences.push([]);
  }
  let best: string[] = [];
  let bestScore = 0;
  for (const ws of sentences) {
    for (let i = 0; i < ws.length; i++) {
      for (let n = 1; n <= max && i + n <= ws.length; n++) {
        let run = ws.slice(i, i + n);
        while (run.length && !content(run[0])) run = run.slice(1);
        while (run.length && !content(run[run.length - 1])) run = run.slice(0, -1);
        if (!run.length) continue;
        const score = run.reduce((a, w) => a + (content(w) ? w.length : -1.5), 0);
        if (score > bestScore + 0.01) { best = run; bestScore = score; }
      }
    }
  }
  return best.join(' ');
}

/** Short comma-separated items ("speed, price, and battery") → a step list. */
function listItems(raw: string[]): string[] | null {
  const text = raw.join(' ');
  if (!/[,;]/.test(text)) return null;
  const tail = text.slice(text.lastIndexOf(':') + 1);
  const parts = tail.split(/,|;|\band\b|\bor\b/i).map((x) => x.replace(/[^\p{L}\p{N}%$₹ ]+/gu, '').trim()).filter(Boolean);
  // Items are the short trailing segments ("…matter speed, price and battery" → speed, price, battery).
  const items: string[] = [];
  for (let i = parts.length - 1; i >= 0; i--) {
    const n = parts[i].split(/\s+/);
    if (n.length <= 3) items.unshift(parts[i]);
    else { if (items.length >= 2) items.unshift(n.slice(-1)[0]); break; }
  }
  return items.length >= 3 ? items.slice(-4).map(title) : null;
}

export function motionFor(words: Word[], a: number, b: number, fallback: string, index: number): GraphicSpec {
  const raw = words.filter((w) => !w.filler && w.t >= a - 0.05 && w.t < b).map((w) => w.w.trim()).filter((w) => clean(w));
  const ws = raw.map(clean);
  if (!ws.length) return { component: 'Motion', scene: 'kinetic', text: fallback.trim() || 'Watch this', sub: index ? String(index + 1).padStart(2, '0') : '' };
  const num = ws.find(isNum);
  if (num) {
    const label = keyPhrase(raw.map((w) => (isNum(w) ? '.' : w)), 3);
    return { component: 'Motion', scene: 'stat', text: title(label || ws.slice(0, 4).join(' ')), value: clean(num) };
  }
  const vs = ws.findIndex((w) => /^(vs|versus)$/i.test(w));
  if (vs > 0 && vs < ws.length - 1) {
    const left = keyPhrase(raw.slice(0, vs), 2) || ws[vs - 1];
    const right = keyPhrase(raw.slice(vs + 1), 2) || ws[vs + 1];
    return { component: 'Motion', scene: 'versus', text: `${title(left)} vs ${title(right)}`, items: [title(left), title(right)] };
  }
  const items = listItems(raw);
  if (items) return { component: 'Motion', scene: 'steps', text: items.join(' · '), items };
  // The spoken line runs underneath as captions, so the card shows only its strongest words.
  return { component: 'Motion', scene: 'kinetic', text: title(keyPhrase(raw) || ws.slice(0, 3).join(' ')), sub: String(index + 1).padStart(2, '0') };
}

/** A picture prompt for an AI image cutaway: what is being said, in the style's mood. */
export function imagePromptFor(words: Word[], a: number, b: number, fallback: string, mood: string): string {
  const ws = spoken(words, a, b);
  const subject = ws.length ? ws.join(' ') : fallback;
  return `${subject}. ${mood}. No text, no letters, no logos, no watermark.`;
}
