import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRoster, wallOrder, type Sidecar, type TeamConfig } from './roster';
import type { Agent, AgentStatus } from './domain';

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

function agent(name: string, status: AgentStatus, isLead = false): Agent {
  return {
    name,
    agentId: `${name}@session-98b0b4a7`,
    isLead,
    agentType: 'general-purpose',
    model: 'claude-opus-5',
    role: '',
    status,
    contextTokens: 0,
    contextLimit: 1_000_000,
    compactAt: 967_000,
    costUsd: 0,
    startedAt: 0,
    transcript: [],
    unread: 0,
  };
}

describe('wallOrder', () => {
  it('orders the lead first, then live agents, then departed ones', () => {
    const agents = [
      agent('probe-alpha', 'departed'),
      agent('probe-bravo', 'departed'),
      agent('team-lead', 'working', true),
      agent('probe-charlie', 'idle'),
    ];
    expect(wallOrder(agents).map((a) => a.name)).toEqual([
      'team-lead', 'probe-charlie', 'probe-alpha', 'probe-bravo',
    ]);
  });

  it('keeps join order within each group, so columns do not reshuffle as agents act', () => {
    const agents = [
      agent('probe-bravo', 'departed'),
      agent('probe-alpha', 'working'),
      agent('team-lead', 'working', true),
      agent('probe-charlie', 'working'),
    ];
    expect(wallOrder(agents).map((a) => a.name)).toEqual([
      'team-lead', 'probe-alpha', 'probe-charlie', 'probe-bravo',
    ]);
  });

  it('leaves the roster as-is when there is no lead', () => {
    const agents = [agent('probe-alpha', 'working'), agent('probe-bravo', 'departed')];
    expect(wallOrder(agents).map((a) => a.name)).toEqual(['probe-alpha', 'probe-bravo']);
  });

  // Operator-requested: idle teammates move to the end of the line, past
  // every attention state, but still ahead of departed.
  it('moves idle teammates behind working ones, still ahead of departed', () => {
    const agents = [
      agent('probe-alpha', 'idle'),
      agent('team-lead', 'working', true),
      agent('probe-bravo', 'working'),
      agent('probe-charlie', 'departed'),
    ];
    expect(wallOrder(agents).map((a) => a.name)).toEqual([
      'team-lead', 'probe-bravo', 'probe-alpha', 'probe-charlie',
    ]);
  });

  it('keeps every attention status ahead of idle, not just working', () => {
    const agents = [
      agent('team-lead', 'working', true),
      agent('probe-alpha', 'idle'),
      agent('probe-bravo', 'plan_pending'),
      agent('probe-charlie', 'failed'),
      agent('probe-delta', 'blocked'),
    ];
    expect(wallOrder(agents).map((a) => a.name)).toEqual([
      'team-lead', 'probe-bravo', 'probe-charlie', 'probe-delta', 'probe-alpha',
    ]);
  });

  it('keeps the lead first even when the lead itself is idle', () => {
    const agents = [
      agent('probe-alpha', 'working'),
      agent('team-lead', 'idle', true),
      agent('probe-bravo', 'working'),
    ];
    expect(wallOrder(agents).map((a) => a.name)).toEqual([
      'team-lead', 'probe-alpha', 'probe-bravo',
    ]);
  });

  it('keeps join order stable within the idle group too', () => {
    const agents = [
      agent('team-lead', 'working', true),
      agent('probe-charlie', 'idle'),
      agent('probe-alpha', 'idle'),
      agent('probe-bravo', 'idle'),
    ];
    expect(wallOrder(agents).map((a) => a.name)).toEqual([
      'team-lead', 'probe-charlie', 'probe-alpha', 'probe-bravo',
    ]);
  });

  it('moves an agent back toward the front the instant it picks up work again', () => {
    const idling = [
      agent('team-lead', 'working', true),
      agent('probe-alpha', 'idle'),
      agent('probe-bravo', 'working'),
    ];
    expect(wallOrder(idling).map((a) => a.name)).toEqual([
      'team-lead', 'probe-bravo', 'probe-alpha',
    ]);

    const backToWork = idling.map((a) =>
      a.name === 'probe-alpha' ? { ...a, status: 'working' as const } : a,
    );
    expect(wallOrder(backToWork).map((a) => a.name)).toEqual([
      'team-lead', 'probe-alpha', 'probe-bravo',
    ]);
  });
});
