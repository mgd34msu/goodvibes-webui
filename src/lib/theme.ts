/**
 * Theme & density preference persistence.
 * Mirrors the pattern from src/lib/ui-preferences.ts:
 * read/write via localStorage, dispatch custom event for cross-tab sync.
 */

export type Theme = 'dark' | 'light';
export type Density = 'default' | 'compact';

export interface ThemePreferences {
  theme: Theme;
  density: Density;
}

export const THEME_PREFERENCES_KEY = 'goodvibes.webui.theme';
export const THEME_PREFERENCES_EVENT = 'goodvibes:webui-theme';

export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  theme: 'dark',
  density: 'default',
};

function storageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/**
 * Determine the initial theme: stored preference > prefers-color-scheme > dark.
 */
export function resolveInitialTheme(): Theme {
  if (storageAvailable()) {
    try {
      const stored = window.localStorage.getItem(THEME_PREFERENCES_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<ThemePreferences>;
        if (parsed.theme === 'light' || parsed.theme === 'dark') {
          return parsed.theme;
        }
      }
    } catch {
      // fall through
    }
    // No stored preference: respect OS signal
    if (window.matchMedia?.('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
  }
  return 'dark';
}

export function readThemePreferences(): ThemePreferences {
  if (!storageAvailable()) return DEFAULT_THEME_PREFERENCES;
  try {
    const stored = window.localStorage.getItem(THEME_PREFERENCES_KEY);
    if (!stored) return DEFAULT_THEME_PREFERENCES;
    const parsed = JSON.parse(stored) as Partial<ThemePreferences>;
    return {
      theme: parsed.theme === 'light' || parsed.theme === 'dark' ? parsed.theme : DEFAULT_THEME_PREFERENCES.theme,
      density: parsed.density === 'compact' ? 'compact' : DEFAULT_THEME_PREFERENCES.density,
    };
  } catch {
    return DEFAULT_THEME_PREFERENCES;
  }
}

export function writeThemePreferences(next: ThemePreferences): ThemePreferences {
  if (storageAvailable()) {
    window.localStorage.setItem(THEME_PREFERENCES_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(THEME_PREFERENCES_EVENT, { detail: next }));
  }
  return next;
}

export function applyThemeToRoot(prefs: ThemePreferences): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', prefs.theme);
  if (prefs.density === 'compact') {
    root.setAttribute('data-density', 'compact');
  } else {
    root.removeAttribute('data-density');
  }
}
