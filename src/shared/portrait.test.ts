import { describe, expect, it } from 'vitest';
import type { PortraitId } from './domain';
import { PORTRAIT_IDS, portraitFor, portraitSvg, SKIN_PAIRS, SPRITE_COLORS, SPRITES } from './portrait';

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
    expect(SPRITE_COLORS).toEqual({
      a: '#b5abfc', b: '#5d5294', h: '#3f424d', k: '#292b31',
      w: '#e9e9ed', d: '#d99e5c', e: '#c98d8d',
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

  it('bakes the failure rose into the repro shirt', () => {
    expect(SPRITES.repro[9]).toBe('..eeeeeeee..');
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

  it('paints the repro shirt with the failure rose and the security badge with white', () => {
    expect(portraitSvg('repro', 0)).toContain('#c98d8d');
    expect(portraitSvg('security', 0)).toContain('#e9e9ed');
  });

  it('returns identical output for the same (portrait, skinIndex)', () => {
    expect(portraitSvg('architect', 4)).toBe(portraitSvg('architect', 4));
    expect(portraitSvg('architect', 4)).not.toBe(portraitSvg('architect', 3));
  });
});
