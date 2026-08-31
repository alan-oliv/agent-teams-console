import { describe, expect, it } from 'vitest';
import { FEAT_IDS, MOVIE_THEMES, buildCast, themeFor, type CastAgent } from './cast';

const lead = (name: string): CastAgent => ({ name, agentType: 'team-lead', isLead: true });
const mate = (name: string, agentType: string): CastAgent => ({ name, agentType, isLead: false });

const crew: CastAgent[] = [
  lead('ada'),
  mate('bo', 'security-reviewer'),
  mate('cy', 'test-runner'),
  mate('di', 'architect'),
];

describe('the theme database', () => {
  it('carries the ten films plus the off entry, each film with a lead and a team', () => {
    expect(MOVIE_THEMES).toHaveLength(11);
    expect(MOVIE_THEMES[0].key).toBe('off');
    for (const theme of MOVIE_THEMES.slice(1)) {
      expect(theme.roles.lead, theme.key).toBeTruthy();
      expect(theme.team, theme.key).toBeTruthy();
    }
  });

  it('keeps every spare out of the role cast, so a spare claims no role', () => {
    // Decision 20: an overflow agent is one whose role the console could not
    // read, so the character it takes must not be one that names a role.
    for (const theme of MOVIE_THEMES) {
      const roles = new Set(Object.values(theme.roles));
      expect(theme.spare.filter((name) => roles.has(name)), theme.key).toEqual([]);
    }
  });

  it('resolves an unset or unknown key to the off theme', () => {
    expect(themeFor(null).key).toBe('off');
    expect(themeFor('a film nobody made').key).toBe('off');
    expect(themeFor('inception').film).toBe('Inception');
  });
});

// v3 adds three keys per film. Nothing consumes them yet — the palette engine,
// the picker and the portraits land separately — so these tests are about the
// data being present and the shape those consumers will read it through.
describe('the v3 film data', () => {
  const inception = themeFor('inception');
  const films = MOVIE_THEMES.filter((theme) => theme.key !== 'off');
  const HEX = /^#[0-9a-f]{6}$/;

  it('carries Inception the grade its palette declares', () => {
    expect(inception.palette).toMatchObject({
      label: 'steel & kick',
      neutralsFrom: 'nocturne',
      term: '#101419',
      bg: '#161c25',
      text: '#e6e9ee',
      warn: '#f0a08c',
      fail: '#b86a6a',
    });
  });

  it('carries one accent ramp per film, base and name included', () => {
    expect(inception.palette?.accent).toMatchObject({
      base: '#c9924f',
      name: 'kick amber',
      500: '#c9924f',
    });
  });

  it('carries a look per role slot as five pipe-joined hex, without the hash', () => {
    // The database stores them bare; whatever paints them prepends the `#`.
    expect(inception.looks?.lead).toBe('e0c3a8|b99a80|6b7f9e|3d4a63|31241b');
    for (const [slot, look] of Object.entries(inception.looks ?? {})) {
      expect(look.split('|'), `inception.${slot}`).toHaveLength(5);
    }
  });

  it('carries accessories per role slot, in the order they are drawn', () => {
    expect(inception.feats).toEqual({ perf: ['specs'], architect: ['longhair'] });
  });

  it('declares warn and fail per palette rather than deriving them from the accent', () => {
    // noSemanticRecolour, and the rev 4b fix: the three gold films drew warn in
    // amber beside a gold accent, so all three shifted to a rose-orange.
    for (const key of ['inception', 'lotr', 'godfather']) {
      const palette = themeFor(key).palette;
      expect(palette?.warn, key).toBe('#f0a08c');
      expect(palette?.warn, key).not.toBe(palette?.accent.base);
      expect(palette?.fail, key).not.toBe(palette?.accent.base);
    }
  });

  it('inherits its neutral ramp from one of the two base themes that have one', () => {
    for (const film of films) {
      expect(['nocturne', 'slate'], film.key).toContain(film.palette?.neutralsFrom);
    }
  });

  it('gives every film all three keys, and every palette colour as a hex', () => {
    for (const film of films) {
      expect(film.palette, film.key).toBeDefined();
      expect(film.looks, film.key).toBeDefined();
      expect(film.feats, film.key).toBeDefined();
      const p = film.palette!;
      for (const value of [p.term, p.bg, p.text, p.warn, p.warnEdge, p.warnTint, p.fail]) {
        expect(value, film.key).toMatch(HEX);
      }
      for (const step of [300, 400, 500, 600, 700, 900] as const) {
        expect(p.accent[step], `${film.key} accent-${step}`).toMatch(HEX);
      }
      expect(p.accent.base, film.key).toMatch(HEX);
    }
  });

  it('draws every accessory from the published vocabulary', () => {
    for (const film of films) {
      for (const [slot, feats] of Object.entries(film.feats ?? {})) {
        for (const feat of feats) {
          expect(FEAT_IDS, `${film.key}.${slot}`).toContain(feat);
        }
      }
    }
  });

  // The off entry is the absence of a theme, and it has none of the three. Every
  // consumer has to survive that, so it is asserted here rather than assumed.
  it('leaves the off entry without a palette, looks or accessories', () => {
    const off = themeFor(null);
    expect(off.palette).toBeUndefined();
    expect(off.looks).toBeUndefined();
    expect(off.feats).toBeUndefined();
    expect(buildCast(crew, null).asChar('ada')).toEqual({ display: 'ada', real: 'ada' });
  });
});

describe('casting', () => {
  it('casts by role slot, so the agent names it is given never change the characters', () => {
    const one = buildCast(crew, 'inception');
    const other = buildCast(
      [lead('zoe'), mate('yan', 'security-reviewer'), mate('xu', 'test-runner'), mate('wes', 'architect')],
      'inception',
    );
    expect(crew.map((a) => one.asChar(a.name).display)).toEqual(['Cobb', 'Arthur', 'Eames', 'Ariadne']);
    expect(other.asChar('zoe').display).toBe('Cobb');
    expect(other.asChar('yan').display).toBe('Arthur');
    expect(other.asChar('xu').display).toBe('Eames');
    expect(other.asChar('wes').display).toBe('Ariadne');
  });

  it('gives a role the same character whatever order the roster arrives in', () => {
    const reversed = buildCast([...crew].reverse(), 'inception');
    for (const agent of crew) {
      expect(reversed.asChar(agent.name).display).toBe(buildCast(crew, 'inception').asChar(agent.name).display);
    }
  });

  it('keeps the real name beside the character', () => {
    expect(buildCast(crew, 'lotr').asChar('bo')).toEqual({ display: 'Aragorn', real: 'bo' });
  });

  it('draws from spare, in roster order, for agents beyond the mapped roles', () => {
    const many = [...crew, mate('ed', 'general-purpose'), mate('fi', 'test-runner')];
    const cast = buildCast(many, 'inception');
    // 'ed' has no slot and 'fi' finds tests already taken by 'cy'; both fall to
    // spare — NOT to inception's still-vacant perf and repro seats. Decision 20:
    // a vacant role slot stays vacant, because handing one to an agent whose role
    // the console could not read would name a role it has no evidence for.
    expect(cast.asChar('cy').display).toBe('Eames');
    expect(cast.asChar('ed').display).toBe('Saito');
    expect(cast.asChar('fi').display).toBe('Mal');
  });

  it('leaves the extras under their real names once the spares run out', () => {
    const spares = themeFor('dogs').spare.length;
    const many = [...crew, ...Array.from({ length: spares + 2 }, (_, i) => mate(`gp${i}`, 'general-purpose'))];
    const cast = buildCast(many, 'dogs');
    expect(cast.asChar(`gp${spares - 1}`).display).toBe(themeFor('dogs').spare[spares - 1]);
    expect(cast.asChar(`gp${spares}`).display).toBe(`gp${spares}`);
    expect(cast.asChar(`gp${spares + 1}`).display).toBe(`gp${spares + 1}`);
  });

  it('keeps the real name of an agent it was not built with', () => {
    // Task owners and mailbox runs name agents that left the roster.
    expect(buildCast(crew, 'inception').asChar('someone-else')).toEqual({
      display: 'someone-else',
      real: 'someone-else',
    });
  });

  it('is the identity mapping with no theme set', () => {
    for (const key of [null, 'off', 'nonesuch']) {
      const cast = buildCast(crew, key);
      for (const agent of crew) {
        expect(cast.asChar(agent.name)).toEqual({ display: agent.name, real: agent.name });
      }
      expect(cast.theme.team).toBe('');
    }
  });

  it('reads the slot off the agent name when the type does not name one', () => {
    const cast = buildCast([lead('ada'), mate('security', ''), mate('repro', '')], 'inception');
    expect(cast.asChar('security').display).toBe('Arthur');
    expect(cast.asChar('repro').display).toBe('Fischer');
  });
});

// The looks follow the ROLE SLOT the cast assigned, not the portrait the sprite
// hashed: an agent that took a spare is one whose role the console could not
// read, so it keeps the default role portrait rather than wearing a character's
// clothes (lookFollowsRoleSlot, and decision 20's premise).
describe('the slot behind a character', () => {
  it('records the slot it cast each agent into', () => {
    const cast = buildCast(crew, 'inception');
    expect(cast.slotOf('ada')).toBe('lead');
    expect(cast.slotOf('bo')).toBe('security');
    expect(cast.slotOf('cy')).toBe('tests');
    expect(cast.slotOf('di')).toBe('architect');
  });

  it('gives no slot to an agent that took a spare', () => {
    const cast = buildCast([...crew, mate('ed', 'general-purpose')], 'inception');
    expect(cast.asChar('ed').display).toBe('Saito');
    expect(cast.slotOf('ed')).toBeNull();
  });

  it('gives no slot to a second agent whose slot was already taken', () => {
    const cast = buildCast([...crew, mate('fi', 'test-runner')], 'inception');
    expect(cast.slotOf('cy')).toBe('tests');
    expect(cast.slotOf('fi')).toBeNull();
  });

  it('gives no slot to an agent it was never built with, or with no theme', () => {
    expect(buildCast(crew, 'inception').slotOf('someone-else')).toBeNull();
    expect(buildCast(crew, null).slotOf('ada')).toBeNull();
  });
});
