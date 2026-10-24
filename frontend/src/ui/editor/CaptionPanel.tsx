'use client';
import { CAPTION_PRESETS } from '@shared/sample';
import type { CaptionSettings } from '@shared/types';
import { useStore } from '../../store/useStore';

const FONTS = ['Inter', 'Anton', 'Bebas Neue', 'Figtree', 'Instrument Serif', 'Mukta', 'Bricolage Grotesque'];

export function CaptionPanel() {
  const c = useStore((s) => s.captions);
  const set = useStore((s) => s.setCaptions);
  const apply = useStore((s) => s.applyCaptionPreset);
  const beginGesture = useStore((s) => s.beginGesture);
  const patch = (p: Partial<CaptionSettings>) => set(p);

  return (
    <>
      <div className="row-between">
        <strong style={{ fontSize: 13 }}>Show captions</strong>
        <button className="switch" role="switch" aria-checked={c.enabled} aria-label="Show captions" onClick={() => { beginGesture(); patch({ enabled: !c.enabled }); }} />
      </div>

      <div className="preset-grid">
        {CAPTION_PRESETS.map((p) => {
          const s = p.settings;
          const box = s.backgroundOpacity > 0;
          return (
            <button key={p.id} className="preset" aria-pressed={c.presetId === p.id} onClick={() => apply(p.id)}>
              <div className="preset-view">
                <span style={{ fontFamily: `'${s.font}', sans-serif`, fontWeight: s.weight, fontSize: 15, lineHeight: 1.1, textTransform: s.uppercase ? 'uppercase' : 'none', color: s.fill, WebkitTextStroke: s.strokeWidth ? `${s.strokeWidth * 0.35}px ${s.stroke}` : undefined, paintOrder: 'stroke fill', background: box ? s.background : undefined, padding: box ? '2px 7px' : 0, borderRadius: 5 }}>
                  {p.id === 'hindi' ? 'सेव करो ' : 'Save this '}
                  <span style={{ color: s.highlightMode === 'none' ? undefined : s.highlight }}>{p.id === 'hindi' ? 'अभी' : 'now'}</span>
                </span>
              </div>
              <span className="preset-name">{p.name}<small>{p.note}</small></span>
            </button>
          );
        })}
      </div>

      <div className="group">
        <label className="ctrl-row"><span>Font</span>
          <select className="select" value={c.font} onChange={(e) => patch({ font: e.target.value })}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select><span />
        </label>
        <label className="ctrl-row"><span>Size</span><input type="range" min={3} max={14} step={0.2} value={c.size} onChange={(e) => patch({ size: +e.target.value })} /><output className="tnum">{c.size.toFixed(1)}</output></label>
        <label className="ctrl-row"><span>Weight</span><input type="range" min={400} max={900} step={100} value={c.weight} onChange={(e) => patch({ weight: +e.target.value })} /><output className="tnum">{c.weight}</output></label>
        <label className="ctrl-row"><span>Words per line</span><input type="range" min={1} max={8} value={c.wordsPerLine} onChange={(e) => patch({ wordsPerLine: +e.target.value })} /><output className="tnum">{c.wordsPerLine}</output></label>
        <label className="ctrl-row"><span>Position</span><input type="range" min={10} max={92} value={c.position} onChange={(e) => patch({ position: +e.target.value })} /><output className="tnum">{c.position}%</output></label>
        <div className="ctrl-row"><span>Uppercase</span><span /><button className="switch" role="switch" aria-checked={c.uppercase} aria-label="Uppercase" onClick={() => patch({ uppercase: !c.uppercase })} /></div>
      </div>

      <div className="group">
        <div className="ctrl-row"><span>Text</span><span /><input type="color" value={c.fill} onChange={(e) => patch({ fill: e.target.value })} aria-label="Text colour" /></div>
        <label className="ctrl-row"><span>Outline</span><input type="range" min={0} max={6} step={0.5} value={c.strokeWidth} onChange={(e) => patch({ strokeWidth: +e.target.value })} /><input type="color" value={c.stroke} onChange={(e) => patch({ stroke: e.target.value })} aria-label="Outline colour" /></label>
        <div className="ctrl-row"><span>Highlight</span>
          <div className="seg" role="group" aria-label="Highlight mode">
            {(['active', 'reveal', 'keyword', 'none'] as const).map((m) => <button key={m} aria-pressed={c.highlightMode === m} onClick={() => patch({ highlightMode: m })}>{m === 'active' ? 'Spoken' : m === 'reveal' ? 'Reveal' : m === 'keyword' ? 'Keywords' : 'Off'}</button>)}
          </div>
          <input type="color" value={c.highlight} onChange={(e) => patch({ highlight: e.target.value })} aria-label="Highlight colour" />
        </div>
        <label className="ctrl-row"><span>Background</span><input type="range" min={0} max={1} step={0.05} value={c.backgroundOpacity} onChange={(e) => patch({ backgroundOpacity: +e.target.value })} /><input type="color" value={c.background} onChange={(e) => patch({ background: e.target.value })} aria-label="Background colour" /></label>
        <div className="ctrl-row"><span>Animation</span>
          <div className="seg" role="group" aria-label="Animation">
            {(['pop', 'slide', 'fade', 'none'] as const).map((m) => <button key={m} aria-pressed={c.animation === m} onClick={() => patch({ animation: m })}>{m.charAt(0).toUpperCase() + m.slice(1)}</button>)}
          </div><span />
        </div>
      </div>
      <p className="note">Changes apply to every caption in this video.</p>
    </>
  );
}
