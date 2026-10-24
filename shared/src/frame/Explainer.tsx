import type { CSSProperties } from 'react';
import { countUp, EXPLAINER_COLORS as C, EXPLAINER_FONT } from '../explainer';
import type { Clip, FilmLookSpec, GraphicSpec, PlateSpec, TextSpec } from '../types';

/** Explainer layers. Every value comes from the clip and the time, so preview, MP4 and Premiere layers match. */

const ease = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

/** Where a line box sits: anchored at its left edge, centre or right edge. */
function anchor(x: number, y: number, align: TextSpec['align'], maxW: number): CSSProperties {
  const w = `${maxW * 100}%`;
  if (align === 'left') return { position: 'absolute', left: `${x * 100}%`, top: `${y * 100}%`, width: w, textAlign: 'left' };
  if (align === 'right') return { position: 'absolute', right: `${(1 - x) * 100}%`, top: `${y * 100}%`, width: w, textAlign: 'right' };
  return { position: 'absolute', left: `${(x - maxW / 2) * 100}%`, top: `${y * 100}%`, width: w, textAlign: 'center' };
}

/** A setup line (light italic) or key line (bold): each word lands as it is spoken. */
export function TextLine({ spec, local: t }: { spec: TextSpec; local: number }) {
  const key = spec.role === 'key';
  const color = C[spec.tone][spec.role];
  return (
    <div
      className="xp-line"
      style={{
        ...anchor(spec.x, spec.y, spec.align, spec.maxW),
        fontFamily: EXPLAINER_FONT,
        fontSize: `${spec.size * 100}cqw`,
        fontWeight: key ? 700 : 380,
        fontStyle: key ? 'normal' : 'italic',
        lineHeight: key ? 1.02 : 1.18,
        letterSpacing: key ? '-0.035em' : '-0.01em',
        color,
        textShadow: spec.tone === 'light' ? '0 0.25cqw 1.4cqw rgba(24, 6, 36, 0.38)' : '0 0 1.4cqw rgba(255, 255, 255, 0.45)',
      }}
    >
      {spec.words.map((w, i) => {
        const age = t - w.t;
        const k = ease(age / 0.2);
        const shown = age >= 0;
        return (
          <span key={i} style={{ display: 'inline-block', opacity: shown ? 0.3 + 0.7 * k : 0, transform: `translateY(${((1 - k) * 0.18).toFixed(4)}em)`, fontVariantNumeric: 'tabular-nums', whiteSpace: 'pre' }}>
            {key ? countUp(w.w, age) : w.w}{i < spec.words.length - 1 ? ' ' : ''}
          </span>
        );
      })}
    </div>
  );
}

/** Label pills: a stack that grows one pill per spoken item. */
export function LabelStack({ g, age }: { g: GraphicSpec; age: number }) {
  const at = g.at;
  if (!at) return null;
  const items = g.items ?? [g.text];
  const times = g.times ?? items.map((_, i) => i * 0.4);
  const justify = at.align === 'left' ? 'flex-start' : at.align === 'right' ? 'flex-end' : 'center';
  const maxW = 0.78;
  return (
    <div className="xp-labels" style={{ ...anchor(at.x, at.y, at.align, maxW), display: 'flex', flexDirection: 'column', alignItems: justify, gap: `${at.size * 0.42 * 100}cqw` }}>
      {items.map((it, i) => {
        const a = age - times[i];
        const k = ease(a / 0.18);
        return (
          <span
            key={i}
            style={{
              fontFamily: EXPLAINER_FONT, fontWeight: 600, fontSize: `${at.size * 100}cqw`, letterSpacing: '-0.01em', lineHeight: 1.1,
              color: C.pillInk, background: C.pill, borderRadius: '999px', padding: '0.32em 0.78em 0.36em',
              boxShadow: '0 0.4cqw 1.6cqw rgba(45, 15, 72, 0.28)',
              opacity: a >= 0 ? k : 0, transform: `translateY(${((1 - k) * 0.3).toFixed(4)}em) scale(${(0.94 + 0.06 * k).toFixed(4)})`,
              transformOrigin: at.align === 'right' ? 'right center' : at.align === 'left' ? 'left center' : 'center',
            }}
          >
            {it}
          </span>
        );
      })}
    </div>
  );
}

const PLATE_BG: Record<PlateSpec['kind'], string> = {
  paper: `radial-gradient(120% 80% at 50% 35%, #F3F3EE 0%, ${C.paper} 60%, #DEDED6 100%)`,
  night: `radial-gradient(120% 80% at 50% 30%, #2A1640 0%, ${C.night} 70%)`,
  violet: `linear-gradient(170deg, #8537BB 0%, ${C.violet} 75%)`,
};

export function Plate({ spec }: { spec: PlateSpec }) {
  return <div className="layer" style={{ background: PLATE_BG[spec.kind] }} />;
}

// Static film grain: fractal noise as an SVG tile (deterministic, so every render matches).
const GRAIN = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" seed="7"/><feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1.6 -0.3"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>',
)}")`;

export function FilmLook({ spec }: { spec: FilmLookSpec }) {
  return (
    <>
      <div className="layer" aria-hidden style={{ backgroundImage: GRAIN, backgroundSize: '22cqw 22cqw', opacity: spec.grain * 2.2 }} />
      <div className="layer" aria-hidden style={{ background: `radial-gradient(130% 95% at 50% 45%, transparent 55%, rgba(18, 6, 28, ${spec.vignette}) 100%)` }} />
    </>
  );
}

/** Which explainer clips are visible at t, in draw order (labels, setup, key). */
export function explainerAt(clips: Clip[], t: number, ids: { plate: string; look: string; labels: string; setup: string; key: string }, only?: string) {
  const live = (id: string) => clips.filter((c) => c.trackId === id && t >= c.start && t < c.start + c.duration && (!only || c.id === only));
  return { plate: live(ids.plate), look: live(ids.look), labels: live(ids.labels), setup: live(ids.setup), key: live(ids.key) };
}
