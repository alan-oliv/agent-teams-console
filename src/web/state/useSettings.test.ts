// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { themeFor } from '../../shared/cast';
import { THEMES } from '../themes';
import { DEFAULT_SETTINGS, SETTINGS_KEY, parseSettings, useSettings } from './useSettings';

afterEach(() => window.localStorage.clear());

describe('parseSettings', () => {
  it('defaults an empty store', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('')).toEqual(DEFAULT_SETTINGS);
  });

  it('defaults rather than throwing on a corrupt blob', () => {
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('"a string"')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS);
  });

  it('reads a full stored blob back', () => {
    const stored = {
      theme: 'phosphor', scheme: 'c', density: 'roomy', movieTheme: 'lotr',
      fade: false, avatars: false, motion: false, numbers: false,
      filmPalette: false, showRateCard: false,
    };
    expect(parseSettings(JSON.stringify(stored))).toEqual(stored);
  });

  it('defaults the rate card visible, including on a blob written before it', () => {
    // The usage view reads this; it is written here. Visible out of the box.
    expect(DEFAULT_SETTINGS.showRateCard).toBe(true);
    expect(parseSettings(JSON.stringify({ theme: 'ember' })).showRateCard).toBe(true);
  });

  it('drives the film palette by default, so picking a film shows the grade', () => {
    expect(DEFAULT_SETTINGS.filmPalette).toBe(true);
    expect(parseSettings(null).filmPalette).toBe(true);
  });

  it('defaults the film-palette switch on a blob written before it existed', () => {
    expect(parseSettings(JSON.stringify({ theme: 'ember' })).filmPalette).toBe(true);
    expect(parseSettings(JSON.stringify({ filmPalette: 'yes' })).filmPalette).toBe(true);
  });

  it('starts with no movie theme', () => {
    expect(DEFAULT_SETTINGS.movieTheme).toBeNull();
    expect(parseSettings(null).movieTheme).toBeNull();
  });

  it('stores the off theme as null rather than as a key', () => {
    expect(parseSettings(JSON.stringify({ movieTheme: 'off' })).movieTheme).toBeNull();
  });

  it('rejects a movie theme the database does not have', () => {
    expect(parseSettings(JSON.stringify({ movieTheme: 'a film nobody made' })).movieTheme).toBeNull();
    expect(parseSettings(JSON.stringify({ movieTheme: 7 })).movieTheme).toBeNull();
  });

  // Field by field on purpose: a whole-object cast would put an unknown theme
  // id on the console root, where it resolves to no colours at all.
  it('keeps the fields it recognises and defaults only the rest', () => {
    const parsed = parseSettings(JSON.stringify({ theme: 'ember', density: 'nope', fade: 'yes' }));
    expect(parsed.theme).toBe('ember');
    expect(parsed.density).toBe(DEFAULT_SETTINGS.density);
    expect(parsed.fade).toBe(DEFAULT_SETTINGS.fade);
    expect(parsed.scheme).toBe(DEFAULT_SETTINGS.scheme);
  });

  it('rejects a theme id from a build that had one this one does not', () => {
    expect(parseSettings(JSON.stringify({ theme: 'sepia' })).theme).toBe(DEFAULT_SETTINGS.theme);
  });

  it('stores under a key that names the machine-wide scope', () => {
    expect(SETTINGS_KEY).toBe('console.appearance');
  });
});

// The switch is what makes "a theme sets names only" a choice rather than a law.
// `theme` is the remembered system theme throughout: it can only ever hold a
// system id, so it is already the fallback the switch needs, and a second field
// holding the same value could only drift from it.
describe('the film palette switch', () => {
  const inception = themeFor('inception').palette!;

  it('paints the film grade while a film drives', () => {
    const { result } = renderHook(() => useSettings());
    act(() => result.current.set('movieTheme', 'inception'));
    expect(result.current.vars['--color-bg']).toBe(inception.bg);
    expect(result.current.vars['--color-accent']).toBe(inception.accent.base);
    expect(result.current.vars['--warn']).toBe(inception.warn);
    expect(result.current.vars['--color-neutral-200']).toBe(THEMES.nocturne.n[0]);
  });

  it('restores the remembered system theme the moment the switch goes off', () => {
    const { result } = renderHook(() => useSettings());
    act(() => result.current.set('theme', 'phosphor'));
    act(() => result.current.set('movieTheme', 'inception'));
    expect(result.current.vars['--color-bg']).toBe(inception.bg);

    act(() => result.current.set('filmPalette', false));
    // Same render, not a reload: the ground is Phosphor's again.
    expect(result.current.vars['--color-bg']).toBe(THEMES.phosphor.bg);
    expect(result.current.vars['--term']).toBe(THEMES.phosphor.term);
    expect(result.current.vars['--warn']).toBe(THEMES.phosphor.warn);
    // The film is still cast — the switch reaches colour only.
    expect(result.current.settings.movieTheme).toBe('inception');
  });

  it('leaves the ground alone when no film is picked, switch on or off', () => {
    const { result } = renderHook(() => useSettings());
    act(() => result.current.set('theme', 'ember'));
    const ground = result.current.vars['--color-bg'];
    act(() => result.current.set('filmPalette', false));
    expect(result.current.vars['--color-bg']).toBe(ground);
    act(() => result.current.set('filmPalette', true));
    expect(result.current.vars['--color-bg']).toBe(ground);
    expect(ground).toBe(THEMES.ember.bg);
  });

  it('persists the switch beside the film', () => {
    const { result } = renderHook(() => useSettings());
    act(() => result.current.set('movieTheme', 'lotr'));
    act(() => result.current.set('filmPalette', false));
    const stored = JSON.parse(window.localStorage.getItem(SETTINGS_KEY)!);
    expect(stored.movieTheme).toBe('lotr');
    expect(stored.filmPalette).toBe(false);
    expect(stored.theme).toBe(DEFAULT_SETTINGS.theme);
  });
});
