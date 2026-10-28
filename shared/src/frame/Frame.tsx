import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { TRACK_IDS } from '../ops';
import { DEFAULT_LOOK } from '../sample';
import type { Asset, CaptionSettings, Clip, FaceSample, GraphicSpec, Job, Look, Word } from '../types';
import { PagesScene, UICard } from './UICard';
import { MotionScene } from './Motion';
import { swatch } from '../util';
import { Person } from './Thumb';
import { pixelWidth } from './pixelMetrics';
import { coverMap } from '../explainer';
import { explainerAt, FilmLook, LabelStack, Plate, TextLine } from './Explainer';

/**
 * One frame of the edit at time t. The editor preview and the server renderer both
 * draw through this component, so what you see while editing is what gets exported.
 */
export type MediaSlot = 'aroll' | 'broll' | 'image';
export type RenderMedia = (slot: MediaSlot, asset: Asset, localTime: number, clip: Clip) => ReactNode;

export interface FrameProps {
  t: number;
  clips: Clip[];
  assets: Asset[];
  words: Word[];
  captions: CaptionSettings;
  look?: Look;
  jobs?: Job[];
  renderMedia: RenderMedia;
  /** Server render: no CSS keyframe animations, they are not frame-accurate. */
  still?: boolean;
  /** Frame width / height. Text and graphics are placed in the free space beside the speaker's face. */
  ratio?: number;
  /** Render one layer only, on a transparent background (for overlay files used in Premiere). */
  layer?: 'all' | 'captions' | 'graphics';
  /** With layer='graphics', draw only this overlay clip. */
  onlyClip?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

const at = (clips: Clip[], trackId: string, t: number) =>
  clips.filter((c) => c.trackId === trackId && t >= c.start && t < c.start + c.duration).at(-1);

const isImage = (a: Asset) => a.kind === 'image' || /\.(png|jpe?g|webp|gif|avif)$/i.test(a.name);

const GRADE: Record<Look['grade'], string | undefined> = {
  none: undefined,
  cinematic: 'brightness(0.74) contrast(1.22) saturate(0.7) sepia(0.14) hue-rotate(-6deg)',
  mono: 'grayscale(1) contrast(1.12)',
  punchy: 'saturate(1.25) contrast(1.06)',
};

/** Camera feel, all computed from t so preview and export match frame for frame. */
function camera(clip: Clip, t: number, look: Look, shot: number) {
  const through = Math.min(1, Math.max(0, (t - clip.start) / Math.max(0.1, clip.duration)));
  let scale = (clip.zoom ?? 1) * (look.punchAlternate && shot % 2 === 1 ? 1.12 : 1) * (look.pushIn ? 1 + 0.045 * through : 1);
  let blur = 0;
  if (look.introSettle && t < 0.45) {
    const k = 1 - t / 0.45;
    scale *= 1 + 0.16 * k * k;
    blur = 7 * k * k;
  }
  return { scale, blur };
}

export interface Zone { x0: number; x1: number; cy: number; side: 'left' | 'right' | 'below'; widthMin: number; /** Shrink to fit the space right now (1 = full size). */ fit?: number }
export interface FaceBox { x0: number; x1: number; y0: number; y1: number; cy: number }

/** Title-safe area: nothing is placed outside it. */
export const SAFE = { x0: 0.06, x1: 0.94, y0: 0.07, y1: 0.9 };

function nearestFace(faces: FaceSample[], local: number): number {
  let lo = 0;
  let hi = faces.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (faces[mid].t < local) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && Math.abs(faces[lo - 1].t - local) < Math.abs(faces[lo].t - local) ? lo - 1 : lo;
}

/** Where the speaker's head (hair to chin, ear to ear) is right now (fractions), after camera zoom. */
function faceBox(src: Asset | undefined, clip: Clip | undefined, t: number, scale: number): FaceBox | null {
  const faces = src?.faces;
  if (!faces?.length || !clip) return null;
  // Footage is cover-fitted: a wider source loses its sides, a taller one its top and bottom.
  const m = coverMap(src?.width, src?.height, RATIO.v);
  const local = clip.in + (t - clip.start);
  const i = nearestFace(faces, local);
  const dense = faces.length > 2 && (faces.at(-1)!.t - faces[0].t) / faces.length < 0.1;
  if (Math.abs(faces[i].t - local) > (dense ? 0.25 : 1.5)) return null;
  // Smooth over neighbours so nothing jitters with detection noise.
  const win = dense ? 0.15 : 0.6;
  let n = 0, x = 0, y = 0, w = 0, h = 0;
  for (let j = i; j >= 0 && local - faces[j].t <= win; j--) { n++; x += faces[j].x; y += faces[j].y; w += faces[j].w; h += faces[j].h; }
  for (let j = i + 1; j < faces.length && faces[j].t - local <= win; j++) { n++; x += faces[j].x; y += faces[j].y; w += faces[j].w; h += faces[j].h; }
  if (!n) return null;
  const cx = 0.5 + (m.x(x / n) - 0.5) * scale;
  const cy = 0.35 + (m.y(y / n) - 0.35) * scale;
  const fw = (w / n) * m.kx * scale;
  const fh = (h / n) * m.ky * scale;
  // The detector boxes brow to chin; widen for ears and hair, extend up for hair and down past the chin.
  return { x0: cx - fw * 0.8, x1: cx + fw * 0.8, y0: cy - fh * 0.95, y1: cy + fh * 0.72, cy };
}

/** Free space beside the head: the wider side for captions, the other side for graphics. */
function zones(face: FaceBox | null, ratio: number): { text: Zone | null; gfx: Zone | null } {
  if (!face) return { text: null, gfx: null };
  const toMin = (w: number) => w * 100 * Math.max(1, ratio);
  const gap = 0.035;
  const left = { x0: SAFE.x0, x1: Math.max(SAFE.x0, face.x0 - gap) };
  const right = { x0: Math.min(SAFE.x1, face.x1 + gap), x1: SAFE.x1 };
  const lw = left.x1 - left.x0;
  const rw = right.x1 - right.x0;
  const cy = Math.min(0.62, Math.max(0.3, face.cy + 0.04));
  if (Math.max(lw, rw) < 0.2) {
    // Portrait framing: no room at the sides, so use the band below the face.
    const below: Zone = { x0: SAFE.x0, x1: SAFE.x1, cy: Math.min(0.86, face.y1 + 0.08), side: 'below', widthMin: toMin(SAFE.x1 - SAFE.x0) };
    return { text: below, gfx: null };
  }
  const textLeft = lw >= rw;
  const t = textLeft ? left : right;
  const g = textLeft ? right : left;
  const text: Zone = { ...t, cy, side: textLeft ? 'left' : 'right', widthMin: toMin(t.x1 - t.x0) };
  const gw = g.x1 - g.x0;
  const gfx: Zone | null = gw >= 0.17 ? { ...g, cy, side: textLeft ? 'right' : 'left', widthMin: toMin(gw) } : null;
  return { text, gfx };
}

/** Everywhere the head goes between t0 and t1, so anything shown for that time stays clear of it. */
export function headSpan(clips: Clip[], assets: Asset[], look: Look, t0: number, t1: number): FaceBox | null {
  const arolls = clips.filter((c) => c.trackId === TRACK_IDS.aroll).sort((x, y) => x.start - y.start);
  let box: FaceBox | null = null;
  let cySum = 0;
  let n = 0;
  for (let t = t0; t <= t1 + 1e-6; t += 1 / 15) {
    const a = at(clips, TRACK_IDS.aroll, t);
    if (!a) continue;
    const f = faceBox(assets.find((x) => x.id === a.assetId), a, t, camera(a, t, look, arolls.indexOf(a)).scale);
    if (!f) continue;
    box = box ? { x0: Math.min(box.x0, f.x0), x1: Math.max(box.x1, f.x1), y0: Math.min(box.y0, f.y0), y1: Math.max(box.y1, f.y1), cy: 0 } : { ...f };
    cySum += f.cy;
    n++;
  }
  return box ? { ...box, cy: cySum / n } : null;
}

export function Frame({ t, clips, assets, words, captions, look = DEFAULT_LOOK, jobs = [], renderMedia, still, style, children, ratio = 9 / 16, layer = 'all', onlyClip }: FrameProps) {
  RATIO.v = ratio;
  const a = at(clips, TRACK_IDS.aroll, t);
  const b = at(clips, TRACK_IDS.broll, t);
  const overlays = clips
    .filter((c) => c.trackId === TRACK_IDS.overlay && t >= c.start && t < c.start + c.duration)
    .filter((c) => !onlyClip || c.id === onlyClip);
  const scene = overlays.find((c) => c.graphic?.ui === 'pages');
  const side = overlays.filter((c) => c !== scene);
  const asset = (c?: Clip) => (c?.assetId ? assets.find((x) => x.id === c.assetId) : undefined);
  const job = (c?: Clip) => (c?.jobId ? jobs.find((j) => j.id === c.jobId) : undefined);
  const split = !!b && look.brollLayout === 'split';
  const arolls = clips.filter((c) => c.trackId === TRACK_IDS.aroll).sort((x, y) => x.start - y.start);
  const shot = a ? arolls.indexOf(a) : 0;
  const cam = a ? camera(a, t, look, shot) : { scale: 1, blur: 0 };
  const face = (b && !split) || scene ? null : faceBox(asset(a), a, t, cam.scale);
  const span = (t0: number, t1: number) => ((b && !split) ? null : headSpan(clips, assets, look, t0, t1));
  const showBase = layer === 'all';
  // Explainer layers: background plate, film look, label stacks, setup and key lines (each its own clip).
  const xp = explainerAt(clips, t, { plate: TRACK_IDS.plate, look: TRACK_IDS.look, labels: TRACK_IDS.labels, setup: TRACK_IDS.setup, key: TRACK_IDS.key }, onlyClip);
  const showXp = layer === 'all' || (layer === 'graphics' && !!onlyClip);
  const showGfx = layer === 'all' || layer === 'graphics';
  const showCaps = (layer === 'all' || layer === 'captions') && captions.enabled && !scene;

  // Side graphics ride beside the head: their inner edge follows the nearest the head comes
  // within ±0.45 s (smoothed), so a card never crosses the face and never jumps.
  const headAt = (tt: number) => {
    const a2 = at(clips, TRACK_IDS.aroll, tt);
    if (!a2 || (b && !split)) return null;
    return faceBox(asset(a2), a2, tt, camera(a2, tt, look, arolls.indexOf(a2)).scale);
  };
  const envelope = (sd: 'left' | 'right', tt: number) => {
    let v: number | null = null;
    for (let u = tt - 0.45; u <= tt + 0.45 + 1e-6; u += 1 / 15) {
      const f = headAt(u);
      if (!f) continue;
      v = v === null ? (sd === 'left' ? f.x0 : f.x1) : sd === 'left' ? Math.min(v, f.x0) : Math.max(v, f.x1);
    }
    return v;
  };
  const edge = (sd: 'left' | 'right', tt: number) => {
    let sum = 0;
    let n = 0;
    for (let u = tt - 0.2; u <= tt + 0.2 + 1e-6; u += 1 / 15) {
      const e = envelope(sd, u);
      if (e !== null) { sum += e; n++; }
    }
    return n ? sum / n : null;
  };
  const GAPX = 0.03;
  const room = (sd: 'left' | 'right', e: number) => (sd === 'left' ? e - GAPX - SAFE.x0 : SAFE.x1 - (e + GAPX));
  const ax = 100 * Math.max(1, ratio);
  const sideFor = (c: Clip): 'left' | 'right' => {
    const want = c.graphic?.place;
    if (want === 'left' || want === 'right') return want;
    // The side whose tightest moment (10th percentile) still leaves the most room.
    const worst = (sd: 'left' | 'right') => {
      const rooms: number[] = [];
      for (let u = c.start; u <= c.start + c.duration; u += 1 / 6) {
        const e = edge(sd, u);
        if (e !== null) rooms.push(room(sd, e));
      }
      rooms.sort((p, q) => p - q);
      return rooms.length ? rooms[Math.floor(rooms.length * 0.1)] : 0;
    };
    const key = `${c.id}:side:${c.start}:${c.duration}`;
    const hit = CARD_SIDE.get(key);
    if (hit) return hit;
    const sd = worst('left') >= worst('right') ? 'left' : 'right';
    CARD_SIDE.set(key, sd);
    return sd;
  };
  const widthFor = (c: Clip, sd: 'left' | 'right') => {
    const key = `${c.id}:${sd}:${c.start}:${c.duration}`;
    const hit = CARD_W.get(key);
    if (hit !== undefined) return hit;
    const rooms: number[] = [];
    for (let u = c.start; u <= c.start + c.duration; u += 1 / 6) {
      const e = edge(sd, u);
      if (e !== null) rooms.push(room(sd, e));
    }
    rooms.sort((p, q) => p - q);
    const w = Math.min(0.3, Math.max(0.21, rooms.length ? rooms[Math.floor(rooms.length * 0.5)] : 0.25));
    CARD_W.set(key, w);
    return w;
  };
  const placeFor = (c: Clip, tt = t): Zone | null => {
    const sd = sideFor(c);
    const w = widthFor(c, sd);
    const e = edge(sd, tt) ?? (sd === 'left' ? 0.33 : 0.67);
    const fit = Math.max(0.72, Math.min(1, room(sd, e) / w));
    const x0 = sd === 'left' ? e - GAPX - w : e + GAPX;
    return { x0, x1: x0 + w, cy: 0.48, side: sd, widthMin: w * ax, fit };
  };
  const placed = side.map((c) => ({ c, zone: placeFor(c) }));
  // Which sides cards hold during a time range (captions avoid them).
  const allSide = clips.filter((c) => c.trackId === TRACK_IDS.overlay && c.graphic?.component === 'UI' && c.graphic.ui !== 'pages');
  const busyIn = (t0: number, t1: number) => {
    const out = new Set<'left' | 'right'>();
    for (const c of allSide) {
      if (c.start >= t1 || c.start + c.duration <= t0) continue;
      out.add(sideFor(c));
    }
    return out;
  };
  const busy = (() => { const s = busyIn(t, t + 0.01); return s.size >= 2 ? 'both' : ([...s][0] ?? null); })();
  const z = zones(face, ratio);
  const blocking = side.some((c) => c.graphic?.slide || (c.graphic?.component === 'BigWord' && !z.gfx));

  return (
    <div className={`frame ${still ? 'frame-render' : ''} ${showBase ? '' : 'frame-layer'}`} style={style}>
      {showXp && xp.plate.map((c) => <Plate key={c.id} spec={c.plate!} />)}
      {showBase && (
        <div className="layer" style={{ filter: GRADE[look.grade], top: split ? '50%' : 0 }}>
          <ARoll clip={a} asset={asset(a)} t={t} renderMedia={renderMedia} cam={cam} />
        </div>
      )}
      {b && (showBase || (layer === 'graphics' && onlyClip === b.id && b.graphic?.component === 'Motion')) && (
        <div className="layer" style={{ filter: b.graphic?.component === 'Motion' ? undefined : GRADE[look.brollGrade ?? look.grade], bottom: split ? '50%' : 0 }}>
          <BRoll clip={b} asset={asset(b)} job={job(b)} t={t} renderMedia={renderMedia} look={look} />
        </div>
      )}
      {showBase && look.vignette && <div className={`vignette ${look.grade === 'cinematic' ? 'cine' : ''}`} aria-hidden />}
      {showXp && xp.look.map((c) => <FilmLook key={c.id} spec={c.filmLook!} />)}
      {showGfx && scene && <PagesScene g={scene.graphic!} age={t - scene.start} dur={scene.duration} />}
      {showGfx && placed.map(({ c, zone }) => (
        <Overlay key={c.id} clip={c} asset={asset(c)} job={job(c)} t={t} renderMedia={renderMedia} look={look} captionTop={captions.enabled ? captions.position : null} zone={zone} />
      ))}
      {showXp && xp.labels.map((c) => <LabelStack key={c.id} g={c.graphic!} age={c.in + t - c.start} />)}
      {showXp && xp.setup.map((c) => <TextLine key={c.id} spec={c.text!} local={c.in + t - c.start} />)}
      {showXp && xp.key.map((c) => <TextLine key={c.id} spec={c.text!} local={c.in + t - c.start} />)}
      {showCaps && !blocking && <Captions words={words} t={t} c={captions} zone={z.text} face={face} busy={busy as Zone['side'] | 'both' | null} span={span} busyIn={busyIn} scene={(t0, t1) => clips.some((c) => c.graphic?.ui === 'pages' && c.start < t1 && c.start + c.duration > t0)} />}
      {children}
    </div>
  );
}

function ARoll({ clip, asset, t, renderMedia, cam }: { clip?: Clip; asset?: Asset; t: number; renderMedia: RenderMedia; cam: { scale: number; blur: number } }) {
  if (!clip) return <div className="layer" style={{ background: '#000' }} />;
  const local = clip.in + (t - clip.start);
  const { scale, blur } = cam;
  const zoom: CSSProperties = { transform: `scale(${scale.toFixed(4)})`, transformOrigin: '50% 35%', filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined, transition: 'none' };
  if (asset?.url && asset.audioOnly) {
    // A voiceover: its sound plays, the plate or B-roll is the picture.
    return <div className="layer" style={{ opacity: 0 }}>{renderMedia('aroll', asset, local, clip)}</div>;
  }
  if (asset?.url) {
    return <div className="layer"><div className="scene" style={zoom}>{renderMedia('aroll', asset, local, clip)}</div></div>;
  }
  // Sample footage: a slow drift so it reads as video rather than a still.
  const sway = Math.sin(local * 1.7) * 0.6;
  return (
    <div className="layer">
      <div className="scene" style={{ background: swatch(clip.hue), ...zoom }}>
        <Person className="scene-person" style={{ transform: `translateX(calc(-50% + ${sway}%))` }} />
      </div>
    </div>
  );
}

const PENDING_TEXT = { stock: 'Finding B-roll', video: 'Generating shot', image: 'Generating image', screen: 'Recording screen', music: 'Picking music' } as const;

function Pending({ job, label }: { job?: Job; label: string }) {
  const pct = Math.round((job?.progress ?? 0) * 100);
  return (
    <div className="gen-fill" role="status">
      <div>
        <span className="spinner" style={{ width: '6cqmin', height: '6cqmin', borderWidth: '0.8cqmin' }} />
        {job ? PENDING_TEXT[job.type] : 'Preparing'}
        <small>{label}{job && job.status === 'running' ? `, ${pct}%` : ''}</small>
      </div>
    </div>
  );
}

function BRollContent({ clip, asset, job, t, renderMedia, look }: { clip: Clip; asset?: Asset; job?: Job; t: number; renderMedia: RenderMedia; look: Look }) {
  if (clip.graphic?.component === 'Motion') return <MotionScene g={clip.graphic} look={look} age={t - clip.start} dur={clip.duration} />;
  if (clip.status !== 'ready') return <Pending job={job} label={clip.label} />;
  if (asset?.url && asset.kind !== 'music' && isImage(asset)) {
    // A still cutaway (generated image) drifts in slowly, so it reads as a shot, not a slide.
    const k = Math.max(0, Math.min(1, (t - clip.start) / Math.max(0.5, clip.duration)));
    const pan = (clip.hue % 2 ? 1 : -1) * 2.2 * k;
    return <div className="layer" style={{ overflow: 'hidden' }}><div className="layer" style={{ transform: `scale(${(1.04 + 0.09 * k).toFixed(4)}) translateX(${pan.toFixed(3)}%)` }}>{renderMedia('image', asset, clip.in + (t - clip.start), clip)}</div></div>;
  }
  if (asset?.url && asset.kind !== 'music') return <>{renderMedia('broll', asset, clip.in + (t - clip.start), clip)}</>;
  const screen = asset?.kind === 'screen';
  return (
    <div className="layer" style={{ background: swatch(clip.hue, 60) }}>
      {screen && (
        <div style={{ position: 'absolute', inset: '14% 7%', borderRadius: '2cqmin', background: '#f4f4f2', overflow: 'hidden', boxShadow: '0 2cqmin 6cqmin rgba(0,0,0,.45)' }}>
          <div style={{ height: '7cqmin', background: '#e2e2de', display: 'flex', alignItems: 'center', gap: '1.4cqmin', padding: '0 2.4cqmin' }}>
            {[0, 1, 2].map((i) => <i key={i} style={{ width: '1.8cqmin', height: '1.8cqmin', borderRadius: 9, background: '#c4c4bf' }} />)}
            <span style={{ marginLeft: '2cqmin', fontSize: '2.6cqmin', color: '#555', fontWeight: 600 }}>{clip.label.replace('Screen: ', '')}</span>
          </div>
          <div style={{ padding: '4cqmin', display: 'grid', gap: '2.4cqmin' }}>
            {[70, 90, 55, 80].map((w, i) => <i key={i} style={{ height: '3cqmin', width: `${w}%`, borderRadius: 4, background: i === 0 ? '#2a2d32' : '#d6d6d1' }} />)}
          </div>
        </div>
      )}
      <span className="scene-label">{clip.label}</span>
    </div>
  );
}

function BRoll(props: { clip: Clip; asset?: Asset; job?: Job; t: number; renderMedia: RenderMedia; look: Look }) {
  if (props.look.brollLayout === 'framed') {
    // B-roll as a framed picture on the template's slide background.
    return (
      <div className={`layer slide slide-${props.look.slideBg === 'solid' ? 'black' : props.look.slideBg}`}>
        <div className="framed"><BRollContent {...props} /></div>
      </div>
    );
  }
  return <div className="layer"><BRollContent {...props} /></div>;
}

const SLIDE_BG: Record<NonNullable<GraphicSpec['bg']>, string> = { white: 'white', blue: 'blue', black: 'black', paper: 'paper' };

function Slide({ look, children, solidBg, bg }: { look: Look; children: ReactNode; solidBg?: string; bg?: GraphicSpec['bg'] }) {
  if (bg) return <div className={`layer slide slide-${SLIDE_BG[bg]}`}>{children}</div>;
  return (
    <div className={`layer slide slide-${look.slideBg}`} style={look.slideBg === 'solid' ? { background: solidBg ?? '#1E3FD8' } : undefined}>
      {children}
    </div>
  );
}

function BigWord({ g, look, age }: { g: GraphicSpec; look: Look; age: number }) {
  const color = g.color ?? (g.bg === 'blue' ? '#FFFFFF' : g.bg === 'white' ? '#2340F5' : look.accent);
  const condensed = !g.variant && look.slideBg === 'paper';
  const serif = g.variant === 'serif';
  const k = Math.min(1, age / 0.22);
  const ease = 1 - (1 - k) * (1 - k);
  const size = serif ? Math.min(34, 170 / Math.max(1, g.text.length)) : condensed ? Math.min(30, 205 / Math.max(1, g.text.length)) : Math.min(19, 150 / Math.max(1, g.text.length));
  const kickerInk = g.slide ? (g.bg === 'blue' || (!g.bg && look.slideBg === 'solid') ? '#fff' : '#111') : '#fff';
  const body = (
    <div className={`gfx-big ${condensed ? 'condensed' : ''} ${serif ? 'serif' : ''}`}>
      {g.sub && <small style={{ color: kickerInk }}>{g.sub}</small>}
      <strong style={{ color, fontSize: `${size}cqmin`, transform: `scale(${(1.18 - 0.18 * ease).toFixed(3)})`, filter: k < 1 ? `blur(${(5 * (1 - ease)).toFixed(2)}px)` : undefined, opacity: Math.min(1, k * 3) }}>{g.text}</strong>
    </div>
  );
  return g.slide ? <Slide look={look} solidBg="#111" bg={g.bg}>{body}</Slide> : body;
}

function List({ g, look }: { g: GraphicSpec; look: Look }) {
  const items = g.items?.length ? g.items : [g.text];
  const active = g.active ?? items.length - 1;
  if (!g.slide) {
    // Over the speaker: darkened top, rows build one by one, earlier rows grey, current row in the accent.
    return (
      <div className="layer gfx-list-over">
        <ol className="gfx-list condensed">
          {items.slice(0, active + 1).map((it, i) => (
            <li key={i} style={{ color: i === active ? (g.color ?? '#E5161D') : 'rgba(235,235,235,0.38)' }}>
              <span className="tnum">{i + 1}.</span> {it}
            </li>
          ))}
        </ol>
      </div>
    );
  }
  const blue = g.bg === 'blue' || (!g.bg && look.slideBg === 'solid');
  return (
    <Slide look={look} bg={g.bg ?? (blue ? 'blue' : undefined)}>
      <ol className="gfx-list">
        {items.map((it, i) => (
          <li key={i} style={{ color: blue ? '#fff' : i === active ? (g.color ?? look.accent) : '#111', opacity: i <= active ? (blue && i < active ? 0.45 : 1) : blue ? 0.22 : 0.28 }}>
            <span className="tnum">{i + 1}.</span> {it}
          </li>
        ))}
      </ol>
    </Slide>
  );
}

function Overlay(props: { clip: Clip; asset?: Asset; job?: Job; t: number; renderMedia: RenderMedia; captionTop: number | null; look: Look; zone: Zone | null }) {
  const g = props.clip.graphic;
  const inZone = props.zone && g && !g.slide && ['UI', 'Counter', 'BigWord', 'LowerThird', 'Callout', 'Headline'].includes(g.component);
  if (inZone && props.zone) {
    // Beside the speaker, never over the face.
    const z = props.zone;
    return (
      <div className={`gzone gzone-${z.side}`} style={{ left: `${z.x0 * 100}%`, width: `${(z.x1 - z.x0) * 100}%`, top: `${SAFE.y0 * 100}%`, bottom: `${(1 - SAFE.y1) * 100}%`, transform: 'none', alignItems: 'center', ['--zw' as string]: `${z.widthMin}cqmin` }}>
        <div style={{ width: '100%', display: 'flex', justifyContent: z.side === 'left' ? 'flex-end' : 'flex-start', transform: z.fit && z.fit < 1 ? `scale(${z.fit.toFixed(4)})` : undefined, transformOrigin: z.side === 'left' ? 'right center' : 'left center' }}>
          {g.component === 'UI' ? <UICard g={g} age={props.t - props.clip.start} dur={props.clip.duration} widthMin={z.widthMin} side={z.side} /> : <OverlayInner {...props} />}
        </div>
      </div>
    );
  }
  return <OverlayInner {...props} />;
}

function OverlayInner({ clip, asset, job, t, renderMedia, captionTop, look }: { clip: Clip; asset?: Asset; job?: Job; t: number; renderMedia: RenderMedia; captionTop: number | null; look: Look }) {
  const g = clip.graphic;
  if (g?.component === 'UI') return <div className="gzone gzone-center" style={{ left: '28%', width: '44%', top: '45%' }}><UICard g={g} age={t - clip.start} dur={clip.duration} widthMin={44} /></div>;
  // Keep the lower third out of the caption band: move it to the top when captions sit low.
  const lowerStyle: CSSProperties | undefined = captionTop !== null && captionTop > 50 ? { top: '12%', bottom: 'auto' } : undefined;
  if (g?.component === 'LowerThird') return <div className="gfx-lower" style={lowerStyle} key={clip.id}><strong>{g.text}</strong>{g.sub && <span>{g.sub}</span>}</div>;
  if (g?.component === 'Headline') return <div className="gfx-head" key={clip.id}>{g.text}</div>;
  if (g?.component === 'Counter') {
    return (
      <div className="gfx-counter" key={clip.id}>
        {g.sub && <small>{g.sub}</small>}
        <strong style={{ color: g.color ?? '#E5161D' }}>{g.text}</strong>
      </div>
    );
  }
  if (g?.component === 'BigWord') return <BigWord g={g} look={look} age={t - clip.start} key={clip.id} />;
  if (g?.component === 'List') {
    // Advance the active row through the clip so the list builds as you talk.
    const items = g.items?.length ?? 1;
    const active = Math.min(items - 1, Math.floor(((t - clip.start) / clip.duration) * items));
    return <List g={{ ...g, active }} look={look} key={clip.id} />;
  }
  return (
    <div className="gfx-image" key={clip.id}>
      {clip.status !== 'ready'
        ? <Pending job={job} label={clip.label} />
        : asset?.url
          ? renderMedia(isImage(asset) ? 'image' : 'broll', asset, clip.in + (t - clip.start), clip)
          : <div className="layer" style={{ background: swatch(clip.hue, 90) }}><span className="scene-label">{clip.label}</span></div>}
    </div>
  );
}

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function captionGroups(words: Word[], perLine: number): Word[][] {
  const out: Word[][] = [];
  // Break at sentence ends (and long gaps, for transcripts without punctuation).
  let cur: Word[] = [];
  for (const w of words) {
    if (w.filler) continue;
    const prev = cur.at(-1);
    if (prev && w.t - (prev.t + prev.d) > 0.6) {
      out.push(cur);
      cur = [];
    }
    cur.push(w);
    if (cur.length >= perLine || /[.!?]$/.test(w.w)) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

const RATIO = { v: 9 / 16 };
const CARD_W = new Map<string, number>();
const CARD_SIDE = new Map<string, 'left' | 'right'>();

const STOP = new Set('a an the and or but so to of in on at for with that this it its it’s it\'s is are was be you your i my me we our they he she will can just not do does'.split(' '));

const isKeyword = (w: string) => /\d/.test(w) || w.replace(/\W/g, '').length >= 7;

type Span = (t0: number, t1: number) => FaceBox | null;
type BusyIn = (t0: number, t1: number) => Set<'left' | 'right'>;

function Captions({ words, t, c, zone, face, busy, span, busyIn, scene }: { words: Word[]; t: number; c: CaptionSettings; zone: Zone | null; face: FaceBox | null; busy: Zone['side'] | 'both' | null; span: Span; busyIn: BusyIn; scene: (t0: number, t1: number) => boolean }) {
  if (c.layout === 'pixel') return <PixelCaptions words={words} t={t} c={c} span={span} busyIn={busyIn} scene={scene} />;
  if (c.layout === 'editorial') return <EditorialCaptions words={words} t={t} c={c} zone={zone} />;
  // Line captions: keep them off the face by moving them below it when they would overlap.
  const pos = face && c.position / 100 > face.y0 - 0.04 && c.position / 100 < face.y1 + 0.04 ? Math.min(90, (face.y1 + 0.07) * 100) : c.position;
  return <LineCaptions words={words} t={t} c={{ ...c, position: pos }} />;
}

/**
 * Editorial captions, as in talking-head edits by top creators: a phrase at a time, its
 * small words placed around the face, then one key word landing huge across the chest.
 */
interface Phrase { small: Word[]; key: Word; index: number; end: number }

export function editorialPhrases(words: Word[]): Phrase[] {
  const out: Phrase[] = [];
  let cur: Word[] = [];
  const spoken = words.filter((w) => !w.filler);
  const close = (next?: Word) => {
    if (!cur.length) return;
    // Key word: numbers first, then long words, then the longest content word; ties go to the later word,
    // which is where people put stress.
    const score = (w: Word) => {
      const bare = w.w.replace(/[^\p{L}\p{N}$%₹]/gu, '');
      if (STOP.has(bare.toLowerCase())) return 0;
      return (/\d/.test(bare) ? 100 : 0) + bare.length;
    };
    const key = cur.reduce((best, w) => (score(w) >= score(best) ? w : best), cur[0]);
    const last = cur.at(-1)!;
    out.push({ small: cur.filter((w) => w !== key), key, index: out.length, end: Math.min(next ? next.t : Infinity, last.t + last.d + 0.45) });
    cur = [];
  };
  spoken.forEach((w, i) => {
    const prev = cur.at(-1);
    if (prev && w.t - (prev.t + prev.d) > 0.6) close(w);
    cur.push(w);
    const sentenceEnd = /[.!?]$/.test(w.w);
    if (sentenceEnd || (cur.length >= 2 && isKeyword(w.w)) || cur.length >= 4) close(spoken[i + 1]);
  });
  close();
  return out;
}

const clean = (w: string) => w.replace(/[,.!?;:]+$/, '');

function EditorialCaptions({ words, t, c, zone }: { words: Word[]; t: number; c: CaptionSettings; zone: Zone | null }) {
  const phrases = useMemo(() => editorialPhrases(words), [words]);
  const p = phrases.find((ph) => t >= (ph.small[0]?.t ?? ph.key.t) - 0.04 && t < ph.end);
  if (!p) return null;
  // Rotate the key word's treatment through the video: heavy sans, accent colour, serif italic.
  const style = p.index % 5 === 1 ? 'accent' : p.index % 5 === 2 || p.index % 5 === 4 ? 'serif' : 'sans';
  const keyText = clean(p.key.w);
  const age = t - p.key.t;
  const k = Math.max(0, Math.min(1, age / 0.22));
  const ease = 1 - (1 - k) * (1 - k);
  const serif = style === 'serif' && !/\d/.test(keyText);
  const room = zone ? zone.widthMin * 0.98 : 104;
  const size = serif ? Math.min(zone ? 15 : 24, room / (0.43 * Math.max(3, keyText.length))) : Math.min(zone ? 12.5 : 20, room / (0.6 * Math.max(3, keyText.length)));
  const keyColor = style === 'accent' || /\d/.test(keyText) ? (/\d/.test(keyText) ? '#E5161D' : c.highlight) : c.fill;
  const flash = style === 'accent' && k < 1 ? `color-mix(in srgb, ${keyColor} ${Math.round(40 + 60 * ease)}%, white)` : keyColor;
  const smallShown = p.small.filter((w) => t >= w.t - 0.02);
  // Two placements: split around the face (first phrase of a sentence) or stacked above the key word.
  const around = p.index % 2 === 0 && smallShown.length >= 2;
  const half = Math.ceil(smallShown.length / 2);
  const smallStyle: CSSProperties = { fontFamily: `'${c.font}', sans-serif`, fontWeight: c.weight, fontSize: `${zone ? Math.min(c.size, 4.2) : c.size}cqmin`, color: c.fill, textShadow: '0 0.3cqmin 1.4cqmin rgba(0,0,0,.5)', textTransform: c.uppercase ? 'uppercase' : 'none' };
  const keyStyle: CSSProperties = {
    fontFamily: serif ? `'${c.accentFont ?? 'Instrument Serif'}', serif` : `'${c.font}', sans-serif`,
    fontStyle: serif && c.accentItalic !== false ? 'italic' : 'normal',
    fontWeight: serif ? 400 : 800,
    letterSpacing: serif ? '-0.02em' : '-0.055em',
    fontSize: `${size}cqmin`,
    color: flash,
    filter: k < 1 ? `blur(${(5 * (1 - ease)).toFixed(2)}px)` : undefined,
    opacity: Math.min(1, 0.15 + k * 3),
  };
  if (zone && zone.side !== 'below') {
    // Beside the face: small words then the key word, stacked and aligned toward the speaker.
    return (
      <div className={`cap-zone cap-zone-${zone.side}`} style={{ left: `${zone.x0 * 100}%`, width: `${(zone.x1 - zone.x0) * 100}%`, top: `${zone.cy * 100}%` }}>
        <div className="cap-zone-small" style={smallStyle}>{smallShown.map((w) => <span key={w.id}>{clean(w.w)}</span>)}</div>
        {t >= p.key.t - 0.02 && <strong className="cap-zone-key" style={{ ...keyStyle, transform: `scale(${(1.18 - 0.18 * ease).toFixed(3)})` }}>{keyText}</strong>}
      </div>
    );
  }
  if (zone) {
    return (
      <div className="cap-ed" style={{ ['--key-y' as string]: `${zone.cy * 100}%` }}>
        <div className="cap-ed-above" style={smallStyle}>{smallShown.map((w) => <span key={w.id}>{clean(w.w)}</span>)}</div>
        {t >= p.key.t - 0.02 && <strong className="cap-ed-key" style={{ ...keyStyle, transform: `translateY(-50%) scale(${(1.18 - 0.18 * ease).toFixed(3)})` }}>{keyText}</strong>}
      </div>
    );
  }
  return (
    <div className="cap-ed" style={{ ['--key-y' as string]: `${c.position}%` }}>
      {around ? (
        <div className="cap-ed-around" style={smallStyle}>
          <span>{smallShown.slice(0, half).map((w) => clean(w.w)).join(' ')}</span>
          <span>{smallShown.slice(half).map((w) => clean(w.w)).join(' ')}</span>
        </div>
      ) : (
        <div className="cap-ed-above" style={smallStyle}>{smallShown.map((w) => <span key={w.id}>{clean(w.w)}</span>)}</div>
      )}
      {t >= p.key.t - 0.02 && (
        <strong
          className="cap-ed-key"
          style={{
            fontFamily: serif ? `'${c.accentFont ?? 'Instrument Serif'}', serif` : `'${c.font}', sans-serif`,
            fontStyle: serif && c.accentItalic !== false ? 'italic' : 'normal',
            fontWeight: serif ? 400 : 800,
            letterSpacing: serif ? '-0.02em' : '-0.055em',
            fontSize: `${size}cqmin`,
            color: flash,
            transform: `translateY(-50%) scale(${(1.18 - 0.18 * ease).toFixed(3)})`,
            filter: k < 1 ? `blur(${(5 * (1 - ease)).toFixed(2)}px)` : undefined,
            opacity: Math.min(1, 0.15 + k * 3),
          }}
        >
          {keyText}
        </strong>
      )}
    </div>
  );
}

function LineCaptions({ words, t, c }: { words: Word[]; t: number; c: CaptionSettings }) {
  const groups = useMemo(() => captionGroups(words, c.wordsPerLine), [words, c.wordsPerLine]);
  const gi = groups.findIndex((g, i) => {
    const next = groups[i + 1];
    const last = g.at(-1)!;
    const end = Math.min(next ? next[0].t : Infinity, last.t + last.d + 0.6);
    return t >= g[0].t - 0.05 && t < end;
  });
  if (gi < 0) return null;
  const g = groups[gi];
  const style: CSSProperties = {
    top: `${c.position}%`,
    transform: 'translateY(-50%)',
    fontFamily: `'${c.font}', sans-serif`,
    fontWeight: c.weight,
    fontSize: `${c.size}cqmin`,
    textTransform: c.uppercase ? 'uppercase' : 'none',
    color: c.fill,
    WebkitTextStroke: c.strokeWidth ? `${c.strokeWidth * 0.16}cqmin ${c.stroke}` : undefined,
    paintOrder: 'stroke fill',
    textShadow: c.strokeWidth ? `0 0.5cqmin 0 ${rgba(c.stroke, 0.5)}` : c.highlightMode === 'reveal' || c.backgroundOpacity > 0 ? undefined : '0 0.3cqmin 1.2cqmin rgba(0,0,0,.45)',
  };
  const box = c.backgroundOpacity > 0;
  const enter = c.animation === 'pop' ? 'pop 0.18s' : c.animation === 'slide' ? 'slidein 0.25s' : c.animation === 'fade' ? 'fadein 0.3s' : 'none';
  return (
    <div className="cap" style={style} key={gi}>
      <span className={box ? 'cap-box' : undefined} style={{ background: box ? rgba(c.background, c.backgroundOpacity) : undefined, animation: `${enter} cubic-bezier(.2,.8,.2,1)` }}>
        {g.map((w) => {
          const active = t >= w.t && t < w.t + w.d + 0.08;
          const lit = (c.highlightMode === 'active' && active) || (c.highlightMode === 'keyword' && isKeyword(w.w));
          const accent = lit && c.accentFont;
          return (
            <span
              key={w.id}
              className="cap-word"
              style={{
                color: lit ? c.highlight : undefined,
                opacity: c.highlightMode === 'reveal' && t < w.t ? 0.22 : 1,
                fontFamily: accent ? `'${c.accentFont}', serif` : undefined,
                fontStyle: accent && c.accentItalic ? 'italic' : undefined,
                fontWeight: accent ? 400 : undefined,
                fontSize: accent ? '1.12em' : undefined,
                transform: lit && c.animation === 'pop' && c.highlightMode === 'active' ? 'scale(1.12)' : undefined,
              }}
            >
              {w.w.replace(/[,.]$/, '')}
            </span>
          );
        })}
      </span>
    </div>
  );
}

/* ---------- Pixel captions (the “Ready player 1” reference) ----------
   Words pop on exactly when spoken, no fade, spread across rows in the free space beside or
   below the face. Key words sit on a ragged sky-blue box. A phrase with a number or a long,
   strong word becomes a "big" moment: small words stacked, the key word typed out huge. */

interface PixelPhrase { words: Word[]; index: number; end: number; big: Word | null; boxed: Set<Word>; bigUnit?: Word }

const contentScore = (w: Word) => {
  const bare = w.w.replace(/[^\p{L}\p{N}$%₹]/gu, '');
  if (STOP.has(bare.toLowerCase())) return 0;
  return (/\d/.test(bare) ? 100 : 0) + bare.length;
};

export function pixelPhrases(words: Word[]): PixelPhrase[] {
  const out: PixelPhrase[] = [];
  const spoken = words.filter((w) => !w.filler);
  let cur: Word[] = [];
  const close = (next?: Word) => {
    if (!cur.length) return;
    const last = cur.at(-1)!;
    const best = cur.reduce((b, w) => (contentScore(w) > contentScore(b) ? w : b), cur[0]);
    const bare = best.w.replace(/[^\p{L}\p{N}]/gu, '');
    const index = out.length;
    // Big moment: a number, or a long word, about one phrase in four.
    const isLast = !next;
    const nextWord = cur.find((w) => /^next$/i.test(w.w.replace(/\W/g, '')));
    const big = isLast && nextWord ? nextWord : /\d/.test(bare) || (bare.length >= 9 && index % 2 === 0) ? best : null;
    const boxed = new Set<Word>();
    if (!big) {
      if (index % 6 === 5) cur.forEach((w) => boxed.add(w));
      else if (index % 2 === 1 && contentScore(best) >= 4) boxed.add(best);
    }
    if (isLast && big) boxed.add(big);
    // "1 million", "10 lakh": the unit word types out together with the number.
    const bi = big ? cur.indexOf(big) : -1;
    const unit = bi >= 0 && /\d/.test(big!.w) && cur[bi + 1] && /^(million|billion|thousand|lakh|crore|k|m)[,.]?$/i.test(cur[bi + 1].w) ? cur[bi + 1] : undefined;
    out.push({ words: cur, index, end: Math.min(next ? next.t - 0.02 : Infinity, last.t + last.d + 0.7), big, boxed, bigUnit: unit });
    cur = [];
  };
  spoken.forEach((w, i) => {
    const prev = cur.at(-1);
    if (prev && w.t - (prev.t + prev.d) > 0.7) close(w);
    cur.push(w);
    if (/[.!?]$/.test(w.w) || cur.length >= 7) close(spoken[i + 1]);
  });
  close();
  return out;
}

/* ---- Layout: every phrase gets one fixed block, sized to fit, clear of the head and the cards ---- */

type SlotKind = 'left' | 'right' | 'below' | 'above';
interface Slot { kind: SlotKind; x0: number; x1: number; y0: number; y1: number }
interface Placed { slot: Slot; size: number; big?: number; lines: Word[][]; tail: Word[][]; top: number; height: number; boxed: Set<Word> }

const GAP = 0.035; // clearance from the head, as a fraction of the frame
const LINE = 1.32; // line box in em (box padding included)
const ROW_GAP = 0.3; // between lines, in em
const WORD_GAP = 0.34; // between words, in em

function slotsFor(head: FaceBox | null, busy: Set<'left' | 'right'>): Slot[] {
  if (!head) return [{ kind: 'below', x0: SAFE.x0, x1: SAFE.x1, y0: 0.62, y1: SAFE.y1 }];
  const out: Slot[] = [];
  const left: Slot = { kind: 'left', x0: SAFE.x0, x1: head.x0 - GAP, y0: SAFE.y0, y1: SAFE.y1 };
  const right: Slot = { kind: 'right', x0: head.x1 + GAP, x1: SAFE.x1, y0: SAFE.y0, y1: SAFE.y1 };
  const sides = [left, right].filter((r) => !busy.has(r.kind as 'left' | 'right') && r.x1 - r.x0 > 0.12);
  sides.sort((p, q) => q.x1 - q.x0 - (p.x1 - p.x0));
  out.push(...sides);
  // Under the chin: full width, unless a card holds that side (then only as far as the head's edge).
  out.push({ kind: 'below', x0: busy.has('left') ? Math.max(SAFE.x0, head.x0 - 0.04) : SAFE.x0, x1: busy.has('right') ? Math.min(SAFE.x1, head.x1 + 0.04) : SAFE.x1, y0: Math.max(head.y1 + GAP, 0.5), y1: SAFE.y1 });
  if (head.y0 - GAP - SAFE.y0 > 0.1) out.push({ kind: 'above', x0: SAFE.x0, x1: SAFE.x1, y0: SAFE.y0, y1: head.y0 - GAP });
  return out;
}

const wordW = (w: Word, boxed: boolean, weight = 400) => pixelWidth(clean(w.w), weight) + (boxed ? 0.64 : 0);

function wrap(ws: Word[], maxEm: number, boxed: Set<Word>): Word[][] | null {
  const lines: Word[][] = [];
  let cur: Word[] = [];
  let width = 0;
  for (const w of ws) {
    const ww = wordW(w, boxed.has(w));
    if (ww > maxEm) return null;
    if (cur.length && width + WORD_GAP + ww > maxEm) { lines.push(cur); cur = []; width = 0; }
    width += (cur.length ? WORD_GAP : 0) + ww;
    cur.push(w);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

export function layoutPhrase(p: PixelPhrase, head: FaceBox | null, busy: Set<'left' | 'right'>, ratio: number, base: number): Placed | null {
  const ax = 100 * Math.max(1, ratio); // frame-width fraction -> cqmin
  const ay = 100 * Math.max(1, 1 / ratio);
  const slots = slotsFor(head, busy);
  const blockH = (n: number, size: number) => (n ? n * LINE * size + (n - 1) * ROW_GAP * size : 0);
  const at = (slot: Slot, h: number) => {
    const sh = (slot.y1 - slot.y0) * ay;
    if (slot.kind === 'below') return slot.y0 * ay + Math.min(1.5, sh - h);
    if (slot.kind === 'above') return slot.y1 * ay - h;
    // Beside the head: centred a little under eye level, kept inside the slot.
    const cy = (head ? head.cy + 0.05 : 0.5) * ay;
    return Math.min(slot.y1 * ay - h, Math.max(slot.y0 * ay, cy - h / 2));
  };
  const maxLines = (k: SlotKind) => (k === 'left' || k === 'right' ? 4 : 2);

  if (p.big) {
    const bi = p.words.indexOf(p.big);
    const lead = p.words.slice(0, bi);
    const tail = p.words.slice(bi + (p.bigUnit ? 2 : 1));
    const key = clean(p.big.w) + (p.bigUnit ? ` ${clean(p.bigUnit.w)}` : '');
    const keyEm = pixelWidth(key, 700, -0.01) + (p.boxed.has(p.big) ? 0.64 : 0) + 0.12; // + cursor
    for (const minBig of [9, 6.5]) {
      for (const slot of slots) {
        const wCq = (slot.x1 - slot.x0) * ax;
        const hCq = (slot.y1 - slot.y0) * ay;
        for (const small of [Math.min(base, 4.8), 4.2, 3.8]) {
          const ll = wrap(lead, wCq / small, p.boxed);
          const tl = wrap(tail, wCq / small, p.boxed);
          if (!ll || !tl || ll.length + tl.length > 3) continue;
          const rest = blockH(ll.length, small) + blockH(tl.length, small) + (ll.length ? 0.35 * small : 0) + (tl.length ? 0.35 * small : 0);
          const big = Math.min(15, wCq / keyEm, (hCq - rest) / 1.05);
          if (big < minBig) continue;
          const h = rest + big * 1.05;
          return { slot, size: small, big, lines: ll, tail: tl, top: at(slot, h), height: h, boxed: p.boxed };
        }
      }
    }
    // No room for a big moment: show it as a normal phrase (the key word stays boxed).
    return layoutPhrase({ ...p, big: null, boxed: new Set([...p.boxed, p.big]) }, head, busy, ratio, base);
  }
  for (const [minSize, kinds] of [[4.6, ['left', 'right', 'below']], [4.0, ['left', 'right', 'below', 'above']], [3.4, ['left', 'right', 'below', 'above']]] as const) {
    for (const slot of slots) {
      if (!(kinds as readonly string[]).includes(slot.kind)) continue;
      const wCq = (slot.x1 - slot.x0) * ax;
      const hCq = (slot.y1 - slot.y0) * ay;
      for (let size = base; size >= minSize - 1e-6; size -= 0.2) {
        const lines = wrap(p.words, wCq / size, p.boxed);
        if (!lines || lines.length > maxLines(slot.kind)) continue;
        const h = blockH(lines.length, size);
        if (h > hCq) continue;
        return { slot, size, lines, tail: [], top: at(slot, h), height: h, boxed: p.boxed };
      }
    }
  }
  // Last resort: the lowest band, as small as needed, never over the head.
  const slot = slots.find((x) => x.kind === 'below') ?? slots[0];
  const wCq = (slot.x1 - slot.x0) * ax;
  const hCq = (slot.y1 - slot.y0) * ay;
  for (let size = 3.4; size >= 2.4; size -= 0.2) {
    const lines = wrap(p.words, wCq / size, p.boxed);
    if (!lines) continue;
    const h = blockH(lines.length, size);
    if (h <= hCq) return { slot, size, lines, tail: [], top: at(slot, h), height: h, boxed: p.boxed };
  }
  return null;
}

/* ---- Motion: letters resolve from a soft blur, boxes wipe on, phrases tilt and blur away ---- */

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const easeOut3 = (k: number) => 1 - Math.pow(1 - k, 3);
const easeOut5 = (k: number) => 1 - Math.pow(1 - k, 5);

function Letters({ text, t, start, stagger = 0.022, dur = 0.3 }: { text: string; t: number; start: number; stagger?: number; dur?: number }) {
  return (
    <>
      {[...text].map((ch, i) => {
        const k = clamp01((t - start - i * stagger) / dur);
        const e = easeOut3(k);
        return (
          <span key={i} className="px-ch" style={{ opacity: e, filter: k < 1 ? `blur(${((1 - e) * 0.2).toFixed(3)}em)` : undefined, transform: k < 1 ? `translateY(${((1 - e) * 0.22).toFixed(3)}em)` : undefined }}>
            {ch === ' ' ? ' ' : ch}
          </span>
        );
      })}
    </>
  );
}

const BLUE = '#08A2F7';

function PixelBox({ children, t, start }: { children: ReactNode; t: number; start: number }) {
  const k = easeOut5(clamp01((t - start) / 0.26));
  return (
    <span className="px-box">
      <i aria-hidden style={{ transform: `scaleX(${k.toFixed(4)})`, opacity: clamp01(k * 3) }} />
      <span>{children}</span>
    </span>
  );
}

function PhraseWord({ w, boxed, t }: { w: Word; boxed: boolean; t: number }) {
  const txt = clean(w.w);
  return boxed
    ? <PixelBox t={t} start={w.t - 0.09}><Letters text={txt} t={t} start={w.t - 0.07} /></PixelBox>
    : <span className="px-word"><Letters text={txt} t={t} start={w.t - 0.08} /></span>;
}

/** A big key word typed out letter by letter, each letter landing sharp, with a blinking cursor. */
function Typed({ text, t, start, boxed }: { text: string; t: number; start: number; boxed: boolean }) {
  const per = 0.045; // matches the typing sound
  const done = start + per * text.length;
  const chars = [...text].map((ch, i) => {
    const k = clamp01((t - start - i * per) / 0.16);
    const e = easeOut3(k);
    return (
      <span key={i} className="px-ch" style={{ opacity: t >= start + i * per ? 1 : 0, transform: k < 1 ? `scale(${(1.22 - 0.22 * e).toFixed(3)})` : undefined, filter: k < 1 ? `blur(${((1 - e) * 0.08).toFixed(3)}em)` : undefined }}>
        {ch === ' ' ? ' ' : ch}
      </span>
    );
  });
  // Cursor follows the last typed letter, blinks twice when done, then fades.
  const after = t - done;
  const cursorOn = t >= start - 0.1 && (after < 0 || (after < 0.75 && Math.floor(after / 0.19) % 2 === 0));
  const cursor = <span className="px-cursor" style={{ opacity: cursorOn ? clamp01(1 - Math.max(0, after - 0.55) / 0.2) : 0 }} />;
  const typedCount = Math.max(0, Math.min(text.length, Math.floor((t - start) / per) + 1));
  // Only typed letters take space, so the line (and its box) grows with the typing; the cursor leads.
  const out = [...chars.slice(0, t >= start ? typedCount : 0), cursor];
  return boxed ? <PixelBox t={t} start={start - 0.1}>{out}</PixelBox> : <>{out}</>;
}

function PixelCaptions({ words, t, c, span, busyIn, scene }: { words: Word[]; t: number; c: CaptionSettings; span: Span; busyIn: BusyIn; scene: (t0: number, t1: number) => boolean }) {
  const phrases = useMemo(() => pixelPhrases(words), [words]);
  const ratio = RATIO.v;
  const base = Math.min(c.size, 5.6);
  const style: CSSProperties = { fontFamily: `'${c.font}', 'Pixelify Sans', monospace`, color: c.fill, fontWeight: c.weight };
  return (
    <>
      {phrases.map((p, i) => {
        const t0 = p.words[0].t - 0.14;
        const next = phrases[i + 1];
        const end = Math.min(p.end, next ? next.words[0].t - 0.16 : Infinity);
        if (t < t0 || t >= end) return null;
        if (scene(t0, end)) return null;
        const head = span(t0, end);
        const placed = layoutPhrase(p, head, busyIn(t0, end), ratio, base);
        if (!placed) return null;
        const { slot } = placed;
        const ax = 100 * Math.max(1, ratio);
        const align = slot.kind === 'left' ? 'flex-end' : slot.kind === 'right' ? 'flex-start' : 'center';
        // Exit: tilt back, drift up, blur away.
        const k = clamp01((t - (end - 0.3)) / 0.3);
        const e = easeOut3(k);
        const exit: CSSProperties = k > 0 ? { opacity: 1 - e, filter: `blur(${(e * 0.9).toFixed(3)}cqmin)`, transform: `perspective(80cqmin) translateY(${(-e * 1.8).toFixed(3)}cqmin) rotateX(${(e * 22).toFixed(2)}deg) scale(${(1 - 0.04 * e).toFixed(4)})` } : {};
        const box: CSSProperties = { ...style, ...exit, left: `${(slot.x0 * ax).toFixed(3)}cqmin`, width: `${((slot.x1 - slot.x0) * ax).toFixed(3)}cqmin`, top: `${placed.top.toFixed(3)}cqmin`, alignItems: align, transformOrigin: `${slot.kind === 'left' ? 'right' : slot.kind === 'right' ? 'left' : 'center'} center` };
        const row = (ws: Word[], key: string, size: number) => (
          <div key={key} className="px-row" style={{ justifyContent: align, fontSize: `${size.toFixed(3)}cqmin`, columnGap: `${WORD_GAP}em` }}>
            {ws.map((w) => <PhraseWord key={w.id} w={w} boxed={placed.boxed.has(w)} t={t} />)}
          </div>
        );
        if (p.big && placed.big !== undefined) {
          const key = clean(p.big.w) + (p.bigUnit ? ` ${clean(p.bigUnit.w)}` : '');
          return (
            <div key={i} className="px-cap px-stack" style={{ ...box, rowGap: `${(ROW_GAP * placed.size).toFixed(3)}cqmin` }}>
              {placed.lines.map((ws, li) => row(ws, `l${li}`, placed.size))}
              <div className="px-row" style={{ justifyContent: align, fontSize: `${placed.big!.toFixed(3)}cqmin`, margin: `${(0.35 * placed.size * (placed.lines.length ? 1 : 0)).toFixed(3)}cqmin 0 ${(0.35 * placed.size * (placed.tail.length ? 1 : 0)).toFixed(3)}cqmin` }}>
                <strong className="px-word px-huge"><Typed text={key} t={t} start={p.big.t} boxed={p.boxed.has(p.big)} /></strong>
              </div>
              {placed.tail.map((ws, li) => row(ws, `t${li}`, placed.size))}
            </div>
          );
        }
        return (
          <div key={i} className="px-cap px-stack" style={{ ...box, rowGap: `${(ROW_GAP * placed.size).toFixed(3)}cqmin` }}>
            {placed.lines.map((ws, li) => row(ws, `l${li}`, placed.size))}
          </div>
        );
      })}
    </>
  );
}
