import { TRACK_IDS } from './ops';
import type { Asset, CalmSample, Clip, FaceSample, GraphicSpec, TextSpec, Word } from './types';
import { uid } from './util';

/**
 * Explainer style (9:16): every sentence becomes a light italic setup line and a bold key line,
 * each its own layer, placed where the footage is calm and clear of any face, inside the
 * Instagram/TikTok safe area. Lists become label pills. Laid out once at first cut and stored in
 * the clips, so the editor, the MP4 and the Premiere layers all draw the same thing.
 */

/** Where Reels/TikTok/Shorts UI doesn't cover a 9:16 frame (top bar, caption + buttons, right rail). */
export const SOCIAL_SAFE = { x0: 0.07, x1: 0.85, y0: 0.13, y1: 0.74 };

export const EXPLAINER_COLORS = {
  ink: { setup: '#231A25', key: '#2D0F48' },
  light: { setup: '#DEC9EB', key: '#FEE9FE' },
  pill: '#8537BB',
  pillInk: '#FEE9FE',
  paper: '#EBEBE4',
  night: '#160B22',
  violet: '#2D0F48',
};

export const EXPLAINER_FONT = '"Inter Display", "Inter", system-ui, sans-serif';

// Average advance per character, in em (Inter Display): light italic, bold, semibold pills.
const ADV = { setup: 0.5, key: 0.57, pill: 0.55 };

const clean = (w: string) => w.replace(/^["“(]+|["”),.;:!?]+$/g, '');
const isNumber = (w: string) => /^\$?\d[\d,.]*(%|x|k|m|bn|\+)?$/i.test(clean(w));
const spokenEnd = (w: Word) => w.t + w.d;

// ---- Mapping footage coordinates to the frame -------------------------------------------

/** Footage is cover-fitted into the frame: how a source fraction maps to a frame fraction. */
export function coverMap(srcW: number | undefined, srcH: number | undefined, ratio: number) {
  const sa = srcW && srcH ? srcW / srcH : ratio;
  const kx = sa > ratio ? sa / ratio : 1;
  const ky = sa < ratio ? ratio / sa : 1;
  return {
    kx, ky,
    x: (v: number) => 0.5 + (v - 0.5) * kx,
    y: (v: number) => 0.5 + (v - 0.5) * ky,
    ix: (v: number) => 0.5 + (v - 0.5) / kx,
    iy: (v: number) => 0.5 + (v - 0.5) / ky,
  };
}

function nearest<T extends { t: number }>(arr: T[], t: number): T | undefined {
  if (!arr.length) return undefined;
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && Math.abs(arr[lo - 1].t - t) < Math.abs(arr[lo].t - t) ? arr[lo - 1] : arr[lo];
}

interface Box { x0: number; x1: number; y0: number; y1: number }
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** What is on screen at timeline time t: the B-roll clip if one covers it, else the A-roll. */
function shotAt(clips: Clip[], assets: Asset[], t: number) {
  const pick = (track: string) => clips.filter((c) => c.trackId === track && t >= c.start && t < c.start + c.duration).at(-1);
  const c = pick(TRACK_IDS.broll) ?? pick(TRACK_IDS.aroll);
  const a = c?.assetId ? assets.find((x) => x.id === c.assetId) : undefined;
  if (!c || !a || a.audioOnly) return null;
  return { clip: c, asset: a, local: c.in + (t - c.start) };
}

/** The head (hair to chin, ear to ear) in frame fractions, or null. */
function headAt(faces: FaceSample[] | undefined, local: number, m: ReturnType<typeof coverMap>): Box | null {
  const f = faces && nearest(faces, local);
  if (!f || Math.abs(f.t - local) > 0.6) return null;
  // YuNet boxes run wide of the face: measured on real footage, hair top ≈ y − 0.9h, chin ≈ y + 0.45h, ears ≈ x ± 0.55w.
  return { x0: m.x(f.x - f.w * 0.55), x1: m.x(f.x + f.w * 0.55), y0: m.y(f.y - f.h * 0.9), y1: m.y(f.y + f.h * 0.45) };
}

/** Busyness (0..1) and brightness (0..1) under a frame box, from the footage's calm map. */
function calmUnder(calm: CalmSample[] | undefined, local: number, box: Box, m: ReturnType<typeof coverMap>) {
  const s = calm && nearest(calm, local);
  if (!s) return null;
  const sx0 = m.ix(box.x0), sx1 = m.ix(box.x1), sy0 = m.iy(box.y0), sy1 = m.iy(box.y1);
  let e = 0, l = 0, n = 0, lo = 1, hi = 0;
  for (let r = 0; r < s.rows; r++) {
    const cy0 = r / s.rows, cy1 = (r + 1) / s.rows;
    if (cy1 <= sy0 || cy0 >= sy1) continue;
    for (let c = 0; c < s.cols; c++) {
      const cx0 = c / s.cols, cx1 = (c + 1) / s.cols;
      if (cx1 <= sx0 || cx0 >= sx1) continue;
      const k = r * s.cols + c;
      e += s.edge[k];
      l += s.luma[k];
      lo = Math.min(lo, s.luma[k]);
      hi = Math.max(hi, s.luma[k]);
      n++;
    }
  }
  // spread: a dark object on a light shirt (a mic, a phone) has few edges inside but a big brightness jump.
  return n ? { edge: e / n, luma: l / n, spread: hi - lo } : null;
}

// ---- Splitting speech into on-screen lines ------------------------------------------------

interface Chunk { words: Word[]; setup: Word[]; key: Word[]; list?: { items: string[]; times: number[] } }

const BREAK_BEFORE = /^(and|but|so|because|that|which|who|to|into|over|in|on|for|with|by|than|until|while|when)$/i;

/** Sentences → chunks of at most ~8 words, broken at commas, pauses and natural joins. */
function chunksOf(words: Word[]): Word[][] {
  const out: Word[][] = [];
  let cur: Word[] = [];
  const flush = () => { if (cur.length) out.push(cur); cur = []; };
  words.forEach((w, i) => {
    const next = words[i + 1];
    cur.push(w);
    const end = /[.!?]["”]?$/.test(w.w) && !/\.\.\.$/.test(w.w);
    const comma = /[,;:—]$|\.\.\.$/.test(w.w);
    const gap = next ? next.t - spokenEnd(w) : 9;
    if (end || gap > 0.6 || (comma && cur.length >= 4)) return flush();
    if (cur.length >= 8) {
      // Too long: break before the last natural join (keeping at least 3 words each side).
      let p = -1;
      for (let k = cur.length - 1; k >= 3; k--) if (BREAK_BEFORE.test(clean(cur[k].w))) { p = k; break; }
      if (p < 0 && cur.length < 10) return;
      const rest = p > 0 ? cur.slice(p) : [];
      cur = p > 0 ? cur.slice(0, p) : cur;
      flush();
      cur = rest;
    }
  });
  flush();
  // Fold a one- or two-word tail into the chunk before it ("…much more / ambitious").
  for (let i = out.length - 1; i > 0; i--) {
    const prevEnd = out[i - 1].at(-1)!;
    const sentenceEnded = /[.!?]["”]?$/.test(prevEnd.w) && !/\.\.\.$/.test(prevEnd.w);
    if (out[i].length <= 2 && out[i - 1].length <= 7 && !sentenceEnded && out[i][0].t - spokenEnd(prevEnd) < 1) {
      out[i - 1].push(...out[i]);
      out.splice(i, 1);
    }
  }
  return out;
}

/** "power, cooling, radiation and AI workloads" → label items with the time each is spoken. */
function findList(ws: Word[]): { from: number; to: number; items: string[]; times: number[] } | null {
  for (let i = 0; i < ws.length; i++) {
    const items: Word[][] = [];
    let j = i;
    while (j < ws.length) {
      let k = j;
      while (k < ws.length && k - j < 3 && !/[,;.]$/.test(ws[k].w)) k++;
      if (k < ws.length && k - j < 3 && /[,;.]$/.test(ws[k].w) && !/\.\.\.$/.test(ws[k].w)) { items.push(ws.slice(j, k + 1)); j = k + 1; } else break;
    }
    // "…cooling, radiation and…": the item right before "and" may have no comma.
    if (items.length >= 2) {
      let k = j;
      while (k < ws.length && k - j < 3 && !/^(and|or)$/i.test(clean(ws[k].w))) k++;
      if (k > j && k < ws.length && k - j <= 2 && /^(and|or)$/i.test(clean(ws[k].w)) && !ws.slice(j, k).some((w) => /[,;.!?]$/.test(w.w))) { items.push(ws.slice(j, k)); j = k; }
    }
    if (items.length < 2 || j >= ws.length || !/^(and|or)$/i.test(clean(ws[j].w))) continue;
    j++;
    const fin: Word[] = [];
    while (j < ws.length && fin.length < 3) {
      fin.push(ws[j]);
      j++;
      if (/[,.;:!?]$/.test(fin.at(-1)!.w)) break;
    }
    if (!fin.length) continue;
    items.push(fin);
    // "to handle power," → "power,": the first item is no longer than the others.
    const longest = items[1].length;
    const from = i + Math.max(0, items[0].length - longest);
    items[0] = items[0].slice(items[0].length - Math.min(items[0].length, longest));
    return { from, to: j, items: items.map((it) => { const t = it.map((w) => clean(w.w)).join(' '); return t.charAt(0).toUpperCase() + t.slice(1); }), times: items.map((it) => it[0].t) };
  }
  return null;
}

/** Pick the words that carry the line: a number, a name, or the last few words. */
function splitKey(words: Word[]): { setup: Word[]; key: Word[] } {
  const n = words.length;
  if (n <= 3) return { setup: [], key: words };
  const tail = Math.max(1, n - 4);
  let k = -1;
  for (let i = tail; i < n; i++) {
    if (isNumber(words[i].w)) { k = i; break; }
  }
  if (k < 0) {
    for (let i = tail; i < n; i++) {
      const w = clean(words[i].w);
      if (/^[A-Z]/.test(w) && w !== 'I' && !/[.!?]$/.test(words[i - 1]?.w ?? '.')) { k = i; break; }
    }
  }
  if (k < 0) k = clean(words[n - 1].w).length <= 3 || clean(words[n - 2].w).length <= 3 ? n - 3 : n - 2;
  // Keep short function words with the key ("the", "a", "of") rather than dangling at the end of the setup.
  while (k > 1 && /^(the|a|an|of|to|in|on|for|its|his|her|their|my|your|our)$/i.test(clean(words[k - 1].w)) && n - k < 4) k--;
  return { setup: words.slice(0, k), key: words.slice(k) };
}

function chunkUp(words: Word[]): Chunk[] {
  const spoken = words.filter((w) => !w.filler);
  const normal = (ws: Word[]): Chunk => ({ words: ws, ...splitKey(ws) });
  const out: Chunk[] = [];
  let rest = spoken;
  // Lists anywhere in the speech become label stacks; the line just before them is their setup.
  for (;;) {
    const list = findList(rest);
    if (!list) { out.push(...chunksOf(rest).map(normal)); break; }
    const pre = chunksOf(rest.slice(0, list.from));
    const lastPre = pre.at(-1);
    const near = lastPre && lastPre.length <= 7 && rest[list.from].t - spokenEnd(lastPre.at(-1)!) < 1.2;
    const setup = near ? pre.pop()! : [];
    out.push(...pre.map(normal));
    out.push({ words: [...setup, ...rest.slice(list.from, list.to)], setup, key: [], list: { items: list.items, times: list.times } });
    rest = rest.slice(list.to);
  }
  return out;
}

// ---- Layout ------------------------------------------------------------------------------

const lineW = (text: string, size: number, adv: number) => text.length * adv * size;

interface Block { setup?: { text: string; size: number; lines: number }; key?: { text: string; size: number; lines: number }; pills?: { items: string[]; size: number }; w: number; h: number }

/** Sizes and the block's footprint (w as a fraction of frame width, h as a fraction of frame height). */
function measure(ch: Chunk, maxW: number, ratio: number): Block {
  const setupText = ch.setup.map((w) => clean(w.w)).join(' ');
  const keyText = ch.key.map((w) => clean(w.w)).join(' ');
  let w = 0;
  let h = 0;
  const b: Block = { w: 0, h: 0 };
  if (setupText) {
    const size = 0.06;
    const lines = Math.ceil(lineW(setupText, size, ADV.setup) / maxW);
    b.setup = { text: setupText, size, lines };
    w = Math.max(w, Math.min(maxW, lineW(setupText, size, ADV.setup)));
    h += lines * size * 1.22;
  }
  if (keyText) {
    // As big as fits on one line, between 0.085 and 0.14 of the width; wrap below that.
    let size = Math.min(0.14, maxW / Math.max(1, keyText.length * ADV.key));
    size = Math.max(0.085, size);
    const lines = Math.ceil(lineW(keyText, size, ADV.key) / maxW);
    b.key = { text: keyText, size, lines };
    w = Math.max(w, Math.min(maxW, lineW(keyText, size, ADV.key)));
    h += lines * size * 1.06 + (setupText ? 0.006 : 0);
  }
  if (ch.list) {
    const size = 0.046;
    b.pills = { items: ch.list.items, size };
    w = Math.max(w, ...ch.list.items.map((it) => lineW(it, size, ADV.pill) + size * 1.4));
    h += ch.list.items.length * size * 1.9 + 0.01;
  }
  b.w = Math.min(maxW, w);
  b.h = h * ratio; // width fractions → height fractions
  return b;
}

export interface ExplainerInput { clips: Clip[]; words: Word[]; assets: Asset[]; ratio: number }

/** Text, label, look and plate clips for an explainer cut. B-roll should already be on the timeline. */
export function explainerLayers({ clips, words, assets, ratio }: ExplainerInput): Clip[] {
  const S = SOCIAL_SAFE;
  const maxW = S.x1 - S.x0;
  const out: Clip[] = [];
  const end = Math.max(0, ...clips.map((c) => c.start + c.duration));
  const chunks = chunkUp(words);
  let prev: { align: TextSpec['align']; y: number } | null = null;

  chunks.forEach((ch, i) => {
    const t0 = Math.max(0, ch.words[0].t - 0.05);
    const next = chunks[i + 1];
    const last = spokenEnd(ch.words.at(-1)!);
    // Hold until the next line lands (hard cut), but never linger in silence.
    const t1 = Math.min(next ? next.words[0].t - 0.05 : end, last + 0.7, end);
    if (t1 - t0 < 0.25) return;
    // Score every candidate spot over the line's life: clear of faces, calm, readable, stepped.
    // Sample the line's whole life: hands and props move, and a spot that is calm once may not stay calm.
    const times: number[] = [];
    for (let u = t0 + 0.05; u < t1; u += 0.3) times.push(u);
    times.push(t1 - 0.05);
    const shots = times.map((t) => shotAt(clips, assets, t));
    const candidates: { align: TextSpec['align']; y: number; box: Box; score: number; luma: number | null; b: Block; width: number }[] = [];
    // Widths to try (one today; narrower columns can be added here and are slightly penalised).
    for (const width of [maxW]) for (const align of ['left', 'center', 'right'] as const) {
      if (width < maxW && align === 'center') continue;
      const b = measure(ch, width, ratio);
      const x0 = align === 'left' ? S.x0 : align === 'right' ? S.x1 - b.w : (S.x0 + S.x1) / 2 - b.w / 2;
      for (let y = S.y0; y + b.h <= S.y1 + 1e-6; y += 0.015) {
        const box = { x0: x0 - 0.01, x1: x0 + b.w + 0.01, y0: y - 0.008, y1: y + b.h + 0.008 };
        let score = width < maxW ? 0.5 : 0;
        let lum = 0;
        let ln = 0;
        const edges: number[] = [];
        shots.forEach((s) => {
          if (!s) return;
          const m = coverMap(s.asset.width, s.asset.height, ratio);
          const head = headAt(s.asset.faces, s.local, m);
          if (head) {
            const area = Math.max(0.001, (box.x1 - box.x0) * (box.y1 - box.y0));
            score += 60 * overlap(box, { x0: head.x0 - 0.02, x1: head.x1 + 0.02, y0: head.y0 - 0.015, y1: head.y1 + 0.015 }) / area + (overlap(box, head) > 0 ? 40 : 0);
            // Below the chin is the speaker's body, hands and mic: they move, and text there looks pasted on.
            const w = head.x1 - head.x0;
            score += 2.5 * overlap(box, { x0: head.x0 - w * 0.6, x1: head.x1 + w * 0.6, y0: head.y1, y1: 1 }) / area;
          }
          const c = calmUnder(s.asset.calm, s.local, box, m);
          if (c) { edges.push(c.edge + c.spread * 0.8); lum += c.luma; ln++; }
        });
        // Face and body terms averaged over the samples (weighted as three looks at the line).
        score = (score / Math.max(1, shots.filter(Boolean).length)) * 3;
        if (edges.length) {
          edges.sort((p, q) => p - q);
          // The busiest moments matter most (85th percentile): a hand or mic passing through counts.
          score += edges[Math.floor(edges.length * 0.85)] * 10;
        }
        const luma = ln ? lum / ln : null;
        if (luma !== null) score += Math.max(0, 0.18 - Math.abs(luma - 0.5)) * 6; // mid-grey is hard to read either way
        // Upper half reads first; a gentle pull toward the top third when everything else is equal.
        score += Math.abs(y + b.h / 2 - 0.34) * 0.8;
        if (prev) {
          if (align === prev.align) score += 0.35; // step the alignment line to line
          score += Math.abs(y - prev.y) * 0.6;
        }
        candidates.push({ align, y, box, score, luma, b, width });
      }
    }
    if (!candidates.length) return;
    candidates.sort((p, q) => p.score - q.score);
    const best = candidates[0];
    const b = best.b;
    const lineMax = best.width;
    prev = { align: best.align, y: best.y };
    const anyShot = shots.some(Boolean);
    const tone: TextSpec['tone'] = best.luma !== null ? (best.luma > 0.55 ? 'ink' : 'light') : anyShot ? 'light' : 'ink';
    const x = best.align === 'left' ? S.x0 : best.align === 'right' ? S.x1 : (S.x0 + S.x1) / 2;

    let y = best.y;
    if (b.setup) {
      out.push({
        id: uid('c'), trackId: TRACK_IDS.setup, label: b.setup.text, start: t0, duration: t1 - t0, in: 0, status: 'ready', hue: 285,
        text: { role: 'setup', words: ch.setup.map((w) => ({ w: clean(w.w), t: w.t - t0 })), x, y, align: best.align, size: b.setup.size, tone, maxW: lineMax },
      });
      y += b.setup.lines * b.setup.size * 1.22 * ratio + 0.006 * ratio;
    }
    if (b.key) {
      const k0 = Math.max(t0, ch.key[0].t - 0.05);
      out.push({
        id: uid('c'), trackId: TRACK_IDS.key, label: b.key.text, start: k0, duration: t1 - k0, in: 0, status: 'ready', hue: 275,
        text: { role: 'key', words: ch.key.map((w) => ({ w: clean(w.w), t: w.t - k0 })), x, y, align: best.align, size: b.key.size, tone, maxW: lineMax },
      });
    }
    if (b.pills && ch.list) {
      const l0 = Math.max(t0, ch.list.times[0] - 0.05);
      const g: GraphicSpec = {
        component: 'Labels', text: ch.list.items.join(', '), items: ch.list.items, times: ch.list.times.map((t) => t - l0),
        at: { x, y: y + 0.01 * ratio, align: best.align, size: b.pills.size, tone },
      };
      out.push({ id: uid('c'), trackId: TRACK_IDS.labels, label: `Labels: ${g.text}`, start: l0, duration: t1 - l0, in: 0, status: 'ready', hue: 280, graphic: g });
    }
  });

  if (end > 0) {
    out.push({ id: uid('c'), trackId: TRACK_IDS.plate, label: 'Paper background', start: 0, duration: end, in: 0, status: 'ready', hue: 60, plate: { kind: 'paper' } });
    out.push({ id: uid('c'), trackId: TRACK_IDS.look, label: 'Film look: grain + vignette', start: 0, duration: end, in: 0, status: 'ready', hue: 0, filmLook: { grain: 0.07, vignette: 0.32 } });
  }
  return out;
}

/**
 * B-roll for an explainer. Talking head: user B-roll cuts in on every other line, starting where
 * the key words land. Voiceover only: B-roll carries the whole picture, cut on line changes.
 */
export function explainerBroll({ clips, words, assets }: Omit<ExplainerInput, 'ratio'>): Clip[] {
  const pool = assets.filter((a) => a.kind === 'broll' && a.url && a.duration > 0.5);
  if (!pool.length) return [];
  const aroll = clips.find((c) => c.trackId === TRACK_IDS.aroll);
  const voiceOnly = !!assets.find((a) => a.id === aroll?.assetId)?.audioOnly;
  const end = Math.max(0, ...clips.map((c) => c.start + c.duration));
  const chunks = chunkUp(words);
  const out: Clip[] = [];
  const used = new Map<string, number>(); // asset → how far into it we've used
  let k = 0;
  const take = (start: number, len: number) => {
    const a = pool[k++ % pool.length];
    const from = used.get(a.id) ?? 0;
    const inPt = from + len <= a.duration ? from : 0;
    const d = Math.min(len, a.duration - inPt);
    used.set(a.id, inPt + d);
    out.push({ id: uid('c'), trackId: TRACK_IDS.broll, assetId: a.id, label: a.name, start, duration: d, in: inPt, status: 'ready', hue: a.hue });
  };
  if (voiceOnly) {
    let t = 0;
    for (let i = 0; i <= chunks.length && t < end - 0.2; i++) {
      const nx = i < chunks.length - 1 ? chunks[i + 1].words[0].t - 0.05 : end;
      if (nx - t < 1.2 && nx < end) continue; // keep shots at least ~1.2 s
      take(t, nx - t);
      t = out.at(-1)!.start + out.at(-1)!.duration;
    }
    return out;
  }
  chunks.forEach((ch, i) => {
    if (i % 2 === 0 || !ch.key.length) return;
    const s = ch.key[0].t - 0.05;
    const e = Math.min(spokenEnd(ch.words.at(-1)!) + 0.3, chunks[i + 1]?.words[0].t ?? end);
    if (e - s >= 1) take(s, Math.min(e - s, 3.5));
  });
  // No transcript to cut on: a cutaway every ~6 s after the hook, so the B-roll still lands.
  if (!out.length) for (let t = 3; t < end - 2; t += 6) take(t, Math.min(3, end - t - 0.5));
  return out;
}

// ---- Drawing helpers shared by the preview and the renderer -------------------------------

/** A spoken number counting up for 0.6 s after it lands ("1,800" → 0 … 1,800). */
export function countUp(word: string, age: number): string {
  if (!isNumber(word) || age >= 0.6) return word;
  const m = word.match(/^(\$?)([\d,.]+)(.*)$/);
  if (!m) return word;
  const value = Number(m[2].replace(/,/g, ''));
  if (!Number.isFinite(value) || value < 10) return word;
  const k = Math.max(0, age) / 0.6;
  const eased = 1 - Math.pow(1 - k, 3);
  const dec = (m[2].split('.')[1] ?? '').length;
  const v = value * eased;
  const body = m[2].includes(',') ? v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : v.toFixed(dec);
  return `${m[1]}${body}${m[3]}`;
}
