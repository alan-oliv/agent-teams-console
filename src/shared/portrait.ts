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

export const SPRITE_COLORS: Record<string, string> = {
  a: '#b5abfc', b: '#5d5294', h: '#3f424d', k: '#292b31',
  w: '#e9e9ed', d: '#d99e5c', e: '#c98d8d',
};

export const SKIN_PAIRS: Record<PortraitId, [string, string]> = {
  lead: ['#e0c3a8', '#b99a80'],
  security: ['#8d6a52', '#6f5240'],
  perf: ['#c9a88f', '#a3846e'],
  tests: ['#e6cdb4', '#c2a68c'],
  architect: ['#a87c5e', '#86603f'],
  repro: ['#d9b89c', '#b2937a'],
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

const svgCache = new Map<string, string>();

export function portraitSvg(portrait: PortraitId, skinIndex: number): string {
  const key = `${portrait}:${skinIndex}`;
  const cached = svgCache.get(key);
  if (cached !== undefined) return cached;

  const skin = SKIN_PAIRS[PORTRAIT_IDS[skinIndex % PORTRAIT_IDS.length]];
  const grid = SPRITES[portrait];
  const paths: string[] = [];

  for (const ch of PAINT_ORDER) {
    const fill = ch === 's' ? skin[0] : ch === 'S' ? skin[1] : SPRITE_COLORS[ch];
    let d = '';
    for (let y = 0; y < grid.length; y++) {
      const row = grid[y];
      for (let x = 0; x < row.length; x++) {
        if (row[x] === ch) d += `M${x} ${y}h1v1h-1z`;
      }
    }
    if (d) paths.push(`<path fill="${fill}" d="${d}"/>`);
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" shape-rendering="crispEdges">${paths.join('')}</svg>`;
  svgCache.set(key, svg);
  return svg;
}
