'use client';
import { useEffect, useRef, useState } from 'react';
import { duration, useStore } from '../../store/useStore';
import { I } from '../icons';
import { ChatPanel } from './ChatPanel';
import { ExportDialog } from './ExportDialog';
import { LeftPanel } from './LeftPanel';
import { Player } from './Player';
import { Timeline } from './Timeline';
import { TopBar } from './TopBar';

export function Editor() {
  const building = useStore((s) => s.building);
  const exportOpen = useStore((s) => s.exportOpen);
  const [tlHeight, setTlHeight] = useState(272);

  // Generation jobs and playback both run on one clock.
  useEffect(() => {
    let last = performance.now();
    let raf = 0;
    let jobAcc = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = useStore.getState();
      if (s.playing) {
        const end = duration(s);
        const next = s.playhead + dt;
        if (next >= end) useStore.setState({ playhead: end, playing: false });
        else useStore.setState({ playhead: next });
      }
      jobAcc += dt;
      if (jobAcc >= 0.1) {
        s.tickJobs(jobAcc);
        jobAcc = 0;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Keyboard shortcuts — skipped while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable]')) return;
      const s = useStore.getState();
      if (s.exportOpen || s.wizardOpen) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === 'Space') { e.preventDefault(); s.togglePlay(); }
      else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); }
      else if (e.key === 's' && !mod) s.splitAtPlayhead();
      else if (e.key === 'Delete' || e.key === 'Backspace') s.deleteSelected();
      else if (e.key === 'Escape') s.clearSelection();
      else if (e.key === 'ArrowLeft') s.setPlayhead(s.playhead - (e.shiftKey ? 1 : 1 / 30));
      else if (e.key === 'ArrowRight') s.setPlayhead(s.playhead + (e.shiftKey ? 1 : 1 / 30));
      else if (e.key === '/') { e.preventDefault(); document.getElementById('composer')?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (building) return <BuildScreen />;

  return (
    <div className="editor" style={{ ['--tl-h' as string]: `${tlHeight}px` }}>
      <TopBar />
      <div className="work">
        <LeftPanel />
        <Player />
        <ChatPanel />
      </div>
      <Timeline onResize={setTlHeight} height={tlHeight} />
      {exportOpen && <ExportDialog />}
    </div>
  );
}

function BuildScreen() {
  const b = useStore((s) => s.building)!;
  const project = useStore((s) => s.project);
  const go = useStore((s) => s.go);
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (b.error) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [b.error]);
  const overall = Math.min(1, (b.index + (b.progress ?? 0)) / b.steps.length);
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  return (
    <div className="building" role="status" aria-live="polite">
      <div className="building-card">
        <p className="building-kicker">{b.error ? 'Something went wrong' : `Step ${Math.min(b.index + 1, b.steps.length)} of ${b.steps.length} · ${project?.title ?? ''}`}</p>
        <h2 ref={ref} tabIndex={-1}>{b.error ? <>The first cut <em>stopped.</em></> : <>Making your <em>first cut…</em></>}</h2>
        {!b.error && (
          <div className="build-overall">
            <div><span>Overall · <span className="tnum">{clock}</span> elapsed</span><span className="tnum">{Math.round(overall * 100)}%</span></div>
            <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(overall * 100)} aria-label="First cut progress"><i style={{ width: `${overall * 100}%` }} /></div>
          </div>
        )}
        <ul className="build-steps">
          {b.steps.map((s, i) => (
            <li key={s} className={i < b.index ? 'done' : i === b.index ? 'now' : ''}>
              <b>{i < b.index ? <I.Check size={14} /> : i === b.index ? (b.error ? <I.X size={14} /> : <span className="spinner" />) : <span style={{ width: 6, height: 6, borderRadius: 9, background: 'currentColor', display: 'block' }} />}</b>
              <span style={{ flex: 1 }}>{s}</span>
              {i === b.index && !b.error && b.progress !== undefined && b.progress > 0 && <span className="tnum" style={{ color: 'var(--muted)', fontSize: 12.5 }}>{Math.round(b.progress * 100)}%</span>}
            </li>
          ))}
        </ul>
        {b.error && (
          <>
            <p className="note" style={{ margin: 0 }}>{b.error}</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={() => { useStore.setState({ building: null }); go('dashboard'); }}>Back to projects</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
