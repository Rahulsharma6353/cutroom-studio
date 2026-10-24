'use client';
import { useEffect, useRef, useState } from 'react';
import type { ChangeSet, Job } from '@shared/types';
import { scopeLabel, scopeOf, useStore } from '../../store/useStore';
import { I } from '../icons';

const WHOLE = ['Remove pauses and filler words', 'Add music that fits', 'Add a whoosh on every cut', 'Switch captions to karaoke'];
const PART = ['Make this punchier', 'Add B-roll here', 'Generate an image for this line', 'Add a lower third with my name'];
const JOB_NAME = { stock: 'Finding B-roll', video: 'Generating shot', image: 'Generating image', screen: 'Recording screen', music: 'Picking music' } as const;

export function ChatPanel() {
  const messages = useStore((s) => s.messages);
  const thinking = useStore((s) => s.thinking);
  const changeSets = useStore((s) => s.changeSets);
  const jobs = useStore((s) => s.jobs);
  const clips = useStore((s) => s.clips);
  const selection = useStore((s) => s.selection);
  const selectedClipIds = useStore((s) => s.selectedClipIds);
  const send = useStore((s) => s.sendPrompt);
  const clear = useStore((s) => s.clearSelection);
  const [text, setText] = useState('');
  const log = useRef<HTMLDivElement>(null);

  const scoped = !!scopeOf({ selection, selectedClipIds, clips });
  const label = scopeLabel({ selection, selectedClipIds, clips });

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, thinking]);

  const submit = (value = text) => {
    const v = value.trim();
    if (!v || thinking) return;
    setText('');
    send(v);
  };

  return (
    <aside className="side right" aria-label="Editor chat">
      <div className="chat-head">
        <strong><I.Spark /> Editor</strong>
        <small>Edits only what you select</small>
      </div>
      <div className="chat-log" ref={log} aria-live="polite">
        {messages.map((m) => {
          const cs = m.changeSetId ? changeSets.find((c) => c.id === m.changeSetId) : undefined;
          return (
            <div key={m.id} className={`msg msg-${m.role}`}>
              {m.role === 'user' && m.scope && <span className="msg-scope">{m.scope}</span>}
              <div className="bubble">{m.text}</div>
              {cs && <ChangeCard cs={cs} jobs={jobs.filter((j) => clips.some((c) => c.jobId === j.id && c.changeSetId === cs.id))} />}
            </div>
          );
        })}
        {thinking && <div className="typing" aria-label="Editor is working"><i /><i /><i /></div>}
      </div>
      <div className="composer">
        {!text && !thinking && (
          <div className="suggest">
            {(scoped ? PART : WHOLE).map((s) => <button key={s} onClick={() => submit(s)}>{s}</button>)}
          </div>
        )}
        <span className={`scope-chip ${scoped ? 'live' : ''}`}>
          {label}
          {scoped && <button onClick={clear} aria-label="Clear selection"><I.X size={12} /></button>}
        </span>
        <div className="composer-box">
          <textarea
            id="composer"
            rows={2}
            value={text}
            placeholder={scoped ? 'What should change in this part?' : 'Describe a change to the whole video…'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
          />
          <button className="send" onClick={() => submit()} disabled={!text.trim() || thinking} aria-label="Send"><I.Send /></button>
        </div>
      </div>
    </aside>
  );
}

function ChangeCard({ cs, jobs }: { cs: ChangeSet; jobs: Job[] }) {
  const accept = useStore((s) => s.acceptChange);
  const revert = useStore((s) => s.revertChange);
  const active = jobs.filter((j) => j.status === 'running' || j.status === 'queued');
  return (
    <div className="change" data-status={cs.status}>
      <div className="change-top">
        <i />
        <div>
          <div style={{ fontWeight: 650 }}>{cs.summary}</div>
          <div style={{ color: 'var(--faint)', fontSize: 11.5 }}>{cs.scope}{cs.status === 'accepted' ? ', kept' : cs.status === 'reverted' ? ', undone' : ''}</div>
        </div>
      </div>
      {active.slice(0, 3).map((j) => (
        <div key={j.id} className="job-line">
          <span>{JOB_NAME[j.type]}: {j.label}</span>
          <span className="tnum">{Math.round(j.progress * 100)}%</span>
          <div className="bar"><i style={{ width: `${j.progress * 100}%` }} /></div>
        </div>
      ))}
      {active.length > 3 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{active.length - 3} more in progress</span>}
      {cs.status === 'preview' && (
        <div className="change-actions">
          <button className="btn btn-primary" onClick={() => accept(cs.id)}><I.Check size={14} /> Keep</button>
          <button className="btn" onClick={() => revert(cs.id)}><I.Undo size={14} /> Undo</button>
        </div>
      )}
      {cs.status === 'accepted' && (
        <div className="change-actions"><button className="btn btn-ghost" onClick={() => revert(cs.id)}><I.Undo size={14} /> Undo this change</button></div>
      )}
    </div>
  );
}
