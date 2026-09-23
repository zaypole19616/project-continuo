import { Moon, Sun } from 'lucide-react';
import { resolveTheme, type ThemePref } from '#/lib/theme';

export function ThemeToggle({ themePref, onTheme, className }: { themePref: ThemePref; onTheme: (pref: ThemePref) => void; className?: string }) {
  const dark = resolveTheme(themePref) === 'dark';
  return (
    <button className={`icon-btn ${className ?? ''}`} title={dark ? '切换到浅色' : '切换到深色'} aria-label={dark ? '切换到浅色' : '切换到深色'} onClick={() => onTheme(dark ? 'light' : 'dark')}>
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
