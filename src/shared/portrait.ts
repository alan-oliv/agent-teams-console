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
    '..eeeeeeee..',
    '.eeeeeeeeee.',
    '.ee.eeee.ee.',
  ],
};

/**
 * Shirts and hats follow the theme's accent ramp, and a failed teammate's shirt
 * the failure rose, so a face does not stay Nocturne purple on a clay or cool
 * grey ground. SVG `fill` resolves a custom property against the element's own
 * cascade, so the sprite themes with everything else.
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

export function portraitSvg(portrait: PortraitId, skinIndex: number): string {
  const key = `${portrait}:${skinIndex}`;
  const cached = svgCache.get(key);
  if (cached !== undefined) return cached;

  const skin = SKIN_PAIRS[PORTRAIT_IDS[skinIndex % PORTRAIT_IDS.length]];
  const svg = gridSvg(SPRITES[portrait], 12, PAINT_ORDER, (ch) =>
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
