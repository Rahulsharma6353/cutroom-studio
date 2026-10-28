'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project, ProjectSummary, TrackKind } from '@shared/types';
import { SceneThumb, ratioOf } from '@shared/frame/Thumb';
import { toUploaded } from '../lib/files';
import { useStore } from '../store/useStore';
import { I } from './icons';

const FILTERS = ['All', 'Editing', 'Exported', 'Draft'] as const;
type Filter = (typeof FILTERS)[number];
export type ServerState = 'checking' | 'up' | 'down' | 'preview' | 'locked';
const SERVER_TEXT: Record<ServerState, string> = { checking: 'Checking the render server', up: 'Render server connected', down: 'Render server offline', preview: 'Preview: nothing renders here', locked: 'Locked: enter the passcode' };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** Headline voice: the title in roman, its last words in italic. */
function Headline({ text }: { text: string }) {
  const words = text.trim().split(/\s+/);
  if (words.length < 3) return <em>{text}</em>;
  const tail = words.length > 4 ? 2 : 1;
  return <>{words.slice(0, -tail).join(' ')} <em>{words.slice(-tail).join(' ')}</em></>;
}

/** The ⋯ menu on a project card: open or delete. */
function ProjectMenu({ p, onClose }: { p: Project; onClose: () => void }) {
  const openProject = useStore((s) => s.openProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!ref.current?.parentElement?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    ref.current?.querySelector('button')?.focus();
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [onClose]);
  return (
    <div className="proj-menu" role="menu" ref={ref} aria-label={`Actions for ${p.title}`}>
      <button role="menuitem" onClick={() => { onClose(); openProject(p.id); }}>Open</button>
      <hr />
      <button role="menuitem" className="danger" onClick={() => {
        onClose();
        if (window.confirm(`Delete “${p.title}”? This can’t be undone.`)) deleteProject(p.id);
      }}><I.Trash size={15} /> Delete project</button>
    </div>
  );
}

/** A project's frame at its true shape: real footage when we have it, a stand-in otherwise. */
function Frame({ p, size }: { p: Project; size: 'lg' | 'sm' }) {
  const r = ratioOf(p.aspect);
  const box = { aspectRatio: String(r), height: r >= 1 ? undefined : size === 'lg' ? '100%' : '86%', width: r >= 1 ? (size === 'lg' ? '100%' : '86%') : undefined };
  return p.thumb
    ? <video className="clipthumb" style={{ ...box, objectFit: 'cover', background: '#000' }} src={`${p.thumb}#t=1`} muted playsInline preload="metadata" />
    : <SceneThumb hue={p.hue} person style={box} />;
}

const ROWS: { kind: TrackKind; label: string }[] = [
  { kind: 'key', label: 'Key line' },
  { kind: 'setup', label: 'Setup' },
  { kind: 'labels', label: 'Labels' },
  { kind: 'overlay', label: 'Graphics' },
  { kind: 'broll', label: 'B-roll' },
  { kind: 'aroll', label: 'A-roll' },
  { kind: 'captions', label: 'Captions' },
  { kind: 'sfx', label: 'Sound' },
  { kind: 'music', label: 'Music' },
];

/** The project's real tracks, drawn small: where the cuts, captions and sounds sit. */
function MiniTimeline({ s }: { s: ProjectSummary }) {
  const rows = ROWS.filter((r) => s.tracks.some((t) => t.kind === r.kind));
  const marks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="mini" aria-label="Timeline overview">
      <div className="mini-ruler tnum" aria-hidden>
        {marks.map((m) => <span key={m} style={{ left: `${m * 100}%` }}>{clock(m * s.duration)}</span>)}
      </div>
      {rows.map((r) => {
        const spans = s.tracks.find((t) => t.kind === r.kind)!.spans;
        return (
          <div key={r.kind} className="mini-row">
            <span className="mini-label">{r.label}</span>
            <div className="mini-lane">
              {spans.map(([a, b], i) => (
                <i key={i} className={`mini-span k-${r.kind}`} style={{ left: `${(a / s.duration) * 100}%`, width: `max(2px, ${((b - a) / s.duration) * 100}%)` }} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Dashboard({ server }: { server: ServerState }) {
  const projects = useStore((s) => s.projects);
  const openProject = useStore((s) => s.openProject);
  const openWizard = useStore((s) => s.openWizard);
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  const [over, setOver] = useState(false);
  const [filter, setFilter] = useState<Filter>('All');
  const [menu, setMenu] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const take = async (files: FileList | null) => {
    if (!files?.length) return;
    openWizard(await toUploaded(files));
  };

  const last = projects[0]; // most recently edited first
  const rendering = projects.filter((p) => p.status === 'Rendering');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) => (filter === 'All' || p.status === filter) && (!q || p.title.toLowerCase().includes(q)));
  }, [projects, filter, query]);

  return (
    <div className="page-inner">
      <div className="studio-head">
        <h1 className="serif">Your studio, <em>ready to cut.</em></h1>
      </div>
      <div className="desk">
        {last ? (
          <section className="resume" aria-labelledby="resume-title">
            <button className="resume-frame" onClick={() => openProject(last.id)} aria-label={`Open ${last.title}`}>
              <Frame p={last} size="lg" />
              <span className="tc tnum">{clock(last.duration)}</span>
            </button>
            <div className="resume-info">
              <p className="resume-kicker">Continue editing</p>
              <h2 id="resume-title"><Headline text={last.title} /></h2>
              <div className="meta">
                <span className="state" data-s={last.status}>{last.status}</span>
                <span>{last.aspect}</span>
                <span>Edited {last.updated.toLowerCase()}</span>
              </div>
              {last.summary && <MiniTimeline s={last.summary} />}
              {last.summary?.lastChange && (
                <p className="last-change"><I.Spark size={16} /> <span><b>Last AI change:</b> {last.summary.lastChange}</span></p>
              )}
              <div className="resume-actions">
                <button className="btn btn-primary btn-lg" onClick={() => openProject(last.id)}>Resume editing</button>
                <button className="btn btn-lg" onClick={() => { openProject(last.id); useStore.getState().setExportOpen(true); }}><I.Export size={16} /> Export</button>
              </div>
            </div>
          </section>
        ) : (
          <section className="resume resume-empty">
            <h2>Your first video <em>starts here.</em></h2>
            <p>Add a talking-head take and you get a first cut with pauses out, captions on, graphics and sound placed.</p>
          </section>
        )}

        <aside className="desk-side">
          <section
            className={`dropcard ${over ? 'over' : ''}`}
            aria-label="New video"
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
            onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
          >
            <span className="dropcard-icon" aria-hidden><I.Upload size={18} /></span>
            <strong>{over ? <>Let go to <em>start a video.</em></> : <>Drop footage, <em>get a first cut.</em></>}</strong>
            <span>A-roll, B-roll, script or music, up to 10 GB a file</span>
            <div className="dropcard-actions">
              <button className="btn" onClick={() => input.current?.click()}>Choose files</button>
              <button className="btn btn-ghost" onClick={() => openWizard()}>Try with a sample</button>
            </div>
            <input ref={input} type="file" multiple hidden accept="video/*,audio/*,image/*,.doc,.docx,.txt,.md" onChange={(e) => take(e.target.files)} />
          </section>

          <section className="queue" aria-labelledby="queue-title">
            <div className="queue-head">
              <h3 id="queue-title">Rendering</h3>
              <span className="server" data-s={server}>{SERVER_TEXT[server]}</span>
            </div>
            {rendering.length ? (
              <ul>
                {rendering.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => openProject(p.id)}><span className="spinner" />{p.title}</button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="queue-empty">Nothing rendering. Exports you start show up here while they run.</p>
            )}
          </section>
        </aside>
      </div>

      <div className="lib-bar">
        <h2>All <em>projects</em></h2>
        <div className="seg" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f}
              <span className="tnum">{f === 'All' ? projects.length : projects.filter((p) => p.status === f).length}</span>
            </button>
          ))}
        </div>
      </div>

      {shown.length ? (
        <section className="projects">
          {shown.map((p) => (
            <article key={p.id} className="proj-card">
              <button className="proj" onClick={() => openProject(p.id)}>
                <div className="plate">
                  <Frame p={p} size="sm" />
                  <span className="tc tnum">{clock(p.duration)}</span>
                </div>
                <strong>{p.title}</strong>
                <div className="meta">
                  <span className="state" data-s={p.status}>{p.status}</span>
                  <span>{p.aspect}</span>
                  <span>{p.updated}</span>
                </div>
              </button>
              <button
                className="proj-more"
                aria-label={`More actions for ${p.title}`}
                aria-haspopup="menu"
                aria-expanded={menu === p.id}
                onClick={() => setMenu(menu === p.id ? null : p.id)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
              </button>
              {menu === p.id && <ProjectMenu p={p} onClose={() => setMenu(null)} />}
            </article>
          ))}
        </section>
      ) : (
        <div className="empty">
          <strong>{query ? `Nothing called “${query.trim()}”` : `No ${filter.toLowerCase()} videos`}</strong>
          <button className="btn btn-ghost" onClick={() => { setQuery(''); setFilter('All'); }}>Show all projects</button>
        </div>
      )}
    </div>
  );
}
