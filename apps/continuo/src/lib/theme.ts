export type ThemePref = 'dark' | 'light' | 'system';

const KEY = 'continuo.theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(pref: ThemePref): 'dark' | 'light' {
  return pref === 'system' ? (media.matches ? 'dark' : 'light') : pref;
}

export function applyTheme(pref: ThemePref): void {
  document.documentElement.dataset.theme = resolveTheme(pref);
  try { localStorage.setItem(KEY, pref); } catch {}
}

export function watchSystemTheme(onChange: () => void): () => void {
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
