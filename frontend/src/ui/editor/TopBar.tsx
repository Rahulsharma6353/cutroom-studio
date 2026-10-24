'use client';
import { TEMPLATES } from '@shared/sample';
import type { AspectRatio } from '@shared/types';
import { useStore } from '../../store/useStore';
import { I } from '../icons';
import { ThemeToggle } from '../ThemeToggle';

const BASE: AspectRatio[] = ['9:16', '1:1', '4:5', '16:9'];
const JOB_WORD = { image: 'image', video: 'shot', screen: 'recording', stock: 'B-roll search', music: 'track' } as const;

export function TopBar() {
  const project = useStore((s) => s.project);
  const go = useStore((s) => s.go);
  const rename = useStore((s) => s.rename);
  const setAspect = useStore((s) => s.setAspect);
  // Styles made for one shape (Explainer: 9:16) lock the shape switcher.
  const locked = TEMPLATES.find((t) => t.id === useStore.getState().project?.templateId)?.aspects;
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const allJobs = useStore((s) => s.jobs);
  const jobs = allJobs.filter((j) => j.status === 'running' || j.status === 'queued');
  const setExportOpen = useStore((s) => s.setExportOpen);
  if (!project) return null;

  const label = jobs.length === 1 ? `Creating ${JOB_WORD[jobs[0].type]}` : `${jobs.length} tasks running`;

  return (
    <header className="topbar">
      <button className="icon-btn" onClick={() => go('dashboard')} aria-label="Back to projects"><I.Back /></button>
      <input className="title" value={project.title} onChange={(e) => rename(e.target.value)} aria-label="Video title" />
      <span className="saved">Saved</span>
      <div className="spacer" />
      <div className="seg" role="group" aria-label="Aspect ratio">
        {(BASE.includes(project.aspect) ? BASE : [...BASE, project.aspect]).map((r) => <button key={r} aria-pressed={project.aspect === r} onClick={() => setAspect(r)} disabled={!!locked && !locked.includes(r)} title={locked && !locked.includes(r) ? `This style is made for ${locked.join(', ')}` : undefined}>{r}</button>)}
      </div>
      <div style={{ display: 'flex', gap: 2 }}>
        <button className="icon-btn" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)"><I.Undo /></button>
        <button className="icon-btn" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><I.Redo /></button>
      </div>
      <div className="spacer" />
      {jobs.length > 0 && <span className="tasks-pill" role="status"><span className="spinner" />{label}</span>}
      <ThemeToggle />
      <button className="btn btn-primary" onClick={() => setExportOpen(true)}><I.Export /> Export</button>
    </header>
  );
}
