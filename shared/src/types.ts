// Core data model. The timeline (tracks + clips + words) is the source of truth;
// every change — manual or AI — goes through EditOps so it can be undone.

export type AspectRatio = '9:16' | '1:1' | '4:5' | '16:9' | '4:3' | '3:4' | 'source';

export type TrackKind = 'aroll' | 'broll' | 'overlay' | 'captions' | 'sfx' | 'music' | 'plate' | 'look' | 'labels' | 'setup' | 'key';

export interface Track {
  id: string;
  kind: TrackKind;
  label: string;
  /** Only shown when it has clips (explainer layers). */
  optional?: boolean;
}

export type AssetKind = 'aroll' | 'broll' | 'image' | 'graphic' | 'screen' | 'sfx' | 'music' | 'script';
export type AssetOrigin = 'upload' | 'stock' | 'generated' | 'recorded' | 'library';

export interface Asset {
  id: string;
  name: string;
  kind: AssetKind;
  origin: AssetOrigin;
  duration: number; // seconds, 0 for stills
  url?: string; // object URL for real uploads
  hue: number; // used to draw a stand-in thumbnail when there is no real media
  credit?: string; // licence credit for sourced media
  size?: number;
  serverId?: string; // set once the file is stored on the server
  faces?: FaceSample[]; // face track in source time, so text never covers the speaker
  /** Source frame size, so faces and calm areas map correctly when the frame crops the footage. */
  width?: number;
  height?: number;
  /** Where the footage is busy or calm, and how bright, over time. */
  calm?: CalmSample[];
  /** Sound only (a voiceover): nothing to show, the plate or B-roll carries the picture. */
  audioOnly?: boolean;
}

/** Face centre and size as fractions of the frame, at source time t. */
export interface FaceSample {
  t: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ClipStatus = 'ready' | 'queued' | 'generating';

export interface Clip {
  id: string;
  trackId: string;
  assetId?: string;
  label: string;
  start: number; // timeline seconds
  duration: number;
  in: number; // offset into the source asset
  status: ClipStatus;
  jobId?: string;
  changeSetId?: string;
  zoom?: number; // punch-in scale, 1 = none
  graphic?: GraphicSpec;
  /** A line of text that is its own layer (explainer style): setup line or key line. */
  text?: TextSpec;
  /** A full-frame background plate. */
  plate?: PlateSpec;
  /** Film look: grain and vignette over the picture. */
  filmLook?: FilmLookSpec;
  hue: number;
}

/** One line of on-screen text, laid out at first cut and stored, so every surface draws it the same. */
export interface TextSpec {
  role: 'setup' | 'key';
  /** Each word and when it is spoken, in clip-local time (clip.in + t − clip.start), so moving or trimming the clip keeps it in sync. */
  words: { w: string; t: number }[];
  /** Left edge (align left), centre (center) or right edge (right) of the line, as a fraction of frame width. */
  x: number;
  /** Top of the line, as a fraction of frame height. */
  y: number;
  align: 'left' | 'center' | 'right';
  /** Font size as a fraction of frame width. */
  size: number;
  /** Text for a light background (ink) or a dark one (light). */
  tone: 'ink' | 'light';
  /** Max width as a fraction of frame width (lines wrap inside it). */
  maxW: number;
}

export interface PlateSpec { kind: 'paper' | 'night' | 'violet' }
export interface FilmLookSpec { grain: number; vignette: number }

/** Footage busyness and brightness on a coarse grid, sampled over time (for placing text in calm areas). */
export interface CalmSample { t: number; cols: number; rows: number; edge: number[]; luma: number[] }

export interface GraphicSpec {
  component: 'LowerThird' | 'Headline' | 'Counter' | 'Callout' | 'BigWord' | 'List' | 'UI' | 'Labels';
  text: string;
  sub?: string; // small kicker above a BigWord, second line of a LowerThird
  items?: string[]; // List rows
  active?: number; // List row being spoken (0-based)
  color?: string; // accent colour override
  slide?: boolean; // full-frame slide (covers the A-roll) instead of an overlay
  variant?: 'sans' | 'serif' | 'ips';
  bg?: 'white' | 'blue' | 'black' | 'paper';
  /** UI motion graphics: an app-style card that animates in beside the speaker. */
  ui?: 'profile' | 'videos' | 'notify' | 'chart' | 'logo' | 'network' | 'pages';
  value?: string;
  strike?: boolean;
  /** Which brand to draw (profile cards, logo, pages scene). */
  brand?: BrandId;
  /** Offsets in seconds from the card's start for each staged step (items, pages, nodes). */
  times?: number[];
  /** Where beside the speaker this graphic goes; auto picks the free side. */
  place?: 'left' | 'right' | 'auto';
  /** Stored position (explainer labels): left/centre/right edge x and top y as frame fractions, size as a fraction of width. */
  at?: { x: number; y: number; align: 'left' | 'center' | 'right'; size: number; tone: 'ink' | 'light' };
}

export type BrandId = 'tgf' | 'hiddentrip' | 'tezscroll' | 'fluxpedia' | 'generic';

export interface Word {
  id: string;
  t: number; // timeline seconds
  d: number;
  w: string;
  filler?: boolean;
}

export interface Pause {
  t: number;
  d: number;
}

export interface CaptionSettings {
  presetId: string;
  font: string;
  size: number; // % of frame width
  weight: number;
  uppercase: boolean;
  fill: string;
  stroke: string;
  strokeWidth: number;
  highlight: string;
  /** active: spoken word lit · keyword: long words/numbers lit · reveal: spoken words solid, upcoming faint */
  highlightMode: 'active' | 'keyword' | 'reveal' | 'none';
  /** Optional second face for lit words, e.g. a serif italic among sans words. */
  accentFont?: string;
  accentItalic?: boolean;
  /** line: words in a row · editorial: small words around the face, one key word huge per phrase */
  layout?: 'line' | 'editorial' | 'pixel';
  background: string;
  backgroundOpacity: number;
  wordsPerLine: number;
  position: number; // % from top
  animation: 'pop' | 'slide' | 'fade' | 'none';
  enabled: boolean;
}

/** Project-wide look from the template: colour grade and how B-roll sits in the frame. */
export interface Look {
  grade: 'none' | 'cinematic' | 'mono' | 'punchy';
  vignette: boolean;
  brollLayout: 'full' | 'split' | 'framed';
  slideBg: 'paper' | 'grid' | 'solid' | 'white';
  accent: string; // template accent colour for graphics
  /** Camera feel: slow push-in on every A-roll shot, punch-in on alternate cuts, zoom-blur settle at the start. */
  pushIn?: boolean;
  punchAlternate?: boolean;
  introSettle?: boolean;
  brollGrade?: Look['grade'];
}

export interface CaptionPreset {
  id: string;
  name: string;
  note: string;
  settings: Omit<CaptionSettings, 'presetId' | 'enabled'>;
}

export type JobType = 'image' | 'video' | 'screen' | 'stock' | 'music';

export interface Job {
  id: string;
  type: JobType;
  label: string;
  progress: number; // 0–1
  eta: number; // seconds total
  clipId: string;
  status: 'queued' | 'running' | 'done' | 'failed';
}

export interface ChangeSet {
  id: string;
  prompt: string;
  summary: string;
  scope: string;
  status: 'preview' | 'accepted' | 'reverted';
  snapshot: TimelineSnapshot;
}

export interface TimelineSnapshot {
  clips: Clip[];
  words: Word[];
  pauses: Pause[];
  captions: CaptionSettings;
}

export interface Selection {
  start: number;
  end: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'editor';
  text: string;
  scope?: string;
  changeSetId?: string;
  pending?: boolean;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  captionPreset: string;
  pace: 'Calm' | 'Steady' | 'Fast';
  hue: number;
  sample: string[];
  look: Look;
  /** What the first cut does, written as a request to the editor. */
  firstPass: string;
  /** Card background for the gallery preview. */
  cardBg: string;
  cardInk: string;
  /** Shapes the template supports (all when unset). */
  aspects?: AspectRatio[];
  /** A finished example of the style, played in the template card. */
  previewVideo?: string;
  /** How the first cut lays out text: the default caption flow, or explainer text layers. */
  layout?: 'captions' | 'explainer';
}

export interface Project {
  id: string;
  title: string;
  aspect: AspectRatio;
  updated: string;
  status: 'Draft' | 'Editing' | 'Rendering' | 'Exported';
  hue: number;
  duration: number;
  templateId?: string;
  /** Where each track has clips, saved when you leave the editor (drives the dashboard's mini timeline). */
  summary?: ProjectSummary;
  /** Footage URL used for the project's thumbnail frame. */
  thumb?: string;
}

export interface ProjectSummary {
  duration: number;
  /** The most recent change the editor made, in its own words. */
  lastChange?: string;
  tracks: { kind: TrackKind; spans: [number, number][] }[];
}

// Operations the director (or the user) can apply. The server validates these
// against the selection before anything touches the timeline.
export type EditOp =
  | { op: 'insert_clip'; trackKind: TrackKind; start: number; duration: number; label: string; assetKind: AssetKind; origin: AssetOrigin; job?: { type: JobType; eta: number }; graphic?: GraphicSpec; credit?: string }
  | { op: 'ripple_delete'; start: number; end: number }
  | { op: 'set_zoom'; start: number; end: number; zoom: number }
  | { op: 'set_caption_preset'; presetId: string }
  | { op: 'set_captions_enabled'; enabled: boolean };

export interface DirectorRequest {
  prompt: string;
  selection: Selection | null;
  duration: number;
  context: {
    words: Pick<Word, 't' | 'd' | 'w' | 'filler'>[];
    pauses: Pause[];
    clips: Pick<Clip, 'trackId' | 'label' | 'start' | 'duration'>[];
    aspect: AspectRatio;
  };
}

export interface DirectorResponse {
  reply: string;
  summary: string;
  ops: EditOp[];
}
