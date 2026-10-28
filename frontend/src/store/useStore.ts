'use client';
import { create } from 'zustand';
import { deleteMedia, fetchStock, generateImage, online, serverCaps, startAnalysis, startBrollAnalysis, uploadFile, waitForJob, type Analysis, type BrollAnalysis } from '../lib/api';
import { baseTimeline } from '@shared/autoEdit';
import { askDirector } from '../lib/director-client';
import { planEdit } from '@shared/director-mock';
import { applyOps, TRACK_IDS, timelineDuration, validateOps } from '@shared/ops';
import { buildTranscript, captionsFromPreset, DEFAULT_LOOK, SAMPLE_PROJECTS, TEMPLATES } from '@shared/sample';
import { explainerBroll, explainerLayers } from '@shared/explainer';
import { imagePromptFor, motionFor } from '@shared/motion';
import { ratioOf } from '@shared/frame/Thumb';

/** The house style every first cut uses: pixel captions, punch-ins, sound design. Not shown as a choice. */
const HOUSE = TEMPLATES.find((t) => t.id === 'pixel-talk') ?? TEMPLATES[0];
/** The style a project is cut in: a chosen style (Explainer) or the house style. */
const templateFor = (p: Pick<Project, 'templateId'>) => TEMPLATES.find((t) => t.id === p.templateId && t.layout === 'explainer') ?? HOUSE;

const ANALYZE_STEPS = ['Reading footage', 'Making a preview copy', 'Finding pauses and your face', 'Transcribing speech'];
import type {
  AspectRatio, Asset, AssetKind, CaptionSettings, Look, ChangeSet, ChatMessage, Clip, Job, Pause, Project,
  ProjectSummary, Selection, TimelineSnapshot, Track, TrackState, Word,
} from '@shared/types';
import { aspectOf, clamp, hashHue, timecode, uid } from '@shared/util';

export type View = 'dashboard' | 'editor';
export type LeftTab = 'media' | 'captions' | 'audio' | 'generate';

/** Top to bottom in draw order: what's listed first is drawn on top. */
export const TRACKS: Track[] = [
  { id: TRACK_IDS.key, kind: 'key', label: 'Key line', optional: true },
  { id: TRACK_IDS.setup, kind: 'setup', label: 'Setup line', optional: true },
  { id: TRACK_IDS.labels, kind: 'labels', label: 'Labels', optional: true },
  { id: TRACK_IDS.overlay, kind: 'overlay', label: 'Graphics' },
  { id: TRACK_IDS.look, kind: 'look', label: 'Look', optional: true },
  { id: TRACK_IDS.broll, kind: 'broll', label: 'B-roll' },
  { id: TRACK_IDS.aroll, kind: 'aroll', label: 'A-roll' },
  { id: TRACK_IDS.plate, kind: 'plate', label: 'Background', optional: true },
  { id: TRACK_IDS.captions, kind: 'captions', label: 'Captions' },
  { id: TRACK_IDS.sfx, kind: 'sfx', label: 'SFX' },
  { id: TRACK_IDS.music, kind: 'music', label: 'Music' },
];

export interface UploadedFile {
  file?: File;
  name: string;
  size: number;
  kind: AssetKind;
  url?: string;
  duration?: number;
  ratio?: number; // width / height, read from the file
}

export interface WizardResult {
  title: string;
  aspect: AspectRatio;
  brief: string;
  files: UploadedFile[];
  /** A chosen style (e.g. 'explainer'); the house style when unset. */
  templateId?: string;
  /** Spoken language for speech-to-text: 'auto' or a Whisper code (en, hi, gu…). */
  language?: string;
}

interface BuildStatus {
  steps: string[];
  index: number;
  progress?: number; // 0–1 within the current step
  error?: string;
}

interface RealMedia {
  words: Word[];
  pauses: Pause[];
  duration: number;
  transcript: 'speech' | 'none' | 'failed';
}

interface State {
  view: View;
  /** Dashboard search text. */
  query: string;
  setQuery: (q: string) => void;
  wizardOpen: boolean;
  projects: Project[];
  project: Project | null;

  assets: Asset[];
  clips: Clip[];
  words: Word[];
  pauses: Pause[];
  captions: CaptionSettings;
  look: Look;
  jobs: Job[];
  changeSets: ChangeSet[];
  messages: ChatMessage[];
  thinking: boolean;

  playhead: number;
  playing: boolean;
  selection: Selection | null;
  selectedClipIds: string[];
  pxPerSec: number;
  leftTab: LeftTab;
  /** Timeline tool: select/move/trim, or razor (click a clip to cut it). */
  tool: 'select' | 'razor';
  /** Clips and the playhead snap to edit points while dragging. */
  snapping: boolean;
  /** Eye / mute / lock / volume per track id. */
  tracks: Record<string, TrackState>;
  exportOpen: boolean;
  building: BuildStatus | null;
  sampleTranscript: boolean;

  past: TimelineSnapshot[];
  future: TimelineSnapshot[];

  go: (view: View) => void;
  wizardFiles: UploadedFile[];
  openWizard: (files?: UploadedFile[]) => void;
  closeWizard: () => void;
  openProject: (id: string) => void;
  /** Removes a project from the library (and its saved editor state). */
  deleteProject: (id: string) => void;
  createProject: (r: WizardResult) => void;
  setAspect: (a: AspectRatio) => void;
  setStatus: (status: Project['status']) => void;
  rename: (title: string) => void;

  setPlayhead: (t: number) => void;
  togglePlay: () => void;
  setPlaying: (p: boolean) => void;
  setSelection: (s: Selection | null) => void;
  selectClip: (id: string, additive: boolean) => void;
  clearSelection: () => void;
  setPxPerSec: (n: number) => void;
  setTool: (t: State['tool']) => void;
  toggleSnapping: () => void;
  setTrack: (id: string, patch: Partial<TrackState>) => void;
  /** Clip volume in dB; call beginGesture first so a drag is one undo step. */
  setClipGain: (id: string, db: number) => void;
  /** Cut one clip at time t (razor tool). */
  razorAt: (id: string, t: number) => void;
  markIn: () => void;
  markOut: () => void;
  clearInOut: () => void;
  /** Move the playhead to the previous or next cut. */
  jumpEdit: (dir: -1 | 1) => void;
  setLeftTab: (t: LeftTab) => void;
  setExportOpen: (o: boolean) => void;

  beginGesture: () => void;
  moveClip: (id: string, start: number) => void;
  trimClip: (id: string, edge: 'left' | 'right', t: number) => void;
  splitAtPlayhead: () => void;
  deleteSelected: () => void;
  undo: () => void;
  redo: () => void;

  addAsset: (f: UploadedFile) => void;
  placeAsset: (assetId: string) => void;
  insertLibrary: (kind: 'music' | 'sfx', name: string, len: number) => void;
  setCaptions: (patch: Partial<CaptionSettings>) => void;
  applyCaptionPreset: (id: string) => void;
  editWord: (id: string, text: string) => void;

  sendPrompt: (text: string) => Promise<void>;
  acceptChange: (id: string) => void;
  revertChange: (id: string) => void;
  tickJobs: (dt: number) => void;
}

const snap = (s: State): TimelineSnapshot => ({ clips: s.clips, words: s.words, pauses: s.pauses, captions: s.captions });

/** Where each track has material, for the dashboard's mini timeline. */
export function summarize(clips: Clip[], words: Word[], lastChange?: string): ProjectSummary {
  const dur = Math.max(1, timelineDuration(clips));
  const tracks: ProjectSummary['tracks'] = [];
  for (const t of TRACKS) {
    if (t.kind === 'captions') {
      // Caption phrases: runs of spoken words with short gaps.
      const spans: [number, number][] = [];
      for (const w of words.filter((w) => !w.filler)) {
        const last = spans.at(-1);
        const prev = words[words.indexOf(w) - 1];
        const breaks = !last || w.t - last[1] > 0.2 || (prev && /[.!?]$/.test(prev.w));
        if (breaks) spans.push([w.t, w.t + w.d]);
        else last[1] = w.t + w.d;
      }
      if (spans.length) tracks.push({ kind: 'captions', spans });
      continue;
    }
    const spans = clips.filter((c) => c.trackId === t.id).map((c): [number, number] => [c.start, c.start + c.duration]);
    if (spans.length) tracks.push({ kind: t.kind, spans });
  }
  return { duration: dur, tracks, lastChange };
}

/** What a project's editor holds, kept for the session so reopening resumes the real edit. */
type Saved = Pick<State, 'assets' | 'clips' | 'words' | 'pauses' | 'captions' | 'look' | 'jobs' | 'changeSets' | 'messages' | 'sampleTranscript'> & { tracks?: Record<string, TrackState> };
const saved = new Map<string, Saved>();

/**
 * Projects and their edits are kept in this browser, so a reload keeps what you made and what
 * you deleted. Local file previews (blob: URLs) don't survive a reload and are dropped.
 */
const STORE_KEY = 'cutroom-projects-v1';
const live = (url?: string) => (url?.startsWith('blob:') ? undefined : url);
function loadLocal(): { projects: Project[]; saved: [string, Saved][] } | null {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(STORE_KEY) : null;
    if (!raw) return null;
    const data = JSON.parse(raw) as { projects: Project[]; saved: [string, Saved][] };
    return {
      projects: data.projects.map((p) => ({ ...p, thumb: live(p.thumb), status: p.status === 'Rendering' ? 'Editing' : p.status })),
      saved: data.saved.map(([id, v]) => [id, { ...v, assets: v.assets.map((a) => ({ ...a, url: live(a.url) })) }]),
    };
  } catch {
    return null;
  }
}
function saveLocal(projects: Project[]) {
  try {
    const ids = new Set(projects.map((p) => p.id));
    localStorage.setItem(STORE_KEY, JSON.stringify({ projects, saved: [...saved].filter(([id]) => ids.has(id)) }));
  } catch {
    // Storage full or blocked (private window): the session still works, it just won't be remembered.
  }
}
const restored = loadLocal();
restored?.saved.forEach(([id, v]) => saved.set(id, v));

/** The sample projects open on the sample talk with the house first cut; their mini timeline shows that cut. */
function sampleSummary(): ProjectSummary {
  const { words, pauses, duration: dur } = buildTranscript();
  const aroll: Asset = { id: 'a-sample', name: 'Sample', kind: 'aroll', origin: 'upload', duration: dur, hue: 0 };
  const clips = baseTimeline(aroll, pauses, dur, words);
  const total = timelineDuration(clips);
  const plan = planEdit({ prompt: HOUSE.firstPass, selection: null, duration: total, context: { words, pauses, clips, aspect: '9:16' } });
  const out = applyOps({ clips, words, pauses, captions: captionsFromPreset(HOUSE.captionPreset, true) }, validateOps(plan.ops, null, total), 'cs-sample');
  return summarize(out.clips, out.words, `First cut: ${plan.summary.charAt(0).toLowerCase()}${plan.summary.slice(1)}`);
}

export const duration = (s: Pick<State, 'clips'>) => Math.max(1, timelineDuration(s.clips));

/** The range the AI is allowed to touch: an explicit range, else the selected clips, else everything. */
export function scopeOf(s: Pick<State, 'selection' | 'selectedClipIds' | 'clips'>): Selection | null {
  if (s.selection) return s.selection;
  const picked = s.clips.filter((c) => s.selectedClipIds.includes(c.id));
  if (!picked.length) return null;
  return { start: Math.min(...picked.map((c) => c.start)), end: Math.max(...picked.map((c) => c.start + c.duration)) };
}

export function scopeLabel(s: Pick<State, 'selection' | 'selectedClipIds' | 'clips'>): string {
  const sc = scopeOf(s);
  if (!sc) return 'Whole video';
  const n = s.selectedClipIds.length;
  return `${timecode(sc.start)}–${timecode(sc.end)}${n ? `, ${n} clip${n > 1 ? 's' : ''}` : ''}`;
}

/** What the server can make when there is no B-roll: refreshed before each first cut. */
let caps = { stock: false, images: false };

/** The picture mood for AI cutaways, from the style's look. */
const moodOf = (look: Look) =>
  look.grade === 'cinematic' ? 'Cinematic film still, moody low-key light, shallow depth of field, photorealistic'
    : look.slideBg === 'paper' ? 'Clean editorial photograph, soft natural light, muted paper-like tones, minimal composition'
      : look.grade === 'punchy' ? 'Bold, vivid, high-contrast commercial photo, clean background'
        : 'Photorealistic, vivid, crisp editorial photo, natural light, shallow depth of field';

const shapeOf = (asp: AspectRatio | undefined): 'portrait' | 'landscape' | 'square' => (asp === '16:9' || asp === '4:3' ? 'landscape' : asp === '1:1' ? 'square' : 'portrait');

export const useStore = create<State>((set, get) => {
  // Navigation or a newer prompt makes every earlier director response obsolete.
  let directorGeneration = 0;
  const record = () => set((s) => ({ past: [...s.past.slice(-49), snap(s)], future: [] }));

  const loadTimeline = (projectIn: Project, aroll: Asset, extra: Asset[], firstPass: boolean, media?: RealMedia, brief = '') => {
    let project = projectIn;
    const { words, pauses, duration: dur } = media ?? buildTranscript();
    const template = templateFor(project);
    const clips = baseTimeline(aroll, pauses, dur, words);
    project = { ...project, duration: Math.round(dur) };
    set((st) => ({ projects: st.projects.map((p) => (p.id === project.id ? project : p)) }));
    set({
      project, assets: [aroll, ...extra], clips, words, pauses, tracks: {},
      captions: captionsFromPreset(template.captionPreset, false), look: template.look,
      jobs: [], changeSets: [], messages: [], thinking: false, playhead: 0, playing: false, selection: null,
      selectedClipIds: [], past: [], future: [], view: 'editor', wizardOpen: false, sampleTranscript: !media,
    });
    if (firstPass) {
      const s = get();
      // The brief's own asks ("add music", "captions off"…) ride along with the house recipe.
      // B-roll in every first cut: the user's own cutaways when they gave some, stock footage matched to the script otherwise.
      const ownBroll = s.assets.some((a) => a.kind === 'broll' && a.url && a.duration > 0.5);
      const wantsBroll = /b-?roll|footage|stock|cutaway/i.test(template.firstPass + ' ' + brief);
      const brollAsk = ownBroll || wantsBroll ? '' : 'add b-roll';
      const plan = { prompt: [template.firstPass, brollAsk, brief].filter(Boolean).join('. '), selection: null, duration: duration(s), context: { words, pauses, clips, aspect: project.aspect } };
      // First pass runs locally for speed; the same ops would come from the server director.
      import('@shared/director-mock').then(({ planEdit }) => {
        const res = planEdit(plan);
        // Own footage wins over stock: drop the stock placeholders and cut the uploads in instead.
        if (ownBroll) res.ops = res.ops.filter((o) => !(o.op === 'insert_clip' && o.trackKind === 'broll' && o.origin === 'stock'));
        // No B-roll uploaded: each beat becomes a motion graphic in the style's colours, an AI image,
        // or a stock shot, rotating through what this server can make.
        const made = { motion: 0, image: 0, stock: 0 };
        if (!ownBroll) {
          const kinds: ('motion' | 'image' | 'stock')[] = ['motion', ...(online() && caps.images ? ['image' as const] : []), ...(online() && caps.stock ? ['stock' as const] : [])];
          let i = 0;
          res.ops = res.ops.map((o) => {
            if (!(o.op === 'insert_clip' && o.trackKind === 'broll' && o.origin === 'stock')) return o;
            const kind = kinds[i % kinds.length];
            const g = motionFor(words, o.start, o.start + o.duration, project.title, i);
            i++;
            made[kind]++;
            if (kind === 'stock') return o;
            if (kind === 'image') return { ...o, assetKind: 'image' as const, origin: 'generated' as const, label: g.text, credit: 'AI image', job: { type: 'image' as const, eta: 14 } };
            return { ...o, assetKind: 'graphic' as const, origin: 'library' as const, label: g.text, credit: undefined, job: undefined, graphic: g };
          });
        }
        const csId = uid('cs');
        const before = snap(get());
        const out = applyOps(before, validateOps(res.ops, null, plan.duration), csId);
        let summary = res.summary;
        if (!ownBroll && made.motion + made.image > 0) {
          const parts = [made.motion && `${made.motion} motion-graphic cutaway${made.motion > 1 ? 's' : ''} in the style’s colours`, made.image && `${made.image} AI image${made.image > 1 ? 's' : ''}`, made.stock && `${made.stock} stock shot${made.stock > 1 ? 's' : ''}`].filter(Boolean);
          summary = summary.replace(/matched \d+ B-roll shots? to your script/i, (m) => `${m[0] === 'M' ? 'Made' : 'made'} ${parts.join(', ')} for B-roll`);
        }
        let captionsOn = true;
        if (template.layout !== 'explainer' && ownBroll) {
          const broll = explainerBroll({ clips: out.clips, words: out.words, assets: [...get().assets, ...out.assets] }).map((c) => ({ ...c, changeSetId: csId }));
          out.clips = [...out.clips, ...broll];
          if (broll.length) summary = `${summary.replace(/\.$/, '')}, cut in ${broll.length} of your B-roll shot${broll.length > 1 ? 's' : ''}`;
        }
        if (template.layout === 'explainer') {
          // Explainer: B-roll on the beats, then every line, label stack, the look and the plate as their own clips.
          const assetsNow = [...get().assets, ...out.assets];
          const broll = explainerBroll({ clips: out.clips, words: out.words, assets: assetsNow }).map((c) => ({ ...c, changeSetId: csId }));
          const withBroll = [...out.clips, ...broll];
          const layers = explainerLayers({ clips: withBroll, words: out.words, assets: assetsNow, ratio: ratioOf(project.aspect) }).map((c) => ({ ...c, changeSetId: csId }));
          out.clips = [...withBroll, ...layers];
          captionsOn = false;
          const n = (id: string) => layers.filter((c) => c.trackId === id).length;
          summary = `${res.summary.replace(/\.$/, '')}, laid out ${n(TRACK_IDS.setup) + n(TRACK_IDS.key)} text lines as separate setup and key layers${n(TRACK_IDS.labels) ? `, ${n(TRACK_IDS.labels)} label stack${n(TRACK_IDS.labels) > 1 ? 's' : ''}` : ''}${broll.length ? `, cut in ${broll.length} B-roll shot${broll.length > 1 ? 's' : ''}` : ''}, and added the paper background and film grain`;
        }
        set((st) => ({
          clips: out.clips, words: out.words, pauses: out.pauses,
          captions: { ...captionsFromPreset(template.captionPreset, captionsOn) },
          assets: [...st.assets, ...out.assets], jobs: [...st.jobs, ...out.jobs],
          changeSets: [{ id: csId, prompt: 'First cut', summary, scope: 'Whole video', status: 'accepted', snapshot: before }],
          messages: [{ id: uid('m'), role: 'editor', text: `Your first cut is ready. I ${summary.charAt(0).toLowerCase()}${summary.slice(1)}.${media && media.transcript !== 'speech' ? (media.transcript === 'failed' ? ' Speech-to-text didn’t respond, so there are no captions yet.' : ' Captions need speech-to-text, which isn’t set up on this server yet.') : ''} Select any part of the timeline and tell me what to change.`, changeSetId: csId }],
        }));
      });
    }
  };

  /** Stock B-roll: search Pexels for the clip's label, store it on the server, swap it in. One request per job. */
  const stockStarted = new Set<string>();
  let toldNoKey = false;
  let stockQueue: Promise<unknown> = Promise.resolve();
  const runStock = (job: Job) => {
    if (stockStarted.has(job.id)) return;
    stockStarted.add(job.id);
    // One search at a time, so each cutaway knows which shots are already used and picks a different one.
    stockQueue = stockQueue.then(() => {
      const s = get();
      const clip = s.clips.find((c) => c.id === job.clipId);
      if (!clip) return;
      const asp = s.project?.aspect ?? '9:16';
      const orientation = asp === '16:9' || asp === '4:3' ? 'landscape' : asp === '1:1' ? 'square' : 'portrait';
      const exclude = s.assets.map((a) => Number(a.name.match(/\(Pexels (\d+)\)/)?.[1])).filter((n) => n > 0);
      return fetchStock({ query: clip.label, orientation, minDuration: clip.duration, exclude })
        .then((r) => {
          const st = get();
          if (!st.clips.some((c) => c.id === clip.id)) return;
          set({
            assets: st.assets.map((a) => (a.id === clip.assetId ? { ...a, name: r.name, url: r.url, serverId: r.id, duration: r.duration, width: r.width, height: r.height, credit: r.credit } : a)),
            clips: st.clips.map((c) => (c.id === clip.id ? { ...c, status: 'ready', in: 0, duration: Math.min(c.duration, r.duration) } : c)),
            jobs: st.jobs.map((j) => (j.id === job.id ? { ...j, progress: 1, status: 'done' } : j)),
          });
        })
        .catch((err: Error & { code?: string }) => {
          const st = get();
          // A cutaway with no footage would export as a blank card: make it a motion graphic instead.
          set({
            clips: st.clips.map((c) => (c.id === clip.id ? { ...c, status: 'ready', jobId: undefined, graphic: motionFor(st.words, c.start, c.start + c.duration, s.project?.title ?? c.label, 1) } : c)),
            jobs: st.jobs.map((j) => (j.id === job.id ? { ...j, status: 'failed' } : j)),
            ...(err.code === 'no-key' && !toldNoKey
              ? { messages: [...st.messages, { id: uid('m'), role: 'editor' as const, text: `I couldn’t add stock B-roll (${err.message}), so those cutaways are motion graphics for now. Upload your own B-roll in Media and I’ll cut it in.` }] }
              : {}),
          });
          if (err.code === 'no-key') toldNoKey = true;
        });
    });
  };

  /** AI image cutaways: two at a time; a failed one leaves the timeline (no blank cards in the export). */
  const imageSlots: Promise<unknown>[] = [Promise.resolve(), Promise.resolve()];
  let imageTurn = 0;
  const runImage = (job: Job) => {
    if (stockStarted.has(job.id)) return;
    stockStarted.add(job.id);
    const slot = imageTurn++ % imageSlots.length;
    imageSlots[slot] = imageSlots[slot].then(() => {
      const s = get();
      const clip = s.clips.find((c) => c.id === job.clipId);
      if (!clip) return;
      const prompt = imagePromptFor(s.words, clip.start, clip.start + clip.duration, clip.label || s.project?.title || 'creator', moodOf(s.look));
      return generateImage({ prompt, shape: shapeOf(s.project?.aspect), label: clip.label })
        .then((r) => {
          const st = get();
          if (!st.clips.some((c) => c.id === clip.id)) return;
          set({
            assets: st.assets.map((a) => (a.id === clip.assetId ? { ...a, name: r.name, url: r.url, serverId: r.id, kind: 'image', duration: 0, width: r.width, height: r.height, credit: 'AI image' } : a)),
            clips: st.clips.map((c) => (c.id === clip.id ? { ...c, status: 'ready', in: 0 } : c)),
            jobs: st.jobs.map((j) => (j.id === job.id ? { ...j, progress: 1, status: 'done' } : j)),
          });
        })
        .catch((err: Error & { code?: string }) => {
          const st = get();
          // Fall back to a motion graphic for B-roll beats; drop failed overlay images.
          const onBroll = clip.trackId === TRACK_IDS.broll;
          set({
            clips: onBroll
              ? st.clips.map((c) => (c.id === clip.id ? { ...c, status: 'ready', jobId: undefined, graphic: motionFor(st.words, c.start, c.start + c.duration, c.label, 0) } : c))
              : st.clips.filter((c) => c.id !== clip.id),
            jobs: st.jobs.map((j) => (j.id === job.id ? { ...j, status: 'failed' } : j)),
            ...(!toldImageErr ? { messages: [...st.messages, { id: uid('m'), role: 'editor' as const, text: `I couldn’t generate an AI image (${err.message}), so I used a motion graphic there instead.` }] } : {}),
          });
          toldImageErr = true;
        });
    });
  };
  let toldImageErr = false;

  /** Real pipeline: upload every file, analyse the A-roll, then make the first cut. */
  const buildFromServer = async (projectIn: Project, brief: string, files: UploadedFile[], arollFile: UploadedFile, language = 'auto') => {
    let project = projectIn;
    const steps = ['Uploading footage', ...ANALYZE_STEPS, 'Making the first cut'];
    const setStep = (index: number, progress = 0) => set({ building: { steps, index, progress } });
    setStep(0);
    try {
      const sizes = files.map((f) => f.size || 1);
      const total = sizes.reduce((a, b) => a + b, 0);
      const done = files.map(() => 0);
      const uploaded = await Promise.all(
        files.map((f, i) =>
          f.file
            ? uploadFile(f.file, f.kind, (p) => {
                done[i] = p * sizes[i];
                setStep(0, done.reduce((a, b) => a + b, 0) / total);
              })
            : Promise.resolve(null),
        ),
      );
      const arollUp = uploaded[files.indexOf(arollFile)]!;
      caps = await serverCaps();
      const { jobId } = await startAnalysis(arollUp.id, language);
      // B-roll: shape and calm areas, so text over a cutaway lands in its quiet space too.
      const brollP = Promise.all(files.map(async (f, i) => {
        const up = uploaded[i];
        if (f === arollFile || f.kind !== 'broll' || !up) return null;
        try {
          const j = await startBrollAnalysis(up.id);
          return await waitForJob<BrollAnalysis>(j.jobId, () => undefined);
        } catch { return null; }
      }));
      const analysis = await waitForJob<Analysis>(jobId, (j) => setStep(1 + Math.min(j.step, ANALYZE_STEPS.length - 1), j.steps.length ? (j.progress * j.steps.length) % 1 : 0));
      const brollInfo = await brollP;
      setStep(steps.length - 1);

      const aroll: Asset = { id: uid('a'), name: arollFile.name, kind: 'aroll', origin: 'upload', duration: analysis.duration, url: arollUp.url, hue: project.hue, size: arollFile.size, serverId: arollUp.id, faces: analysis.faces,
        width: analysis.width, height: analysis.height, calm: analysis.calm, audioOnly: analysis.hasVideo === false };
      const extra: Asset[] = files
        .map((f, i) => ({ f, up: uploaded[i] }))
        .filter(({ f }) => f !== arollFile)
        .map(({ f, up }) => {
          const info = brollInfo[files.indexOf(f)];
          return { id: uid('a'), name: f.name, kind: f.kind, origin: 'upload' as const, duration: info?.duration ?? f.duration ?? 0, url: up?.url ?? f.url, hue: hashHue(f.name), size: f.size, serverId: up?.id, width: info?.width, height: info?.height, calm: info?.calm, faces: info?.faces };
        });
      const media: RealMedia = { words: analysis.words, pauses: analysis.pauses, duration: analysis.duration, transcript: analysis.transcript };
      // 'Match footage' keeps the upload's own shape.
      if (project.aspect === 'source') project = { ...project, aspect: (analysis.hasVideo === false ? null : aspectOf(analysis.width, analysis.height)) ?? '16:9' };
      set({ building: null });
      loadTimeline(project, aroll, extra, true, media, brief);
    } catch (err) {
      set((s) => ({ building: s.building ? { ...s.building, error: err instanceof Error ? err.message : 'Something went wrong.' } : null }));
    }
  };

  return {
    view: 'dashboard', wizardOpen: false, query: '',
    setQuery: (query) => set({ query }),
    projects: restored?.projects ?? (() => { const sum = sampleSummary(); return SAMPLE_PROJECTS.map((p) => ({ ...p, summary: sum })); })(), project: null,
    assets: [], clips: [], words: [], pauses: [], captions: captionsFromPreset('bold-pop'), look: DEFAULT_LOOK,
    jobs: [], changeSets: [], messages: [], thinking: false,
    playhead: 0, playing: false, selection: null, selectedClipIds: [], pxPerSec: 34, tool: 'select', snapping: true, tracks: {},
    leftTab: 'media', exportOpen: false, building: null, sampleTranscript: true,
    past: [], future: [],

    go: (view) => {
      const s = get();
      if (view !== s.view) directorGeneration++;
      if (s.view === 'editor' && view !== 'editor' && s.project) {
        const { assets, clips, words, pauses, captions, look, jobs, changeSets, messages, sampleTranscript, tracks } = s;
        saved.set(s.project.id, { assets, clips, words, pauses, captions, look, jobs, changeSets, messages, sampleTranscript, tracks });
        const project: Project = { ...s.project, summary: summarize(clips, words, (() => { const c = changeSets.filter((x) => x.status !== 'reverted').at(-1); return c ? (c.prompt === 'First cut' ? `First cut: ${c.summary.charAt(0).toLowerCase()}${c.summary.slice(1)}` : c.summary) : undefined; })()), duration: Math.round(duration(s)), updated: 'Just now', status: s.project.status === 'Draft' ? 'Editing' : s.project.status };
        set((st) => ({ projects: [project, ...st.projects.filter((p) => p.id !== project.id)], project }));
      }
      set({ view, playing: false, thinking: view === s.view ? s.thinking : false });
    },
    wizardFiles: [],
    openWizard: (files = []) => set({ wizardOpen: true, wizardFiles: files }),
    closeWizard: () => set({ wizardOpen: false }),

    deleteProject: (id) => {
      // Uploaded footage for this project is removed from the server too, so it doesn't pile up.
      const st = get();
      const assets = st.project?.id === id ? st.assets : saved.get(id)?.assets ?? [];
      if (online()) for (const a of assets) if (a.serverId) void deleteMedia(a.serverId);
      saved.delete(id);
      set((s) => ({
        projects: s.projects.filter((p) => p.id !== id),
        ...(s.project?.id === id ? { project: null, view: 'dashboard' as View } : {}),
      }));
    },

    openProject: (id) => {
      const project = get().projects.find((p) => p.id === id);
      if (!project) return;
      directorGeneration++;
      const keep = saved.get(id);
      if (keep) {
        set({ tracks: {}, ...keep, project, view: 'editor', thinking: false, playhead: 0, playing: false, selection: null, selectedClipIds: [], past: [], future: [], wizardOpen: false });
        return;
      }
      const aroll: Asset = { id: uid('a'), name: 'Talking head, take 2', kind: 'aroll', origin: 'upload', duration: 40, hue: project.hue };
      const extra: Asset[] = [
        { id: uid('a'), name: 'Desk setup, wide', kind: 'broll', origin: 'upload', duration: 8, hue: 210 },
        { id: uid('a'), name: 'Phone scroll', kind: 'broll', origin: 'upload', duration: 6, hue: 160 },
        { id: uid('a'), name: 'Script.docx', kind: 'script', origin: 'upload', duration: 0, hue: 50 },
      ];
      loadTimeline(project, aroll, extra, true);
    },

    createProject: (r) => {
      directorGeneration++;
      const template = TEMPLATES.find((t) => t.id === r.templateId) ?? HOUSE;
      const localAspect = r.aspect === 'source' ? (r.files.find((f) => f.kind === 'aroll')?.ratio ? aspectOf(r.files.find((f) => f.kind === 'aroll')!.ratio! * 1000, 1000) : null) : null;
      const project: Project = { id: uid('p'), title: r.title || 'Untitled video', aspect: template.aspects?.length === 1 ? template.aspects[0] : localAspect ?? (r.aspect === 'source' && !(online() && r.files.some((f) => f.kind === 'aroll' && f.file)) ? '16:9' : r.aspect), updated: 'Just now', status: 'Editing', hue: template.hue, duration: 0, templateId: template.id, thumb: r.files.find((f) => f.kind === 'aroll')?.url };
      const files = r.files;
      const arollFile = files.find((f) => f.kind === 'aroll');
      const aroll: Asset = arollFile
        ? { id: uid('a'), name: arollFile.name, kind: 'aroll', origin: 'upload', duration: arollFile.duration ?? 40, url: arollFile.url, hue: template.hue, size: arollFile.size }
        : { id: uid('a'), name: 'Sample talking head', kind: 'aroll', origin: 'upload', duration: 40, hue: template.hue };
      const extra: Asset[] = files.filter((f) => f !== arollFile).map((f) => ({ id: uid('a'), name: f.name, kind: f.kind, origin: 'upload', duration: f.duration ?? 0, url: f.url, hue: hashHue(f.name), size: f.size }));
      set((s) => ({ projects: [project, ...s.projects], wizardOpen: false, view: 'editor', project, clips: [], assets: [], thinking: false }));

      if (online() && arollFile?.file) {
        void buildFromServer(project, r.brief, files, arollFile, r.language);
        return;
      }

      // Preview build or no A-roll: sample footage with a simulated build.
      set({ building: { steps: ['Uploading footage', 'Transcribing speech', 'Finding pauses and filler words', 'Making the first cut', 'Placing graphics and sound'], index: 0 } });
      const advance = (i: number) => {
        if (i >= 5) {
          set({ building: null });
          loadTimeline(project, aroll, extra, true, undefined, r.brief);
          return;
        }
        set((s) => (s.building ? { building: { ...s.building, index: i } } : {}));
        setTimeout(() => advance(i + 1), 650 + Math.random() * 350);
      };
      advance(0);
    },

    setAspect: (aspect) => set((s) => (s.project ? { project: { ...s.project, aspect } } : {})),
    setStatus: (status) => set((s) => {
      if (!s.project) return {};
      const project = { ...s.project, status, updated: 'Just now' };
      return { project, projects: s.projects.map((p) => (p.id === project.id ? project : p)) };
    }),
    rename: (title) => set((s) => (s.project ? { project: { ...s.project, title } } : {})),

    setPlayhead: (t) => set((s) => ({ playhead: clamp(t, 0, duration(s)) })),
    togglePlay: () => set((s) => ({ playing: !s.playing, playhead: s.playhead >= duration(s) - 0.05 ? 0 : s.playhead })),
    setPlaying: (playing) => set({ playing }),
    setSelection: (selection) => set({ selection, selectedClipIds: [] }),
    selectClip: (id, additive) =>
      set((s) => ({
        selection: null,
        selectedClipIds: additive ? (s.selectedClipIds.includes(id) ? s.selectedClipIds.filter((x) => x !== id) : [...s.selectedClipIds, id]) : [id],
      })),
    clearSelection: () => set({ selection: null, selectedClipIds: [] }),
    setPxPerSec: (n) => set({ pxPerSec: clamp(n, 6, 240) }),
    setTool: (tool) => set({ tool }),
    toggleSnapping: () => set((s) => ({ snapping: !s.snapping })),
    setTrack: (id, patch) => set((s) => ({ tracks: { ...s.tracks, [id]: { ...s.tracks[id], ...patch } } })),
    setClipGain: (id, db) => set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, gainDb: Math.round(clamp(db, -60, 15) * 10) / 10 } : c)) })),
    razorAt: (id, t) => {
      const s = get();
      const c = s.clips.find((x) => x.id === id);
      if (!c || s.tracks[c.trackId]?.locked || t <= c.start + 0.05 || t >= c.start + c.duration - 0.05) return;
      record();
      set((st) => ({
        clips: st.clips.flatMap((x) => (x.id !== id ? [x] : [{ ...x, duration: t - x.start }, { ...x, id: uid('c'), start: t, in: x.in + (t - x.start), duration: x.start + x.duration - t }])),
      }));
    },
    markIn: () => set((s) => {
      const end = s.selection && s.selection.end > s.playhead + 0.05 ? s.selection.end : duration(s);
      return end - s.playhead < 0.05 ? {} : { selection: { start: s.playhead, end }, selectedClipIds: [] };
    }),
    markOut: () => set((s) => {
      const start = s.selection && s.selection.start < s.playhead - 0.05 ? s.selection.start : 0;
      return s.playhead - start < 0.05 ? {} : { selection: { start, end: s.playhead }, selectedClipIds: [] };
    }),
    clearInOut: () => set({ selection: null }),
    jumpEdit: (dir) => set((s) => {
      const pts = [...new Set([0, duration(s), ...s.clips.filter((c) => c.trackId === TRACK_IDS.aroll || c.trackId === TRACK_IDS.broll).flatMap((c) => [c.start, c.start + c.duration])])].sort((a, b) => a - b);
      const t = dir > 0 ? pts.find((p) => p > s.playhead + 0.01) : [...pts].reverse().find((p) => p < s.playhead - 0.01);
      return t === undefined ? {} : { playhead: t };
    }),
    setLeftTab: (leftTab) => set({ leftTab }),
    setExportOpen: (exportOpen) => set({ exportOpen, playing: false }),

    beginGesture: record,
    moveClip: (id, start) => set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, start: Math.max(0, start) } : c)) })),
    trimClip: (id, edge, t) =>
      set((s) => ({
        clips: s.clips.map((c) => {
          if (c.id !== id) return c;
          const end = c.start + c.duration;
          if (edge === 'left') {
            const ns = clamp(t, Math.max(0, c.start - c.in), end - 0.2);
            return { ...c, start: ns, in: c.in + (ns - c.start), duration: end - ns };
          }
          return { ...c, duration: Math.max(0.2, t - c.start) };
        }),
      })),
    splitAtPlayhead: () => {
      const s = get();
      const t = s.playhead;
      const targets = s.clips.filter((c) => !s.tracks[c.trackId]?.locked && t > c.start + 0.05 && t < c.start + c.duration - 0.05 && (s.selectedClipIds.length ? s.selectedClipIds.includes(c.id) : c.trackId === TRACK_IDS.aroll));
      if (!targets.length) return;
      record();
      set((st) => ({
        clips: st.clips.flatMap((c) => {
          if (!targets.includes(c)) return [c];
          const left = t - c.start;
          return [{ ...c, duration: left }, { ...c, id: uid('c'), start: t, in: c.in + left, duration: c.duration - left }];
        }),
      }));
    },
    deleteSelected: () => {
      const s = get();
      if (s.selectedClipIds.length) {
        record();
        set((st) => ({ clips: st.clips.filter((c) => !st.selectedClipIds.includes(c.id) || st.tracks[c.trackId]?.locked), selectedClipIds: [] }));
      } else if (s.selection) {
        record();
        const out = applyOps(snap(s), [{ op: 'ripple_delete', start: s.selection.start, end: s.selection.end }], uid('cs'));
        set({ clips: out.clips, words: out.words, pauses: out.pauses, selection: null, playhead: s.selection.start });
      }
    },
    undo: () => {
      const s = get();
      const prev = s.past.at(-1);
      if (!prev) return;
      set({ ...prev, past: s.past.slice(0, -1), future: [snap(s), ...s.future] });
    },
    redo: () => {
      const s = get();
      const next = s.future[0];
      if (!next) return;
      set({ ...next, future: s.future.slice(1), past: [...s.past, snap(s)] });
    },

    addAsset: (f) => {
      const id = uid('a');
      set((s) => ({ assets: [...s.assets, { id, name: f.name, kind: f.kind, origin: 'upload', duration: f.duration ?? (f.kind === 'image' ? 0 : 5), url: f.url, hue: hashHue(f.name), size: f.size }] }));
      // Show the local copy right away; swap to the stored copy once it is uploaded so exports can use it.
      if (online() && f.file) {
        uploadFile(f.file, f.kind)
          .then((up) => set((s) => ({ assets: s.assets.map((a) => (a.id === id ? { ...a, url: up.url, serverId: up.id } : a)) })))
          .catch(() => set((s) => ({ messages: [...s.messages, { id: uid('m'), role: 'editor', text: `“${f.name}” didn’t finish uploading, so it will show as a placeholder in exports. Add it again to retry.` }] })));
      }
    },
    placeAsset: (assetId) => {
      const s = get();
      const a = s.assets.find((x) => x.id === assetId);
      if (!a || a.kind === 'script') return;
      record();
      const trackId = a.kind === 'music' ? TRACK_IDS.music : a.kind === 'sfx' ? TRACK_IDS.sfx : a.kind === 'image' || a.kind === 'graphic' ? TRACK_IDS.overlay : a.kind === 'aroll' ? TRACK_IDS.aroll : TRACK_IDS.broll;
      const len = a.duration > 0 ? Math.min(a.duration, 4) : 3;
      set({ clips: [...s.clips, { id: uid('c'), trackId, assetId: a.id, label: a.name, start: s.playhead, duration: len, in: 0, status: 'ready', hue: a.hue }] });
    },
    insertLibrary: (kind, name, len) => {
      const s = get();
      record();
      const hue = hashHue(name);
      const asset: Asset = { id: uid('a'), name, kind, origin: 'library', duration: len, hue };
      const sc = scopeOf(s);
      const start = sc ? sc.start : kind === 'music' ? 0 : s.playhead;
      const dur = kind === 'music' ? (sc ? sc.end - sc.start : duration(s)) : len;
      set({ assets: [...s.assets, asset], clips: [...s.clips, { id: uid('c'), trackId: kind === 'music' ? TRACK_IDS.music : TRACK_IDS.sfx, assetId: asset.id, label: name, start, duration: dur, in: 0, status: 'ready', hue }] });
    },
    setCaptions: (patch) => set((s) => ({ captions: { ...s.captions, ...patch } })),
    applyCaptionPreset: (id) => {
      record();
      set({ captions: captionsFromPreset(id, true) });
    },
    editWord: (id, text) => set((s) => ({ words: s.words.map((w) => (w.id === id ? { ...w, w: text } : w)) })),

    sendPrompt: async (text) => {
      const s = get();
      if (s.view !== 'editor' || !s.project) return;
      const projectId = s.project.id;
      const requestGeneration = ++directorGeneration;
      const scope = scopeOf(s);
      const label = scopeLabel(s);
      set({ thinking: true, messages: [...s.messages, { id: uid('m'), role: 'user', text, scope: label }] });
      const res = await askDirector({
        prompt: text,
        selection: scope,
        duration: duration(s),
        context: {
          words: s.words.map(({ t, d, w, filler }) => ({ t, d, w, filler })),
          pauses: s.pauses,
          clips: s.clips.map(({ trackId, label: l, start, duration: d }) => ({ trackId, label: l, start, duration: d })),
          aspect: s.project?.aspect ?? '9:16',
        },
      });
      if (get().project?.id !== projectId || get().view !== 'editor' || requestGeneration !== directorGeneration) return;
      const ops = validateOps(res.ops, scope, duration(get()));
      if (!ops.length) {
        set((st) => ({ thinking: false, messages: [...st.messages, { id: uid('m'), role: 'editor', text: res.reply }] }));
        return;
      }
      const before = snap(get());
      const csId = uid('cs');
      const out = applyOps(before, ops, csId);
      set((st) => ({
        thinking: false,
        past: [...st.past.slice(-49), before], future: [],
        clips: out.clips, words: out.words, pauses: out.pauses, captions: out.captions,
        assets: [...st.assets, ...out.assets], jobs: [...st.jobs, ...out.jobs],
        changeSets: [...st.changeSets, { id: csId, prompt: text, summary: res.summary, scope: label, status: 'preview', snapshot: before }],
        messages: [...st.messages, { id: uid('m'), role: 'editor', text: res.reply, changeSetId: csId }],
        playhead: scope ? scope.start : st.playhead,
      }));
    },
    acceptChange: (id) => set((s) => ({ changeSets: s.changeSets.map((c) => (c.id === id ? { ...c, status: 'accepted' } : c)) })),
    revertChange: (id) => {
      const s = get();
      const cs = s.changeSets.find((c) => c.id === id);
      if (!cs || cs.status === 'reverted') return;
      const live = s.changeSets.filter((c) => c.status !== 'reverted');
      const isLatest = live.at(-1)?.id === id;
      const clipIds = new Set(s.clips.filter((c) => c.changeSetId === id).map((c) => c.id));
      const base = isLatest
        ? { ...cs.snapshot }
        : { clips: s.clips.filter((c) => !(clipIds.has(c.id) && c.assetId && s.assets.find((a) => a.id === c.assetId)?.origin !== 'upload')).map((c) => (c.changeSetId === id ? { ...c, zoom: undefined } : c)) };
      set({
        ...base,
        past: [...s.past.slice(-49), snap(s)], future: [],
        jobs: s.jobs.map((j) => (clipIds.has(j.clipId) && j.status !== 'done' ? { ...j, status: 'failed' } : j)),
        changeSets: s.changeSets.map((c) => (c.id === id ? { ...c, status: 'reverted' } : c)),
      });
    },
    tickJobs: (dt) => {
      const s = get();
      if (!s.jobs.some((j) => j.status === 'queued' || j.status === 'running')) return;
      const finished: string[] = [];
      const jobs = s.jobs.map((j) => {
        if (j.status === 'done' || j.status === 'failed') return j;
        if (j.type === 'image' && online() && caps.images) {
          runImage(j);
          return { ...j, progress: Math.min(0.9, j.progress + dt / Math.max(8, j.eta)), status: 'running' as const };
        }
        if (j.type === 'stock' && online()) {
          // Real stock search: the server finishes it; the bar creeps toward 90 % meanwhile.
          runStock(j);
          return { ...j, progress: Math.min(0.9, j.progress + dt / Math.max(4, j.eta * 4)), status: 'running' as const };
        }
        const progress = Math.min(1, j.progress + dt / j.eta);
        if (progress >= 1) finished.push(j.clipId);
        return { ...j, progress, status: progress >= 1 ? ('done' as const) : ('running' as const) };
      });
      const running = new Set(jobs.filter((j) => j.status === 'running').map((j) => j.clipId));
      set({
        jobs,
        clips: s.clips.map((c) => (finished.includes(c.id) ? { ...c, status: 'ready' } : running.has(c.id) && c.status !== 'generating' ? { ...c, status: 'generating' } : c)),
      });
    },
  };
});

// Remember projects whenever the list changes (create, rename, status, delete, leaving the editor).
if (typeof window !== 'undefined') {
  let last = useStore.getState().projects;
  useStore.subscribe((st) => {
    if (st.projects === last) return;
    last = st.projects;
    saveLocal(st.projects);
  });
}
