'use client';
import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
import { THEME_KEY as KEY } from './theme-boot';

/** Saved choice, else the system setting. */
export function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch {
    // storage blocked: fall through to the system setting
  }
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>('dark');
  useEffect(() => setTheme((document.documentElement.dataset.theme as Theme) || readTheme()), []);
  const set = (t: Theme) => {
    setTheme(t);
    applyTheme(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      // private mode: the choice lasts for this visit
    }
  };
  return [theme, set];
}
