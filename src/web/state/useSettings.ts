import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { MOVIE_THEMES, themeFor, type FilmPalette } from '../../shared/cast';
import {
  ACCENT_KEYS,
  DENSITY,
  DENSITY_IDS,
  THEME_IDS,
  cssVarsFor,
  type AccentKey,
  type Density,
  type ThemeId,
} from '../themes';

export interface Settings {
  theme: ThemeId;
  scheme: AccentKey;
  density: Density;
  /** The per-line opacity ladder in transcripts. */
  fade: boolean;
  /** The 8-bit faces. */
  avatars: boolean;
  /** Cursor blink and the typing dots. Off is also the accessible setting. */
  motion: boolean;
  /** The gutter in an expanded JSON payload. */
  numbers: boolean;
  /** The film the team is cast from; null is off, and off is the real names. */
  movieTheme: string | null;
  /**
   * Whether the picked film's grade drives the console's colours too. Off, the
   * film reaches names and portrait tints only and the ground stays on `theme`
   * — which is why `theme` is the fallback and no second field records one: it
   * can only ever hold a system id, so it IS the last system theme picked.
   */
  filmPalette: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'nocturne',
  scheme: 'a',
  density: 'default',
  fade: true,
  avatars: true,
  motion: true,
  numbers: true,
  movieTheme: null,
  filmPalette: true,
};

// Appearance is a property of this machine, not of the team being watched — a
// console reopened on another session keeps the operator's theme.
export const SETTINGS_KEY = 'console.appearance';

const inList = <T,>(list: readonly T[], value: unknown): value is T =>
  list.includes(value as T);

// The database's own `off` entry is the absence of a theme, and the setting
// already spells that null — one value for off rather than two.
const CAST_KEYS = MOVIE_THEMES.map((theme) => theme.key).filter((key) => key !== 'off');

/**
 * Field by field, so a stored blob from an older build — or a hand-edited one —
 * contributes what it can and defaults the rest. A whole-object cast would put
 * an unknown theme id on the root, where it resolves to no colours at all.
 */
export function parseSettings(raw: string | null): Settings {
  if (!raw) return DEFAULT_SETTINGS;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (!stored || typeof stored !== 'object') return DEFAULT_SETTINGS;
  const s = stored as Record<string, unknown>;
  const bool = (key: 'fade' | 'avatars' | 'motion' | 'numbers' | 'filmPalette'): boolean =>
    typeof s[key] === 'boolean' ? (s[key] as boolean) : DEFAULT_SETTINGS[key];
  return {
    theme: inList(THEME_IDS, s.theme) ? s.theme : DEFAULT_SETTINGS.theme,
    scheme: inList(ACCENT_KEYS, s.scheme) ? s.scheme : DEFAULT_SETTINGS.scheme,
    density: inList(DENSITY_IDS, s.density) ? s.density : DEFAULT_SETTINGS.density,
    fade: bool('fade'),
    avatars: bool('avatars'),
    motion: bool('motion'),
    numbers: bool('numbers'),
    movieTheme: inList(CAST_KEYS, s.movieTheme) ? s.movieTheme : DEFAULT_SETTINGS.movieTheme,
    filmPalette: bool('filmPalette'),
  };
}

function read(): Settings {
  try {
    return parseSettings(window.localStorage.getItem(SETTINGS_KEY));
  } catch {
    // Private browsing and a blocked origin both throw on access, not on write.
    return DEFAULT_SETTINGS;
  }
}

export interface SettingsStore {
  settings: Settings;
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
  reset(): void;
  /** Theme colours for the console root. */
  vars: Record<string, string>;
  /** Transcript line gap for the chosen density, in px. */
  gap: number;
}

/**
 * The film grade currently driving, if one is. `themeFor(null)` is the off
 * entry and carries no palette, so "no film" and "switch off" collapse to the
 * same absent value. Shared rather than inlined because the portraits lift
 * against this same ground — two copies of the rule could disagree.
 */
export function activePalette(settings: Settings): FilmPalette | undefined {
  return settings.filmPalette ? themeFor(settings.movieTheme).palette : undefined;
}

export function useSettings(): SettingsStore {
  const [settings, setSettings] = useState<Settings>(read);

  const persist = useCallback((next: Settings) => {
    setSettings(next);
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // A full or blocked store costs persistence, never the session in hand.
    }
  }, []);

  const set = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) =>
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        try {
          window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
        } catch {
          // as above
        }
        return next;
      }),
    [],
  );

  const reset = useCallback(() => persist(DEFAULT_SETTINGS), [persist]);

  const vars = useMemo(
    () => cssVarsFor(settings.theme, settings.scheme, activePalette(settings)),
    [settings.theme, settings.scheme, settings.movieTheme, settings.filmPalette],
  );

  return { settings, set, reset, vars, gap: DENSITY[settings.density] };
}

// Read by the leaves that have to change shape rather than colour — the feed's
// line gap, the fade ladder, the portraits, the JSON gutter. Colour needs no
// context at all: it resolves through the custom properties on the root.
export const SettingsContext = createContext<Settings>(DEFAULT_SETTINGS);

export function useAppearance(): Settings {
  return useContext(SettingsContext);
}
