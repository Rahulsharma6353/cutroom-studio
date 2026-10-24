'use client';
import { useEffect, useState } from 'react';
import { accessKey, keyHeaders, online, setAccessKey } from '../lib/api';
import { useStore } from '../store/useStore';
import { Dashboard, type ServerState } from './Dashboard';
import { ThemeToggle } from './ThemeToggle';
import { Wizard } from './Wizard';
import { Editor } from './editor/Editor';
import { I } from './icons';

export const APP_NAME = 'Cutroom Studio';

/** Whether the render server answers, checked once on load and every 30 s. */
function useServer() {
  const [state, setState] = useState<ServerState>('checking');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!online()) return setState('preview');
    let alive = true;
    const check = () =>
      fetch('/api/health', { cache: 'no-store', headers: keyHeaders() })
        .then(async (r) => {
          if (!alive) return;
          const j = r.ok ? ((await r.json().catch(() => ({}))) as { locked?: boolean }) : {};
          setState(!r.ok ? 'down' : j.locked ? 'locked' : 'up');
        })
        .catch(() => alive && setState('down'));
    check();
    const id = setInterval(check, 30000);
    return () => { alive = false; clearInterval(id); };
  }, [tick]);
  return { state, recheck: () => setTick((n) => n + 1) };
}

/** The studio is passcode-protected: ask once, keep it in this browser. */
function Unlock({ onDone, wrong }: { onDone: () => void; wrong: boolean }) {
  const [code, setCode] = useState('');
  return (
    <div className="unlock">
      <form className="unlock-card" onSubmit={(e) => { e.preventDefault(); setAccessKey(code.trim()); onDone(); }}>
        <span className="brand-mark" aria-hidden><i /><i /></span>
        <h1>{APP_NAME}</h1>
        <p>This studio is private. Enter its passcode to start editing.</p>
        <input className="input input-lg" type="password" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Passcode" aria-label="Passcode" />
        {wrong && <small className="unlock-err">That passcode didn’t work.</small>}
        <button className="btn btn-primary btn-lg" type="submit" disabled={!code.trim()}>Open the studio</button>
      </form>
    </div>
  );
}


export function App() {
  const view = useStore((s) => s.view);
  const wizardOpen = useStore((s) => s.wizardOpen);
  const openWizard = useStore((s) => s.openWizard);
  const project = useStore((s) => s.project);
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  const { state: server, recheck } = useServer();

  useEffect(() => {
    document.title = view === 'editor' && project ? `${project.title} — ${APP_NAME}` : APP_NAME;
  }, [view, project]);

  if (server === 'locked') return <Unlock onDone={recheck} wrong={!!accessKey()} />;

  if (view === 'editor') {
    return (
      <>
        <Editor />
        {wizardOpen && <Wizard />}
      </>
    );
  }

  return (
    <div className="shell">
      <header className="topnav">
        <div className="brand">
          <span className="brand-mark" aria-hidden><i /><i /></span>
          {APP_NAME}
        </div>
        <label className="search">
          <I.Search />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects" aria-label="Search projects" />
        </label>
        <div className="topnav-end">
          <ThemeToggle />
          <button className="btn btn-primary" onClick={() => openWizard()}><I.Plus /> New video</button>
        </div>
      </header>
      <main className="page"><Dashboard server={server} /></main>
      {wizardOpen && <Wizard />}
    </div>
  );
}
