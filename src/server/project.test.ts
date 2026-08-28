import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { project } from './project';
import type { StoredEvent, EventKind } from './store';
import type { TeamConfig, Sidecar } from '../shared/roster';
import { parseLine, type TranscriptRecord } from '../shared/transcript';
import { contextOccupancy } from '../shared/usage';
import type { InboxEntry } from '../shared/mailbox';

const FIXTURES = path.resolve(process.cwd(), 'fixtures');
const fx = (name: string) => path.join(FIXTURES, name);
const readJson = <T>(name: string): T => JSON.parse(readFileSync(fx(name), 'utf8')) as T;

const TRANSCRIPTS: Array<[string, string]> = [
  ['probe-alpha', 'transcript-agent-aprobe-alpha-84fd551b27de6433.jsonl'],
  ['probe-bravo', 'transcript-agent-aprobe-bravo-babf58016882bc72.jsonl'],
  ['probe-charlie', 'transcript-agent-aprobe-charlie-12ee4cb1ed35cf7c.jsonl'],
];

function recordsOf(file: string): TranscriptRecord[] {
  return readFileSync(fx(file), 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map(parseLine)
    .filter((r): r is TranscriptRecord => r !== null);
}

function buildLog(configOverride?: TeamConfig | null): StoredEvent[] {
  const config = configOverride !== undefined ? configOverride : readJson<TeamConfig>('config-4-members.json');
  const sidecars = readJson<Sidecar[]>('meta-sidecars.json').map((meta) => ({
    meta,
    transcriptPath: `/projects/slug/subagents/agent-a${meta.name}-0000000000000000.jsonl`,
  }));
  const tasks = readJson<Array<Record<string, unknown>>>('tasks.json');
  const snapshots = readJson<Array<{ path: string; entries: InboxEntry[] }>>('inbox-snapshots.json');

  const events: StoredEvent[] = [];
  let seq = 0;
  const push = (kind: EventKind, payload: unknown, agent?: string) => {
    events.push({ seq: ++seq, ts: 1787843400000 + seq, kind, agent, payload });
  };

  push('roster', { config, sidecars });
  for (const [agent, file] of TRANSCRIPTS) push('transcript', { agent, records: recordsOf(file) }, agent);
  for (const t of tasks) push('task', t);
  for (const s of snapshots) {
    push('mail', { source: 'inbox', to: s.path.replace(/\.json$/, ''), entries: s.entries }, s.path);
  }
  push('substatus', { agent: 'probe-charlie', tokenCount: 23639, contextWindowSize: 200000 }, 'probe-charlie');
  push('statusline', { branch: 'HEAD', fiveHourPct: 41, sevenDayPct: 12, resetsAt: '2026-08-27T20:00:00Z' }, 'team-lead');
  return events;
}

describe('project', () => {
  const state = project(buildLog(), false);
  const byName = Object.fromEntries(state.agents.map((a) => [a.name, a]));

  it('assembles the four-member roster from the real config', () => {
    expect(state.agents).toHaveLength(4);
    expect(state.agents.map((a) => a.name).sort()).toEqual([
      'probe-alpha',
      'probe-bravo',
      'probe-charlie',
      'team-lead',
    ]);
    expect(state.teamName).toBe('session-98b0b4a7');
    expect(state.leadSessionId).toBe('98b0b4a7-3206-455b-aaf6-a5a81ad1e283');
    expect(state.startedAt).toBe(1787798107581);
    expect(byName['team-lead'].isLead).toBe(true);
    expect(byName['probe-alpha'].agentType).toBe('general-purpose');
    expect(byName['probe-bravo'].agentType).toBe('Explore');
    expect(byName['probe-alpha'].color).toBe('blue');
  });

  it('gives each agent the window of its own resolved model', () => {
    expect(byName['probe-alpha'].model).toBe('claude-opus-5');
    expect(byName['probe-alpha'].contextLimit).toBe(1_000_000);
    expect(byName['probe-alpha'].compactAt).toBe(967_000);
    expect(byName['probe-bravo'].contextLimit).toBe(1_000_000);
    expect(byName['probe-charlie'].model).toBe('claude-haiku-4-5');
    expect(byName['probe-charlie'].contextLimit).toBe(200_000);
    expect(byName['probe-charlie'].compactAt).toBe(167_000);
  });

  it('computes non-zero per-agent and total cost', () => {
    expect(byName['probe-charlie'].costUsd).toBeCloseTo(0.044338, 4);
    expect(byName['probe-alpha'].costUsd).toBeGreaterThan(0);
    expect(byName['team-lead'].costUsd).toBe(0);
    expect(state.totalCostUsd).toBeCloseTo(
      byName['probe-alpha'].costUsd + byName['probe-bravo'].costUsd + byName['probe-charlie'].costUsd,
      9,
    );
    expect(state.totalCostUsd).toBeGreaterThan(0);
    expect(state.totalTokens).toBe(734808);
  });

  it('prefers substatus tokenCount and falls back to transcript occupancy', () => {
    expect(byName['probe-charlie'].contextTokens).toBe(23639);
    expect(byName['probe-alpha'].contextTokens).toBe(
      contextOccupancy(recordsOf('transcript-agent-aprobe-alpha-84fd551b27de6433.jsonl')),
    );
  });

  it('caps the in-memory transcript at 2000 lines per agent', () => {
    for (const a of state.agents) expect(a.transcript.length).toBeLessThanOrEqual(2000);
    expect(byName['probe-charlie'].transcript.length).toBeGreaterThan(0);
    expect(byName['team-lead'].transcript).toEqual([]);
  });

  it('folds tasks last-write-wins and derives state', () => {
    expect(state.tasks.map((t) => t.id)).toEqual(['1', '2']);
    const one = state.tasks.find((t) => t.id === '1')!;
    expect(one.state).toBe('completed');
    expect(one.owner).toBe('probe-alpha');
    expect(one.subject).toBe('SPIKE probe A — report your identity');
    expect(state.tasks.find((t) => t.id === '2')!.owner).toBe('probe-bravo');
  });

  it('merges mail by msg_id and counts pending unread per inbox', () => {
    expect(state.mail).toHaveLength(9);
    const claimed = state.mail.find((m) => m.msgId === '4a236089-e8f5-4688-bca2-e47c6f0d8310')!;
    expect(claimed.from).toBe('probe-alpha');
    expect(claimed.to).toBe('team-lead');
    expect(claimed.ts).toBe(1787843417891);
    expect(claimed.tsIsDelivery).toBe(false);
    expect(byName['probe-alpha'].unread).toBe(2);
    expect(byName['probe-bravo'].unread).toBe(1);
    expect(byName['team-lead'].unread).toBe(1);
    expect(byName['probe-charlie'].unread).toBe(0);
  });

  it('carries branch, rate limits and the read-only flag', () => {
    expect(state.branch).toBe('HEAD');
    expect(state.rateLimits).toEqual({
      fiveHourPct: 41,
      sevenDayPct: 12,
      resetsAt: '2026-08-27T20:00:00Z',
    });
    expect(state.readOnly).toBe(false);
    expect(project(buildLog(), true).readOnly).toBe(true);
  });

  it('drops resolved needs-you cards', () => {
    const log = buildLog();
    let seq = log.length;
    log.push({
      seq: ++seq,
      ts: 1787843500000,
      kind: 'needsyou',
      agent: 'probe-alpha',
      payload: { id: 'p1', kind: 'plan', agent: 'probe-alpha', reason: 'plan approval', detail: '4 steps' },
    });
    log.push({
      seq: ++seq,
      ts: 1787843500001,
      kind: 'needsyou',
      agent: 'probe-bravo',
      payload: { id: 'p2', kind: 'permission', agent: 'probe-bravo', reason: 'permission', detail: 'Bash' },
    });
    const withCards = project(log, false);
    expect(withCards.needsYou.map((n) => n.id)).toEqual(['p1', 'p2']);
    expect(withCards.agents.find((a) => a.name === 'probe-alpha')!.status).toBe('plan_pending');

    log.push({ seq: ++seq, ts: 1787843500002, kind: 'needsyou-resolved', payload: { id: 'p1' } });
    expect(project(log, false).needsYou.map((n) => n.id)).toEqual(['p2']);
  });

  it('drops a permission card whose hold has already expired', () => {
    // The permit lives in the previous process's memory, so `allow` 404s and
    // nothing can ever retire the card except its own expiry.
    const log = buildLog();
    let seq = log.length;
    log.push({
      seq: ++seq,
      ts: 1787843500000,
      kind: 'needsyou',
      agent: 'probe-alpha',
      payload: {
        id: 'zombie',
        kind: 'permission',
        agent: 'probe-alpha',
        reason: 'permission',
        detail: 'Bash',
        expiresAt: Date.now() - 1,
      },
    });
    log.push({
      seq: ++seq,
      ts: 1787843500001,
      kind: 'needsyou',
      agent: 'probe-bravo',
      payload: {
        id: 'live',
        kind: 'permission',
        agent: 'probe-bravo',
        reason: 'permission',
        detail: 'Bash',
        expiresAt: Date.now() + 540_000,
      },
    });
    expect(project(log, false).needsYou.map((n) => n.id)).toEqual(['live']);
  });

  it('deduplicates transcript records re-read by the reconciliation sweep', () => {
    const log = buildLog();
    const dup = log.find((e) => e.kind === 'transcript' && e.agent === 'probe-charlie')!;
    const once = project(log, false).agents.find((a) => a.name === 'probe-charlie')!;
    log.push({ ...dup, seq: log.length + 1 });
    const twice = project(log, false).agents.find((a) => a.name === 'probe-charlie')!;
    expect(twice.transcript.length).toBe(once.transcript.length);
    expect(twice.costUsd).toBeCloseTo(once.costUsd, 9);
  });
});

describe('departed status', () => {
  it('marks an agent missing from config.members as departed but keeps its cost in the total', () => {
    const config = readJson<TeamConfig>('config-4-members.json');
    const withoutCharlie: TeamConfig = {
      ...config,
      members: config.members.filter((m) => m.name !== 'probe-charlie'),
    };
    const state = project(buildLog(withoutCharlie), false);
    const byName = Object.fromEntries(state.agents.map((a) => [a.name, a]));

    expect(byName['probe-charlie'].status).toBe('departed');
    expect(byName['probe-alpha'].status).not.toBe('departed');
    expect(byName['probe-charlie'].costUsd).toBeGreaterThan(0);
    // The departed agent keeps its final transcript/model, and its spend still
    // counts toward the team total.
    expect(byName['probe-charlie'].transcript.length).toBeGreaterThan(0);
    expect(byName['probe-charlie'].model).toBe('claude-haiku-4-5');
    expect(state.totalCostUsd).toBeCloseTo(
      byName['probe-alpha'].costUsd + byName['probe-bravo'].costUsd + byName['probe-charlie'].costUsd,
      9,
    );
  });

  it('marks every agent departed when config is null — lead exited, team dir gone', () => {
    const state = project(buildLog(null), false);
    expect(state.agents.length).toBeGreaterThan(0);
    expect(state.agents.every((a) => a.status === 'departed')).toBe(true);
  });
});
