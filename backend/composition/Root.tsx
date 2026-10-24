import { Composition } from 'remotion';
import { captionsFromPreset } from '@shared/sample';
import { TimelineVideo, type TimelineProps } from './TimelineVideo';

const defaults: TimelineProps = {
  clips: [], assets: [], words: [], captions: captionsFromPreset('bold-pop'),
  width: 1080, height: 1920, fps: 30, durationInFrames: 30, origin: 'http://localhost:3000',
};

export function Root() {
  return (
    <Composition
      id="Timeline"
      component={TimelineVideo}
      defaultProps={defaults}
      durationInFrames={defaults.durationInFrames}
      fps={defaults.fps}
      width={defaults.width}
      height={defaults.height}
      calculateMetadata={({ props }) => ({ durationInFrames: props.durationInFrames, fps: props.fps, width: props.width, height: props.height })}
    />
  );
}
