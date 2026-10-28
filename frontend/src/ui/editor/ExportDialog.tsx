'use client';
import { useEffect, useRef, useState } from 'react';
import { online, startExport, waitForJob } from '../../lib/api';
import type { Word } from '@shared/types';
import { duration, useStore } from '../../store/useStore';
import { I } from '../icons';

const PRESETS = [
  { id: 'reel', label: 'Instagram Reel', aspect: '9:16', res: '1080p', fps: '30' },
  { id: 'short', label: 'YouTube Short', aspect: '9:16', res: '1080p', fps: '30' },
  { id: 'yt', label: 'YouTube 16:9', aspect: '16:9', res: '4K', fps: '30' },
  { id: 'linkedin', label: 'LinkedIn', aspect: '1:1', res: '1080p', fps: '30' },
  { id: 'custom', label: 'Custom', aspect: '', res: '1080p', fps: '30' },
];
const PREMIERE = 'Premiere Pro project (.zip)';
const FORMATS = ['MP4 (H.264)', 'MP4 (H.265)', 'MOV (ProRes 422)', 'WebM', 'GIF', 'MP3 audio only', 'WAV audio only', PREMIERE];
const FOLDER_KEY = 'cutroom.premiereFolder';
const readFolder = () => { try { return localStorage.getItem(FOLDER_KEY) ?? ''; } catch { return ''; } };

function srt(words: Word[], per = 4): string {
  const ts = (s: number) => {
    const ms = Math.round(s * 1000);
    const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60, r = ms % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(r).padStart(3, '0')}`;
  };
  const vis = words.filter((w) => !w.filler);
  const out: string[] = [];
  for (let i = 0, n = 1; i < vis.length; i += per, n++) {
    const g = vis.slice(i, i + per);
    out.push(`${n}\n${ts(g[0].t)} --> ${ts(g.at(-1)!.t + g.at(-1)!.d)}\n${g.map((w) => w.w).join(' ')}\n`);
  }
  return out.join('\n');
}

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportDialog() {
  const close = () => useStore.getState().setExportOpen(false);
  const project = useStore((s) => s.project)!;
  const selection = useStore((s) => s.selection);
  const total = useStore(duration);
  const [preset, setPreset] = useState('reel');
  const [format, setFormat] = useState(FORMATS[0]);
  const [res, setRes] = useState('1080p');
  const [fps, setFps] = useState('30');
  const [quality, setQuality] = useState('Standard');
  const [captions, setCaptions] = useState('Burned in');
  const [credits, setCredits] = useState(true);
  const [range, setRange] = useState<'all' | 'sel'>('all');
  const [phase, setPhase] = useState<'settings' | 'rendering' | 'done'>('settings');
  const [progress, setProgress] = useState(0);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState('');
  const [folder, setFolder] = useState(readFolder);
  const isPremiere = format === PREMIERE;
  const abort = useRef<AbortController | null>(null);
  const live = online();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => () => abort.current?.abort(), []);

  // Preview build: no render server, so progress is simulated.
  useEffect(() => {
    if (phase !== 'rendering' || live) return;
    const id = setInterval(() => setProgress((p) => {
      if (p >= 1) { clearInterval(id); setPhase('done'); useStore.getState().setStatus('Exported'); return 1; }
      return Math.min(1, p + 0.035);
    }), 120);
    return () => clearInterval(id);
  }, [phase]);

  const pick = (id: string) => {
    setPreset(id);
    const p = PRESETS.find((x) => x.id === id)!;
    setRes(p.res);
    setFps(p.fps);
    if (p.aspect && p.aspect !== project.aspect) useStore.getState().setAspect(p.aspect as typeof project.aspect);
  };

  const seconds = range === 'sel' && selection ? selection.end - selection.start : total;
  const slug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'video';

  const exportNow = async () => {
    setProgress(0);
    setError('');
    setFileUrl(null);
    setPhase('rendering');
    const before = useStore.getState().project?.status ?? 'Editing';
    useStore.getState().setStatus('Rendering');
    if (!live) return;
    const s = useStore.getState();
    const burn = captions === 'Burned in' || captions === 'Both';
    try {
      const { jobId } = await startExport({
        title: project.title, aspect: project.aspect, clips: s.clips, assets: s.assets, words: s.words,
        captions: { ...s.captions, enabled: s.captions.enabled && burn }, look: s.look,
        format, res, fps: Number(fps), quality, range: range === 'sel' && selection ? selection : null, duration: total,
        ...(isPremiere ? { folder } : {}),
      });
      if (isPremiere) { try { localStorage.setItem(FOLDER_KEY, folder); } catch { /* private mode */ } }
      abort.current = new AbortController();
      await waitForJob(jobId, (j) => { setProgress(j.progress); setStep(j.steps[Math.min(j.step, j.steps.length - 1)] ?? ''); }, abort.current.signal);
      setFileUrl(`/api/exports/${jobId}`);
      setProgress(1);
      setPhase('done');
      useStore.getState().setStatus('Exported');
    } catch (err) {
      useStore.getState().setStatus(before);
      if (err instanceof Error && err.message === 'cancelled') return;
      setError(err instanceof Error ? err.message : 'The export stopped. Try again.');
      setPhase('settings');
    }
  };



  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="exp-title" onMouseDown={(e) => e.target === e.currentTarget && phase !== 'rendering' && close()}>
      <div className="dialog" style={{ width: 'min(680px, 100%)' }}>
        <div className="dialog-head">
          <h2 id="exp-title">{phase === 'settings' ? <>Export <em>your cut</em></> : phase === 'rendering' ? <>Exporting<em>…</em></> : <>Your export <em>is ready.</em></>}</h2>
          <button className="icon-btn" onClick={close} aria-label="Close"><I.X /></button>
        </div>

        <div className="dialog-body">
          {phase === 'settings' && (
            <div className="export-grid">
              <div className="presets-row" role="group" aria-label="Preset">
                {PRESETS.map((p) => <button key={p.id} className="chip" aria-pressed={preset === p.id} onClick={() => pick(p.id)}>{p.label}</button>)}
              </div>
              <label className="field"><span>Format</span>
                <select className="select" value={format} onChange={(e) => { setFormat(e.target.value); setPreset('custom'); }}>{FORMATS.map((f) => <option key={f}>{f}</option>)}</select>
              </label>
              <label className="field"><span>Captions</span>
                <select className="select" value={captions} onChange={(e) => setCaptions(e.target.value)}>{['Burned in', 'Separate .srt file', 'Both', 'None'].map((f) => <option key={f}>{f}</option>)}</select>
              </label>
              <div className="field"><span>Resolution</span>
                <div className="seg" role="group">{['720p', '1080p', '1440p', '4K'].map((r) => <button key={r} aria-pressed={res === r} onClick={() => { setRes(r); setPreset('custom'); }}>{r}</button>)}</div>
              </div>
              <div className="field"><span>Frame rate</span>
                <div className="seg" role="group">{['24', '25', '30', '60'].map((r) => <button key={r} aria-pressed={fps === r} onClick={() => { setFps(r); setPreset('custom'); }}>{r} fps</button>)}</div>
              </div>
              <div className="field"><span>Quality</span>
                <div className="seg" role="group">{['Draft', 'Standard', 'High'].map((r) => <button key={r} aria-pressed={quality === r} onClick={() => setQuality(r)}>{r}</button>)}</div>
              </div>
              <div className="field"><span>Range</span>
                <div className="seg" role="group">
                  <button aria-pressed={range === 'all'} onClick={() => setRange('all')}>Whole video</button>
                  <button aria-pressed={range === 'sel'} disabled={!selection} onClick={() => setRange('sel')}>Selected part</button>
                </div>
              </div>
              <div className="row-between" style={{ gridColumn: '1 / -1' }}>
                <span style={{ fontSize: 13 }}>Add a credits card for stock and sourced media</span>
                <button className="switch" role="switch" aria-checked={credits} onClick={() => setCredits(!credits)} aria-label="Add credits card" />
              </div>
              {isPremiere && (
                <label className="field" style={{ gridColumn: '1 / -1' }}><span>Where you’ll unzip it</span>
                  <input className="input" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="C:\Users\you\Downloads  or  /Users/you/Downloads" spellCheck={false} />
                  <small style={{ color: 'var(--faint)', fontSize: 12 }}>Premiere links media by full path. Get this right and everything opens linked; otherwise Premiere asks you to find one file once.</small>
                </label>
              )}
              {error && <p className="note" role="alert" style={{ gridColumn: '1 / -1', margin: 0, borderColor: 'var(--danger)', color: 'var(--text)' }}>{error}</p>}
              <p className="note" style={{ gridColumn: '1 / -1', margin: 0 }}>
                {isPremiere
                  ? <>A project for Premiere Pro: your footage cut into shots, every caption phrase and graphic as its own transparent clip, B-roll, music and sound effects on their own tracks. {project.aspect}, {res}, {fps} fps.</>
                  : <>{project.aspect}, {res}, {fps} fps, {format}, about {Math.round(seconds)} seconds.</>} Rendering runs on the server. Keep this window open to download the file when it’s done.
              </p>
            </div>
          )}

          {phase !== 'settings' && (
            <div className="render" role="status" aria-live="polite">
              <div className="big tnum">{Math.round(progress * 100)}%</div>
              <div className="bar"><i style={{ width: `${progress * 100}%` }} /></div>
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                {phase === 'rendering' ? (live && step ? `${step}…` : `Rendering at ${res}`) : 'Your files are ready.'}
              </span>
              {phase === 'done' && (
                <div style={{ display: 'grid', gap: 8, marginTop: 14, width: '100%', maxWidth: 420 }}>
                  {fileUrl ? (
                    <a className="btn btn-primary" style={{ justifyContent: 'center', textDecoration: 'none' }} href={fileUrl} download>
                      <I.Export /> {isPremiere ? 'Download Premiere project (.zip)' : 'Download video'}
                    </a>
                  ) : (
                    <button className="btn btn-primary" style={{ justifyContent: 'center' }} disabled title="Needs the render server">
                      <I.Export /> Download {slug}.mp4
                    </button>
                  )}
                  <button className="btn" style={{ justifyContent: 'center' }} onClick={() => download(`${slug}.srt`, srt(useStore.getState().words), 'text/plain')}>Download captions (.srt)</button>
                  <button className="btn" style={{ justifyContent: 'center' }} onClick={() => {
                    const s = useStore.getState();
                    download(`${slug}.edit.json`, JSON.stringify({ project: s.project, clips: s.clips, captions: s.captions, words: s.words }, null, 2), 'application/json');
                  }}>Download edit file (.json)</button>
                  {!fileUrl && <span style={{ fontSize: 12, color: 'var(--faint)' }}>This preview has no render server, so video download is off. The full app renders on its server.</span>}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="dialog-foot">
          <span className="foot-note">{isPremiere ? 'Opens in Premiere Pro 2020 or later.' : 'Renders on the server.'}</span>
          {phase === 'settings' && <button className="btn btn-primary" onClick={exportNow}><I.Export /> {isPremiere ? 'Export Premiere project' : `Export ${Math.round(seconds)}s video`}</button>}
          {phase === 'rendering' && <button className="btn" onClick={() => { abort.current?.abort(); setPhase('settings'); }}>Back to settings</button>}
          {phase === 'done' && <button className="btn" onClick={close}>Done</button>}
        </div>
      </div>
    </div>
  );
}
