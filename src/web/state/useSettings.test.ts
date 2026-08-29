// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_KEY, parseSettings } from './useSettings';

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
      theme: 'phosphor', scheme: 'c', density: 'roomy',
      fade: false, avatars: false, motion: false, numbers: false,
    };
    expect(parseSettings(JSON.stringify(stored))).toEqual(stored);
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
