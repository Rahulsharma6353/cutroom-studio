'use client';
import { useTheme } from '../lib/theme';
import { I } from './icons';

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      <button aria-pressed={theme === 'light'} onClick={() => setTheme('light')} title="Light"><I.Sun /><span className="sr-only">Light</span></button>
      <button aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')} title="Dark"><I.Moon /><span className="sr-only">Dark</span></button>
    </div>
  );
}
