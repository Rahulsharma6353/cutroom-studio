'use client';
import { SOCIAL_SAFE } from '@shared/explainer';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Asset } from '@shared/types';
import { timecode } from '@shared/util';
import { duration, useStore } from '../../store/useStore';
import { Frame, type RenderMedia } from '@shared/frame/Frame';
import { I } from '../icons';
import { ratioOf } from '@shared/frame/Thumb';

/** A <video> kept in step with the playhead. */
function SyncedVideo({ asset, local, playing, muted }: { asset: Asset; local: number; playing: boolean; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const target = v.duration ? local % v.duration : local;
    if (Math.abs(v.currentTime - target) > (playing ? 0.3 : 0.04)) v.currentTime = target;
    if (playing && v.paused) v.play().catch(() => {});
    if (!playing && !v.paused) v.pause();
  }, [local, playing]);
  return <video ref={ref} src={asset.url} playsInline preload="auto" muted={muted} />;
}

export function Player() {
  const project = useStore((s) => s.project);
  const clips = useStore((s) => s.clips);
  const assets = useStore((s) => s.assets);
  const jobs = useStore((s) => s.jobs);
  const words = useStore((s) => s.words);
  const captions = useStore((s) => s.captions);
  const look = useStore((s) => s.look);
  const t = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const togglePlay = useStore((s) => s.togglePlay);
  const total = useStore(duration);
  const [safe, setSafe] = useState(false);

  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 300, h: 500 });
  const ratio = ratioOf(project?.aspect ?? '9:16');

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const W = e.contentRect.width - 44;
      const H = e.contentRect.height - 44;
      const w = Math.min(W, H * ratio);
      setSize({ w, h: w / ratio });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ratio]);

  const renderMedia: RenderMedia = (slot, asset, local, clip) =>
    slot === 'image'
      ? <img src={asset.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      : <SyncedVideo key={clip.id} asset={asset} local={local} playing={playing} muted={slot !== 'aroll'} />;

  return (
    <section className="stage" aria-label="Preview">
      <div className="stage-canvas" ref={box}>
        <Frame t={t} clips={clips} assets={assets} jobs={jobs} words={words} captions={captions} look={look} ratio={ratio} renderMedia={renderMedia} style={{ width: size.w, height: size.h }}>
          {safe && <div className="safe" aria-hidden style={project?.aspect === '9:16' ? { left: `${SOCIAL_SAFE.x0 * 100}%`, right: `${(1 - SOCIAL_SAFE.x1) * 100}%`, top: `${SOCIAL_SAFE.y0 * 100}%`, bottom: `${(1 - SOCIAL_SAFE.y1) * 100}%` } : undefined} />}
        </Frame>
      </div>
      <div className="transport">
        <button className="play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <I.Pause /> : <I.Play />}</button>
        <div className="time tnum">{timecode(t, true)} <span>/ {timecode(total, true)}</span></div>
        <div className="spacer" />
        <button className={`icon-btn ${safe ? 'on' : ''}`} onClick={() => setSafe(!safe)} aria-pressed={safe} title="Show platform safe zone"><I.Safe /></button>
      </div>
    </section>
  );
}
