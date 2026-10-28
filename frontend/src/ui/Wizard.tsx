'use client';
import { useEffect, useRef, useState } from 'react';
import type { AspectRatio, AssetKind } from '@shared/types';
import { TEMPLATES } from '@shared/sample';
import { SceneThumb } from '@shared/frame/Thumb';
import { formatBytes } from '@shared/util';
import { toUploaded } from '../lib/files';
import { useStore, type UploadedFile } from '../store/useStore';
import { I } from './icons';

const RATIOS: { id: AspectRatio; label: string; w: number; h: number }[] = [
  { id: 'source', label: 'Same as footage', w: 22, h: 22 },
  { id: '9:16', label: 'Reels, Shorts', w: 14, h: 24 },
  { id: '4:5', label: 'Feed portrait', w: 19, h: 24 },
  { id: '1:1', label: 'Feed square', w: 22, h: 22 },
  { id: '16:9', label: 'YouTube', w: 30, h: 17 },
];
const LENGTHS = ['30 s', '45 s', '60 s', '90 s', 'Keep all'];
/** Spoken language for captions. Auto works for most takes; picking one helps mixed or accented speech. */
const LANGUAGES: { id: string; label: string }[] = [
  { id: 'auto', label: 'Detect automatically' }, { id: 'en', label: 'English' }, { id: 'hi', label: 'Hindi' },
  { id: 'gu', label: 'Gujarati' }, { id: 'mr', label: 'Marathi' }, { id: 'bn', label: 'Bengali' }, { id: 'ta', label: 'Tamil' },
  { id: 'te', label: 'Telugu' }, { id: 'kn', label: 'Kannada' }, { id: 'ml', label: 'Malayalam' }, { id: 'pa', label: 'Punjabi' },
  { id: 'ur', label: 'Urdu' }, { id: 'es', label: 'Spanish' }, { id: 'fr', label: 'French' }, { id: 'de', label: 'German' },
  { id: 'pt', label: 'Portuguese' }, { id: 'ar', label: 'Arabic' }, { id: 'ja', label: 'Japanese' }, { id: 'ko', label: 'Korean' }, { id: 'zh', label: 'Chinese' },
];
const KINDS: { kind: AssetKind; label: string; hint: string; color: string; accept: string }[] = [
  { kind: 'aroll', label: 'A-roll', hint: 'You talking to camera, or a voiceover. The cut is built around this.', color: 'var(--aroll)', accept: 'video/*,audio/*' },
  { kind: 'broll', label: 'B-roll', hint: 'Cutaways, screen recordings, product shots', color: 'var(--broll)', accept: 'video/*,image/*' },
  { kind: 'script', label: 'Script', hint: 'Checks the captions against what you meant to say', color: 'var(--captions)', accept: '.doc,.docx,.txt,.md,.pdf' },
  { kind: 'music', label: 'Music', hint: 'Optional. Without it, a track is picked for you', color: 'var(--music)', accept: 'audio/*' },
  { kind: 'image', label: 'Brand assets', hint: 'Logos and photos for the graphics', color: 'var(--overlay)', accept: 'image/*,.ttf,.otf' },
];

const EXPLAINER = TEMPLATES.find((t) => t.layout === 'explainer');

const nameOf = (file: string) => file.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

export function Wizard() {
  const close = useStore((s) => s.closeWizard);
  const create = useStore((s) => s.createProject);
  const presetFiles = useStore((s) => s.wizardFiles);

  const [files, setFiles] = useState<UploadedFile[]>(presetFiles);
  const [title, setTitle] = useState(() => nameOf(presetFiles.find((f) => f.kind === 'aroll')?.name ?? ''));
  const [aspect, setAspect] = useState<AspectRatio>('source');
  const [length, setLength] = useState('45 s');
  const [language, setLanguage] = useState('auto');
  const [brief, setBrief] = useState('');
  const [over, setOver] = useState<AssetKind | null>(null);
  const [style, setStyle] = useState<string>('');
  const locked = style ? TEMPLATES.find((t) => t.id === style)?.aspects : undefined;
  const pickStyle = (id: string) => {
    setStyle(id);
    const only = TEMPLATES.find((t) => t.id === id)?.aspects;
    if (only?.length === 1) setAspect(only[0]);
  };
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    titleRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const add = async (list: FileList | null, kind: AssetKind) => {
    if (!list?.length) return;
    const up = await toUploaded(list, kind);
    setFiles((f) => [...f, ...up]);
    if (kind === 'aroll' && !title) setTitle(nameOf(up[0].name));
  };
  const remove = (f: UploadedFile) => setFiles((all) => all.filter((x) => x !== f));

  const hasAroll = files.some((f) => f.kind === 'aroll');
  const start = () => create({ language, templateId: style || undefined, title: title.trim() || 'Untitled video', aspect, brief: [brief.trim(), length !== 'Keep all' ? `keep it under ${length.replace(' s', ' seconds')}` : ''].filter(Boolean).join('. '), files });

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="wiz-title" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog sheet">
        <div className="dialog-head">
          <h2 id="wiz-title">New <em>video</em></h2>
          <button className="icon-btn" onClick={close} aria-label="Close"><I.X /></button>
        </div>

        <div className="sheet-body">
          <section className="sheet-files" aria-label="Footage">
            {KINDS.map((k) => {
              const mine = files.filter((f) => f.kind === k.kind || (k.kind === 'image' && f.kind === 'graphic'));
              return (
                <label
                  key={k.kind}
                  className={`intake ${over === k.kind ? 'over' : ''} ${mine.length ? 'filled' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setOver(k.kind); }}
                  onDragLeave={() => setOver(null)}
                  onDrop={(e) => { e.preventDefault(); setOver(null); add(e.dataTransfer.files, k.kind); }}
                >
                  <i className="intake-tick" style={{ background: k.color }} aria-hidden />
                  <div className="intake-text">
                    <strong>{k.label}</strong>
                    {mine.length === 0 && <small>{k.hint}</small>}
                    {mine.map((f, i) => (
                      <span key={i} className="intake-file">
                        <span>{f.name}</span>
                        <span className="tnum">{f.duration ? `${Math.round(f.duration)} s` : formatBytes(f.size)}</span>
                        <button type="button" className="intake-x" aria-label={`Remove ${f.name}`} onClick={(e) => { e.preventDefault(); remove(f); }}><I.X size={12} /></button>
                      </span>
                    ))}
                  </div>
                  <span className="intake-add"><I.Plus size={14} /> {mine.length ? 'More' : 'Add'}</span>
                  <input type="file" multiple hidden accept={k.accept} onChange={(e) => add(e.target.files, k.kind)} />
                </label>
              );
            })}
          </section>

          <section className="sheet-form" aria-label="Video settings">
            <label className="field">
              <span>Title</span>
              <input ref={titleRef} className="input input-lg" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="3 AI tools that save 10 hours" />
            </label>
            {EXPLAINER && (
              <div className="field">
                <span>Style</span>
                <div className="styles" role="group" aria-label="Style">
                  <button className="style-card" aria-pressed={style === ''} onClick={() => pickStyle('')}>
                    <span className="style-media"><SceneThumb hue={200} person style={{ height: '100%', aspectRatio: '9 / 16' }} /></span>
                    <span className="style-text"><strong>House</strong><small>Pixel captions beside you, UI cards, sound design. Any shape.</small></span>
                  </button>
                  <button className="style-card" aria-pressed={style === EXPLAINER.id} onClick={() => pickStyle(EXPLAINER.id)}>
                    <span className="style-media">
                      <video src={EXPLAINER.previewVideo} autoPlay muted loop playsInline preload="metadata" aria-label="Explainer style example" />
                    </span>
                    <span className="style-text"><strong>{EXPLAINER.name}</strong><small>Setup line and bold key line, each its own layer. Calm-space placement, face clear, Reels safe area. 9:16.</small></span>
                  </button>
                </div>
              </div>
            )}
            <div className="field">
              <span>Shape{locked?.length === 1 ? <em className="field-note"> · {locked[0]} for this style</em> : null}</span>
              <div className="shapes" role="group" aria-label="Shape">
                {RATIOS.map((r) => (
                  <button key={r.id} className="shape" aria-pressed={aspect === r.id} onClick={() => setAspect(r.id)} title={r.label} disabled={!!locked && !locked.includes(r.id)}>
                    <i style={{ width: r.w, height: r.h, borderStyle: r.id === 'source' ? 'dashed' : undefined }} aria-hidden />
                    <strong>{r.id === 'source' ? 'Match' : r.id}</strong>
                    <small>{r.label}</small>
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span>Spoken language</span>
              <select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </label>
            <div className="field">
              <span>Length</span>
              <div className="seg" role="group" aria-label="Length">
                {LENGTHS.map((l) => <button key={l} aria-pressed={length === l} onClick={() => setLength(l)}>{l}</button>)}
              </div>
            </div>
            <label className="field">
              <span>Notes for the editor</span>
              <textarea className="textarea" rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Hinglish captions, add music, more B-roll in the middle" />
            </label>
          </section>
        </div>

        <div className="dialog-foot">
          <span className="foot-note">
            {hasAroll ? `${files.length} ${files.length === 1 ? 'file' : 'files'} ready. Uploading starts when you make the cut.` : 'No A-roll yet: you’ll get a sample clip to try the editor.'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={close}>Cancel</button>
            <button className="btn btn-primary" onClick={start}>Make the first cut</button>
          </div>
        </div>
      </div>
    </div>
  );
}
