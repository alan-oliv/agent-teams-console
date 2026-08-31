import { describe, expect, it } from 'vitest';
import { themeFor } from './cast';
import type { PortraitId } from './domain';
import {
  applyFeats,
  FEAT_SPRITES,
  LIFT_TARGETS,
  lift,
  parseLook,
  PORTRAIT_IDS,
  portraitFor,
  portraitSvg,
  SKIN_PAIRS,
  SPRITE_COLORS,
  SPRITES,
  TERMINAL_SPRITE,
  TERMINAL_SPRITE_SVG,
} from './portrait';

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
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** Hue in degrees, for asserting the lift moved lightness and nothing else. */
function hue(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}
const hueGap = (a: string, b: string) => {
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 360 - d);
};

const countPaths = (svg: string): number => (svg.match(/<path /g) ?? []).length;

describe('sprite data', () => {
  it('holds six sprites, each exactly 12 rows of 12 characters', () => {
    expect(PORTRAIT_IDS).toEqual(['lead', 'security', 'perf', 'tests', 'architect', 'repro']);
    expect(Object.keys(SPRITES)).toHaveLength(6);
    for (const id of PORTRAIT_IDS) {
      const grid = SPRITES[id];
      expect(grid, id).toHaveLength(12);
      for (const row of grid) expect(row.length, `${id}:${row}`).toBe(12);
    }
  });

  it('carries the prototype palette verbatim', () => {
    // Accent and semantic entries resolve through the theme; the structural
    // greys stay literal so a hat keeps its contrast on a light ground.
    expect(SPRITE_COLORS).toEqual({
      a: 'var(--color-accent-400)', b: 'var(--color-accent-700)',
      h: '#3f424d', k: '#292b31',
      w: '#e9e9ed', d: 'var(--warn)', e: 'var(--fail)',
    });
  });

  it('carries the twelve skin hexes as six pairs', () => {
    expect(SKIN_PAIRS).toEqual({
      lead: ['#e0c3a8', '#b99a80'],
      security: ['#8d6a52', '#6f5240'],
      perf: ['#c9a88f', '#a3846e'],
      tests: ['#e6cdb4', '#c2a68c'],
      architect: ['#a87c5e', '#86603f'],
      repro: ['#d9b89c', '#b2937a'],
    });
    expect(Object.values(SKIN_PAIRS).flat()).toHaveLength(12);
  });

  // Decision 29. The shirt rows are identical geometry on every role, and repro
  // used to draw them in `e` — the failure rose — which made a repro agent that
  // ACTUALLY failed indistinguishable from one at rest, and left ten films
  // declaring a repro garment that could never be painted.
  it('dresses every role shirt in the garment glyph, semantic tokens never', () => {
    const SEMANTIC = ['d', 'e'];
    for (const id of PORTRAIT_IDS) {
      for (const row of SPRITES[id].slice(9)) {
        for (const ch of row) {
          expect(SEMANTIC, `${id} rest shirt paints a semantic glyph: ${row}`).not.toContain(ch);
        }
      }
    }
  });

  it('gives repro the same shirt geometry as the roles that always had it', () => {
    expect(SPRITES.repro.slice(9)).toEqual(SPRITES.perf.slice(9));
    expect(SPRITES.repro.slice(9)).toEqual(SPRITES.tests.slice(9));
  });

  // `e` keeps its meaning: it is the failed-STATUS treatment, for any role.
  it('keeps the failure rose available as a colour, unused at rest', () => {
    expect(SPRITE_COLORS.e).toBe('var(--fail)');
    expect(Object.values(SPRITES).flat().join('')).not.toContain('e');
  });
});

describe('terminal sprite', () => {
  it('is 17 rows of 24 characters, the not-watching screen size', () => {
    expect(TERMINAL_SPRITE).toHaveLength(17);
    for (const row of TERMINAL_SPRITE) expect(row).toHaveLength(24);
  });

  it('renders crisp 24x17 inline SVG', () => {
    expect(TERMINAL_SPRITE_SVG.startsWith('<svg ')).toBe(true);
    expect(TERMINAL_SPRITE_SVG.endsWith('</svg>')).toBe(true);
    expect(TERMINAL_SPRITE_SVG).toContain('viewBox="0 0 24 17"');
    expect(TERMINAL_SPRITE_SVG).toContain('shape-rendering="crispEdges"');
  });

  it('paints the frame, screen, dim output and lit prompt as four distinct colours', () => {
    expect(countPaths(TERMINAL_SPRITE_SVG)).toBe(4);
    expect(TERMINAL_SPRITE_SVG).toContain('var(--color-neutral-700)'); // frame + stand
    expect(TERMINAL_SPRITE_SVG).toContain('var(--color-neutral-900)'); // screen ground
    expect(TERMINAL_SPRITE_SVG).toContain('var(--color-neutral-600)'); // dim output lines
    expect(TERMINAL_SPRITE_SVG).toContain('var(--color-accent-400)'); // lit prompt
  });
});

describe('portraitFor', () => {
  it('gives the lead the crown regardless of agentType', () => {
    expect(portraitFor({ name: 'team-lead', agentType: 'team-lead', isLead: true })).toEqual({
      portrait: 'lead',
      skinIndex: 1,
    });
  });

  it('matches agentType keywords before falling back to the name hash', () => {
    const cases: Array<[string, PortraitId]> = [
      ['security-auditor', 'security'],
      ['code-review', 'security'],
      ['perf-bench', 'perf'],
      ['test-writer', 'tests'],
      ['architect', 'architect'],
      ['planner', 'architect'],
      ['repro-runner', 'repro'],
      ['debugger', 'repro'],
    ];
    for (const [agentType, expected] of cases) {
      expect(portraitFor({ name: 'probe-alpha', agentType, isLead: false }).portrait, agentType).toBe(expected);
    }
  });

  it('falls back to a stable hash of the name for the real fixture teammates', () => {
    expect(portraitFor({ name: 'probe-alpha', agentType: 'general-purpose', isLead: false })).toEqual({
      portrait: 'security',
      skinIndex: 2,
    });
    expect(portraitFor({ name: 'probe-bravo', agentType: 'Explore', isLead: false })).toEqual({
      portrait: 'architect',
      skinIndex: 2,
    });
    expect(portraitFor({ name: 'probe-charlie', agentType: 'general-purpose', isLead: false })).toEqual({
      portrait: 'architect',
      skinIndex: 4,
    });
  });

  it('never hands a non-lead agent the crown, even when the hash fallback fires', () => {
    expect(portraitFor({ name: 'api-worker', agentType: 'general-purpose', isLead: false }).portrait).not.toBe(
      'lead',
    );
    const sampleNames = [
      'api-worker', 'probe-alpha', 'probe-bravo', 'probe-charlie', 'worker-1', 'worker-2',
      'worker-3', 'ghost', 'runner', 'helper', 'agent-99', 'octo', 'nightly-job', '', 'x', 'y', 'z',
    ];
    for (const name of sampleNames) {
      expect(portraitFor({ name, agentType: 'general-purpose', isLead: false }).portrait, name).not.toBe('lead');
    }
  });

  it('matches keywords in the name when agentType is generic', () => {
    expect(portraitFor({ name: 'security-scan', agentType: 'general-purpose', isLead: false }).portrait).toBe(
      'security',
    );
    expect(portraitFor({ name: 'perf-probe', agentType: 'general-purpose', isLead: false }).portrait).toBe('perf');
  });

  it('still gives the lead the crown when isLead is true', () => {
    expect(portraitFor({ name: 'team-lead', agentType: 'team-lead', isLead: true }).portrait).toBe('lead');
  });

  it('is deterministic across repeated calls', () => {
    const first = portraitFor({ name: 'probe-charlie', agentType: 'general-purpose', isLead: false });
    for (let i = 0; i < 100; i++) {
      expect(portraitFor({ name: 'probe-charlie', agentType: 'general-purpose', isLead: false })).toEqual(first);
    }
  });

  it('always produces a skin index inside the pair range', () => {
    for (const name of ['team-lead', 'probe-alpha', 'probe-bravo', 'probe-charlie', '', 'x']) {
      const { skinIndex } = portraitFor({ name, agentType: 'general-purpose', isLead: false });
      expect(skinIndex).toBeGreaterThanOrEqual(0);
      expect(skinIndex).toBeLessThan(6);
    }
  });
});

describe('portraitSvg', () => {
  it('emits one path per distinct colour used by the sprite', () => {
    expect(countPaths(portraitSvg('lead', 0))).toBe(5);
    expect(countPaths(portraitSvg('security', 0))).toBe(6);
    expect(countPaths(portraitSvg('perf', 0))).toBe(5);
    expect(countPaths(portraitSvg('tests', 0))).toBe(5);
    expect(countPaths(portraitSvg('architect', 0))).toBe(6);
    expect(countPaths(portraitSvg('repro', 0))).toBe(5);
  });

  it('renders crisp 12x12 inline SVG', () => {
    const svg = portraitSvg('lead', 0);
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('viewBox="0 0 12 12"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('M3 0h1v1h-1z'); // lead row 0, column 3 is 'a'
  });

  it('picks the skin pair by index', () => {
    const zero = portraitSvg('lead', 0);
    expect(zero).toContain('#e0c3a8');
    expect(zero).toContain('#b99a80');

    const one = portraitSvg('lead', 1);
    expect(one).toContain('#8d6a52');
    expect(one).toContain('#6f5240');
    expect(one).not.toContain('#e0c3a8');
  });

  it('paints the repro shirt on the accent ramp, like every other role', () => {
    // Decision 29: it used to be var(--fail), which spent a status colour on a
    // resting role. The security badge's literal white is untouched — that one
    // is artwork, not a semantic token.
    expect(portraitSvg('repro', 0)).toContain('var(--color-accent-400)');
    expect(portraitSvg('repro', 0)).not.toContain('var(--fail)');
    expect(portraitSvg('security', 0)).toContain('#e9e9ed');
  });

  it('returns identical output for the same (portrait, skinIndex)', () => {
    expect(portraitSvg('architect', 4)).toBe(portraitSvg('architect', 4));
    expect(portraitSvg('architect', 4)).not.toBe(portraitSvg('architect', 3));
  });
});

describe('parseLook', () => {
  it('reads the five slots off a film look, adding the hash the data omits', () => {
    expect(parseLook('e0c3a8|b99a80|6b7f9e|3d4a63|31241b')).toEqual({
      skin: '#e0c3a8',
      skinShade: '#b99a80',
      garment: '#6b7f9e',
      garmentShade: '#3d4a63',
      hair: '#31241b',
    });
  });

  it('reads every look the database actually ships', () => {
    for (const theme of [...Array(10)].map((_, i) => themeFor(
      ['inception', 'stranger', 'lotr', 'starwars', 'bttf', 'pulp', 'godfather', 'dogs', 'matrix', 'breakingbad'][i],
    ))) {
      for (const [slot, raw] of Object.entries(theme.looks ?? {})) {
        const look = parseLook(raw);
        expect(look, `${theme.key}.${slot}`).not.toBeNull();
        for (const value of Object.values(look!)) {
          expect(value, `${theme.key}.${slot}`).toMatch(/^#[0-9a-f]{6}$/);
        }
      }
    }
  });

  it('refuses a look it cannot read rather than painting half a character', () => {
    for (const bad of [undefined, '', 'nope', 'e0c3a8|b99a80', 'e0c3a8|b99a80|6b7f9e|3d4a63|31241b|extra', 'e0c3a8|b99a80|6b7f9e|3d4a63|zzzzzz']) {
      expect(parseLook(bad), String(bad)).toBeNull();
    }
  });
});

describe('applyFeats', () => {
  const lead = SPRITES.lead;

  it('leaves the silhouette alone when a character wears nothing', () => {
    expect(applyFeats(lead, [])).toEqual(lead);
  });

  it('keeps the grid 12x12 whatever it draws', () => {
    for (const feat of Object.keys(FEAT_SPRITES) as Array<keyof typeof FEAT_SPRITES>) {
      const grid = applyFeats(lead, [feat]);
      expect(grid, feat).toHaveLength(12);
      for (const row of grid) expect(row.length, `${feat}:${row}`).toBe(12);
    }
  });

  it('paints accessories only in the character own look slots, never a colour of its own', () => {
    // Every glyph an accessory can introduce has to be one the look supplies.
    for (const rows of Object.values(FEAT_SPRITES)) {
      for (const patch of Object.values(rows)) {
        for (const ch of patch) expect('.sSabh', patch).toContain(ch);
      }
    }
  });

  it('clears the scalp for bald, so a hat lands on skin rather than on hair', () => {
    const bald = applyFeats(lead, ['bald']);
    expect(bald.join('')).not.toContain('h');
    // The spec's own pairing: the chemist is bald UNDER the pork pie hat.
    const hatted = applyFeats(lead, ['bald', 'fedora']);
    expect(hatted[2]).toBe('.aaaaaaaaaa.'); // brim
    expect(hatted[3]).not.toContain('h'); // no hair peeking out beneath it
  });

  it('applies in list order, so the later accessory wins the pixels they share', () => {
    // bald+fedora cannot show this: a fedora is drawn in garment glyphs and bald
    // only clears hair, so that pair commutes. A pair that shares rows can.
    const hatOverHair = applyFeats(lead, ['wildhair', 'fedora']);
    const hairOverHat = applyFeats(lead, ['fedora', 'wildhair']);
    expect(hatOverHair).not.toEqual(hairOverHat);
    // Column 5 of row 0 is the one cell both of them paint, so it is the cell
    // that records which was drawn last. Everywhere else the base silhouette
    // still shows through, which is why this asserts the pixel and not the row.
    expect(hatOverHair[0][5]).toBe('a'); // the hat went on after the hair
    expect(hairOverHat[0][5]).toBe('h'); // the hair went on after the hat
  });

  it('ignores an accessory it has no art for rather than throwing', () => {
    expect(applyFeats(lead, ['nonesuch' as never])).toEqual(lead);
  });
});

describe('the silhouette lift', () => {
  // The recorded failure: Pulp Fiction's lead measured 1.06:1 garment against
  // the pane and read as a floating face.
  const pulp = parseLook(themeFor('pulp').looks!.lead)!;
  const ground = themeFor('pulp').palette!.bg;

  it('rescues the near-black garment that vanished on the near-black ground', () => {
    expect(contrast(pulp.garment, ground)).toBeLessThan(1.3); // the bug, still in the data
    const lifted = lift(pulp.garment, ground, LIFT_TARGETS.garment);
    expect(contrast(lifted, ground)).toBeGreaterThanOrEqual(LIFT_TARGETS.garment - 0.01);
  });

  it('moves lightness and leaves hue alone', () => {
    for (const hex of ['#16161a', '#123456', '#7f0000', '#1f2a24', '#4a2b2b']) {
      const out = lift(hex, '#141414', LIFT_TARGETS.garment);
      expect(hueGap(hex, out), hex).toBeLessThan(2);
    }
  });

  it('never darkens against a dark ground', () => {
    for (const hex of ['#000000', '#0a0a0a', '#16161a', '#222222', '#333333', '#123456']) {
      const out = lift(hex, '#141414', LIFT_TARGETS.garment);
      expect(luminance(out), hex).toBeGreaterThanOrEqual(luminance(hex) - 1e-9);
    }
  });

  it('leaves a colour that already reads exactly as it was', () => {
    for (const hex of ['#c9924f', '#e0c3a8', '#f0d3a4']) {
      expect(lift(hex, '#141414', LIFT_TARGETS.garment), hex).toBe(hex);
    }
  });

  it('pushes the other way on a light ground', () => {
    const out = lift('#e8e2d4', '#ece5d7', LIFT_TARGETS.garment);
    expect(luminance(out)).toBeLessThan(luminance('#e8e2d4'));
    expect(contrast(out, '#ece5d7')).toBeGreaterThanOrEqual(LIFT_TARGETS.garment - 0.01);
  });

  it('lifts the garment hardest, because it carries the shape', () => {
    expect(LIFT_TARGETS.garment).toBeGreaterThan(LIFT_TARGETS.garmentShade);
    expect(LIFT_TARGETS.garment).toBeGreaterThan(LIFT_TARGETS.hair);
    expect(LIFT_TARGETS.garment).toBeGreaterThan(LIFT_TARGETS.outline);
    expect(LIFT_TARGETS.garment).toBeGreaterThan(LIFT_TARGETS.skin);
  });

  it('makes every shipped look read against its own film ground', () => {
    // The whole point: no character may be a floating face on any of the ten.
    for (const key of ['inception', 'stranger', 'lotr', 'starwars', 'bttf', 'pulp', 'godfather', 'dogs', 'matrix', 'breakingbad']) {
      const theme = themeFor(key);
      const bg = theme.palette!.bg;
      for (const [slot, raw] of Object.entries(theme.looks ?? {})) {
        const look = parseLook(raw)!;
        const garment = lift(look.garment, bg, LIFT_TARGETS.garment);
        expect(contrast(garment, bg), `${key}.${slot} garment`).toBeGreaterThanOrEqual(
          LIFT_TARGETS.garment - 0.01,
        );
      }
    }
  });
});

describe('portraitSvg painted from a film', () => {
  const look = parseLook(themeFor('inception').looks!.lead)!;
  const ground = themeFor('inception').palette!.bg;

  it('is the default portrait when the character has no look', () => {
    expect(portraitSvg('lead', 0)).toBe(portraitSvg('lead', 0, undefined));
  });

  it('paints the silhouette in the film colours rather than the default skin', () => {
    const svg = portraitSvg('lead', 0, { look, ground });
    // The garment came off the accent ramp before; it is the film's now.
    expect(svg).not.toContain('var(--color-accent-400)');
    expect(svg).toContain('viewBox="0 0 12 12"');
    expect(svg).not.toBe(portraitSvg('lead', 0));
  });

  it('lifts the film colours against the ground rather than painting them raw', () => {
    // Pulp Fiction's lead is the recorded case: raw garment is invisible here.
    const pulpLook = parseLook(themeFor('pulp').looks!.lead)!;
    const pulpGround = themeFor('pulp').palette!.bg;
    const svg = portraitSvg('lead', 0, { look: pulpLook, ground: pulpGround });
    expect(svg).not.toContain(pulpLook.garment);
    const fills = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
    for (const fill of fills) {
      expect(contrast(fill, pulpGround), fill).toBeGreaterThan(1.3);
    }
  });

  it('draws the character accessories over the silhouette', () => {
    const plain = portraitSvg('lead', 0, { look, ground });
    const shaded = portraitSvg('lead', 0, { look, ground, feats: ['shades'] });
    expect(shaded).not.toBe(plain);
  });

  it('returns identical output for identical input, and different for different', () => {
    expect(portraitSvg('lead', 0, { look, ground })).toBe(portraitSvg('lead', 0, { look, ground }));
    expect(portraitSvg('lead', 0, { look, ground, feats: ['bald'] })).not.toBe(
      portraitSvg('lead', 0, { look, ground }),
    );
  });
});

// Decision 29's other half: the data that had no consumer now has one.
describe('every film repro garment reaches the portrait', () => {
  const FILMS = ['inception', 'stranger', 'lotr', 'starwars', 'bttf', 'pulp', 'godfather', 'dogs', 'matrix', 'breakingbad'];

  it('paints the declared repro garment on all ten films', () => {
    for (const key of FILMS) {
      const theme = themeFor(key);
      const look = parseLook(theme.looks!.repro)!;
      const ground = theme.palette!.bg;
      const svg = portraitSvg('repro', 0, { look, ground, feats: theme.feats?.repro });
      const painted = lift(look.garment, ground, LIFT_TARGETS.garment);
      expect(svg, `${key} repro garment`).toContain(painted);
      expect(svg, `${key} must not paint a rest shirt in the failure rose`).not.toContain('var(--fail)');
    }
  });

  it('is the accent, not the failure rose, when no film is casting', () => {
    expect(portraitSvg('repro', 0)).toContain('var(--color-accent-400)');
    expect(portraitSvg('repro', 0)).not.toContain('var(--fail)');
  });
});
