import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { project, PROJECTED_TRANSCRIPT_LINES } from './project';
import type { StoredEvent, EventKind } from './store';
import type { TeamConfig, Sidecar } from '../shared/roster';
import { parseLine, TRANSCRIPT_TEXT_CAP, type TranscriptRecord } from '../shared/transcript';
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
    // Throughput, not cumulative cache reads: summing cache_read counts the
    // whole re-read prefix once per message, which reached 1.8B in the wild.
    expect(state.totalTokens).toBe(118353);
  });

  it('prefers substatus tokenCount and falls back to transcript occupancy', () => {
    expect(byName['probe-charlie'].contextTokens).toBe(23639);
    expect(byName['probe-alpha'].contextTokens).toBe(
      contextOccupancy(recordsOf('transcript-agent-aprobe-alpha-84fd551b27de6433.jsonl')),
    );
  });

  it('caps the projected transcript at 60 lines per agent', () => {
    for (const a of state.agents) expect(a.transcript.length).toBeLessThanOrEqual(PROJECTED_TRANSCRIPT_LINES);
    expect(byName['probe-charlie'].transcript.length).toBeGreaterThan(0);
    expect(byName['team-lead'].transcript).toEqual([]);
  });

  it('projects only the last 60 of 500 transcript lines, in order', () => {
    const config: TeamConfig = {
      name: 'session-solo',
      createdAt: 0,
      leadAgentId: 'lead-1',
      leadSessionId: 'lead-1',
      members: [{ agentId: 'lead-1', name: 'solo', joinedAt: 0, tmuxPaneId: '', subscriptions: [] }],
    };
    const records: TranscriptRecord[] = Array.from({ length: 500 }, (_, i) => ({
      type: 'assistant',
      uuid: `line-${i + 1}`,
      timestamp: new Date(1787843400000 + i).toISOString(),
      message: { content: [{ type: 'text', text: `line ${i + 1}` }] },
    }));
    const log: StoredEvent[] = [
      { seq: 1, ts: 0, kind: 'roster', payload: { config, sidecars: [] } },
      { seq: 2, ts: 0, kind: 'transcript', agent: 'solo', payload: { agent: 'solo', records } },
    ];
    const solo = project(log, false).agents.find((a) => a.name === 'solo')!;
    expect(solo.transcript).toHaveLength(PROJECTED_TRANSCRIPT_LINES);
    expect(solo.transcript.map((l) => l.text)).toEqual(
      Array.from({ length: PROJECTED_TRANSCRIPT_LINES }, (_, i) => `line ${441 + i}`),
    );
  });

  // Regression guard for the 60x-oversized SSE frame: measured live, 11 agents
  // (one carrying ~1000 transcript lines) serialised to 1683 KB, ~103% of it
  // transcript JSON, to draw at most 18 lines on screen. If the projected cap
  // is ever "optimised" back up, this is what catches it.
  it('serialises a realistic multi-agent frame under 200 KB', () => {
    const config: TeamConfig = {
      name: 'session-load',
      createdAt: 0,
      leadAgentId: 'agent-0',
      leadSessionId: 'agent-0',
      members: Array.from({ length: 11 }, (_, i) => ({
        agentId: `agent-${i}`,
        name: `agent-${i}`,
        joinedAt: 0,
        tmuxPaneId: '',
        subscriptions: [],
      })),
    };
    const log: StoredEvent[] = [{ seq: 1, ts: 0, kind: 'roster', payload: { config, sidecars: [] } }];
    let seq = 1;
    for (let i = 0; i < 11; i++) {
      // Mirrors the live measurement: one agent alone carried ~1000 lines.
      const lineCount = i === 0 ? 1000 : 200;
      const records: TranscriptRecord[] = Array.from({ length: lineCount }, (_, j) => ({
        type: 'assistant',
        uuid: `agent-${i}-line-${j}`,
        timestamp: new Date(1787843400000 + j).toISOString(),
        message: {
          content: [
            { type: 'text', text: `Ran the check for step ${j} and confirmed the output matches expectations.` },
          ],
        },
      }));
      log.push({ seq: ++seq, ts: 0, kind: 'transcript', agent: `agent-${i}`, payload: { agent: `agent-${i}`, records } });
    }
    const bytes = Buffer.byteLength(JSON.stringify(project(log, false)));
    expect(bytes).toBeLessThan(200 * 1024);
  });

  const oversized = (uuid: string, chars: number): TranscriptRecord => ({
    type: 'user',
    uuid,
    timestamp: '2026-08-27T15:20:00.000Z',
    message: { role: 'user', content: [{ type: 'tool_result', content: 'x'.repeat(chars) }] },
  });

  it('caps every projected transcript line at TRANSCRIPT_TEXT_CAP', () => {
    const log = buildLog();
    log.push({
      seq: log.length + 1,
      ts: 1787843500000,
      kind: 'transcript',
      agent: 'probe-alpha',
      payload: { agent: 'probe-alpha', records: [oversized('oversized-1', 30_000)] },
    });
    const projected = project(log, false);
    expect(projected.agents.find((a) => a.name === 'probe-alpha')!.transcript.length).toBeGreaterThan(0);
    for (const a of projected.agents) {
      for (const l of a.transcript) expect(l.text.length).toBeLessThanOrEqual(TRANSCRIPT_TEXT_CAP);
    }
  });

  it('keeps full history in the store and truncates only the projection', () => {
    const config: TeamConfig = {
      name: 'session-solo',
      createdAt: 0,
      leadAgentId: 'lead-1',
      leadSessionId: 'lead-1',
      members: [{ agentId: 'lead-1', name: 'solo', joinedAt: 0, tmuxPaneId: '', subscriptions: [] }],
    };
    const records = [oversized('oversized-1', 30_000)];
    const log: StoredEvent[] = [
      { seq: 1, ts: 0, kind: 'roster', payload: { config, sidecars: [] } },
      { seq: 2, ts: 0, kind: 'transcript', agent: 'solo', payload: { agent: 'solo', records } },
    ];
    const line = project(log, false).agents[0].transcript[0];
    expect(line.text).toHaveLength(TRANSCRIPT_TEXT_CAP);

    const stored = (log[1].payload as { records: TranscriptRecord[] }).records[0];
    const block = (stored.message!.content as Array<{ content: string }>)[0];
    expect(block.content).toHaveLength(30_000);
  });

  // The 200 KB guard above uses one 74-char synthetic line per record, so it
  // cannot see D1: the frame is dominated by the few very long lines, not by
  // the many average ones. Measured over real transcripts: p50 163 chars,
  // p90 1789, p99 9401, max 21071. Uncapped, this same frame is ~950 KB.
  it('keeps a frame of realistic line lengths under 400 KB', () => {
    const LENGTHS = [163, 163, 163, 163, 163, 400, 400, 900, 1789, 9401];
    const config: TeamConfig = {
      name: 'session-load',
      createdAt: 0,
      leadAgentId: 'agent-0',
      leadSessionId: 'agent-0',
      members: Array.from({ length: 11 }, (_, i) => ({
        agentId: `agent-${i}`,
        name: `agent-${i}`,
        joinedAt: 0,
        tmuxPaneId: '',
        subscriptions: [],
      })),
    };
    const log: StoredEvent[] = [{ seq: 1, ts: 0, kind: 'roster', payload: { config, sidecars: [] } }];
    let seq = 1;
    for (let i = 0; i < 11; i++) {
      const lineCount = i === 0 ? 1000 : 200;
      const records: TranscriptRecord[] = Array.from({ length: lineCount }, (_, j) =>
        // one worst-case line, at the very end of agent-0 so it survives the 60-line cap
        i === 0 && j === lineCount - 1
          ? oversized(`agent-0-outlier`, 21_071)
          : oversized(`agent-${i}-line-${j}`, LENGTHS[j % LENGTHS.length]),
      );
      log.push({ seq: ++seq, ts: 0, kind: 'transcript', agent: `agent-${i}`, payload: { agent: `agent-${i}`, records } });
    }
    const projected = project(log, false);
    for (const a of projected.agents) {
      for (const l of a.transcript) expect(l.text.length).toBeLessThanOrEqual(TRANSCRIPT_TEXT_CAP);
    }
    expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThan(400 * 1024);
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
