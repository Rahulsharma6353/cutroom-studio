import type { CSSProperties, ReactNode } from 'react';
import { BRANDS, type Brand } from '../brands';
import type { BrandId, GraphicSpec } from '../types';

/**
 * App-style motion graphics. Every animation is a pure function of `age` (seconds since the
 * graphic appeared), so the editor preview, the MP4 export and the Premiere overlay renders
 * all match frame for frame. Cards use Instagram's dark theme to sit naturally next to the
 * creator's real profile screenshots.
 */
export const ASSET_BASE = { v: '' };
const asset = (p: string) => `${ASSET_BASE.v}${p}`;

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const outCubic = (k: number) => 1 - Math.pow(1 - k, 3);
const outQuint = (k: number) => 1 - Math.pow(1 - k, 5);
const outBack = (k: number, c = 1.5) => 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);

/**
 * Entrance, as in clean SaaS motion: the element swings up out of a soft blur in 3D
 * (tilted back, slightly turned), then settles with a small overshoot.
 */
function enter(age: number, delay = 0, dur = 0.55, from = 5, turn = 0): CSSProperties {
  const k = clamp((age - delay) / dur);
  if (k >= 1) return {};
  const e = outQuint(k);
  return {
    opacity: clamp(k * 2.2),
    transform: `perspective(140cqmin) translate3d(0, ${((1 - e) * from).toFixed(3)}cqmin, 0) rotateX(${((1 - e) * 18).toFixed(2)}deg) rotateY(${((1 - e) * turn).toFixed(2)}deg) scale(${(0.9 + 0.1 * outBack(k, 1.2)).toFixed(4)})`,
    filter: `blur(${((1 - outCubic(k)) * 0.9).toFixed(3)}cqmin)`,
  };
}

/** Value text that counts up to a target like "144K", "1,000,000" or "52.8K". */
export function countTo(value: string, p: number): string {
  const m = value.match(/^([^\d]*)([\d,.]+)\s*([KkMm]?)(.*)$/);
  if (!m) return p >= 1 ? value : '';
  const [, pre, num, unit, post] = m;
  const target = Number(num.replace(/,/g, ''));
  const decimals = num.includes('.') ? num.split('.')[1].length : 0;
  const v = target * outCubic(clamp(p));
  const shown = num.includes(',') ? Math.round(v).toLocaleString('en-US') : v.toFixed(decimals);
  return `${pre}${shown}${unit}${post}`;
}

export function Avatar({ brand, size, ring = true }: { brand: Brand; size: string; ring?: boolean }) {
  const a = brand.avatar;
  let mark: ReactNode = null;
  if (a.mark === 'tgf') {
    mark = (
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <text x="50" y="58" textAnchor="middle" fontFamily="Inter" fontWeight="900" fontSize="34" letterSpacing="-2" fill={a.ink}>TG<tspan fill={a.accent}>F</tspan></text>
        <path d="M63 47 L74 36 M74 36 L66 36 M74 36 L74 44" stroke={a.accent} strokeWidth="3.4" strokeLinecap="round" fill="none" />
        <text x="50" y="74" textAnchor="middle" fontFamily="Inter" fontWeight="700" fontSize="6.4" fill={a.ink} letterSpacing="0.3">THE GROWTH FEVER</text>
      </svg>
    );
  } else if (a.mark === 'arrow') {
    mark = (
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <path d="M30 70 L66 34 M40 33 L67 33 L67 60" stroke={a.ink} strokeWidth="11" strokeLinecap="square" strokeLinejoin="miter" fill="none" />
      </svg>
    );
  } else if (a.mark === 'word') {
    mark = (
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <text x="50" y="56" textAnchor="middle" fontFamily="Inter" fontWeight="800" fontSize="15.5" letterSpacing="-0.5" fill={a.ink}>{a.text}</text>
      </svg>
    );
  } else if (a.mark === 'logo') {
    mark = (
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <rect x="24" y="24" width="52" height="52" rx="7" fill="#5B2D8F" />
        <path d="M62 30 C46 30 38 40 50 50 C60 58 54 68 36 70" stroke="#fff" strokeWidth="7" fill="none" strokeLinecap="round" />
        <circle cx="47" cy="64" r="4" fill="#fff" />
      </svg>
    );
  } else {
    mark = <span style={{ fontWeight: 800, fontSize: '1em', color: a.ink }}>{a.text}</span>;
  }
  return (
    <span className={`ig-avatar ${ring ? 'ring' : ''}`} style={{ width: size, height: size, position: 'relative' }}>
      <span className="ig-avatar-in" style={{ background: a.bg, position: 'absolute', inset: ring ? `calc(${size} * 0.06)` : 0, width: 'auto', height: 'auto' }}>{mark}</span>
    </span>
  );
}

function Verified({ size }: { size: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ flex: 'none' }} aria-hidden>
      <path d="M12 1.5l2.6 2 3.2-.3.9 3.1 2.8 1.6-1 3.1 1 3.1-2.8 1.6-.9 3.1-3.2-.3L12 22.5l-2.6-2-3.2.3-.9-3.1-2.8-1.6 1-3.1-1-3.1 2.8-1.6.9-3.1 3.2.3z" fill="#0095F6" />
      <path d="M7.6 12.2l3 3 5.8-6" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function UICard({ g, age, dur, widthMin, side = 'right' }: { g: GraphicSpec; age: number; dur: number; widthMin: number; side?: 'left' | 'right' | 'below' }) {
  const w = Math.min(widthMin * 0.96, 58);
  // Resting pose: turned slightly toward the speaker, floating gently.
  const turn = side === 'left' ? 9 : side === 'right' ? -9 : 0;
  const float = Math.sin(age * 1.7) * 0.35;
  // Exit over the last 0.32 s: tip back, drop, blur away.
  const out = outCubic(clamp((age - (dur - 0.32)) / 0.32));
  const wrap: CSSProperties = {
    width: `${w}cqmin`,
    ['--u' as string]: `${(w / 100).toFixed(4)}cqmin`,
    opacity: 1 - out,
    filter: out > 0 ? `blur(${(out * 1.1).toFixed(3)}cqmin)` : undefined,
    transform: `perspective(140cqmin) translateY(${(float + out * 3).toFixed(3)}cqmin) rotateY(${turn}deg) rotateX(${(3 - out * 14).toFixed(2)}deg) scale(${(1 - 0.06 * out).toFixed(4)})`,
    transformOrigin: side === 'left' ? 'right center' : side === 'right' ? 'left center' : 'center',
  };
  let body: ReactNode;
  switch (g.ui) {
    case 'videos': body = <Videos g={g} age={age} />; break;
    case 'notify': body = <Notify g={g} age={age} />; break;
    case 'chart': body = <Chart g={g} age={age} />; break;
    case 'logo': body = <Logo age={age} />; break;
    case 'network': body = <Network g={g} age={age} />; break;
    default: body = <Profile g={g} age={age} compact={w < 46} />;
  }
  return <div className="ui-wrap" style={wrap}>{body}</div>;
}

/* Instagram profile header, dark theme, like the creator's own screenshots. */
function Profile({ g, age, compact }: { g: GraphicSpec; age: number; compact: boolean }) {
  const brand = BRANDS[(g.brand ?? 'generic') as BrandId];
  const target = g.value ?? brand.followers;
  const counted = clamp((age - 0.35) / 1.1);
  const strikeK = g.strike ? clamp((age - 1.6) / 0.32) : 0;
  const name = g.brand && g.brand !== 'generic' ? brand.name : g.text || brand.name;
  if (compact) {
    // Narrow space beside the face: avatar and name on one line, the follower count big below.
    // Type sizes are fitted to the card's inner width (84u) so nothing runs past the edge.
    const numEm = [...target].reduce((a, ch) => a + (/[,.]/.test(ch) ? 0.3 : 0.6), 0);
    const numSize = Math.min(23, 82 / Math.max(1, numEm));
    const nameSize = Math.min(10.5, (84 - 24 - 6 - (brand.verified ? 11 : 0)) / (0.6 * Math.max(4, name.length)));
    return (
      <div className="ig-card ig-compact" style={enter(age)}>
        <div className="ig-top">
          <Avatar brand={brand} size="calc(var(--u) * 24)" />
          <div className="ig-name"><b style={{ fontSize: `calc(var(--u) * ${nameSize.toFixed(2)})` }}>{name}</b>{brand.verified && <Verified size="calc(var(--u) * 8)" />}</div>
        </div>
        <div className="ig-big">
          <b className="tnum" style={{ fontSize: `calc(var(--u) * ${numSize.toFixed(2)})`, color: strikeK > 0 ? '#9AA1B0' : undefined }}>{countTo(target, counted)}</b>
          <small>followers</small>
          {strikeK > 0 && <i className="ig-strike" style={{ transform: `scaleX(${outCubic(strikeK)})` }} />}
        </div>
        {strikeK >= 1 && <div className="ig-note" style={enter(age, 1.95, 0.32, 2)}>Not required</div>}
      </div>
    );
  }
  return (
    <div className="ig-card" style={enter(age)}>
      <div className="ig-top">
        <Avatar brand={brand} size="calc(var(--u) * 26)" />
        <div className="ig-meta">
          <div className="ig-name"><b>{name}</b>{brand.verified && <Verified size="calc(var(--u) * 6.5)" />}</div>
          <div className="ig-stats">
            <span><b className="tnum">{brand.posts}</b><small>posts</small></span>
            <span className="ig-main">
              <b className="tnum" style={{ color: strikeK > 0 ? '#9AA1B0' : undefined }}>{countTo(target, counted)}</b>
              <small>followers</small>
              {strikeK > 0 && <i className="ig-strike" style={{ transform: `scaleX(${outCubic(strikeK)})` }} />}
            </span>
            <span><b className="tnum">{brand.following}</b><small>following</small></span>
          </div>
        </div>
      </div>
      {g.sub && <div className="ig-bio" style={enter(age, 0.5, 0.35, 2)}>{g.sub}</div>}
      {strikeK >= 1 && <div className="ig-note" style={enter(age, 1.95, 0.32, 2)}>Not required</div>}
    </div>
  );
}

const TILE_HUES = [210, 330, 30, 160, 270, 0];

function Videos({ g, age }: { g: GraphicSpec; age: number }) {
  const views = g.items?.length ? g.items : ['8.2K', '12K', '5.4K', '31K', '9.7K', '1M'];
  return (
    <div className="ig-card" style={enter(age)}>
      <div className="ig-row-title"><b>{g.text || 'Reels'}</b><small>{views.length} reels</small></div>
      <div className="ig-grid">
        {views.map((v, i) => {
          const isBig = /m$/i.test(v);
          const strikeK = g.strike && isBig ? clamp((age - 0.3 - views.length * 0.12 - 0.45) / 0.3) : 0;
          return (
            <div key={i} className="ig-tile" style={{ ...enter(age, 0.2 + i * 0.12, 0.35, 3), background: `linear-gradient(160deg, hsl(${TILE_HUES[i % 6]} 90% 92%), hsl(${TILE_HUES[i % 6] + 30} 75% 78%))` }}>
              <span className="ig-views tnum">▶ {v}</span>
              {strikeK > 0 && <i className="ig-x" style={{ opacity: strikeK, transform: `scale(${(0.6 + 0.4 * outBack(strikeK)).toFixed(3)})` }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const NOTIFY_ICON: Record<string, string> = { value: '★', trust: '✓', money: '₹' };

function Notify({ g, age }: { g: GraphicSpec; age: number }) {
  const items = g.items?.length ? g.items : ['New follower', '3 people shared your reel', 'Your post is getting attention'];
  return (
    <div className="ig-stack">
      {items.map((it, i) => {
        const at = g.times?.[i] ?? i * 0.38;
        if (age < at - 0.02) return null;
        const key = it.toLowerCase();
        return (
          <div key={i} className="ig-toast" style={enter(age, at, 0.5, 4)}>
            <span className="ig-toast-icon">{NOTIFY_ICON[key] ?? '♥'}</span>
            <span><b>{it}</b><small>{g.text || 'now'}</small></span>
          </div>
        );
      })}
    </div>
  );
}

function Chart({ g, age }: { g: GraphicSpec; age: number }) {
  const k = outCubic(clamp((age - 0.3) / 1.3));
  const pts = [0, 6, 4, 12, 10, 22, 19, 34, 31, 52, 48, 70];
  const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i / (pts.length - 1)) * 100} ${78 - v}`).join(' ');
  return (
    <div className="ig-card" style={enter(age)}>
      <div className="ig-row-title"><b>{g.text || 'Accounts reached'}</b><span className="ig-pill tnum">{g.value ? countTo(g.value, k) : `+${Math.round(312 * k)}%`}</span></div>
      <svg className="ig-chart" viewBox="0 0 100 80" preserveAspectRatio="none">
        <defs><linearGradient id="igc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2F6BF2" stopOpacity="0.28" /><stop offset="1" stopColor="#2F6BF2" stopOpacity="0" /></linearGradient></defs>
        <path d={`${d} L100 80 L0 80 Z`} fill="url(#igc)" style={{ clipPath: `inset(0 ${((1 - k) * 100).toFixed(2)}% 0 0)` }} />
        <path d={d} fill="none" stroke="#2F6BF2" strokeWidth="2.2" pathLength={1} strokeDasharray="1" strokeDashoffset={(1 - k).toFixed(4)} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function Logo({ age }: { age: number }) {
  // Card lifts in, then a light sweep crosses the logo.
  const sweep = clamp((age - 0.45) / 0.7);
  return (
    <div className="ig-logo" style={enter(age, 0, 0.5, 6)}>
      <img src={asset('/brand/fluxpedia.png')} alt="Fluxpedia" />
      {sweep > 0 && sweep < 1 && <i className="ig-sweep" style={{ left: `${(-40 + 160 * outCubic(sweep)).toFixed(2)}%` }} />}
    </div>
  );
}

/* One channel, then a network of media IPs around Fluxpedia. */
function Network({ g, age }: { g: GraphicSpec; age: number }) {
  // variant 'ips': the network only (no "1 channel" opening), spreading as it lands.
  const ips = g.variant === 'ips';
  const t1 = g.times?.[0] ?? 0;
  const t2 = ips ? (g.times?.[1] ?? 0.25) : (g.times?.[1] ?? 1.6);
  const spread = outCubic(clamp((age - t2) / 0.6));
  const nodes: { id: BrandId; x: number; y: number }[] = [
    { id: 'tezscroll', x: 22, y: 40 },
    { id: 'hiddentrip', x: 78, y: 40 },
    { id: 'tgf', x: 50, y: 87 },
  ];
  return (
    <div className="ig-net" style={enter(age, t1, 0.45, 4)}>
      <svg className="ig-net-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
        {nodes.map((n) => (
          <line key={n.id} x1="50" y1="60" x2={50 + (n.x - 50) * spread} y2={60 + (n.y - 60) * spread} stroke="rgba(47,107,242,0.5)" strokeWidth="1.2" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="ig-net-node center" style={{ left: '50%', top: '60%' }}>
        <Avatar brand={BRANDS.fluxpedia} size="calc(var(--u) * 30)" />
      </div>
      {nodes.map((n, i) => {
        const k = clamp((age - t2 - 0.08 * i) / 0.45);
        if (k <= 0) return null;
        return (
          <div key={n.id} className="ig-net-node" style={{ left: `${50 + (n.x - 50) * spread}%`, top: `${60 + (n.y - 60) * spread}%`, opacity: clamp(k * 2.5), transform: `translate(-50%, -50%) scale(${(0.6 + 0.4 * outBack(k)).toFixed(3)})` }}>
            <Avatar brand={BRANDS[n.id]} size="calc(var(--u) * 22)" />
          </div>
        );
      })}
      {/* Label cross-fades: "1 channel" blurs out as the network spreads, "Media IPs" resolves in. */}
      {!ips && age < t2 + 0.3 && (
        <div className="ig-net-label" style={{ ...enter(age, t1 + 0.2, 0.45, 2), ...(age > t2 ? { opacity: 1 - outCubic(clamp((age - t2) / 0.25)), filter: `blur(${(outCubic(clamp((age - t2) / 0.25)) * 0.8).toFixed(3)}cqmin)` } : {}) }}>1 channel</div>
      )}
      {age >= t2 + 0.1 && <div className="ig-net-label" style={enter(age, t2 + 0.15, 0.45, 2)}>Media IPs</div>}
    </div>
  );
}

/**
 * Full-frame scene for the creator's pages: an account sheet in Instagram's dark theme.
 * Rows land on the times given (when each page is named) and counts roll up.
 */
export function PagesScene({ g, age, dur }: { g: GraphicSpec; age: number; dur: number }) {
  const rows: BrandId[] = ['tezscroll', 'hiddentrip', 'tgf'];
  const times = g.times ?? [0.2, 1.8, 3.4, 4.6];
  const inK = outCubic(clamp(age / 0.35));
  const outK = outCubic(clamp((age - (dur - 0.3)) / 0.3));
  const push = 1 + 0.035 * clamp(age / Math.max(1, dur));
  return (
    <div className="pages-scene" style={{ opacity: inK * (1 - outK) }}>
      <div className="pages-glow" />
      <div className="pages-sheet" style={{ transform: `translate(-50%, -50%) scale(${push.toFixed(4)})` }}>
        <div className="pages-head" style={enter(age, 0, 0.45, 3)}>
          <img src={asset('/brand/fluxpedia.png')} alt="Fluxpedia" />
          <small>Media IPs</small>
        </div>
        {rows.map((id, i) => {
          const at = times[i] ?? i * 1.5;
          if (age < at - 0.02) return null;
          const b = BRANDS[id];
          const counted = clamp((age - at - 0.15) / 0.9);
          return (
            <div key={id} className="pages-row" style={enter(age, at, 0.45, 4)}>
              <Avatar brand={b} size="7.4cqmin" />
              <div className="pages-name"><b>{b.name}</b>{b.verified && <Verified size="2.5cqmin" />}<small>@{b.handle}</small></div>
              <div className="pages-count"><b className="tnum">{countTo(b.followers, counted)}</b><small>followers</small></div>
            </div>
          );
        })}
        {age >= (times[3] ?? 5) - 0.02 && <div className="pages-more" style={enter(age, times[3] ?? 5, 0.4, 3)}>+ many more</div>}
      </div>
    </div>
  );
}
