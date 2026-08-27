import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRoster, type Sidecar, type TeamConfig } from './roster';

const config = JSON.parse(
  readFileSync(new URL('../../fixtures/config-4-members.json', import.meta.url), 'utf8'),
) as TeamConfig;

const metas = JSON.parse(
  readFileSync(new URL('../../fixtures/meta-sidecars.json', import.meta.url), 'utf8'),
) as Sidecar[];

const sidecars = metas.map((meta) => ({
  meta,
  transcriptPath: `/x/subagents/agent-a${meta.name}.jsonl`,
}));

describe('buildRoster', () => {
  it('joins the four config members to their sidecars on name', () => {
    const roster = buildRoster(config, sidecars);
    expect(roster).toHaveLength(4);
    expect(roster.map((a) => a.name)).toEqual([
      'team-lead', 'probe-alpha', 'probe-bravo', 'probe-charlie',
    ]);
    expect(roster[1].transcriptPath).toBe('/x/subagents/agent-aprobe-alpha.jsonl');
    expect(roster[0].transcriptPath).toBeUndefined();
  });

  it('marks only the lead as lead and gives it no colour, model or role', () => {
    const roster = buildRoster(config, sidecars);
    expect(roster[0].isLead).toBe(true);
    expect(roster[0].agentId).toBe('team-lead@session-98b0b4a7');
    expect(roster[0].color).toBeUndefined();
    expect(roster[0].rawModel).toBeUndefined();
    expect(roster[0].role).toBe('');
    expect(roster.filter((a) => a.isLead)).toHaveLength(1);
  });

  it('takes agentType from config, never from the sidecar which repeats the name', () => {
    const roster = buildRoster(config, sidecars);
    expect(metas[0].agentType).toBe('probe-alpha'); // the trap, straight from the fixture
    expect(roster[1].agentType).toBe('general-purpose');
    expect(roster[1].agentType).not.toBe('probe-alpha');
    expect(roster[2].agentType).toBe('Explore');
    expect(roster[3].agentType).toBe('general-purpose');
    expect(roster[0].agentType).toBe('team-lead');
  });

  it('takes the role from the sidecar description', () => {
    const roster = buildRoster(config, sidecars);
    expect(roster[1].role).toBe('Spike probe alpha');
    expect(roster[2].role).toBe('Spike probe bravo');
    expect(roster[3].role).toBe('Spike probe charlie');
  });

  it('falls back to a truncated config prompt when there is no sidecar', () => {
    const roster = buildRoster(config, []);
    expect(roster).toHaveLength(4);
    expect(roster[1].role).toBe(
      'You are a throwaway probe for a 2-minute data-capture spike. Do EXACTLY these st…',
    );
    expect(roster[1].role.includes('\n')).toBe(false);
  });

  it('carries the raw model verbatim, alias and all', () => {
    const roster = buildRoster(config, sidecars);
    expect(roster[1].rawModel).toBe('claude-opus-5');
    expect(roster[3].rawModel).toBe('haiku');
  });

  it('carries colour and joinedAt from config', () => {
    const roster = buildRoster(config, sidecars);
    expect(roster[1].color).toBe('blue');
    expect(roster[2].color).toBe('green');
    expect(roster[3].color).toBe('yellow');
    expect(roster[1].joinedAt).toBe(1787843382976);
  });

  it('works from sidecars alone after the lead exits and the team dir is gone', () => {
    const roster = buildRoster(null, sidecars);
    expect(roster).toHaveLength(3);
    expect(roster.map((a) => a.name)).toEqual(['probe-alpha', 'probe-bravo', 'probe-charlie']);
    expect(roster[0].agentId).toBe('probe-alpha@session-98b0b4a7');
    expect(roster[0].isLead).toBe(false);
    expect(roster[0].role).toBe('Spike probe alpha');
    expect(roster[0].color).toBe('blue');
    expect(roster[0].rawModel).toBe('claude-opus-5');
    // no config means no real subagent type — the sidecar only repeats the name
    expect(roster[0].agentType).toBe('');
  });

  it('appends a sidecar that config has not caught up with yet', () => {
    const extra: Sidecar = {
      agentType: 'probe-delta',
      description: 'Spike probe delta',
      name: 'probe-delta',
      spawnDepth: 0,
      model: 'claude-sonnet-5',
      taskKind: 'in_process_teammate',
      teamName: 'session-98b0b4a7',
      color: 'red',
    };
    const roster = buildRoster(config, [
      ...sidecars,
      { meta: extra, transcriptPath: '/x/subagents/agent-aprobe-delta.jsonl' },
    ]);
    expect(roster).toHaveLength(5);
    expect(roster[4].name).toBe('probe-delta');
    expect(roster[4].agentId).toBe('probe-delta@session-98b0b4a7');
    expect(roster[4].rawModel).toBe('claude-sonnet-5');
    expect(roster[4].joinedAt).toBe(0);
  });
});
