export type SiriusTheme = 'dark' | 'light' | 'system';

export const THEME_STORAGE_KEY = 'sirius_pref_theme';

export function readStoredTheme(): SiriusTheme {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* ignore */
  }
  return 'dark';
}

export function writeStoredTheme(t: SiriusTheme): void {
  localStorage.setItem(THEME_STORAGE_KEY, t);
}

/** Apply resolved light/dark to &lt;html data-sirius-theme&gt; */
export function applySiriusTheme(mode: SiriusTheme): void {
  const root = document.documentElement;
  if (mode === 'system') {
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? true;
    root.setAttribute('data-sirius-theme', dark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-sirius-theme', mode);
  }
}
