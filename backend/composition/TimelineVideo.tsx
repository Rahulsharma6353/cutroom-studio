import { useEffect, useState } from 'react';
import { AbsoluteFill, Audio, continueRender, delayRender, Img, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Asset, CaptionSettings, Clip, Look, Word } from '@shared/types';
import { Frame, type RenderMedia } from '@shared/frame/Frame';
import { ASSET_BASE } from '@shared/frame/UICard';
import { sfxFile, SFX_VOLUME } from '@shared/sfx';
import { dbToGain } from '@shared/util';
import '@shared/styles/fonts';
import '@shared/styles/frame.css';

export interface TimelineProps {
  [key: string]: unknown;
  clips: Clip[];
  assets: Asset[];
  words: Word[];
  captions: CaptionSettings;
  look?: Look;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  /** Absolute origin the renderer fetches media from, e.g. http://localhost:3000 */
  origin: string;
  /** Overlay renders for Premiere: one layer on a transparent background. */
  layer?: 'all' | 'captions' | 'graphics';
  onlyClip?: string;
}

function useFonts() {
  const [handle] = useState(() => delayRender('Loading caption fonts', { timeoutInMilliseconds: 20000 }));
  useEffect(() => {
    // Fonts are bundled; ask for each face the frame uses, then wait for them to load.
    const faces = ['400 1em Anton', '400 1em "Bebas Neue"', '400 1em "Instrument Serif"', 'italic 400 1em "Instrument Serif"', '800 1em Inter', '900 1em Inter', '900 1em Figtree', '800 1em Mukta', '400 1em "Pixelify Sans"', '700 1em "Pixelify Sans"', 'italic 300 1em "Inter Display"', '700 1em "Inter Display"', '600 1em "Inter Display"'];
    let finished = false;
    const done = () => { if (!finished) { finished = true; continueRender(handle); } };
    const timer = setTimeout(done, 8000);
    Promise.all(faces.map((f) => document.fonts.load(f).catch(() => null))).then(() => { clearTimeout(timer); done(); });
    return () => clearTimeout(timer);
  }, [handle]);
}

export function TimelineVideo({ clips, assets, words, captions, look, fps, origin, layer = 'all', onlyClip }: TimelineProps) {
  useFonts();
  ASSET_BASE.v = origin;
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = frame / fps;
  const src = (a: Asset) => `${origin}${a.url}${a.url?.includes('?') ? '&' : '?'}v=original`;

  const renderMedia: RenderMedia = (slot, asset, _local, clip) => {
    if (slot === 'image') return <Img src={src(asset)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
    const from = Math.round(clip.start * fps);
    if (asset.audioOnly) {
      // A voiceover: sound only.
      return (
        <Sequence from={from} durationInFrames={Math.max(1, Math.round(clip.duration * fps))} layout="none">
          <Audio src={src(asset)} trimBefore={Math.max(0, Math.round(clip.in * fps))} volume={dbToGain(clip.gainDb)} />
        </Sequence>
      );
    }
    return (
      <Sequence from={from} durationInFrames={Math.max(1, Math.round(clip.duration * fps))} layout="none">
        <OffthreadVideo
          src={src(asset)}
          trimBefore={Math.max(0, Math.round(clip.in * fps))}
          muted={slot !== 'aroll' || dbToGain(clip.gainDb) === 0}
          volume={dbToGain(clip.gainDb)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </Sequence>
    );
  };

  return (
    <AbsoluteFill style={{ background: layer === 'all' ? '#000' : 'transparent', fontSize: width / 40 }}>
      {/* The app stylesheet paints <body>; overlay renders need the page itself transparent. */}
      {layer !== 'all' && <style>{'html, body { background: transparent !important; }'}</style>}
      <Frame t={t} clips={clips} assets={assets} words={words} captions={captions} look={look} ratio={width / height} renderMedia={renderMedia} still layer={layer} onlyClip={onlyClip} />
      {layer === 'all' && clips.filter((c) => c.trackId === 't-sfx').map((c) => {
        const file = sfxFile(c.label);
        if (!file || dbToGain(c.gainDb) === 0) return null;
        return (
          <Sequence key={c.id} from={Math.max(0, Math.round(c.start * fps))} durationInFrames={Math.max(1, Math.round(Math.max(c.duration, 0.1) * fps) + 2)} layout="none">
            <Audio src={`${origin}/sfx/${file}`} volume={(SFX_VOLUME[file] ?? 0.6) * dbToGain(c.gainDb)} />
          </Sequence>
        );
      })}
      {/* Music beds: 0 dB clip volume is the bed level (0.35), like the Premiere export. */}
      {layer === 'all' && clips.filter((c) => c.trackId === 't-music' && dbToGain(c.gainDb) > 0).map((c) => {
        const a = assets.find((x) => x.id === c.assetId);
        if (!a?.url) return null;
        return (
          <Sequence key={c.id} from={Math.max(0, Math.round(c.start * fps))} durationInFrames={Math.max(1, Math.round(c.duration * fps))} layout="none">
            <Audio src={src(a)} trimBefore={Math.max(0, Math.round(c.in * fps))} volume={0.35 * dbToGain(c.gainDb)} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
