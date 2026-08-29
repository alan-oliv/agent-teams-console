import { describe, expect, it } from 'vitest';
import {
  ACCENT_KEYS,
  DENSITY,
  DENSITY_IDS,
  THEMES,
  THEME_IDS,
  cssVarsFor,
  type ThemeId,
} from './themes';

/** sRGB relative luminance, enough to order two colours by lightness. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

const LIGHT: ThemeId[] = ['organic', 'frost'];

describe('the theme table', () => {
  it('carries all six themes', () => {
    expect(THEME_IDS).toEqual(['nocturne', 'organic', 'ember', 'frost', 'slate', 'phosphor']);
    expect(Object.keys(THEMES).sort()).toEqual([...THEME_IDS].sort());
  });

  it('gives every theme a full ramp, four accents and the semantic pair', () => {
    for (const id of THEME_IDS) {
      const theme = THEMES[id];
      expect(theme.n, id).toHaveLength(8);
      expect(Object.keys(theme.accents).sort(), id).toEqual([...ACCENT_KEYS].sort());
      for (const key of ACCENT_KEYS) {
        expect(theme.accents[key].steps, `${id}.${key}`).toHaveLength(7);
        expect(theme.accents[key].name, `${id}.${key}`).toBeTruthy();
      }
      for (const value of [theme.term, theme.bg, theme.text, theme.onAccent, theme.warn, theme.warnEdge, theme.warnTint, theme.fail, theme.jsonString, theme.jsonBoolean]) {
        expect(value, id).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  // The rule the whole thing rests on. If a light theme's ramp ran the same
  // direction as a dark one, `var(--color-neutral-700)` would mean "quiet
  // label" on carbon and "near-invisible" on paper, and every component would
  // need a light-mode branch.
  it('orders the neutral ramp BY USE, so a light theme runs it the other way', () => {
    for (const id of THEME_IDS) {
      const n = THEMES[id].n;
      const strongest = luminance(n[0]);
      const quietest = luminance(n[7]);
      if (LIGHT.includes(id)) {
        expect(strongest, `${id} 200 must be DARKER than 900 on a light theme`).toBeLessThan(quietest);
      } else {
        expect(strongest, `${id} 200 must be LIGHTER than 900 on a dark theme`).toBeGreaterThan(quietest);
      }
    }
  });

  it('keeps text legible against the ground on every theme', () => {
    for (const id of THEME_IDS) {
      const theme = THEMES[id];
      const contrast = (a: string, b: string) => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      // 4.5 is the AA body-text bar; the ramp's strongest step has to clear it
      // against both grounds or the theme is unreadable, not merely different.
      expect(contrast(theme.text, theme.term), `${id} text on term`).toBeGreaterThan(4.5);
      expect(contrast(theme.text, theme.bg), `${id} text on bg`).toBeGreaterThan(4.5);
      expect(contrast(theme.n[0], theme.term), `${id} neutral-200 on term`).toBeGreaterThan(4.5);
    }
  });

  it('keeps a label readable on an accent fill', () => {
    // What --on-accent is FOR: text sitting on a filled accent, like the unread
    // pill. Every theme picks one of its own grounds for it, but which one is
    // not a formula — the only thing that has to hold is that it reads.
    for (const id of THEME_IDS) {
      const theme = THEMES[id];
      for (const key of ACCENT_KEYS) {
        const [hi, lo] = [luminance(theme.onAccent), luminance(theme.accents[key].steps[0])].sort(
          (x, y) => y - x,
        );
        expect((hi + 0.05) / (lo + 0.05), `${id}.${key} on-accent`).toBeGreaterThan(3);
      }
    }
  });
});

describe('cssVarsFor', () => {
  it('publishes every step a component can ask for', () => {
    const vars = cssVarsFor('nocturne', 'a');
    expect(Object.keys(vars).sort()).toEqual(
      [
        '--color-accent',
        '--color-accent-300', '--color-accent-400', '--color-accent-500',
        '--color-accent-600', '--color-accent-700', '--color-accent-900',
        '--color-bg',
        '--color-neutral-200', '--color-neutral-300', '--color-neutral-400',
        '--color-neutral-500', '--color-neutral-600', '--color-neutral-700',
        '--color-neutral-800', '--color-neutral-900',
        '--color-text', '--fail', '--json-boolean', '--json-string',
        '--on-accent', '--term', '--warn', '--warn-edge', '--warn-tint',
      ].sort(),
    );
  });

  it('maps the ramps the way the prototype indexes them', () => {
    const vars = cssVarsFor('nocturne', 'a');
    // n[0] is 200 and n[7] is 900; the accent runs base, 300…700, 900.
    expect(vars['--color-neutral-200']).toBe('#e2e3ea');
    expect(vars['--color-neutral-900']).toBe('#292b31');
    expect(vars['--color-accent']).toBe('#9184d9');
    expect(vars['--color-accent-400']).toBe('#b5abfc');
    expect(vars['--color-accent-900']).toBe('#2b2741');
  });

  it('swaps only the accent when the scheme changes, never the ground', () => {
    const blurple = cssVarsFor('nocturne', 'a');
    const teal = cssVarsFor('nocturne', 'b');
    expect(teal['--color-accent']).toBe('#6fb3ac');
    expect(teal['--term']).toBe(blurple['--term']);
    expect(teal['--color-bg']).toBe(blurple['--color-bg']);
    expect(teal['--color-neutral-600']).toBe(blurple['--color-neutral-600']);
  });

  it('falls back to Nocturne rather than publishing nothing for a bad id', () => {
    // A stored theme id from an older build must not leave the root with no
    // colours at all.
    const vars = cssVarsFor('does-not-exist' as ThemeId, 'a');
    expect(vars['--term']).toBe(THEMES.nocturne.term);
  });
});

describe('density', () => {
  it('is the three gaps the panel offers', () => {
    expect(DENSITY_IDS).toEqual(['compact', 'default', 'roomy']);
    expect(DENSITY).toEqual({ compact: 5, default: 10, roomy: 16 });
  });
});
