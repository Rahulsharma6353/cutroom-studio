import type { DirectorRequest, DirectorResponse, EditOp } from './types';

// Offline planner with the same contract as the real director route.
// Used in the design preview and as a fallback when the server is unreachable.

const STOP = new Set('the a an and or of to for in on with this that your you it is are will be me my add put make some please here part section clip first second third even picks gives reads drafts adds cuts save follow three hours week edits videos tools'.split(' '));

function subjectAfter(prompt: string, keys: string[]): string | null {
  const lower = prompt.toLowerCase();
  for (const k of keys) {
    const i = lower.indexOf(k);
    if (i >= 0) {
      const rest = prompt.slice(i + k.length).replace(/^[\s:,-]+/, '');
      const cut = rest.split(/\s+(?:over|on|for|at|in this|here|and then|then)\b|[.,;!(]/i)[0].trim();
      if (cut.length > 1) return cut.slice(0, 48);
    }
  }
  return null;
}

function quoted(prompt: string): string | null {
  const m = prompt.match(/["“']([^"”']{2,60})["”']/);
  return m ? m[1] : null;
}

function keywordsFrom(req: DirectorRequest, lo: number, hi: number): string {
  const words = req.context.words
    .filter((w) => w.t >= lo && w.t < hi && !w.filler)
    .map((w) => w.w.replace(/[^a-z0-9]/gi, '').toLowerCase())
    .filter((w) => w.length > 3 && !STOP.has(w));
  // Longest content words make the best stock queries; keep their spoken order.
  const top = [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 2);
  const picked = words.filter((w, i) => top.includes(w) && words.indexOf(w) === i);
  const q = picked.join(' ');
  return q ? q.charAt(0).toUpperCase() + q.slice(1) : 'Creator at desk';
}

function chunks(lo: number, hi: number, size: number): [number, number][] {
  const out: [number, number][] = [];
  const n = Math.max(1, Math.round((hi - lo) / size));
  const step = (hi - lo) / n;
  for (let i = 0; i < n; i++) out.push([lo + i * step, lo + (i + 1) * step]);
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function planEdit(req: DirectorRequest): DirectorResponse {
  const p = req.prompt.toLowerCase();
  const lo = req.selection?.start ?? 0;
  const hi = req.selection?.end ?? req.duration;
  const span = hi - lo;
  const ops: EditOp[] = [];
  const done: string[] = [];

  if (/pause|silence|dead air|tighten|punchier|gap/.test(p)) {
    const ps = req.context.pauses.filter((x) => x.t >= lo - 0.01 && x.t + x.d <= hi + 0.01);
    ps.forEach((x) => ops.push({ op: 'ripple_delete', start: r2(x.t + 0.06), end: r2(x.t + x.d - 0.06) }));
    if (ps.length) done.push(`removed ${ps.length} pause${ps.length > 1 ? 's' : ''}`);
  }

  if (/filler|um\b|uh\b|ums|clean up/.test(p) || /punchier|tighten/.test(p)) {
    const ws = req.context.words;
    let n = 0;
    ws.forEach((w, i) => {
      if (!w.filler || w.t < lo || w.t >= hi) return;
      const next = ws[i + 1];
      ops.push({ op: 'ripple_delete', start: r2(w.t - 0.02), end: r2(next ? next.t - 0.03 : w.t + w.d) });
      n++;
    });
    if (n) done.push(`cut ${n} filler word${n > 1 ? 's' : ''}`);
  }

  if (/zoom|punch[- ]?in|punchier/.test(p)) {
    const a = lo + span * 0.35;
    const b = Math.min(hi, a + Math.max(1.2, span * 0.3));
    ops.push({ op: 'set_zoom', start: r2(a), end: r2(b), zoom: 1.18 });
    done.push('added a punch-in zoom');
  }

  if (/b-?roll|footage|stock|cover (this|it)|cutaway/.test(p)) {
    const explicit = subjectAfter(req.prompt, ['b-roll of', 'broll of', 'footage of', 'stock of', 'shot of', 'clip of']);
    let parts = chunks(lo, hi, 3.2);
    // Whole-video passes keep the hook on the speaker's face and alternate B-roll with A-roll.
    if (!req.selection) parts = parts.filter(([a], i) => a >= 3 && i % 2 === 1);
    parts.forEach(([a, b], i) => {
      const label = explicit ? (parts.length > 1 ? `${explicit} ${i + 1}` : explicit) : keywordsFrom(req, a, b);
      ops.push({ op: 'insert_clip', trackKind: 'broll', start: r2(a), duration: r2(b - a), label, assetKind: 'broll', origin: 'stock', job: { type: 'stock', eta: 1.4 + i * 0.5 }, credit: 'Pexels' });
    });
    done.push(explicit ? `found ${parts.length} B-roll shot${parts.length > 1 ? 's' : ''} of “${explicit}”` : `matched ${parts.length} B-roll shot${parts.length > 1 ? 's' : ''} to your script`);
  }

  if (/screen ?record|record the|screen capture|screencast/.test(p)) {
    const site = req.prompt.match(/([a-z0-9-]+\.(?:com|ai|io|in|org|dev|app))/i)?.[1] ?? subjectAfter(req.prompt, ['record the', 'record', 'screen recording of']) ?? 'website';
    ops.push({ op: 'insert_clip', trackKind: 'broll', start: r2(lo), duration: r2(Math.min(span, 6)), label: `Screen: ${site}`, assetKind: 'screen', origin: 'recorded', job: { type: 'screen', eta: 6 } });
    done.push(`recorded ${site}`);
  }

  if (/(generate|create|make).*(image|picture|photo|illustration)|\bimage of\b/.test(p)) {
    const subject = subjectAfter(req.prompt, ['image of', 'picture of', 'photo of', 'illustration of', 'image']) ?? keywordsFrom(req, lo, hi);
    ops.push({ op: 'insert_clip', trackKind: 'overlay', start: r2(lo), duration: r2(Math.min(span, 3)), label: subject, assetKind: 'image', origin: 'generated', job: { type: 'image', eta: 5 } });
    done.push(`generated an image of “${subject}”`);
  }

  if (/(generate|create|make).*(video|shot|scene|clip)|\bvideo of\b/.test(p) && !/b-?roll|stock|story scenes/.test(p)) {
    const subject = subjectAfter(req.prompt, ['video of', 'shot of', 'scene of', 'clip of']) ?? keywordsFrom(req, lo, hi);
    ops.push({ op: 'insert_clip', trackKind: 'broll', start: r2(lo), duration: r2(Math.min(span, 5)), label: subject, assetKind: 'broll', origin: 'generated', job: { type: 'video', eta: 9 } });
    done.push(`generated a ${Math.round(Math.min(span, 5))}s shot of “${subject}”`);
  }

  if (/lower[- ]?third|name tag|my name|title card|headline|text on screen/.test(p)) {
    const text = quoted(req.prompt) ?? (/name/.test(p) ? 'Rahul Sharma' : 'Three tools, ten hours');
    const component = /headline|title/.test(p) ? 'Headline' : 'LowerThird';
    ops.push({ op: 'insert_clip', trackKind: 'overlay', start: r2(lo), duration: r2(Math.min(span, 3.5)), label: text, assetKind: 'graphic', origin: 'library', graphic: { component, text, sub: component === 'LowerThird' ? 'Creator, Fluxpedia' : undefined } });
    done.push(`added a ${component === 'Headline' ? 'headline' : 'lower third'}`);
  }

  if (/big word|giant word|word slide/.test(p)) {
    const pool = req.context.words.filter((w) => w.t >= lo && w.t < hi && !w.filler);
    const q = quoted(req.prompt);
    const pick = q ? pool.find((w) => w.w.toLowerCase().includes(q.toLowerCase())) : [...pool].sort((a, b) => b.w.replace(/\W/g, '').length - a.w.replace(/\W/g, '').length)[0];
    if (pick) {
      const i = pool.indexOf(pick);
      const text = (q ?? pick.w.replace(/[^\p{L}\p{N}$%₹]/gu, ''));
      const kicker = pool.slice(Math.max(0, i - 2), i).map((w) => w.w.replace(/[,.]/g, '')).join(' ');
      const slide = /slide/.test(p);
      ops.push({ op: 'insert_clip', trackKind: 'overlay', start: r2(Math.max(lo, pick.t - 0.05)), duration: r2(Math.min(slide ? 1.6 : 1.3, hi - pick.t + 0.05)), label: text, assetKind: 'graphic', origin: 'library', graphic: { component: 'BigWord', text, sub: kicker || undefined, slide } });
      done.push(`added a big “${text}” ${slide ? 'slide' : 'word'}`);
    }
  }

  if (/\blist\b|numbered|steps/.test(p)) {
    const q = req.prompt.match(/["“']([^"”']+)["”']/)?.[1];
    // Rows from the user's quoted text, else the opening words of each sentence in range.
    const sentences: string[] = [];
    let cur: string[] = [];
    req.context.words.filter((w) => w.t >= lo && w.t < hi && !w.filler).forEach((w) => {
      cur.push(w.w.replace(/[,.!?]$/, ''));
      if (/[.!?]$/.test(w.w)) { sentences.push(cur.slice(0, 4).join(' ')); cur = []; }
    });
    if (cur.length) sentences.push(cur.slice(0, 4).join(' '));
    const items = (q ? q.split(/\s*[,;|]\s*/) : sentences).filter(Boolean).slice(0, 4);
    if (items.length >= 2) {
      const len = Math.min(span, 1.4 * items.length + 1);
      const start = lo + Math.max(0, (span - len) * 0.4);
      ops.push({ op: 'insert_clip', trackKind: 'overlay', start: r2(start), duration: r2(len), label: `List: ${items[0]}`, assetKind: 'graphic', origin: 'library', graphic: { component: 'List', text: items[0], items, slide: !/over (the )?speaker|over me/.test(p) } });
      done.push(`added a ${items.length}-point list`);
    }
  }

  if (/story scenes|scene for each|ai scenes/.test(p)) {
    const parts = chunks(lo, hi, 3.6).filter(([a]) => a >= 2);
    parts.forEach(([a, b], i) => ops.push({ op: 'insert_clip', trackKind: 'broll', start: r2(a), duration: r2(b - a), label: `Scene: ${keywordsFrom(req, a, b)}`, assetKind: 'broll', origin: 'generated', job: { type: 'video', eta: 8 + i * 1.5 } }));
    if (parts.length) done.push(`started ${parts.length} AI scene${parts.length > 1 ? 's' : ''} for the story`);
  }

  if (/counter|count up|animated number/.test(p)) {
    const n = req.prompt.match(/\d[\d,.]*\s*(?:k|m|lakh|crore|%|hours?)?/i)?.[0] ?? '10 hours';
    // The words spoken just before become the small label above the number, as in "most editors charge / $50/h".
    const lead = req.context.words.filter((w) => w.t >= lo && w.t < hi && !w.filler).slice(0, 3).map((w) => w.w.replace(/[,.]/g, '')).join(' ');
    ops.push({ op: 'insert_clip', trackKind: 'overlay', start: r2(lo), duration: r2(Math.min(span, 2.5)), label: n, assetKind: 'graphic', origin: 'library', graphic: { component: 'Counter', text: n, sub: lead || undefined } });
    done.push('added an animated counter');
  }

  if (/sound design/.test(p)) {
    // Sound design pass: whoosh into each cut, typing clicks under big words, a pop on key words.
    const sfx = (t: number, label: string, d: number) => ops.push({ op: 'insert_clip', trackKind: 'sfx', start: r2(Math.max(lo, t)), duration: d, label, assetKind: 'sfx', origin: 'library' });
    let n = 0;
    const cuts = req.context.clips.filter((c) => c.trackId === 't-aroll' && c.start > lo + 0.1 && c.start < hi - 0.1).map((c) => c.start);
    cuts.forEach((t) => { sfx(t - 0.32, 'Whoosh', 0.75); n++; });
    const spoken = req.context.words.filter((w) => w.t >= lo && w.t < hi && !w.filler);
    spoken.forEach((w) => {
      const bare = w.w.replace(/[^\p{L}\p{N}]/gu, '');
      if (/\d/.test(bare) || bare.length >= 9) {
        for (let i = 0; i < Math.min(bare.length, 12); i += 2) sfx(w.t + i * 0.045, 'Type', 0.05);
        n++;
      } else if (bare.length >= 6) { sfx(w.t, 'Pop', 0.14); n++; }
    });
    done.push(`added sound design (${n} hits)`);
  }

  if (/profile card|followers card|ui card|profile ui/.test(p)) {
    const q = quoted(req.prompt);
    const strike = /cross|strike|not needed|don.?t need/.test(p);
    ops.push({ op: 'insert_clip', trackKind: 'overlay', start: r2(lo), duration: r2(Math.max(1.6, span)), label: 'Profile card', assetKind: 'graphic', origin: 'library', graphic: { component: 'UI', ui: 'profile', text: 'yourpage', value: q ?? '1,000,000', strike } });
    ops.push({ op: 'insert_clip', trackKind: 'sfx', start: r2(lo), duration: 0.14, label: 'Pop', assetKind: 'sfx', origin: 'library' });
    if (strike) ops.push({ op: 'insert_clip', trackKind: 'sfx', start: r2(lo + 1.45), duration: 0.5, label: 'Hit', assetKind: 'sfx', origin: 'library' });
    done.push('added a profile card');
  }

  if (/videos? grid|video wall|grid of videos/.test(p)) {
    const strike = /cross|strike|not needed|don.?t need/.test(p);
    ops.push({ op: 'insert_clip', trackKind: 'overlay', start: r2(lo), duration: r2(Math.max(1.8, span)), label: 'Videos grid', assetKind: 'graphic', origin: 'library', graphic: { component: 'UI', ui: 'videos', text: 'Your videos', items: ['8.2K', '12K', '5.4K', '31K', '9.7K', '1M'], strike } });
    for (let i = 0; i < 6; i++) ops.push({ op: 'insert_clip', trackKind: 'sfx', start: r2(lo + 0.2 + i * 0.14), duration: 0.06, label: 'Click', assetKind: 'sfx', origin: 'library' });
    if (strike) ops.push({ op: 'insert_clip', trackKind: 'sfx', start: r2(lo + 1.49), duration: 0.5, label: 'Hit', assetKind: 'sfx', origin: 'library' });
    done.push('added a videos grid');
  }

  if (/notification/.test(p)) {
    const q = req.prompt.match(/["“']([^"”']+)["”']/)?.[1];
    const items = q ? q.split(/\s*[|;]\s*/) : undefined;
    ops.push({ op: 'insert_clip', trackKind: 'overlay', start: r2(lo), duration: r2(Math.max(1.6, span)), label: 'Notifications', assetKind: 'graphic', origin: 'library', graphic: { component: 'UI', ui: 'notify', text: '', items } });
    for (let i = 0; i < (items?.length ?? 3); i++) ops.push({ op: 'insert_clip', trackKind: 'sfx', start: r2(lo + i * 0.38), duration: 0.6, label: 'Ding', assetKind: 'sfx', origin: 'library' });
    done.push('added notifications');
  }

  if (/growth chart|chart/.test(p) && !/videos? grid/.test(p)) {
    ops.push({ op: 'insert_clip', trackKind: 'overlay', start: r2(lo), duration: r2(Math.max(1.8, span)), label: 'Growth chart', assetKind: 'graphic', origin: 'library', graphic: { component: 'UI', ui: 'chart', text: 'Reach' } });
    ops.push({ op: 'insert_clip', trackKind: 'sfx', start: r2(lo + 0.2), duration: 1.4, label: 'Riser', assetKind: 'sfx', origin: 'library' });
    done.push('added a growth chart');
  }

  if (/whoosh|sfx|sound effect|swoosh|pop sound|riser/.test(p) && !/sound design/.test(p)) {
    const kind = /pop/.test(p) ? 'Pop' : /riser/.test(p) ? 'Riser' : 'Whoosh';
    const cuts = req.context.clips.filter((c) => (c.trackId === 't-aroll' || c.trackId === 't-broll') && c.start > lo + 0.1 && c.start < hi - 0.1).map((c) => c.start);
    const points = (cuts.length ? Array.from(new Set(cuts.map(r2))) : chunks(lo, hi, 3).map(([a]) => a)).slice(0, 8);
    points.forEach((t) => ops.push({ op: 'insert_clip', trackKind: 'sfx', start: r2(Math.max(lo, t - 0.15)), duration: 0.7, label: kind, assetKind: 'sfx', origin: 'library' }));
    done.push(`added ${points.length} ${kind.toLowerCase()} sound${points.length > 1 ? 's' : ''}`);
  }

  if (/music|soundtrack|background track|bgm/.test(p)) {
    const mood = /calm|chill|soft/.test(p) ? 'Calm piano' : /dramatic|epic|tense/.test(p) ? 'Dramatic strings' : 'Upbeat lo-fi';
    ops.push({ op: 'insert_clip', trackKind: 'music', start: r2(lo), duration: r2(span), label: `${mood}, 104 BPM`, assetKind: 'music', origin: 'library', job: { type: 'music', eta: 2 } });
    done.push(`picked “${mood}” and ducked it under your voice`);
  }

  if (/caption|subtitle/.test(p)) {
    const preset = /hindi|devanagari/.test(p) ? 'hindi' : /karaoke/.test(p) ? 'karaoke' : /minimal|simple|clean/.test(p) ? 'minimal' : /box/.test(p) ? 'boxed' : /ticker|news/.test(p) ? 'ticker' : /bold|pop/.test(p) ? 'bold-pop' : null;
    if (/(remove|hide|turn off|drop|no)\s+(the\s+|all\s+)?(captions?|subtitles?)|(captions?|subtitles?)\s+off/.test(p)) {
      ops.push({ op: 'set_captions_enabled', enabled: false });
      done.push('turned captions off');
    } else if (preset) {
      ops.push({ op: 'set_caption_preset', presetId: preset });
      done.push(`switched captions to ${preset.replace('-', ' ')}`);
    } else {
      ops.push({ op: 'set_captions_enabled', enabled: true });
      done.push('turned captions on');
    }
  }

  if (!ops.length) {
    return {
      reply: 'I couldn’t tell what to change here. Try something like “remove the pauses”, “add B-roll of a stock market chart”, “generate an image of a futuristic Surat skyline”, “add a whoosh on every cut” or “add a lower third with my name”.',
      summary: '',
      ops: [],
    };
  }

  const text = done.join(', ');
  return {
    reply: `Done — I ${text}. Preview it, then keep or undo.`,
    summary: text.charAt(0).toUpperCase() + text.slice(1),
    ops,
  };
}
