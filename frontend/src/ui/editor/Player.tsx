'use client';
import { SOCIAL_SAFE } from '@shared/explainer';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Asset, Clip } from '@shared/types';
import { dbToGain, playableClips, timecode } from '@shared/util';
import { sfxFile, SFX_VOLUME } from '@shared/sfx';
import { TRACK_IDS } from '@shared/ops';
import { duration, useStore } from '../../store/useStore';
import { Frame, type RenderMedia } from '@shared/frame/Frame';
import { I } from '../icons';
import { ratioOf } from '@shared/frame/Thumb';

/** Base level of each built-in or music sound at 0 dB clip volume (matches the MP4 render). */
const MUSIC_LEVEL = 0.35;

/**
 * Sound effects and music in the preview, at each clip's volume. A sound starts when the
 * playhead enters its clip and restarts if you scrub back before it.
 */
function PreviewAudio({ clips, assets, t, playing }: { clips: Clip[]; assets: Asset[]; t: number; playing: boolean }) {
  const pool = useRef(new Map<string, HTMLAudioElement>());
  const started = useRef(new Set<string>());
  const sources = useMemo(() => clips.flatMap((c) => {
    if (c.trackId === TRACK_IDS.sfx) {
      const f = sfxFile(c.label);
      return f ? [{ c, src: `/sfx/${f}`, base: SFX_VOLUME[f] ?? 0.6, from: 0, end: c.start + Math.max(c.duration, 2.5) }] : [];
    }
    if (c.trackId === TRACK_IDS.music) {
      const a = c.assetId ? assets.find((x) => x.id === c.assetId) : undefined;
      return a?.url ? [{ c, src: a.url, base: MUSIC_LEVEL, from: c.in, end: c.start + c.duration }] : [];
    }
    return [];
  }), [clips, assets]);

  useEffect(() => {
    const all = pool.current;
    if (!playing) { all.forEach((a) => a.pause()); started.current.clear(); return; }
    for (const { c, src, base, from, end } of sources) {
      const inside = t >= c.start && t < end;
      let a = all.get(c.id);
      if (t < c.start || t >= end) {
        if (started.current.has(c.id)) { a?.pause(); started.current.delete(c.id); }
        continue;
      }
      if (inside && !started.current.has(c.id)) {
        if (!a || a.src.indexOf(src) < 0) { a = new Audio(src); all.set(c.id, a); }
        a.currentTime = from + (t - c.start);
        a.play().catch(() => {});
        started.current.add(c.id);
      }
      if (a) a.volume = Math.min(1, base * dbToGain(c.gainDb));
    }
  }, [t, playing, sources]);
  useEffect(() => () => pool.current.forEach((a) => a.pause()), []);
  return null;
}

/** A <video> kept in step with the playhead. */
function SyncedVideo({ asset, local, playing, muted, gainDb }: { asset: Asset; local: number; playing: boolean; muted?: boolean; gainDb?: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.volume = Math.min(1, dbToGain(gainDb));
  }, [gainDb]);
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
  const allClips = useStore((s) => s.clips);
  const tracks = useStore((s) => s.tracks);
  // Hidden tracks drop out, muted tracks go silent, clip + track volume apply.
  const clips = useMemo(() => playableClips(allClips, tracks), [allClips, tracks]);
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
      : <SyncedVideo key={clip.id} asset={asset} local={local} playing={playing} muted={slot !== 'aroll'} gainDb={clip.gainDb} />;

  return (
    <section className="stage" aria-label="Preview">
      <div className="stage-canvas" ref={box}>
        <Frame t={t} clips={clips} assets={assets} jobs={jobs} words={words} captions={captions} look={look} ratio={ratio} renderMedia={renderMedia} style={{ width: size.w, height: size.h }}>
          {safe && <div className="safe" aria-hidden style={project?.aspect === '9:16' ? { left: `${SOCIAL_SAFE.x0 * 100}%`, right: `${(1 - SOCIAL_SAFE.x1) * 100}%`, top: `${SOCIAL_SAFE.y0 * 100}%`, bottom: `${(1 - SOCIAL_SAFE.y1) * 100}%` } : undefined} />}
        </Frame>
      </div>
      <div className="transport">
        <PreviewAudio clips={clips} assets={assets} t={t} playing={playing} />
        <button className="icon-btn" onClick={() => useStore.getState().jumpEdit(-1)} title="Previous cut (↑)" aria-label="Previous cut"><I.SkipBack /></button>
        <button className="play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <I.Pause /> : <I.Play />}</button>
        <button className="icon-btn" onClick={() => useStore.getState().jumpEdit(1)} title="Next cut (↓)" aria-label="Next cut"><I.SkipFwd /></button>
        <div className="time tnum">{timecode(t, true)} <span>/ {timecode(total, true)}</span></div>
        <div className="spacer" />
        <button className={`icon-btn ${safe ? 'on' : ''}`} onClick={() => setSafe(!safe)} aria-pressed={safe} title="Show platform safe zone"><I.Safe /></button>
      </div>
    </section>
  );
}
