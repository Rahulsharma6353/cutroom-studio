import type { AspectRatio } from '@shared/types';

const SHORT_SIDE: Record<string, number> = { '720p': 720, '1080p': 1080, '1440p': 1440, '4K': 2160 };

export function frameSize(aspect: AspectRatio, res: string) {
  const [w, h] = (aspect === 'source' ? '16:9' : aspect).split(':').map(Number);
  const short = SHORT_SIDE[res] ?? 1080;
  const even = (n: number) => Math.round(n / 2) * 2;
  return w >= h ? { width: even((short * w) / h), height: short } : { width: short, height: even((short * h) / w) };
}

