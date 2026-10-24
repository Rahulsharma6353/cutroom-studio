import type { CaptionPreset, CaptionSettings, Look, Pause, Project, Template, Word } from './types';

// A sample talking-head script used until speech-to-text is connected.
const SCRIPT: string[] = [
  'Three AI tools that will save you ten hours this week.',
  'Um, the first one edits your videos for you.',
  'You upload the footage and it cuts the pauses, adds captions and even picks the music.',
  'Second, an agent that reads your inbox and drafts replies in your tone.',
  'And third, uh, a research assistant that browses the web and gives you sources, not guesses.',
  'Save this and follow for part two.',
];

const SENTENCE_GAPS = [0.9, 1.1, 0.7, 1.2, 0.8];
const FILLERS = new Set(['um,', 'uh,']);

export function buildTranscript(): { words: Word[]; pauses: Pause[]; duration: number } {
  const words: Word[] = [];
  const pauses: Pause[] = [];
  let t = 0.4;
  SCRIPT.forEach((sentence, si) => {
    sentence.split(' ').forEach((raw, wi) => {
      const len = raw.replace(/[^a-z]/gi, '').length;
      const d = Math.min(0.62, 0.18 + len * 0.045);
      const filler = FILLERS.has(raw.toLowerCase());
      words.push({ id: `w${si}_${wi}`, t: round(t), d: round(d), w: raw, filler });
      t += d + (raw.endsWith(',') ? 0.22 : 0.06);
    });
    const gap = SENTENCE_GAPS[si];
    if (gap) {
      pauses.push({ t: round(t), d: gap });
      t += gap;
    }
  });
  return { words, pauses, duration: round(t + 0.5) };
}

const round = (n: number) => Math.round(n * 100) / 100;

export const CAPTION_PRESETS: CaptionPreset[] = [
  {
    id: 'bold-pop',
    name: 'Bold pop',
    note: '2–3 words, active word scales up',
    settings: { font: 'Anton', size: 9, weight: 400, uppercase: true, fill: '#FFFFFF', stroke: '#000000', strokeWidth: 3, highlight: '#F2A93B', highlightMode: 'active', background: '#000000', backgroundOpacity: 0, wordsPerLine: 3, position: 68, animation: 'pop' },
  },
  {
    id: 'karaoke',
    name: 'Karaoke',
    note: 'Full line, colour sweeps word by word',
    settings: { font: 'Figtree', size: 6, weight: 800, uppercase: false, fill: '#FFFFFF', stroke: '#000000', strokeWidth: 0, highlight: '#8FD3C1', highlightMode: 'active', background: '#000000', backgroundOpacity: 0.45, wordsPerLine: 6, position: 72, animation: 'none' },
  },
  {
    id: 'minimal',
    name: 'Minimal',
    note: 'One quiet line, lower third',
    settings: { font: 'Figtree', size: 4.6, weight: 600, uppercase: false, fill: '#FFFFFF', stroke: '#000000', strokeWidth: 0, highlight: '#FFFFFF', highlightMode: 'none', background: '#000000', backgroundOpacity: 0, wordsPerLine: 7, position: 82, animation: 'fade' },
  },
  {
    id: 'boxed',
    name: 'Boxed',
    note: 'Words on a solid rounded box',
    settings: { font: 'Figtree', size: 6, weight: 800, uppercase: false, fill: '#1E2024', stroke: '#000000', strokeWidth: 0, highlight: '#B4442E', highlightMode: 'keyword', background: '#FFFFFF', backgroundOpacity: 1, wordsPerLine: 4, position: 70, animation: 'slide' },
  },
  {
    id: 'hindi',
    name: 'Hindi',
    note: 'Devanagari-ready, Roman Hindi too',
    settings: { font: 'Mukta', size: 7, weight: 800, uppercase: false, fill: '#FFFFFF', stroke: '#000000', strokeWidth: 2, highlight: '#F2A93B', highlightMode: 'keyword', background: '#000000', backgroundOpacity: 0, wordsPerLine: 3, position: 66, animation: 'pop' },
  },
  {
    id: 'ticker',
    name: 'News ticker',
    note: 'Line slides in, channel style',
    settings: { font: 'Figtree', size: 5, weight: 700, uppercase: true, fill: '#FFFFFF', stroke: '#000000', strokeWidth: 0, highlight: '#FFFFFF', highlightMode: 'none', background: '#B4442E', backgroundOpacity: 1, wordsPerLine: 5, position: 86, animation: 'slide' },
  },
  {
    id: 'editorial',
    name: 'Editorial',
    note: 'Small words round the face, one key word huge',
    settings: { font: 'Inter', size: 4.6, weight: 600, uppercase: false, fill: '#FFFFFF', stroke: '#000000', strokeWidth: 0, highlight: '#3DDC58', highlightMode: 'keyword', accentFont: 'Instrument Serif', accentItalic: true, layout: 'editorial', background: '#000000', backgroundOpacity: 0, wordsPerLine: 5, position: 55, animation: 'pop' },
  },
  {
    id: 'pixel',
    name: 'Pixel pop',
    note: 'Words pop on beside you, blue key words',
    settings: { font: 'Pixelify Sans', size: 6, weight: 500, uppercase: false, fill: '#FFFFFF', stroke: '#000000', strokeWidth: 0, highlight: '#08A2F7', highlightMode: 'keyword', layout: 'pixel', background: '#08A2F7', backgroundOpacity: 0, wordsPerLine: 6, position: 70, animation: 'none' },
  },
  {
    id: 'reveal-red',
    name: 'Reveal',
    note: 'Spoken words solid, next words faint',
    settings: { font: 'Inter', size: 7, weight: 800, uppercase: false, fill: '#E5161D', stroke: '#000000', strokeWidth: 0, highlight: '#E5161D', highlightMode: 'reveal', background: '#000000', backgroundOpacity: 0, wordsPerLine: 4, position: 50, animation: 'none' },
  },
  {
    id: 'story-box',
    name: 'Story box',
    note: 'Two small caps words on a dark box',
    settings: { font: 'Inter', size: 4.4, weight: 800, uppercase: true, fill: '#FFFFFF', stroke: '#000000', strokeWidth: 0, highlight: '#FFFFFF', highlightMode: 'none', background: '#000000', backgroundOpacity: 0.55, wordsPerLine: 2, position: 72, animation: 'none' },
  },
  {
    id: 'red-label',
    name: 'Red label',
    note: 'Hinglish words on a red tag',
    settings: { font: 'Inter', size: 4.6, weight: 700, uppercase: false, fill: '#FFFFFF', stroke: '#000000', strokeWidth: 0, highlight: '#FFFFFF', highlightMode: 'none', background: '#E0141B', backgroundOpacity: 1, wordsPerLine: 2, position: 80, animation: 'pop' },
  },
  {
    id: 'cropped-bold',
    name: 'Cropped bold',
    note: 'Huge rounded words, product-promo style',
    settings: { font: 'Figtree', size: 15, weight: 900, uppercase: false, fill: '#FFFFFF', stroke: '#000000', strokeWidth: 0, highlight: '#FFFFFF', highlightMode: 'none', background: '#000000', backgroundOpacity: 0, wordsPerLine: 2, position: 16, animation: 'slide' },
  },
];

export function captionsFromPreset(id: string, enabled = true): CaptionSettings {
  const p = CAPTION_PRESETS.find((c) => c.id === id) ?? CAPTION_PRESETS[0];
  return { presetId: p.id, enabled, ...p.settings };
}

const LOOK: Look = { grade: 'none', vignette: false, brollLayout: 'full', slideBg: 'solid', accent: '#F2A93B' };

// Templates built from the reference reels: each is a recipe the editor follows on new footage.
export const TEMPLATES: Template[] = [
  {
    id: 'pixel-talk', name: 'Pixel talk', description: 'Pixel words pop on beside you, blue key words, typed big moments, UI cards',
    captionPreset: 'pixel', pace: 'Fast', hue: 200, sample: ['A person', '1 million', 'next'],
    look: { grade: 'none', vignette: false, brollLayout: 'full', slideBg: 'solid', accent: '#08A2F7', pushIn: true, punchAlternate: true },
    firstPass: 'remove pauses and filler words, add captions, add sound design',
    cardBg: 'linear-gradient(170deg, #4d7a3c 0%, #1d3a24 100%)', cardInk: '#FFFFFF',
  },
  {
    id: 'cinematic-talk', name: 'Cinematic talk', description: 'Moody grade, one word at a time, serif accents, a giant colour word',
    captionPreset: 'editorial', pace: 'Steady', hue: 30, sample: ['best paid', 'editors', 'sell'],
    look: { grade: 'cinematic', vignette: true, brollLayout: 'framed', slideBg: 'white', accent: '#3DDC58', pushIn: true, punchAlternate: true, introSettle: true, brollGrade: 'mono' },
    firstPass: 'remove pauses and filler words, add captions, add b-roll, add a list over the speaker, add calm music',
    cardBg: 'linear-gradient(170deg, #3a342e 0%, #15130f 100%)', cardInk: '#FFFFFF',
  },
  {
    id: 'product-motion', name: 'Product motion', description: 'Bold colour blocks, huge cropped words, fast cuts, logo end card',
    captionPreset: 'cropped-bold', pace: 'Fast', hue: 330, sample: ['Invest', 'Tailored', 'to you'],
    look: { grade: 'punchy', vignette: false, brollLayout: 'full', slideBg: 'solid', accent: '#F472B6' },
    firstPass: 'remove pauses and filler words, add captions, add b-roll, add whoosh sfx, add upbeat music',
    cardBg: '#F06EB0', cardInk: '#FFFFFF',
  },
  {
    id: 'kinetic-type', name: 'Kinetic type', description: 'Red on white, words fill in as you speak, numbered lists',
    captionPreset: 'reveal-red', pace: 'Steady', hue: 0, sample: ['Stop pairing', '5 fonts', 'Inter'],
    look: { grade: 'none', vignette: false, brollLayout: 'framed', slideBg: 'grid', accent: '#E5161D' },
    firstPass: 'remove pauses and filler words, add captions, add a list, add pop sfx',
    cardBg: '#F4F4F2', cardInk: '#E5161D',
  },
  {
    id: 'ai-story', name: 'AI story', description: 'You on the mic, AI-made scenes tell the story, split screen',
    captionPreset: 'story-box', pace: 'Steady', hue: 25, sample: ['A YEAR', 'MEANWHILE', 'WHO STILL'],
    look: { grade: 'cinematic', vignette: false, brollLayout: 'split', slideBg: 'solid', accent: '#FFFFFF' },
    firstPass: 'remove pauses and filler words, add captions, generate story scenes, add dramatic music',
    cardBg: 'linear-gradient(170deg, #5b4a3a 0%, #1f1a16 100%)', cardInk: '#FFFFFF',
  },
  {
    id: 'hinglish-type', name: 'Hinglish type', description: 'Spaced caps words, giant red word slides on grey paper',
    captionPreset: 'red-label', pace: 'Steady', hue: 0, sample: ['AGAR', 'EXAMPLE', 'font mein'],
    look: { grade: 'none', vignette: false, brollLayout: 'full', slideBg: 'paper', accent: '#E0141B' },
    firstPass: 'remove pauses and filler words, add captions, add a big word slide, add hit sfx',
    cardBg: 'radial-gradient(circle at 50% 40%, #e2e2df, #b9b9b5)', cardInk: '#E0141B',
  },
  {
    id: 'fast-explainer', name: 'Fast explainer', description: 'Tight cuts, punch-in zooms, B-roll every sentence',
    captionPreset: 'bold-pop', pace: 'Fast', hue: 38, sample: ['3 AI TOOLS', 'THAT SAVE', '10 HOURS'],
    look: LOOK, firstPass: 'remove pauses and filler words, add captions, add b-roll, add zoom, add music, add whoosh sfx',
    cardBg: 'linear-gradient(155deg, hsl(38 42% 34%), hsl(66 38% 18%))', cardInk: '#F2A93B',
  },
];

/** Explainer (9:16): built from the purple-and-paper reference reel. Offered in New video with the reel as its preview. */
TEMPLATES.push({
  id: 'explainer', name: 'Explainer', description: 'Light italic setup line, bold key line; words land as they are spoken, numbers count up. Text sits in calm space, never on a face, inside the Reels safe area. Lists become labels.',
  captionPreset: 'pixel', pace: 'Steady', hue: 280, sample: ['until you see what Google is', 'actually planning'],
  look: { grade: 'none', vignette: false, brollLayout: 'full', slideBg: 'paper', accent: '#8537BB' },
  firstPass: 'remove pauses and filler words',
  cardBg: '#EBEBE4', cardInk: '#2D0F48',
  aspects: ['9:16'], previewVideo: '/templates/explainer.mp4', layout: 'explainer',
});

export const DEFAULT_LOOK = LOOK;

export const SAMPLE_PROJECTS: Project[] = [
  { id: 'p-ai-tools', title: '3 AI tools that save 10 hours', aspect: '9:16', updated: '12 min ago', status: 'Editing', hue: 38, duration: 32, templateId: 'cinematic-talk' },
  { id: 'p-sensex', title: 'Why Sensex fell 900 points', aspect: '9:16', updated: 'Yesterday', status: 'Exported', hue: 8, duration: 47, templateId: 'kinetic-type' },
  { id: 'p-founder', title: 'Founder story — Zerodha', aspect: '9:16', updated: '2 days ago', status: 'Draft', hue: 280, duration: 61, templateId: 'hinglish-type' },
  { id: 'p-podcast', title: 'Podcast ep. 14 highlights', aspect: '16:9', updated: 'Last week', status: 'Exported', hue: 190, duration: 94, templateId: 'ai-story' },
];
