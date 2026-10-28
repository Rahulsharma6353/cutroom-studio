'use client';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPE } from 'react';
import type { Asset, Clip, Track, TrackKind } from '@shared/types';
import { fmtDb, timecode } from '@shared/util';
import { useFilmstrip } from '../../lib/filmstrip';
import { duration, TRACKS, useStore } from '../../store/useStore';
import { I } from '../icons';

export const TRACK_COLOR: Record<TrackKind, string> = {
  overlay: 'var(--overlay)', broll: 'var(--broll)', aroll: 'var(--aroll)', captions: 'var(--captions)', sfx: 'var(--sfx)', music: 'var(--music)',
  key: '#9d5fd6', setup: '#c4a3e6', labels: '#b57fe0', look: '#8d8a99', plate: '#c8c1ac',
};
const ROW_H: Record<TrackKind, number> = { overlay: 32, broll: 48, aroll: 58, captions: 28, sfx: 34, music: 36, key: 28, setup: 26, labels: 26, look: 22, plate: 22 };
/** Tracks that carry sound get a mute switch and a volume line on their clips. */
const AUDIO: TrackKind[] = ['aroll', 'sfx', 'music'];
const HEAD_W = 172;
// Volume line range on a clip, like Premiere's rubber band: top = +12 dB, bottom = −48 dB.
const DB_TOP = 12;
const DB_RANGE = 60;

/** Ruler step: the smallest of these that leaves room for a label. */
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120];

export function Timeline({ height, onResize }: { height: number; onResize: (h: number) => void }) {
  const clips = useStore((s) => s.clips);
  const assets = useStore((s) => s.assets);
  const words = useStore((s) => s.words);
  const pauses = useStore((s) => s.pauses);
  const jobs = useStore((s) => s.jobs);
  const captionsOn = useStore((s) => s.captions.enabled);
  const playhead = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const selection = useStore((s) => s.selection);
  const selected = useStore((s) => s.selectedClipIds);
  const pps = useStore((s) => s.pxPerSec);
  const tool = useStore((s) => s.tool);
  const snapping = useStore((s) => s.snapping);
  const tracks = useStore((s) => s.tracks);
  const total = useStore(duration);
  const rows = TRACKS.filter((tr) => !tr.optional || clips.some((c) => c.trackId === tr.id));
  const st = useStore.getState;

  const scroller = useRef<HTMLDivElement>(null);
  const lanes = useRef<HTMLDivElement>(null);
  const width = (total + 8) * pps;
  const [gainTip, setGainTip] = useState<{ id: string; db: number } | null>(null);

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    const x = HEAD_W + playhead * pps;
    if (x > el.scrollLeft + el.clientWidth - 60 || x < el.scrollLeft + HEAD_W) el.scrollLeft = Math.max(0, x - HEAD_W - 80);
  }, [playhead, playing, pps]);

  const timeAt = (clientX: number) => {
    const r = lanes.current!.getBoundingClientRect();
    return Math.max(0, Math.min(total, (clientX - r.left) / pps));
  };

  const editPoints = (exclude?: string) => [0, total, playhead, ...(selection ? [selection.start, selection.end] : []), ...clips.filter((c) => c.id !== exclude).flatMap((c) => [c.start, c.start + c.duration])];
  const snap = (t: number, exclude?: string, withPlayhead = true) => {
    if (!snapping) return t;
    const tol = 7 / pps;
    let best = t;
    let bestD = tol;
    for (const p of editPoints(exclude)) {
      if (!withPlayhead && p === playhead) continue;
      const d = Math.abs(p - t);
      if (d < bestD) { best = p; bestD = d; }
    }
    return best;
  };

  const drag = (onMove: (ev: PointerEvent) => void, onUp?: (ev: PointerEvent) => void) => {
    const move = (ev: PointerEvent) => onMove(ev);
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onUp?.(ev);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Ruler and playhead head: drag to scrub. Playback pauses while you scrub.
  const onScrubPlayhead = (e: RPE) => {
    e.preventDefault();
    e.stopPropagation();
    const wasPlaying = st().playing;
    if (wasPlaying) st().setPlaying(false);
    st().setPlayhead(snap(timeAt(e.clientX), undefined, false));
    drag((ev) => st().setPlayhead(snap(timeAt(ev.clientX), undefined, false)), () => { if (wasPlaying) st().setPlaying(true); });
  };

  // Empty lane space: drag to mark a range (In/Out) for the editor; a click moves the playhead.
  const onLaneDown = (e: RPE) => {
    if ((e.target as HTMLElement).closest('.clip, .gain-line')) return;
    const x0 = e.clientX;
    const t0 = snap(timeAt(x0));
    let dragging = false;
    drag(
      (ev) => {
        if (!dragging && Math.abs(ev.clientX - x0) < 4) return;
        dragging = true;
        const t1 = snap(timeAt(ev.clientX));
        st().setSelection({ start: Math.min(t0, t1), end: Math.max(t0, t1) });
      },
      (ev) => {
        if (!dragging) {
          st().clearSelection();
          st().setPlayhead(timeAt(ev.clientX));
        } else {
          const sel = st().selection;
          if (sel && sel.end - sel.start < 0.15) st().setSelection(null);
          else if (sel) st().setPlayhead(sel.start);
        }
      },
    );
  };

  const onClipDown = (e: RPE, c: Clip, mode: 'move' | 'left' | 'right') => {
    e.stopPropagation();
    if (tool === 'razor') {
      st().razorAt(c.id, snap(timeAt(e.clientX), c.id));
      return;
    }
    if (mode === 'move') st().selectClip(c.id, e.shiftKey || e.metaKey || e.ctrlKey);
    if (tracks[c.trackId]?.locked) return;
    const x0 = e.clientX;
    let started = false;
    drag((ev) => {
      const dx = (ev.clientX - x0) / pps;
      if (!started) {
        if (Math.abs(ev.clientX - x0) < 3) return;
        started = true;
        st().beginGesture();
      }
      if (mode === 'move') {
        const s = snap(c.start + dx, c.id);
        const e2 = snap(c.start + c.duration + dx, c.id);
        st().moveClip(c.id, Math.abs(s - (c.start + dx)) <= Math.abs(e2 - (c.start + c.duration + dx)) ? s : e2 - c.duration);
      } else if (mode === 'left') st().trimClip(c.id, 'left', snap(c.start + dx, c.id));
      else st().trimClip(c.id, 'right', snap(c.start + c.duration + dx, c.id));
    });
  };

  // The yellow volume line on a clip: drag up/down to change its volume, double-click for 0 dB.
  const onGainDown = (e: RPE, c: Clip, h: number) => {
    e.stopPropagation();
    if (tracks[c.trackId]?.locked) return;
    st().selectClip(c.id, false);
    st().beginGesture();
    const y0 = e.clientY;
    const db0 = c.gainDb ?? 0;
    setGainTip({ id: c.id, db: db0 });
    drag(
      (ev) => {
        const db = Math.max(-60, Math.min(DB_TOP, db0 - ((ev.clientY - y0) / h) * DB_RANGE * (ev.shiftKey ? 0.2 : 1)));
        st().setClipGain(c.id, db);
        setGainTip({ id: c.id, db });
      },
      () => setGainTip(null),
    );
  };

  const onResizeDown = (e: RPE) => {
    const y0 = e.clientY;
    const h0 = height;
    drag((ev) => onResize(Math.max(200, Math.min(window.innerHeight * 0.65, h0 - (ev.clientY - y0)))));
  };

  const fit = () => {
    const w = (scroller.current?.clientWidth ?? 900) - HEAD_W - 24;
    st().setPxPerSec(w / Math.max(1, total));
  };

  const step = STEPS.find((s) => s * pps >= 70) ?? 120;
  const ticks: number[] = [];
  for (let t = 0; t <= total + 8; t += step / 4) ticks.push(Math.round(t * 1000) / 1000);
  const one = selected.length === 1 ? clips.find((c) => c.id === selected[0]) : undefined;
  const oneKind = one ? TRACKS.find((t) => t.id === one.trackId)?.kind : undefined;
  const lanesH = rows.reduce((n, r) => n + ROW_H[r.kind], 0);

  return (
    <section className={`timeline tool-${tool}`} aria-label="Timeline">
      <div className="tl-resize" onPointerDown={onResizeDown} aria-hidden />
      <div className="tl-tools" role="toolbar" aria-label="Timeline tools">
        <div className="tl-group" role="group" aria-label="Tool">
          <button className="tl-btn" aria-pressed={tool === 'select'} onClick={() => st().setTool('select')} title="Selection tool (V)"><I.Cursor /></button>
          <button className="tl-btn" aria-pressed={tool === 'razor'} onClick={() => st().setTool('razor')} title="Razor tool: click a clip to cut it (C)"><I.Razor /></button>
        </div>
        <div className="tl-group">
          <button className="tl-btn" onClick={() => st().splitAtPlayhead()} title="Cut at playhead (Ctrl/⌘ K)"><I.Split /></button>
          <button className="tl-btn" onClick={() => st().deleteSelected()} disabled={!selection && !selected.length} title={selection && !selected.length ? 'Ripple delete In–Out (Delete)' : 'Delete clip (Delete)'}>{selection && !selected.length ? <I.Ripple /> : <I.Trash />}</button>
        </div>
        <div className="tl-group">
          <button className="tl-btn" aria-pressed={snapping} onClick={() => st().toggleSnapping()} title="Snapping (S)"><I.Magnet /></button>
        </div>
        <div className="tl-group" role="group" aria-label="In and Out">
          <button className="tl-btn" onClick={() => st().markIn()} title="Mark In at playhead (I)"><I.MarkIn /></button>
          <button className="tl-btn" onClick={() => st().markOut()} title="Mark Out at playhead (O)"><I.MarkOut /></button>
          {selection && <button className="tl-btn tl-text" onClick={() => st().clearInOut()} title="Clear In and Out (Alt X)">Clear</button>}
        </div>
        <div className="tl-time tnum" aria-live="off">
          <b>{timecode(playhead, true)}</b>
          {selection && <span>In {timecode(selection.start, true)} · Out {timecode(selection.end, true)} · {(selection.end - selection.start).toFixed(2)} s</span>}
        </div>
        <div className="tl-inspector">
          {one ? (
            <>
              <span className="tl-clipname" title={one.label}>{one.label}</span>
              {oneKind && AUDIO.includes(oneKind) && (
                <label className="tl-vol" title="Clip volume. Drag the yellow line on the clip, or use this slider.">
                  <I.Speaker size={15} />
                  <input
                    type="range" min={-40} max={12} step={0.5} value={Math.max(-40, one.gainDb ?? 0)}
                    onPointerDown={() => st().beginGesture()}
                    onChange={(e) => st().setClipGain(one.id, Number(e.target.value) <= -40 ? -60 : Number(e.target.value))}
                    aria-label="Clip volume in dB"
                  />
                  <button className="tnum tl-db" onClick={() => { st().beginGesture(); st().setClipGain(one.id, 0); }} title="Reset to 0 dB">{fmtDb(one.gainDb ?? 0)}</button>
                </label>
              )}
            </>
          ) : (
            <span className="tl-hint">{tool === 'razor' ? 'Click a clip to cut it there' : 'Drag across the tracks or press I / O to mark a range for the editor'}</span>
          )}
        </div>
        <div className="tl-group tl-zoom">
          <button className="tl-btn" onClick={() => st().setPxPerSec(pps / 1.4)} title="Zoom out (−)"><I.ZoomOut /></button>
          <input className="zoom" type="range" min={6} max={240} value={pps} onChange={(e) => st().setPxPerSec(Number(e.target.value))} aria-label="Timeline zoom" />
          <button className="tl-btn" onClick={() => st().setPxPerSec(pps * 1.4)} title="Zoom in (+)"><I.ZoomIn /></button>
          <button className="tl-btn" onClick={fit} title="Fit the whole edit (\)"><I.Fit /></button>
        </div>
      </div>

      <div className="tl-scroll" ref={scroller}>
        <div className="tl-grid" style={{ width: HEAD_W + width }}>
          <div className="tl-ruler-row">
            <div className="tl-corner tnum">{timecode(total)}</div>
            <div className="ruler" style={{ width }} onPointerDown={onScrubPlayhead} title="Drag to move the playhead">
              {ticks.map((t) => {
                const major = Math.abs(t / step - Math.round(t / step)) < 0.001;
                return <div key={t} className={`tick ${major ? '' : 'minor'}`} style={{ left: t * pps }}>{major && <span className="tnum">{timecode(t)}</span>}</div>;
              })}
              {selection && <div className="ruler-io" style={{ left: selection.start * pps, width: (selection.end - selection.start) * pps }}><i className="io-in" /><i className="io-out" /></div>}
              <div className="ruler-playhead" style={{ left: playhead * pps }}>
                <button className="playhead-head" onPointerDown={onScrubPlayhead} aria-label={`Playhead at ${timecode(playhead)}. Drag to move.`} />
              </div>
            </div>
          </div>

          {rows.map((tr) => (
            <div key={tr.id} className={`tl-row ${tracks[tr.id]?.hidden || (tracks[tr.id]?.muted && tr.kind !== 'aroll') ? 'off' : ''} ${tracks[tr.id]?.locked ? 'locked' : ''}`} style={{ height: ROW_H[tr.kind] }}>
              <TrackHead tr={tr} />
              <div className="lane" style={{ width }} onPointerDown={onLaneDown}>
                {tr.kind === 'captions'
                  ? words.map((w) => (
                      <div key={w.id} className={`word-block ${w.filler ? 'f' : ''} ${captionsOn ? '' : 'dim'}`} style={{ left: w.t * pps, width: Math.max(2, w.d * pps - 1) }} title={w.w}>{pps > 40 ? w.w : ''}</div>
                    ))
                  : clips.filter((c) => c.trackId === tr.id).map((c) => (
                      <ClipView
                        key={c.id} c={c} kind={tr.kind} pps={pps} h={ROW_H[tr.kind]}
                        asset={c.assetId ? assets.find((a) => a.id === c.assetId) : undefined}
                        progress={c.jobId ? jobs.find((x) => x.id === c.jobId)?.progress : undefined}
                        selected={selected.includes(c.id)}
                        gainTip={gainTip?.id === c.id ? gainTip.db : null}
                        onDown={onClipDown} onGainDown={onGainDown}
                      />
                    ))}
                {tr.kind === 'aroll' && pauses.map((p, i) => <div key={i} className="pause-mark" style={{ left: p.t * pps, width: p.d * pps }} title="Pause" />)}
              </div>
            </div>
          ))}

          <div className="tl-overlay" ref={lanes} style={{ left: HEAD_W, width, height: 28 + lanesH }}>
            {selection && (
              <div className="sel-band" style={{ left: selection.start * pps, width: (selection.end - selection.start) * pps }}>
                <span className="tnum">{(selection.end - selection.start).toFixed(1)}s</span>
              </div>
            )}
            <div className="playhead" style={{ left: playhead * pps }} />
          </div>
        </div>
      </div>
    </section>
  );
}

function TrackHead({ tr }: { tr: Track }) {
  const t = useStore((s) => s.tracks[tr.id]);
  const setTrack = useStore((s) => s.setTrack);
  const audio = AUDIO.includes(tr.kind);
  const visual = tr.kind !== 'sfx' && tr.kind !== 'music';
  return (
    <div className="tl-head">
      <i style={{ background: TRACK_COLOR[tr.kind] }} />
      <span className="tl-head-name">{tr.label}</span>
      <span className="tl-head-btns">
        {visual && (
          <button className="tl-hbtn" aria-pressed={!!t?.hidden} onClick={() => setTrack(tr.id, { hidden: !t?.hidden })} title={t?.hidden ? `Show ${tr.label}` : `Hide ${tr.label} (not in preview or export)`}>
            {t?.hidden ? <I.EyeOff size={14} /> : <I.Eye size={14} />}
          </button>
        )}
        {audio && (
          <button className="tl-hbtn" aria-pressed={!!t?.muted} onClick={() => setTrack(tr.id, { muted: !t?.muted })} title={t?.muted ? `Unmute ${tr.label}` : `Mute ${tr.label}`}>
            {t?.muted ? <I.SpeakerOff size={14} /> : <I.Speaker size={14} />}
          </button>
        )}
        <button className="tl-hbtn" aria-pressed={!!t?.locked} onClick={() => setTrack(tr.id, { locked: !t?.locked })} title={t?.locked ? `Unlock ${tr.label}` : `Lock ${tr.label}`}>
          {t?.locked ? <I.Lock size={14} /> : <I.Unlock size={14} />}
        </button>
      </span>
    </div>
  );
}

function ClipView({ c, kind, asset, pps, h, progress, selected, gainTip, onDown, onGainDown }: {
  c: Clip; kind: TrackKind; asset?: Asset; pps: number; h: number; progress?: number; selected: boolean; gainTip: number | null;
  onDown: (e: RPE, c: Clip, mode: 'move' | 'left' | 'right') => void;
  onGainDown: (e: RPE, c: Clip, h: number) => void;
}) {
  const w = Math.max(4, c.duration * pps - 1);
  const isVideo = !!asset?.url && !asset.audioOnly && (kind === 'aroll' || kind === 'broll' || kind === 'overlay') && asset.kind !== 'image' && asset.kind !== 'music' && !/\.(png|jpe?g|webp|gif|avif)$/i.test(asset.name);
  const isImage = !!asset?.url && (asset.kind === 'image' || /\.(png|jpe?g|webp|gif|avif)$/i.test(asset.name));
  const strip = useFilmstrip(isVideo && w > 30 ? asset!.url : undefined);
  const audio = AUDIO.includes(kind) && h >= 30;
  const db = c.gainDb ?? 0;
  const y = Math.min(1, Math.max(0, (DB_TOP - Math.max(-48, db)) / DB_RANGE)) * (h - 4) + 2;

  // Filmstrip tiles: each shows the frame at its own point in the clip.
  let tiles: { left: number; src: string }[] = [];
  if (strip && strip.frames.length) {
    const tileW = Math.max(24, (h - 2) * strip.aspect);
    for (let x = 0; x < w; x += tileW) {
      const t = c.in + x / pps;
      const i = Math.min(strip.frames.length - 1, Math.max(0, Math.round(t / strip.step)));
      tiles.push({ left: x, src: strip.frames[i] });
      if (tiles.length > 400) break;
    }
  }
  const style: CSSProperties = { left: c.start * pps, width: w, background: TRACK_COLOR[kind] };
  if (isImage) Object.assign(style, { backgroundImage: `url("${asset!.url}")`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' });

  return (
    <div
      className={`clip ${selected ? 'sel' : ''} ${c.changeSetId ? 'ai' : ''} ${c.status !== 'ready' ? 'pending' : ''} ${tiles.length || isImage ? 'thumbs' : ''}`}
      style={style}
      onPointerDown={(e) => onDown(e, c, 'move')}
      title={`${c.label}${audio ? ` · ${fmtDb(db)}` : ''}`}
    >
      {tiles.length > 0 && <div className="strip" aria-hidden>{tiles.map((tile, i) => <img key={i} src={tile.src} alt="" style={{ left: tile.left, height: h - 2 }} draggable={false} />)}</div>}
      <div className="handle l" onPointerDown={(e) => onDown(e, c, 'left')} />
      {c.status !== 'ready' && w > 24 && <span className="spinner" style={{ width: 10, height: 10 }} />}
      {w > 34 && <span className="clip-label">{c.label}</span>}
      {c.zoom && c.zoom > 1 && <b className="zoomtag">{Math.round(c.zoom * 100)}%</b>}
      {progress !== undefined && c.status !== 'ready' && <i className="prog" style={{ width: `${progress * 100}%` }} />}
      {audio && (
        <div className="gain-line" style={{ top: y }} onPointerDown={(e) => onGainDown(e, c, h)} onDoubleClick={(e) => { e.stopPropagation(); useStore.getState().beginGesture(); useStore.getState().setClipGain(c.id, 0); }} title="Drag to change volume, double-click for 0 dB (Shift for fine)">
          <i />
        </div>
      )}
      {gainTip !== null && <span className="gain-tip tnum">{fmtDb(gainTip)}</span>}
      <div className="handle r" onPointerDown={(e) => onDown(e, c, 'right')} />
    </div>
  );
}
