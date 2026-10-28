import type { CSSProperties, ReactNode } from 'react';
import type { GraphicSpec, Look } from '../types';

/**
 * Motion-graphic B-roll: a full-frame animated card in the style's colours, drawn from the clip's
 * time alone (no CSS animations), so the preview, the MP4 and the Premiere layer are identical.
 * Content sits in the upper two thirds; the caption band below stays clear.
 */

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const out3 = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const outBack = (x: number) => { const k = clamp01(x); const c = 1.6; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };

interface Theme { bg: string; ink: string; soft: string; accent: string; glow: number; grid: boolean; dark: boolean; serif: boolean }

function themeOf(look: Look, g: GraphicSpec): Theme {
  const accent = g.color ?? look.accent ?? '#08A2F7';
  const serif = look.grade === 'cinematic';
  switch (look.slideBg) {
    case 'paper': return { bg: 'radial-gradient(ellipse at 50% 38%, #ececea 0%, #c4c4c0 100%)', ink: '#161616', soft: 'rgba(20,20,20,0.55)', accent, glow: 0.22, grid: false, dark: false, serif };
    case 'white': return { bg: '#fafafa', ink: '#111', soft: 'rgba(17,17,17,0.5)', accent, glow: 0.16, grid: false, dark: false, serif };
    case 'grid': return { bg: '#f6f6f4', ink: '#111', soft: 'rgba(17,17,17,0.5)', accent, glow: 0.14, grid: true, dark: false, serif };
    default: return { bg: 'radial-gradient(ellipse at 50% 30%, #1a1d24 0%, #08090c 100%)', ink: '#fff', soft: 'rgba(255,255,255,0.62)', accent, glow: 0.42, grid: false, dark: true, serif };
  }
}

function rgba(hex: string, a: number) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return `rgba(8,162,247,${a})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** "1,800" → counts 0 … 1,800; keeps the prefix ($, ₹) and the suffix (%, k, x). */
function counting(value: string, k: number): string {
  const m = value.match(/^([$₹€£]?)([\d,.]+)(.*)$/);
  if (!m) return value;
  const n = Number(m[2].replace(/,/g, ''));
  if (!Number.isFinite(n) || k >= 1) return value;
  const dec = (m[2].split('.')[1] ?? '').length;
  const v = n * out3(k);
  const body = m[2].includes(',') ? v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : v.toFixed(dec);
  return `${m[1]}${body}${m[3]}`;
}

/** Deterministic specks drifting up: a sense of motion without distracting from the words. */
const SPECKS = Array.from({ length: 14 }, (_, i) => ({ x: (i * 37.7) % 100, y: (i * 61.3) % 100, r: 0.5 + ((i * 13) % 5) * 0.22, v: 2 + ((i * 7) % 5) }));

function Backdrop({ th, age, dur, ghost }: { th: Theme; age: number; dur: number; ghost: string }) {
  const sx = Math.sin(age * 0.7), cy = Math.cos(age * 0.5);
  const sweep = out3(age / 0.55);
  const line = th.dark ? '#ffffff' : '#000000';
  return (
    <>
      <div className="layer" style={{ background: th.bg }} />
      {/* A giant outlined word drifting behind everything. */}
      <div className="layer" style={{ overflow: 'hidden' }} aria-hidden>
        <div style={{ position: 'absolute', top: '58%', left: 0, whiteSpace: 'nowrap', transform: `translateX(${(4 - age * 3.2).toFixed(2)}%)`, fontFamily: "'Inter Display', 'Inter', system-ui, sans-serif", fontWeight: 900, fontSize: '34cqmin', letterSpacing: '-0.06em', color: 'transparent', WebkitTextStroke: `0.25cqmin ${rgba(line, th.dark ? 0.09 : 0.08)}`, textTransform: 'uppercase', opacity: out3(age / 0.6) }}>
          {ghost}
        </div>
      </div>
      <div className="layer" aria-hidden>
        {SPECKS.map((p, i) => (
          <i key={i} style={{ position: 'absolute', left: `${p.x}%`, top: `${(((p.y - age * p.v) % 100) + 100) % 100}%`, width: `${p.r}cqmin`, height: `${p.r}cqmin`, borderRadius: '50%', background: i % 3 === 0 ? th.accent : rgba(line, 0.18), opacity: 0.7 }} />
        ))}
      </div>
      {th.grid && <div className="layer" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px)', backgroundSize: '6cqmin 6cqmin', backgroundPosition: `${(age * 1.2).toFixed(2)}cqmin ${(age * 0.8).toFixed(2)}cqmin` }} />}
      <div className="layer" style={{ background: `radial-gradient(circle at ${(28 + 8 * sx).toFixed(2)}% ${(30 + 6 * cy).toFixed(2)}%, ${rgba(th.accent, th.glow)} 0%, transparent 42%)` }} />
      <div className="layer" style={{ background: `radial-gradient(circle at ${(76 - 7 * cy).toFixed(2)}% ${(70 + 5 * sx).toFixed(2)}%, ${rgba(th.accent, th.glow * 0.7)} 0%, transparent 38%)` }} />
      {/* A diagonal band sweeps across as the card opens. */}
      <div className="layer" style={{ overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-20%', bottom: '-20%', width: '28%', left: `${(-40 + 150 * sweep).toFixed(2)}%`, transform: 'skewX(-18deg)', background: rgba(th.accent, th.dark ? 0.16 : 0.12) }} />
      </div>
      {/* Progress hairline: how long this beat lasts. */}
      <div style={{ position: 'absolute', left: '7%', right: '7%', top: '9%', height: '0.5cqmin', background: rgba(th.dark ? '#ffffff' : '#000000', 0.1), borderRadius: 9 }}>
        <div style={{ height: '100%', width: `${(clamp01(age / Math.max(0.1, dur)) * 100).toFixed(2)}%`, background: th.accent, borderRadius: 9 }} />
      </div>
    </>
  );
}

function Stage({ children }: { children: ReactNode }) {
  return <div style={{ position: 'absolute', left: '7%', right: '7%', top: '14%', bottom: '34%', display: 'grid', placeItems: 'center', textAlign: 'center' }}>{children}</div>;
}

const font = (th: Theme, serif = false): CSSProperties => (serif && th.serif
  ? { fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: 'italic', fontWeight: 400 }
  : { fontFamily: "'Inter Display', 'Inter', system-ui, sans-serif", fontWeight: 850 });

function Kinetic({ g, th, age }: { g: GraphicSpec; th: Theme; age: number }) {
  const words = g.text.split(/\s+/).filter(Boolean);
  const longest = Math.max(...words.map((w) => w.length), 4);
  const size = Math.min(17, 128 / Math.max(longest, 5), 64 / Math.max(1, Math.sqrt(g.text.length)));
  const bar = out3((age - 0.35) / 0.45);
  return (
    <Stage>
      <div style={{ display: 'grid', justifyItems: 'center', gap: '2.4cqmin' }}>
        {g.sub && (/^\d{2}$/.test(g.sub)
          ? <div style={{ ...font(th), fontSize: '3.2cqmin', letterSpacing: '0.08em', color: th.accent, border: `0.3cqmin solid ${rgba(th.accent, 0.6)}`, borderRadius: 99, padding: '0.6cqmin 2.2cqmin', opacity: out3((age - 0.05) / 0.3) }}>{g.sub}</div>
          : <div style={{ ...font(th, true), fontWeight: 600, fontSize: '3.6cqmin', lineHeight: 1.25, color: th.soft, maxWidth: '88%', opacity: out3((age - 0.12) / 0.3) }}>{g.sub}</div>)}
        <div style={{ ...font(th), fontSize: `${size.toFixed(2)}cqmin`, lineHeight: 0.98, letterSpacing: '-0.045em', color: th.ink, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: '0.24em' }}>
          {words.map((w, i) => {
            const k = out3((age - 0.06 - i * 0.09) / 0.32);
            const last = i === words.length - 1;
            return (
              <span key={i} style={{ display: 'inline-block', color: last ? th.accent : th.ink, opacity: k, transform: `translateY(${((1 - k) * 35).toFixed(2)}%) scale(${(0.92 + 0.08 * k).toFixed(3)})`, filter: k < 1 ? `blur(${((1 - k) * 6).toFixed(2)}px)` : undefined }}>
                {w}
              </span>
            );
          })}
        </div>
        <div style={{ height: '1.1cqmin', width: `${(bar * 34).toFixed(2)}%`, background: th.accent, borderRadius: 99 }} />
      </div>
    </Stage>
  );
}

function Stat({ g, th, age }: { g: GraphicSpec; th: Theme; age: number }) {
  const value = g.value ?? g.text;
  const k = clamp01((age - 0.1) / 0.9);
  const ring = out3((age - 0.05) / 1.1);
  const R = 46;
  const C = 2 * Math.PI * R;
  const size = Math.min(24, 100 / Math.max(3, value.length));
  return (
    <Stage>
      <div style={{ display: 'grid', justifyItems: 'center', gap: '2cqmin', position: 'relative' }}>
        <svg viewBox="0 0 100 100" style={{ position: 'absolute', width: '62cqmin', height: '62cqmin', left: '50%', top: '42%', transform: `translate(-50%, -50%) rotate(${(-90 + age * 6).toFixed(2)}deg)` }} aria-hidden>
          <circle cx="50" cy="50" r={R} fill="none" stroke={rgba(th.dark ? '#ffffff' : '#000000', 0.08)} strokeWidth="1.6" />
          <circle cx="50" cy="50" r={R} fill="none" stroke={th.accent} strokeWidth="1.6" strokeLinecap="round" strokeDasharray={`${(C * 0.78 * ring).toFixed(2)} ${C.toFixed(2)}`} />
        </svg>
        <div style={{ ...font(th), fontSize: `${size.toFixed(2)}cqmin`, lineHeight: 0.9, letterSpacing: '-0.05em', color: th.accent, fontVariantNumeric: 'tabular-nums', transform: `scale(${(0.85 + 0.15 * outBack(age / 0.45)).toFixed(3)})` }}>
          {counting(value, k)}
        </div>
        <div style={{ ...font(th), fontSize: '5.6cqmin', letterSpacing: '-0.02em', color: th.ink, opacity: out3((age - 0.3) / 0.35), maxWidth: '90%' }}>{g.text}</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1.2cqmin', height: '8cqmin', marginTop: '1cqmin' }} aria-hidden>
          {[0.35, 0.55, 0.45, 0.75, 1].map((h, i) => (
            <i key={i} style={{ width: '2.6cqmin', borderRadius: '0.6cqmin', height: `${(h * 100 * out3((age - 0.45 - i * 0.08) / 0.4)).toFixed(2)}%`, background: i === 4 ? th.accent : rgba(th.dark ? '#ffffff' : '#000000', 0.18) }} />
          ))}
        </div>
      </div>
    </Stage>
  );
}

function Versus({ g, th, age }: { g: GraphicSpec; th: Theme; age: number }) {
  const [l, r] = g.items?.length === 2 ? g.items : g.text.split(/\s+vs\s+/i);
  const kl = out3(age / 0.4), kr = out3((age - 0.1) / 0.4), kv = outBack((age - 0.3) / 0.35);
  const card = (text: string, k: number, from: number, lit: boolean): CSSProperties => ({
    ...font(th), fontSize: `${Math.min(9, 60 / Math.max(4, text.length)).toFixed(2)}cqmin`, letterSpacing: '-0.03em', color: lit ? '#fff' : th.ink,
    background: lit ? th.accent : rgba(th.dark ? '#ffffff' : '#000000', 0.07), borderRadius: '3cqmin', padding: '7cqmin 3cqmin', width: '100%', boxSizing: 'border-box',
    opacity: k, transform: `translateX(${((1 - k) * from).toFixed(2)}%)`,
  });
  return (
    <Stage>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: '2.4cqmin', width: '100%' }}>
        <div style={card(l ?? '', kl, -60, false)}>{l}</div>
        <div style={{ ...font(th), width: '12cqmin', height: '12cqmin', borderRadius: '50%', display: 'grid', placeItems: 'center', background: th.ink, color: th.dark ? '#000' : '#fff', fontSize: '4.4cqmin', transform: `scale(${Math.max(0, kv).toFixed(3)})` }}>VS</div>
        <div style={card(r ?? '', kr, 60, true)}>{r}</div>
      </div>
    </Stage>
  );
}

function Steps({ g, th, age, dur }: { g: GraphicSpec; th: Theme; age: number; dur: number }) {
  const items = (g.items ?? [g.text]).slice(0, 4);
  const every = Math.max(0.25, (dur * 0.75) / items.length);
  return (
    <Stage>
      <div style={{ display: 'grid', gap: '2.2cqmin', width: '88%' }}>
        {items.map((it, i) => {
          const k = out3((age - i * every) / 0.35);
          const now = age >= i * every && (i === items.length - 1 || age < (i + 1) * every);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '3cqmin', padding: '2.6cqmin 3.4cqmin', borderRadius: '2.6cqmin', background: now ? rgba(th.accent, th.dark ? 0.22 : 0.14) : rgba(th.dark ? '#ffffff' : '#000000', 0.06), opacity: Math.max(0.0, k), transform: `translateY(${((1 - k) * 40).toFixed(2)}%)` }}>
              <span style={{ ...font(th), width: '8cqmin', height: '8cqmin', flex: 'none', borderRadius: '50%', display: 'grid', placeItems: 'center', background: th.accent, color: '#fff', fontSize: '4.2cqmin' }}>{i + 1}</span>
              <span style={{ ...font(th), fontSize: '6.4cqmin', letterSpacing: '-0.03em', color: th.ink, textAlign: 'left' }}>{it}</span>
            </div>
          );
        })}
      </div>
    </Stage>
  );
}

export function MotionScene({ g, look, age, dur }: { g: GraphicSpec; look: Look; age: number; dur: number }) {
  const th = themeOf(look, g);
  const a = Math.max(0, age);
  return (
    <div className="layer" style={{ overflow: 'hidden' }}>
      <Backdrop th={th} age={a} dur={dur} ghost={(g.items?.[0] ?? g.text).split(/\s+/).sort((x, y) => y.length - x.length)[0] ?? ''} />
      {g.scene === 'stat' ? <Stat g={g} th={th} age={a} /> : g.scene === 'versus' ? <Versus g={g} th={th} age={a} /> : g.scene === 'steps' ? <Steps g={g} th={th} age={a} dur={dur} /> : <Kinetic g={g} th={th} age={a} />}
    </div>
  );
}
