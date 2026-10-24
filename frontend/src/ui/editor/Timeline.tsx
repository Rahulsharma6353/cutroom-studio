'use client';
import { useEffect, useRef, type PointerEvent as RPE } from 'react';
import type { Clip, TrackKind } from '@shared/types';
import { timecode } from '@shared/util';
import { duration, TRACKS, useStore } from '../../store/useStore';
import { I } from '../icons';

export const TRACK_COLOR: Record<TrackKind, string> = {
  overlay: 'var(--overlay)', broll: 'var(--broll)', aroll: 'var(--aroll)', captions: 'var(--captions)', sfx: 'var(--sfx)', music: 'var(--music)',
  key: '#9d5fd6', setup: '#c4a3e6', labels: '#b57fe0', look: '#8d8a99', plate: '#c8c1ac',
};
const ROW_H: Record<TrackKind, number> = { overlay: 30, broll: 38, aroll: 44, captions: 28, sfx: 26, music: 30, key: 28, setup: 26, labels: 26, look: 22, plate: 22 };

export function Timeline({ height, onResize }: { height: number; onResize: (h: number) => void }) {
  const clips = useStore((s) => s.clips);
  const words = useStore((s) => s.words);
  const pauses = useStore((s) => s.pauses);
  const jobs = useStore((s) => s.jobs);
  const captionsOn = useStore((s) => s.captions.enabled);
  const playhead = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const selection = useStore((s) => s.selection);
  const selected = useStore((s) => s.selectedClipIds);
  const pps = useStore((s) => s.pxPerSec);
  const total = useStore(duration);
  // Layer tracks (explainer) appear only when the edit uses them.
  const rows = TRACKS.filter((tr) => !tr.optional || clips.some((c) => c.trackId === tr.id));
  const st = useStore.getState;

  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const width = (total + 10) * pps;

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    const x = playhead * pps;
    if (x > el.scrollLeft + el.clientWidth - 60 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80);
  }, [playhead, playing, pps]);

  const timeAt = (clientX: number) => {
    const r = inner.current!.getBoundingClientRect();
    return Math.max(0, Math.min(total, (clientX - r.left) / pps));
  };

  // Drag on empty space or the ruler: a range for the editor. A plain click moves the playhead.
  const onScrub = (e: RPE) => {
    if ((e.target as HTMLElement).closest('.clip')) return;
    const x0 = e.clientX;
    const t0 = timeAt(x0);
    let dragging = false;
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientX - x0) < 4) return;
      dragging = true;
      const t1 = timeAt(ev.clientX);
      st().setSelection({ start: Math.min(t0, t1), end: Math.max(t0, t1) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!dragging) {
        st().clearSelection();
        st().setPlayhead(timeAt(ev.clientX));
      } else {
        const sel = st().selection;
        if (sel && sel.end - sel.start < 0.15) st().setSelection(null);
        else if (sel) st().setPlayhead(sel.start);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const snapPoints = (exclude: string) => [playhead, 0, ...clips.filter((c) => c.id !== exclude).flatMap((c) => [c.start, c.start + c.duration])];
  const snap = (t: number, exclude: string) => {
    const tol = 6 / pps;
    for (const p of snapPoints(exclude)) if (Math.abs(p - t) < tol) return p;
    return t;
  };

  const onClipDown = (e: RPE, c: Clip, mode: 'move' | 'left' | 'right') => {
    e.stopPropagation();
    if (mode === 'move') st().selectClip(c.id, e.shiftKey || e.metaKey);
    const x0 = e.clientX;
    let started = false;
    const move = (ev: PointerEvent) => {
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
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onResizeDown = (e: RPE) => {
    const y0 = e.clientY;
    const h0 = height;
    const move = (ev: PointerEvent) => onResize(Math.max(190, Math.min(window.innerHeight * 0.6, h0 - (ev.clientY - y0))));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const step = pps >= 70 ? 1 : pps >= 30 ? 2 : 5;
  const ticks: number[] = [];
  for (let t = 0; t <= total + 10; t += step / 2) ticks.push(t);

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="tl-resize" onPointerDown={onResizeDown} aria-hidden />
      <div className="tl-tools">
        <button className="icon-btn" onClick={() => st().splitAtPlayhead()} title="Split at playhead (S)" aria-label="Split at playhead"><I.Split /></button>
        <button className="icon-btn" onClick={() => st().deleteSelected()} disabled={!selection && !selected.length} title="Delete (Del)" aria-label="Delete selection"><I.Trash /></button>
        <div className="spacer" />
        <span className="tl-hint">{selection ? `Selected ${timecode(selection.start)}–${timecode(selection.end)}. Ask the editor to change it.` : 'Drag across the timeline to select a part for the editor'}</span>
        <input className="zoom" type="range" min={12} max={160} value={pps} onChange={(e) => st().setPxPerSec(Number(e.target.value))} aria-label="Timeline zoom" />
      </div>
      <div className="tl-body">
        <div className="tl-heads">
          {rows.map((tr) => (
            <div key={tr.id} className="tl-head" style={{ ['--row-h' as string]: `${ROW_H[tr.kind]}px` }}>
              <i style={{ background: TRACK_COLOR[tr.kind] }} />{tr.label}
            </div>
          ))}
        </div>
        <div className="tl-scroll" ref={scroller}>
          <div className="tl-inner" ref={inner} style={{ width }} onPointerDown={onScrub}>
            <div className="ruler">
              {ticks.map((t) => {
                const major = Math.abs(t / step - Math.round(t / step)) < 0.001;
                return <div key={t} className={`tick ${major ? '' : 'minor'}`} style={{ left: t * pps }}>{major && <span className="tnum">{timecode(t)}</span>}</div>;
              })}
            </div>
            {rows.map((tr) => (
              <div key={tr.id} className={`row ${tr.kind === 'captions' && !captionsOn ? 'captions-off' : ''}`} style={{ ['--row-h' as string]: `${ROW_H[tr.kind]}px` }}>
                {tr.kind === 'captions'
                  ? words.map((w) => (
                      <div key={w.id} className={`word-block ${w.filler ? 'f' : ''}`} style={{ left: w.t * pps, width: Math.max(2, w.d * pps - 1) }} title={w.w}>{pps > 40 ? w.w : ''}</div>
                    ))
                  : clips.filter((c) => c.trackId === tr.id).map((c) => {
                      const j = c.jobId ? jobs.find((x) => x.id === c.jobId) : undefined;
                      return (
                        <div
                          key={c.id}
                          className={`clip ${selected.includes(c.id) ? 'sel' : ''} ${c.changeSetId ? 'ai' : ''} ${c.status !== 'ready' ? 'pending' : ''}`}
                          style={{ left: c.start * pps, width: Math.max(4, c.duration * pps - 1), background: TRACK_COLOR[tr.kind] }}
                          onPointerDown={(e) => onClipDown(e, c, 'move')}
                          title={c.label}
                        >
                          <div className="handle l" onPointerDown={(e) => onClipDown(e, c, 'left')} />
                          {c.status !== 'ready' && c.duration * pps > 24 && <span className="spinner" style={{ width: 10, height: 10 }} />}
                          {c.duration * pps > 34 && <span>{c.label}</span>}
                          {c.zoom && c.zoom > 1 && <b className="zoomtag">{Math.round(c.zoom * 100)}%</b>}
                          {j && c.status !== 'ready' && <i className="prog" style={{ width: `${j.progress * 100}%` }} />}
                          <div className="handle r" onPointerDown={(e) => onClipDown(e, c, 'right')} />
                        </div>
                      );
                    })}
                {tr.kind === 'aroll' && pauses.map((p, i) => <div key={i} className="pause-mark" style={{ left: p.t * pps, width: p.d * pps, pointerEvents: 'none' }} title="Pause" />)}
              </div>
            ))}
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
