'use client';
import { create } from 'zustand';
import { online, startAnalysis, startBrollAnalysis, uploadFile, waitForJob, type Analysis, type BrollAnalysis } from '../lib/api';
import { baseTimeline } from '@shared/autoEdit';
import { askDirector } from '../lib/director-client';
import { planEdit } from '@shared/director-mock';
import { applyOps, TRACK_IDS, timelineDuration, validateOps } from '@shared/ops';
import { buildTranscript, captionsFromPreset, DEFAULT_LOOK, SAMPLE_PROJECTS, TEMPLATES } from '@shared/sample';
import { explainerBroll, explainerLayers } from '@shared/explainer';
import { ratioOf } from '@shared/frame/Thumb';

/** The house style every first cut uses: pixel captions, punch-ins, sound design. Not shown as a choice. */
const HOUSE = TEMPLATES.find((t) => t.id === 'pixel-talk') ?? TEMPLATES[0];
/** The style a project is cut in: a chosen style (Explainer) or the house style. */
const templateFor = (p: Pick<Project, 'templateId'>) => TEMPLATES.find((t) => t.id === p.templateId && t.layout === 'explainer') ?? HOUSE;

const ANALYZE_STEPS = ['Reading footage', 'Making a preview copy', 'Finding pauses and your face', 'Transcribing speech'];
import type {
  AspectRatio, Asset, AssetKind, CaptionSettings, Look, ChangeSet, ChatMessage, Clip, Job, Pause, Project,
  ProjectSummary, Selection, TimelineSnapshot, Track, Word,
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
type Saved = Pick<State, 'assets' | 'clips' | 'words' | 'pauses' | 'captions' | 'look' | 'jobs' | 'changeSets' | 'messages' | 'sampleTranscript'>;
const saved = new Map<string, Saved>();

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
      project, assets: [aroll, ...extra], clips, words, pauses,
      captions: captionsFromPreset(template.captionPreset, false), look: template.look,
      jobs: [], changeSets: [], messages: [], thinking: false, playhead: 0, playing: false, selection: null,
      selectedClipIds: [], past: [], future: [], view: 'editor', wizardOpen: false, sampleTranscript: !media,
    });
    if (firstPass) {
      const s = get();
      // The brief's own asks ("add music", "captions off"…) ride along with the house recipe.
      const plan = { prompt: [template.firstPass, brief].filter(Boolean).join('. '), selection: null, duration: duration(s), context: { words, pauses, clips, aspect: project.aspect } };
      // First pass runs locally for speed; the same ops would come from the server director.
      import('@shared/director-mock').then(({ planEdit }) => {
        const res = planEdit(plan);
        const csId = uid('cs');
        const before = snap(get());
        const out = applyOps(before, validateOps(res.ops, null, plan.duration), csId);
        let summary = res.summary;
        let captionsOn = true;
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

  /** Real pipeline: upload every file, analyse the A-roll, then make the first cut. */
  const buildFromServer = async (projectIn: Project, brief: string, files: UploadedFile[], arollFile: UploadedFile) => {
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
      const { jobId } = await startAnalysis(arollUp.id);
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
    projects: (() => { const sum = sampleSummary(); return SAMPLE_PROJECTS.map((p) => ({ ...p, summary: sum })); })(), project: null,
    assets: [], clips: [], words: [], pauses: [], captions: captionsFromPreset('bold-pop'), look: DEFAULT_LOOK,
    jobs: [], changeSets: [], messages: [], thinking: false,
    playhead: 0, playing: false, selection: null, selectedClipIds: [], pxPerSec: 34,
    leftTab: 'media', exportOpen: false, building: null, sampleTranscript: true,
    past: [], future: [],

    go: (view) => {
      const s = get();
      if (view !== s.view) directorGeneration++;
      if (s.view === 'editor' && view !== 'editor' && s.project) {
        const { assets, clips, words, pauses, captions, look, jobs, changeSets, messages, sampleTranscript } = s;
        saved.set(s.project.id, { assets, clips, words, pauses, captions, look, jobs, changeSets, messages, sampleTranscript });
        const project: Project = { ...s.project, summary: summarize(clips, words, (() => { const c = changeSets.filter((x) => x.status !== 'reverted').at(-1); return c ? (c.prompt === 'First cut' ? `First cut: ${c.summary.charAt(0).toLowerCase()}${c.summary.slice(1)}` : c.summary) : undefined; })()), duration: Math.round(duration(s)), updated: 'Just now', status: s.project.status === 'Draft' ? 'Editing' : s.project.status };
        set((st) => ({ projects: [project, ...st.projects.filter((p) => p.id !== project.id)], project }));
      }
      set({ view, playing: false, thinking: view === s.view ? s.thinking : false });
    },
    wizardFiles: [],
    openWizard: (files = []) => set({ wizardOpen: true, wizardFiles: files }),
    closeWizard: () => set({ wizardOpen: false }),

    openProject: (id) => {
      const project = get().projects.find((p) => p.id === id);
      if (!project) return;
      directorGeneration++;
      const keep = saved.get(id);
      if (keep) {
        set({ ...keep, project, view: 'editor', thinking: false, playhead: 0, playing: false, selection: null, selectedClipIds: [], past: [], future: [], wizardOpen: false });
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
        void buildFromServer(project, r.brief, files, arollFile);
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
    setPxPerSec: (n) => set({ pxPerSec: clamp(n, 12, 160) }),
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
      const targets = s.clips.filter((c) => t > c.start + 0.05 && t < c.start + c.duration - 0.05 && (s.selectedClipIds.length ? s.selectedClipIds.includes(c.id) : c.trackId === TRACK_IDS.aroll));
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
        set((st) => ({ clips: st.clips.filter((c) => !st.selectedClipIds.includes(c.id)), selectedClipIds: [] }));
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
