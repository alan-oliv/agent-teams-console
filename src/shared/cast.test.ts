import { describe, expect, it } from 'vitest';
import { MOVIE_THEMES, buildCast, themeFor, type CastAgent } from './cast';

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

  it('resolves an unset or unknown key to the off theme', () => {
    expect(themeFor(null).key).toBe('off');
    expect(themeFor('a film nobody made').key).toBe('off');
    expect(themeFor('inception').film).toBe('Inception');
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
    // 'ed' has no slot and 'fi' finds tests already taken by 'cy'; both fall to spare.
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
