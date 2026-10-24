/** Built-in sound effects (public/sfx). Labels on SFX clips map to these files. */
export const SFX_FILES: Record<string, string> = {
  whoosh: 'whoosh.wav', swoosh: 'whoosh.wav', pop: 'pop.wav', type: 'type.wav', typing: 'type.wav',
  ding: 'ding.wav', notification: 'ding.wav', riser: 'riser.wav', hit: 'hit.wav', boom: 'hit.wav', click: 'click.wav',
};

export const SFX_VOLUME: Record<string, number> = { 'whoosh.wav': 0.55, 'pop.wav': 0.7, 'type.wav': 0.45, 'ding.wav': 0.35, 'riser.wav': 0.4, 'hit.wav': 0.7, 'click.wav': 0.5 };

export function sfxFile(label: string): string | undefined {
  const key = label.toLowerCase().split(/[\s,]+/)[0];
  return SFX_FILES[key];
}
