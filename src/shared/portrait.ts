import type { FeatId } from './cast';
import type { PortraitId } from './domain';

// Lifted verbatim from "Octo Session Console.dc.html" lines 1237-1333.
export const SPRITES: Record<PortraitId, string[]> = {
  lead: [
    '...a.aa.a...',
    '...aaaaaa...',
    '..hhhhhhhh..',
    '..hssssssh..',
    '..hskssksh..',
    '..hssssssh..',
    '...sskkss...',
    '...SssssS...',
    '....SSSS....',
    '..aaaaaaaa..',
    '.aaaaaaaaaa.',
    '.aa.aaaa.aa.',
  ],
  security: [
    '............',
    '..bbbbbbbb..',
    '.bbbbbbbbbb.',
    '..bssssssb..',
    '..bskssksb..',
    '..bssssssb..',
    '...sskkss...',
    '...SssssS...',
    '....SSSS....',
    '..aaaaaaaa..',
    '.aaawaaaaaa.',
    '.aa.aaaa.aa.',
  ],
  perf: [
    '...aaaaaa...',
    '..ahhhhhha..',
    '..ahhhhhha..',
    '..assssssa..',
    '..askssksa..',
    '..hssssssh..',
    '...sskkss...',
    '...SssssS...',
    '....SSSS....',
    '..aaaaaaaa..',
    '.aaaaaaaaaa.',
    '.aa.aaaa.aa.',
  ],
  tests: [
    '............',
    '...aaaaaa...',
    '.aaaaaaaaaa.',
    '..hssssssh..',
    '..hskssksh..',
    '..hssssssh..',
    '...sskkss...',
    '...SssssS...',
    '....SSSS....',
    '..aaaaaaaa..',
    '.aaaaaaaaaa.',
    '.aa.aaaa.aa.',
  ],
  architect: [
    '............',
    '...bbbbbb...',
    '.bbbbbbbbbb.',
    '..hssssssh..',
    '..akkakkas..',
    '..hssssssh..',
    '...sskkss...',
    '...SssssS...',
    '....SSSS....',
    '..aaaaaaaa..',
    '.aaaaaaaaaa.',
    '.aa.aaaa.aa.',
  ],
  repro: [
    '..h..h..h...',
    '..hhhhhhhh..',
    '.hhhhhhhhhh.',
    '..hssssssh..',
    '..hskssksh..',
    '..hssssssh..',
    '...skkkks...',
    '...SssssS...',
    '....SSSS....',
    '..aaaaaaaa..',
    '.aaaaaaaaaa.',
    '.aa.aaaa.aa.',
  ],
};

/**
 * Shirts and hats follow the theme's accent ramp, so a face does not stay
 * Nocturne purple on a clay or cool grey ground. SVG `fill` resolves a custom
 * property against the element's own cascade, so the sprite themes with
 * everything else.
 *
 * `d` and `e` are the semantic pair and no sprite paints its REST state in
 * either (decision 29): a status colour that is always on cannot signal status,
 * and repro used to wear the failure rose at rest — so a repro agent that had
 * actually failed looked exactly like one that had not.
 *
 * The structural greys (`h` hats and hair, `k` outlines) stay literal on
 * purpose: they are the artwork's internal contrast, and running them through
 * the ramp would put a pale hat on a pale ground on the light themes.
 */
export const SPRITE_COLORS: Record<string, string> = {
  a: 'var(--color-accent-400)', b: 'var(--color-accent-700)',
  h: '#3f424d', k: '#292b31',
  w: '#e9e9ed', d: 'var(--warn)', e: 'var(--fail)',
};

export const SKIN_PAIRS: Record<PortraitId, [string, string]> = {
  lead: ['#e0c3a8', '#b99a80'],
  security: ['#8d6a52', '#6f5240'],
  perf: ['#c9a88f', '#a3846e'],
  tests: ['#e6cdb4', '#c2a68c'],
  architect: ['#a87c5e', '#86603f'],
  repro: ['#d9b89c', '#b2937a'],
};

/**
 * The "left session" screen's sprite: an unwatched terminal, lit prompt, dim
 * output lines, on a stand. No prototype grid to lift here — the mock fakes it
 * with a role sprite as a placeholder — so this one is drawn from scratch, at
 * the same 2px-per-cell scale as the role portraits above.
 */
export const TERMINAL_SPRITE: string[] = [
  '........................',
  '..ffffffffffffffffffff..',
  '..fttttttttttttttttttf..',
  '..fttoooooooooooootttf..',
  '..fttttttttttttttttttf..',
  '..fttoooooooottttttttf..',
  '..fttttttttttttttttttf..',
  '..fttoooooooooooottttf..',
  '..fttttttttttttttttttf..',
  '..fttppppptttttttttttf..',
  '..fttttttttttttttttttf..',
  '..ffffffffffffffffffff..',
  '........................',
  '...........ff...........',
  '...........ff...........',
  '.........ffffff.........',
  '........ffffffff........',
];

const TERMINAL_SPRITE_COLORS: Record<string, string> = {
  f: 'var(--color-neutral-700)', // case and stand
  t: 'var(--color-neutral-900)', // screen ground
  o: 'var(--color-neutral-600)', // dim output lines
  p: 'var(--color-accent-400)', // the lit prompt
};

export const PORTRAIT_IDS: PortraitId[] = ['lead', 'security', 'perf', 'tests', 'architect', 'repro'];

// The crown is the lead's identity marker; the hash fallback must never assign it to a teammate.
const NON_LEAD_PORTRAIT_IDS: PortraitId[] = PORTRAIT_IDS.slice(1);

const TYPE_PORTRAITS: Array<[RegExp, PortraitId]> = [
  [/security|review/, 'security'],
  [/perf/, 'perf'],
  [/test/, 'tests'],
  [/architect|plan/, 'architect'],
  [/repro|debug/, 'repro'],
];

const PAINT_ORDER = ['a', 'b', 'h', 'k', 'w', 'd', 'e', 's', 'S'];

function hashName(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function portraitFor(agent: { name: string; agentType: string; isLead: boolean }): {
  portrait: PortraitId;
  skinIndex: number;
} {
  const hash = hashName(agent.name);
  const skinIndex = hash % PORTRAIT_IDS.length;
  if (agent.isLead) return { portrait: 'lead', skinIndex };
  const type = agent.agentType.toLowerCase();
  const name = agent.name.toLowerCase();
  for (const [pattern, portrait] of TYPE_PORTRAITS) {
    if (pattern.test(type)) return { portrait, skinIndex };
  }
  for (const [pattern, portrait] of TYPE_PORTRAITS) {
    if (pattern.test(name)) return { portrait, skinIndex };
  }
  return { portrait: NON_LEAD_PORTRAIT_IDS[hash % NON_LEAD_PORTRAIT_IDS.length], skinIndex };
}

/** One `<path>` per colour in `order`, a unit square per matching cell. */
function gridSvg(grid: string[], width: number, order: string[], colorOf: (ch: string) => string): string {
  const paths: string[] = [];
  for (const ch of order) {
    const fill = colorOf(ch);
    let d = '';
    for (let y = 0; y < grid.length; y++) {
      const row = grid[y];
      for (let x = 0; x < row.length; x++) {
        if (row[x] === ch) d += `M${x} ${y}h1v1h-1z`;
      }
    }
    if (d) paths.push(`<path fill="${fill}" d="${d}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${grid.length}" shape-rendering="crispEdges">${paths.join('')}</svg>`;
}

const svgCache = new Map<string, string>();

export function portraitSvg(
  portrait: PortraitId,
  skinIndex: number,
  film?: FilmPaint,
): string {
  const key = film
    ? [
        portrait, skinIndex, film.ground,
        film.look.skin, film.look.skinShade, film.look.garment,
        film.look.garmentShade, film.look.hair,
        (film.feats ?? []).join('+'),
      ].join(':')
    : `${portrait}:${skinIndex}`;
  const cached = svgCache.get(key);
  if (cached !== undefined) return cached;

  const skin = SKIN_PAIRS[PORTRAIT_IDS[skinIndex % PORTRAIT_IDS.length]];
  const svg = film
    ? gridSvg(applyFeats(SPRITES[portrait], film.feats ?? []), 12, PAINT_ORDER, (ch) => {
        const own = LOOK_GLYPHS[ch];
        // Everything structural still lifts — an outline that vanishes takes the
        // silhouette's edge with it — but only the five look slots are recoloured.
        if (own) return lift(film.look[own], film.ground, LIFT_TARGETS[LIFT_ROLES[ch]]);
        if (ch === 'k') return lift(SPRITE_COLORS.k, film.ground, LIFT_TARGETS.outline);
        return SPRITE_COLORS[ch];
      })
    : gridSvg(SPRITES[portrait], 12, PAINT_ORDER, (ch) =>
        ch === 's' ? skin[0] : ch === 'S' ? skin[1] : SPRITE_COLORS[ch],
      );
  svgCache.set(key, svg);
  return svg;
}

// Fixed grid, fixed palette — computed once rather than cached per call.
export const TERMINAL_SPRITE_SVG = gridSvg(
  TERMINAL_SPRITE,
  24,
  ['f', 't', 'o', 'p'],
  (ch) => TERMINAL_SPRITE_COLORS[ch],
);

/** A film's five colours for one role slot, in the order the database lists them. */
export interface Look {
  skin: string;
  skinShade: string;
  garment: string;
  garmentShade: string;
  hair: string;
}

const BARE_HEX = /^[0-9a-f]{6}$/;

/**
 * `movie-themes.json` stores a look as five pipe-joined hex WITHOUT the leading
 * `#`. A look this cannot read comes back null rather than half-parsed: a
 * character painted from three of five colours is worse than the default one.
 */
export function parseLook(raw: string | null | undefined): Look | null {
  if (!raw) return null;
  const parts = raw.split('|');
  if (parts.length !== 5 || !parts.every((part) => BARE_HEX.test(part))) return null;
  const [skin, skinShade, garment, garmentShade, hair] = parts.map((part) => `#${part}`);
  return { skin, skinShade, garment, garmentShade, hair };
}

/**
 * Accessory art, on the same 12x12 grid as the silhouettes: row index to row
 * string, where `.` keeps whatever is underneath. Every glyph is a look slot,
 * so an accessory is always painted in the character's own colours and never
 * carries one of its own.
 *
 * `bald` has no art — it is the one subtractive feature, clearing hair to skin
 * so a hat listed after it lands on the scalp.
 */
export const FEAT_SPRITES: Record<Exclude<FeatId, 'bald'>, Record<number, string>> = {
  shades: { 4: '..bbbbbbbb..' },
  specs: { 4: '..aaa..aaa..' },
  visor: { 3: '.bbbbbbbbbb.', 4: '.bbbbbbbbbb.' },
  fedora: { 0: '....aaaa....', 1: '....bbbb....', 2: '.aaaaaaaaaa.' },
  pointyhat: { 0: '.....aa.....', 1: '....aaaa....', 2: '.aaaaaaaaaa.' },
  wildhair: { 0: '..h..h..h...', 1: '..hhhhhhhh..', 2: '.hhhhhhhhhh.' },
  goatee: { 7: '....hhhh....', 8: '.....hh.....' },
  beard: { 6: '..hh....hh..', 7: '..hhhhhhhh..', 8: '....hhhh....' },
  longhair: {
    2: '.hhhhhhhhhh.',
    3: '.h........h.', 4: '.h........h.', 5: '.h........h.',
    6: '.h........h.', 7: '.h........h.', 8: '.h........h.',
  },
};

/** Drawn in the order the film lists them, so a later feature wins shared pixels. */
export function applyFeats(grid: readonly string[], feats: readonly FeatId[]): string[] {
  let out = [...grid];
  for (const feat of feats) {
    if (feat === 'bald') {
      out = out.map((row) => row.replace(/h/g, 's'));
      continue;
    }
    const rows = FEAT_SPRITES[feat as Exclude<FeatId, 'bald'>];
    if (!rows) continue;
    out = out.map((row, y) => {
      const patch = rows[y];
      if (!patch) return row;
      return [...row].map((ch, x) => (patch[x] === '.' ? ch : patch[x])).join('');
    });
  }
  return out;
}

/**
 * How hard each kind of pixel is pushed away from the ground. The garment is
 * lifted hardest because it carries the shape — a black-clad character on a
 * near-black film ground is a floating face, which is the recorded bug.
 *
 * There is no separate `lens` target: accessory lenses are drawn in the garment
 * shade, so they lift with it. That is the stricter of the two a lens could
 * have taken, which is the safe direction — a black lens on a black ground is a
 * hole rather than a pair of sunglasses.
 */
export const LIFT_TARGETS = {
  garment: 2.2,
  garmentShade: 1.9,
  hair: 1.7,
  outline: 1.5,
  skin: 1.4,
} as const;

/** The five sprite glyphs a film look recolours, and the slot each one takes. */
const LOOK_GLYPHS: Record<string, keyof Look> = {
  s: 'skin', S: 'skinShade', a: 'garment', b: 'garmentShade', h: 'hair',
};

/** Every glyph that lifts, including the outline, which no look recolours. */
const LIFT_ROLES: Record<string, keyof typeof LIFT_TARGETS> = {
  s: 'skin', S: 'skin', a: 'garment', b: 'garmentShade', h: 'hair', k: 'outline',
};

/** What a portrait needs to wear a film: the colours, the extras, the ground. */
export interface FilmPaint {
  look: Look;
  /** The active palette's ground, which everything is lifted against. */
  ground: string;
  feats?: readonly FeatId[];
}

const srgb = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

function luminanceOf(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * srgb((n >> 16) & 255) + 0.7152 * srgb((n >> 8) & 255) + 0.0722 * srgb(n & 255);
}

function contrastOf(a: string, b: string): number {
  const [hi, lo] = [luminanceOf(a), luminanceOf(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function toHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6
    : max === g ? ((b - r) / d + 2) / 6
    : ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function toHex([h, s, l]: [number, number, number]): string {
  const channel = (t: number) => {
    if (s === 0) return l;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const byte = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v * 255))).toString(16).padStart(2, '0');
  return `#${byte(channel(h + 1 / 3))}${byte(channel(h))}${byte(channel(h - 1 / 3))}`;
}

/**
 * Move `hex` along lightness alone — hue and saturation fixed — until it clears
 * `target` contrast against `ground`, away from the ground so this lifts on a
 * dark one and darkens on a light one. A colour that already reads is returned
 * untouched: the look data keeps the film's real colours wherever it can.
 */
export function lift(hex: string, ground: string, target: number): string {
  if (contrastOf(hex, ground) >= target) return hex;
  const [h, s, start] = toHsl(hex);
  const away = luminanceOf(ground) < 0.5 ? 1 : 0;
  const limit = toHex([h, s, away]);
  if (contrastOf(limit, ground) < target) return limit; // as far as this hue goes
  let lo = start;
  let hi = away;
  let best = limit;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const candidate = toHex([h, s, mid]);
    if (contrastOf(candidate, ground) >= target) {
      best = candidate;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return best;
}
