'use client';
import { useRef, useState } from 'react';
import { toUploaded } from '../../lib/files';
import type { Asset } from '@shared/types';
import { swatch, timecode } from '@shared/util';
import { scopeLabel, useStore, type LeftTab } from '../../store/useStore';
import { I } from '../icons';
import { CaptionPanel } from './CaptionPanel';

const TABS: { id: LeftTab; label: string }[] = [
  { id: 'media', label: 'Media' },
  { id: 'captions', label: 'Captions' },
  { id: 'audio', label: 'Audio' },
  { id: 'generate', label: 'Create' },
];

export function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  const setTab = useStore((s) => s.setLeftTab);
  return (
    <aside className="side" aria-label="Assets">
      <div className="tabs" role="tablist">
        {TABS.map((t) => <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      <div className="side-scroll" role="tabpanel">
        {tab === 'media' && <MediaBin />}
        {tab === 'captions' && <CaptionPanel />}
        {tab === 'audio' && <AudioPanel />}
        {tab === 'generate' && <CreatePanel />}
      </div>
    </aside>
  );
}

const ORIGIN: Record<Asset['origin'], string | null> = { upload: null, stock: 'Stock', generated: 'AI', recorded: 'Rec', library: null };

function AssetThumb({ a }: { a: Asset }) {
  const tag = ORIGIN[a.origin];
  return (
    <div className="asset-thumb" style={{ background: swatch(a.hue) }}>
      {a.url && a.kind !== 'music' && (a.kind === 'image' ? <img src={a.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <video src={`${a.url}#t=0.5`} muted preload="metadata" />)}
      {a.kind === 'screen' && <I.Screen style={{ position: 'absolute', inset: 0, margin: 'auto', opacity: 0.7 }} size={22} />}
      {tag && <span className={`badge ${a.origin === 'generated' ? 'ai' : ''}`}>{tag}</span>}
    </div>
  );
}

function MediaBin() {
  const assets = useStore((s) => s.assets);
  const place = useStore((s) => s.placeAsset);
  const addAsset = useStore((s) => s.addAsset);
  const input = useRef<HTMLInputElement>(null);
  const visual = assets.filter((a) => !['music', 'sfx', 'script'].includes(a.kind));
  const scripts = assets.filter((a) => a.kind === 'script');

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    (await toUploaded(files)).forEach((f) => addAsset({ ...f, kind: f.kind === 'aroll' ? 'broll' : f.kind }));
  };

  return (
    <>
      <div className="bin">
        <button className="upload-tile" onClick={() => input.current?.click()}><span style={{ display: 'grid', justifyItems: 'center', gap: 4 }}><I.Upload />Upload</span></button>
        <input ref={input} type="file" multiple hidden accept="video/*,image/*,audio/*" onChange={(e) => onFiles(e.target.files)} />
        {visual.map((a) => (
          <button key={a.id} className="asset" onClick={() => place(a.id)} title="Add at playhead">
            <AssetThumb a={a} />
            <span className="asset-name">{a.name}</span>
            <span className="asset-meta tnum">{a.kind === 'aroll' ? 'A-roll' : a.kind === 'image' ? 'Image' : a.kind === 'graphic' ? 'Graphic' : a.kind === 'screen' ? 'Screen recording' : 'B-roll'}{a.duration ? `, ${timecode(a.duration)}` : ''}</span>
          </button>
        ))}
      </div>
      {scripts.length > 0 && (
        <>
          <div className="side-label">Script</div>
          {scripts.map((s) => <div key={s.id} className="file-row"><span><I.Script size={14} style={{ verticalAlign: -2, marginRight: 6 }} />{s.name}</span><span>Aligned</span></div>)}
        </>
      )}
      <p className="note">Click a clip to add it at the playhead. Stock and AI-made clips show a tag, and their licence credit is kept for export.</p>
    </>
  );
}

const MUSIC = [
  { name: 'Upbeat lo-fi, 104 BPM', mood: 'Bright, steady', len: 120 },
  { name: 'Calm piano, 72 BPM', mood: 'Reflective', len: 140 },
  { name: 'Dramatic strings, 90 BPM', mood: 'Tense, cinematic', len: 110 },
  { name: 'Desi hip-hop beat, 96 BPM', mood: 'Confident', len: 100 },
];
const SFX = [
  { name: 'Whoosh', len: 0.7 }, { name: 'Pop', len: 0.4 }, { name: 'Riser', len: 1.6 },
  { name: 'Hit', len: 0.6 }, { name: 'Click', len: 0.3 }, { name: 'Cash register', len: 1.1 },
];

function AudioPanel() {
  const insert = useStore((s) => s.insertLibrary);
  const [duck, setDuck] = useState(true);
  return (
    <>
      <div className="side-label">Music</div>
      <div style={{ display: 'grid', gap: 2 }}>
        {MUSIC.map((m) => (
          <button key={m.name} className="audio-item" onClick={() => insert('music', m.name, m.len)}>
            <i style={{ background: 'rgba(134,199,122,.16)', color: 'var(--music)' }}><I.Music /></i>
            <span><strong>{m.name}</strong><small>{m.mood}</small></span>
            <I.Plus size={14} />
          </button>
        ))}
      </div>
      <div className="side-label">Sound effects</div>
      <div style={{ display: 'grid', gap: 2 }}>
        {SFX.map((m) => (
          <button key={m.name} className="audio-item" onClick={() => insert('sfx', m.name, m.len)}>
            <i style={{ background: 'rgba(143,184,240,.16)', color: 'var(--sfx)' }}><I.Wave /></i>
            <span><strong>{m.name}</strong><small>{m.len}s</small></span>
            <I.Plus size={14} />
          </button>
        ))}
      </div>
      <div className="group">
        <div className="row-between"><span style={{ fontSize: 12.5, fontWeight: 600 }}>Lower music under speech</span><button className="switch" role="switch" aria-checked={duck} onClick={() => setDuck(!duck)} aria-label="Lower music under speech" /></div>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Export loudness is set to −14 LUFS for social platforms.</span>
      </div>
    </>
  );
}

function CreatePanel() {
  const send = useStore((s) => s.sendPrompt);
  const thinking = useStore((s) => s.thinking);
  const scope = useStore((s) => scopeLabel(s));
  const [img, setImg] = useState('');
  const [imgStyle, setImgStyle] = useState('Photo');
  const [vid, setVid] = useState('');
  const [vidLen, setVidLen] = useState('5 s');
  const [url, setUrl] = useState('');
  const [stock, setStock] = useState('');

  return (
    <>
      <p className="note" style={{ margin: 0 }}>New assets land at <b>{scope}</b> and appear on the timeline when they’re ready.</p>
      <div className="gen-card">
        <strong><I.Search size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Find B-roll</strong>
        <p>Searches licensed stock first, then your uploads.</p>
        <input className="input" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="e.g. Mumbai skyline at night" />
        <button className="btn" disabled={!stock.trim() || thinking} onClick={() => { send(`add b-roll of ${stock}`); setStock(''); }}>Find clips</button>
      </div>
      <div className="gen-card">
        <strong><I.Image size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Image</strong>
        <input className="input" value={img} onChange={(e) => setImg(e.target.value)} placeholder="e.g. futuristic Surat skyline, sunset" />
        <div className="seg" role="group">{['Photo', 'Illustration', '3D'].map((s) => <button key={s} aria-pressed={imgStyle === s} onClick={() => setImgStyle(s)}>{s}</button>)}</div>
        <button className="btn" disabled={!img.trim() || thinking} onClick={() => { send(`generate an image of ${img} (${imgStyle.toLowerCase()})`); setImg(''); }}>Create image</button>
      </div>
      <div className="gen-card">
        <strong><I.Film size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Video shot</strong>
        <input className="input" value={vid} onChange={(e) => setVid(e.target.value)} placeholder="e.g. robot hand typing on a laptop" />
        <div className="seg" role="group">{['3 s', '5 s', '8 s'].map((s) => <button key={s} aria-pressed={vidLen === s} onClick={() => setVidLen(s)}>{s}</button>)}</div>
        <button className="btn" disabled={!vid.trim() || thinking} onClick={() => { send(`generate a video of ${vid}`); setVid(''); }}>Create shot</button>
      </div>
      <div className="gen-card">
        <strong><I.Screen size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Screen recording</strong>
        <p>Public pages only. Clicks get auto-zoom.</p>
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="e.g. chatgpt.com" />
        <button className="btn" disabled={!url.trim() || thinking} onClick={() => { send(`screen record ${url}`); setUrl(''); }}>Record page</button>
      </div>
    </>
  );
}
