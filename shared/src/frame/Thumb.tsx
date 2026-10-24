import type { CSSProperties } from 'react';
import { swatch } from '../util';

/** A stand-in frame of "footage": a soft gradient with a speaker silhouette. */
export function Person({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 200 220" aria-hidden>
      <defs>
        <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.55" />
          <stop offset="1" stopColor="#000" stopOpacity="0.8" />
        </linearGradient>
      </defs>
      <ellipse cx="100" cy="72" rx="38" ry="44" fill="url(#pg)" />
      <path d="M18 220c4-62 40-92 82-92s78 30 82 92z" fill="url(#pg)" />
    </svg>
  );
}

export function SceneThumb({ hue, person = false, label, style, className }: { hue: number; person?: boolean; label?: string; style?: CSSProperties; className?: string }) {
  return (
    <div className={`clipthumb ${className ?? ''}`} style={{ background: swatch(hue), ...style }}>
      {person && <Person style={{ position: 'absolute', left: '50%', bottom: 0, transform: 'translateX(-50%)', width: '58%' }} />}
      {label && <span className="badge">{label}</span>}
    </div>
  );
}

export function ratioOf(aspect: string): number {
  if (aspect === 'source') return 16 / 9;
  const [w, h] = aspect.split(':').map(Number);
  return w / h;
}
