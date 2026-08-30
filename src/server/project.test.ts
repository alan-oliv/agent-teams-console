import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  project,
  transcriptHistory,
  transcriptLineText,
  PROJECTED_TRANSCRIPT_LINES,
  type TaskPayload,
} from './project';
import { TRANSCRIPT_RECORDS_PER_AGENT, type StoredEvent, type EventKind } from './store';
import type { TeamConfig, Sidecar } from '../shared/roster';
import { parseLine, TRANSCRIPT_TEXT_CAP, type TranscriptRecord } from '../shared/transcript';
import { contextOccupancy, dedupeUsage, totalCost, tokensOf, usageRecordsOf } from '../shared/usage';
import type { InboxEntry } from '../shared/mailbox';
import { AGENT_STALE_MS } from '../shared/status';

// Counts every real derivation the fold performs, so the tests below can assert
// how much work project() does — not just what it returns. The wrappers delegate,
// so every other test in this file sees the unmodified behaviour.
const derivations = vi.hoisted(() => ({ lines: 0, tools: 0 }));
vi.mock('../shared/transcript', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/transcript')>();
  return {
    ...actual,
    toTranscriptLines: (rec: TranscriptRecord, agent?: string) => {
      derivations.lines++;
      return actual.toTranscriptLines(rec, agent);
    },
    currentToolOf: (rec: TranscriptRecord) => {
      derivations.tools++;
      return actual.currentToolOf(rec);
    },
  };
});

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

  // `parseLine` keeps non-object records out of the store, so this only happens
  // to a hand-edited or corrupted log — but the log is a plain text file an
  // operator can open, and one bad row must cost one row. project() throwing
  // takes every later publish with it: flush() swallows it and the SSE simply
  // stops sending frames, so the console freezes with nothing on screen.
  it('skips a non-object transcript record and keeps folding the rest', () => {
    const config: TeamConfig = {
      name: 'session-corrupt',
      createdAt: 0,
      leadAgentId: 'lead-1',
      leadSessionId: 'lead-1',
      members: [
        { agentId: 'lead-1', name: 'solo', joinedAt: 0, tmuxPaneId: '', subscriptions: [] },
        { agentId: 'lead-2', name: 'other', joinedAt: 0, tmuxPaneId: '', subscriptions: [] },
      ],
    };
    const speech = (uuid: string, text: string): TranscriptRecord => ({
      type: 'assistant',
      uuid,
      timestamp: '2026-08-27T15:20:00.000Z',
      message: { content: [{ type: 'text', text }] },
    });
    const corrupt = [
      speech('solo-1', 'solo one'),
      'a-string',
      42,
      true,
      speech('solo-2', 'solo two'),
    ] as unknown as TranscriptRecord[];
    const log: StoredEvent[] = [
      { seq: 1, ts: 0, kind: 'roster', payload: { config, sidecars: [] } },
      { seq: 2, ts: 0, kind: 'transcript', agent: 'solo', payload: { agent: 'solo', records: corrupt } },
      {
        seq: 3,
        ts: 0,
        kind: 'transcript',
        agent: 'other',
        payload: { agent: 'other', records: [speech('other-1', 'other one')] },
      },
    ];

    const projected = project(log, false);
    const named = Object.fromEntries(projected.agents.map((a) => [a.name, a]));
    expect(named['solo'].transcript.map((l) => l.text)).toEqual(['solo one', 'solo two']);
    expect(named['other'].transcript.map((l) => l.text)).toEqual(['other one']);
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

  const soloConfig = (name: string): TeamConfig => ({
    name,
    createdAt: 0,
    leadAgentId: 'lead-1',
    leadSessionId: 'lead-1',
    members: [{ agentId: 'lead-1', name: 'solo', joinedAt: 0, tmuxPaneId: '', subscriptions: [] }],
  });

  const soloLog = (records: TranscriptRecord[]): StoredEvent[] => [
    { seq: 1, ts: 0, kind: 'roster', payload: { config: soloConfig('session-solo'), sidecars: [] } },
    { seq: 2, ts: 0, kind: 'transcript', agent: 'solo', payload: { agent: 'solo', records } },
  ];

  // Every record is unique to this call, so the memo inside project() is cold
  // for them and the counters below measure a first derivation, not a cache hit.
  const freshRecords = (tag: string, count: number): TranscriptRecord[] =>
    Array.from({ length: count }, (_, i) => ({
      type: 'assistant',
      uuid: `${tag}-${i}`,
      timestamp: new Date(1787843400000 + i).toISOString(),
      message:
        i % 3 === 0
          ? { content: [{ type: 'tool_use', name: 'Bash', input: { command: `echo ${i}` } }] }
          : { content: [{ type: 'text', text: `line ${i}` }] },
    }));

  it('derives only the lines it projects, not one per stored record', () => {
    const records = freshRecords('window', 2000);
    derivations.lines = 0;
    const solo = project(soloLog(records), false).agents.find((a) => a.name === 'solo')!;

    expect(solo.transcript).toHaveLength(PROJECTED_TRANSCRIPT_LINES);
    expect(solo.transcript.at(-1)!.id).toBe('window-1999#0');
    expect(derivations.lines).toBeGreaterThan(0);
    expect(derivations.lines).toBeLessThanOrEqual(PROJECTED_TRANSCRIPT_LINES + 1);
  });

  it('re-derives nothing on the next publish of the same records', () => {
    const log = soloLog(freshRecords('memo', 2000));
    project(log, false);
    derivations.lines = 0;
    derivations.tools = 0;
    const again = project(log, false).agents.find((a) => a.name === 'solo')!;

    expect(derivations.lines).toBe(0);
    expect(derivations.tools).toBe(0);
    expect(again.transcript).toHaveLength(PROJECTED_TRANSCRIPT_LINES);
    expect(again.currentTool).toBe('Bash(echo 1998)');
  });

  const editRecord = (uuid: string): TranscriptRecord => ({
    type: 'assistant',
    uuid,
    timestamp: '2026-08-27T15:09:55.618Z',
    message: {
      content: [
        { type: 'tool_use', name: 'Edit', input: { file_path: '/a.ts', old_string: 'a', new_string: 'b' } },
      ],
    },
  });

  const twoMemberConfig: TeamConfig = {
    name: 'session-two',
    createdAt: 0,
    leadAgentId: 'lead-1',
    leadSessionId: 'lead-1',
    members: [
      { agentId: 'lead-1', name: 'first', joinedAt: 0, tmuxPaneId: '', subscriptions: [] },
      { agentId: 'lead-2', name: 'second', joinedAt: 0, tmuxPaneId: '', subscriptions: [] },
    ],
  };

  it("fills Diff.agent from the agent whose transcript the line came from, not left blank", () => {
    const solo = project(soloLog([editRecord('edit-1')]), false).agents.find((a) => a.name === 'solo')!;
    expect(solo.transcript[0].diff?.agent).toBe('solo');
  });

  // The memo is keyed on (record, agent), not on the record alone, precisely so
  // this can never happen — even if the SAME record object were ever read for
  // two agents, each would still get its own name on the diff rather than
  // whichever agent happened to derive it first.
  it('keeps two agents apart even when the same record object is read for both', () => {
    const record = editRecord('shared');
    const log: StoredEvent[] = [
      { seq: 1, ts: 0, kind: 'roster', payload: { config: twoMemberConfig, sidecars: [] } },
      { seq: 2, ts: 0, kind: 'transcript', agent: 'first', payload: { agent: 'first', records: [record] } },
      { seq: 3, ts: 0, kind: 'transcript', agent: 'second', payload: { agent: 'second', records: [record] } },
    ];
    const agents = project(log, false).agents;
    expect(agents.find((a) => a.name === 'first')!.transcript[0].diff?.agent).toBe('first');
    expect(agents.find((a) => a.name === 'second')!.transcript[0].diff?.agent).toBe('second');
  });

  it('caches per (record, agent): a repeat publish is free, a new agent on the same record is not', () => {
    const record = editRecord('shared-2');
    const log: StoredEvent[] = [
      { seq: 1, ts: 0, kind: 'roster', payload: { config: twoMemberConfig, sidecars: [] } },
      { seq: 2, ts: 0, kind: 'transcript', agent: 'first', payload: { agent: 'first', records: [record] } },
    ];
    derivations.lines = 0;
    project(log, false);
    expect(derivations.lines).toBe(1);

    project(log, false); // same (record, agent) pair — the 53ms-of-56ms property
    expect(derivations.lines).toBe(1);

    log.push({ seq: 3, ts: 0, kind: 'transcript', agent: 'second', payload: { agent: 'second', records: [record] } });
    project(log, false); // same record, a genuinely new agent — one more derivation, not zero
    expect(derivations.lines).toBe(2);
  });

  it('projects the last 60 lines of a single record that yields more', () => {
    const record: TranscriptRecord = {
      type: 'assistant',
      uuid: 'fat',
      timestamp: '2026-08-27T15:20:00.000Z',
      message: {
        content: Array.from({ length: 200 }, (_, i) => ({ type: 'text', text: `block ${i}` })),
      },
    };
    const solo = project(soloLog([record]), false).agents.find((a) => a.name === 'solo')!;

    expect(solo.transcript).toHaveLength(PROJECTED_TRANSCRIPT_LINES);
    expect(solo.transcript.map((l) => l.text)).toEqual(
      Array.from({ length: PROJECTED_TRANSCRIPT_LINES }, (_, i) => `block ${140 + i}`),
    );
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

  it('marks a still-listed member departed once it goes silent well past any turn with no idle frame', () => {
    const config: TeamConfig = {
      name: 'session-stale',
      createdAt: 0,
      leadAgentId: 'lead',
      leadSessionId: 'lead',
      members: [
        { agentId: 'lead', name: 'lead', joinedAt: 0, tmuxPaneId: '', subscriptions: [] },
        { agentId: 'straggler', name: 'straggler', joinedAt: 0, tmuxPaneId: '', subscriptions: [] },
      ],
    };
    const recordAt = (agent: string, ts: number): TranscriptRecord => ({
      type: 'assistant',
      uuid: `${agent}-1`,
      timestamp: new Date(ts).toISOString(),
      message: { content: [{ type: 'text', text: 'hi' }] },
    });
    const base = 1787843400000;
    // The lead's activity stands in for the team's pulse: it lands well after
    // the straggler's only record, past the point silence stops being a turn.
    const log: StoredEvent[] = [
      { seq: 1, ts: 0, kind: 'roster', payload: { config, sidecars: [] } },
      {
        seq: 2,
        ts: 0,
        kind: 'transcript',
        agent: 'lead',
        payload: { agent: 'lead', records: [recordAt('lead', base + AGENT_STALE_MS + 60_000)] },
      },
      {
        seq: 3,
        ts: 0,
        kind: 'transcript',
        agent: 'straggler',
        payload: { agent: 'straggler', records: [recordAt('straggler', base)] },
      },
    ];

    const byName = Object.fromEntries(project(log, false).agents.map((a) => [a.name, a]));
    expect(byName['straggler'].status).toBe('departed');
    expect(byName['lead'].status).not.toBe('departed');
  });
});

// ---------------------------------------------------------------------------
// The store now bounds transcript history per agent by RECORD count, so the
// fold can no longer see every record an agent ever wrote. Cost and tokens ride
// along on the payload as a cumulative snapshot; a from-byte-0 re-read says so
// rather than colliding with what the log already holds.
// ---------------------------------------------------------------------------
describe('bounded transcript history', () => {
  const rosterFor = (names: string[]): StoredEvent => ({
    seq: 1,
    ts: 0,
    kind: 'roster',
    payload: {
      config: {
        name: 'session-bounded',
        createdAt: 0,
        leadAgentId: names[0],
        leadSessionId: names[0],
        members: names.map((n) => ({
          agentId: n,
          name: n,
          joinedAt: 0,
          tmuxPaneId: '',
          subscriptions: [],
        })),
      },
      sidecars: [],
    },
  });

  const assistant = (agent: string, i: number): TranscriptRecord => ({
    type: 'assistant',
    uuid: `${agent}-a${i}`,
    timestamp: new Date(1787843400000 + i * 1000).toISOString(),
    message: {
      id: `msg_${agent}_${i}`,
      model: 'claude-sonnet-4-5-20250929',
      role: 'assistant',
      usage: {
        input_tokens: 4,
        output_tokens: 100 + (i % 37),
        cache_read_input_tokens: 20000 + i,
        cache_creation_input_tokens: 500,
      },
      content: [{ type: 'text', text: `assistant turn ${i}` }],
    },
  });

  const toolResult = (agent: string, i: number): TranscriptRecord => ({
    type: 'user',
    uuid: `${agent}-u${i}`,
    timestamp: new Date(1787843400000 + i * 1000 + 500).toISOString(),
    toolUseResult: { ok: true },
    message: {
      role: 'user',
      content: [{ type: 'tool_result', content: `result of step ${i}`, is_error: false }],
    },
  });

  const historyOf = (agent: string, count: number): TranscriptRecord[] =>
    Array.from({ length: count }, (_, i) => (i % 2 === 0 ? assistant(agent, i) : toolResult(agent, i)));

  it('takes cost and tokens from a totals snapshot instead of walking the records', () => {
    const records = historyOf('solo', 6);
    const walked = project(
      [rosterFor(['solo']), { seq: 2, ts: 0, kind: 'transcript', agent: 'solo', payload: { agent: 'solo', records } }],
      false,
    );
    expect(walked.agents[0].costUsd).toBeGreaterThan(0);

    const snapshot = project(
      [
        rosterFor(['solo']),
        {
          seq: 2,
          ts: 0,
          kind: 'transcript',
          agent: 'solo',
          payload: { agent: 'solo', records, totals: { costUsd: 12.5, tokens: 777 } },
        },
      ],
      false,
    );
    // The snapshot covers records the store has already dropped, so it REPLACES
    // the walk rather than being reconciled against it.
    expect(snapshot.agents[0].costUsd).toBe(12.5);
    expect(snapshot.totalCostUsd).toBe(12.5);
    expect(snapshot.totalTokens).toBe(777);
    expect(snapshot.agents[0].costUsd).not.toBeCloseTo(walked.agents[0].costUsd, 6);
    expect(snapshot.totalTokens).not.toBe(walked.totalTokens);
  });

  // The anti-double-count property. A snapshot is cumulative and total, so two
  // of them for one agent can never be summed across an eviction boundary — the
  // measured failure of the "aggregate the dropped prefix, add the live tail"
  // shape was +37.7% on a real fixture, because a duplicate message-id group
  // straddled the cut.
  it('lets the later totals snapshot replace the earlier one, never add to it', () => {
    const records = historyOf('solo', 4);
    const state = project(
      [
        rosterFor(['solo']),
        {
          seq: 2,
          ts: 0,
          kind: 'transcript',
          agent: 'solo',
          payload: { agent: 'solo', records: records.slice(0, 2), totals: { costUsd: 1.25, tokens: 100 } },
        },
        {
          seq: 3,
          ts: 0,
          kind: 'transcript',
          agent: 'solo',
          payload: { agent: 'solo', records: records.slice(2), totals: { costUsd: 3, tokens: 260 } },
        },
      ],
      false,
    );
    expect(state.agents[0].costUsd).toBe(3);
    expect(state.totalTokens).toBe(260);
  });

  it('still computes cost from the records when no snapshot rides along', () => {
    const records = historyOf('solo', 6);
    const state = project(
      [rosterFor(['solo']), { seq: 2, ts: 0, kind: 'transcript', agent: 'solo', payload: { agent: 'solo', records } }],
      false,
    );
    expect(state.agents[0].costUsd).toBeGreaterThan(0);
    expect(state.totalTokens).toBeGreaterThan(0);
  });

  // A per-agent record bound makes this routine: boot 1 leaves the newest 200
  // records in the log, boot 2 re-reads the whole 400-record file. The uuid
  // dedupe keeps the FIRST copy it sees, so without the marker the fold's list
  // is [201..400, 1..200] and the console shows a transcript 200 records in the
  // past with a stale context number.
  it('rebuilds an agent from the file when a batch says it starts at byte 0', () => {
    const records = historyOf('probe', 400);
    const chunk = (recs: TranscriptRecord[], from: number, seq0: number, fromStart: boolean): StoredEvent[] => {
      const out: StoredEvent[] = [];
      for (let i = 0; i < recs.length; i += 100) {
        out.push({
          seq: seq0 + i,
          ts: 0,
          kind: 'transcript',
          agent: 'probe',
          payload: {
            agent: 'probe',
            records: recs.slice(i, i + 100),
            ...(fromStart && i === 0 ? { fromStart: true } : {}),
          },
        });
      }
      return out;
    };
    const truth = project(
      [rosterFor(['probe']), { seq: 2, ts: 0, kind: 'transcript', agent: 'probe', payload: { agent: 'probe', records } }],
      false,
    ).agents[0];

    const trimmed = chunk(records.slice(200), 200, 1000, false);
    const stale = project([rosterFor(['probe']), ...trimmed, ...chunk(records, 0, 2000, false)], false).agents[0];
    const rebuilt = project([rosterFor(['probe']), ...trimmed, ...chunk(records, 0, 2000, true)], false).agents[0];

    expect(stale.transcript.at(-1)!.text).toBe('result of step 199');
    expect(stale.contextTokens).not.toBe(truth.contextTokens);
    expect(rebuilt.transcript.at(-1)!.text).toBe('result of step 399');
    expect(rebuilt.transcript).toEqual(truth.transcript);
    expect(rebuilt.contextTokens).toBe(truth.contextTokens);
  });

  // If the marker cleared the record list but not the uuid set, every record of
  // the re-read would be deduped away against a list that was just emptied.
  it('clears the agent uuid set too, so the re-read is admitted', () => {
    const records = historyOf('probe', 8);
    const state = project(
      [
        rosterFor(['probe']),
        { seq: 2, ts: 0, kind: 'transcript', agent: 'probe', payload: { agent: 'probe', records } },
        {
          seq: 3,
          ts: 0,
          kind: 'transcript',
          agent: 'probe',
          payload: { agent: 'probe', records, fromStart: true },
        },
      ],
      false,
    );
    const once = project(
      [rosterFor(['probe']), { seq: 2, ts: 0, kind: 'transcript', agent: 'probe', payload: { agent: 'probe', records } }],
      false,
    ).agents[0];
    expect(state.agents[0].transcript).toEqual(once.transcript);
    expect(state.agents[0].transcript.length).toBeGreaterThan(0);
    expect(state.agents[0].contextTokens).toBe(once.contextTokens);
  });

  // A log written before snapshots existed carries none, so the fold can only
  // report the spend of the records the bound still holds. That window is the
  // boot itself — the sweep re-reads every transcript and the first drain writes
  // a snapshot — but it is real, so both halves are pinned here.
  it('under-reports a snapshot-less bounded log only until the next drain', () => {
    const records = historyOf('solo', 400);
    const truth = project(
      [rosterFor(['solo']), { seq: 2, ts: 0, kind: 'transcript', agent: 'solo', payload: { agent: 'solo', records } }],
      false,
    );

    const bounded: StoredEvent[] = [
      rosterFor(['solo']),
      { seq: 2, ts: 0, kind: 'transcript', agent: 'solo', payload: { agent: 'solo', records: records.slice(-100) } },
    ];
    const stale = project(bounded, false);
    expect(stale.totalCostUsd).toBeLessThan(truth.totalCostUsd);

    const usage = dedupeUsage(usageRecordsOf(records));
    bounded.push({
      seq: 3,
      ts: 0,
      kind: 'transcript',
      agent: 'solo',
      payload: {
        agent: 'solo',
        records,
        fromStart: true,
        totals: { costUsd: totalCost(usage), tokens: tokensOf(usage) },
      },
    });
    const healed = project(bounded, false);
    expect(healed.totalCostUsd).toBeCloseTo(truth.totalCostUsd, 9);
    expect(healed.totalTokens).toBe(truth.totalTokens);
  });

  // The headline: an 11-agent team whose history has been bounded to the newest
  // TRANSCRIPT_RECORDS_PER_AGENT projects the same money, the same lines and the
  // same context as the unbounded fold. The three fixture transcripts are 21-27
  // records, far too small to reach the cap on their own.
  it('projects the same cost, lines and context from a log bounded at the cap', () => {
    const names = Array.from({ length: 11 }, (_, i) => `agent-${i}`);
    const roster = rosterFor(names);
    const perAgent = new Map(names.map((n) => [n, historyOf(n, 2000)]));

    const unbounded: StoredEvent[] = [roster];
    let seq = 1;
    for (const [agent, records] of perAgent) {
      unbounded.push({ seq: ++seq, ts: 0, kind: 'transcript', agent, payload: { agent, records } });
    }

    const bounded: StoredEvent[] = [roster];
    for (const [agent, records] of perAgent) {
      const usage = dedupeUsage(usageRecordsOf(records));
      const totals = { costUsd: totalCost(usage), tokens: tokensOf(usage) };
      const kept = records.slice(-TRANSCRIPT_RECORDS_PER_AGENT);
      for (let i = 0; i < kept.length; i += 200) {
        const last = i + 200 >= kept.length;
        bounded.push({
          seq: ++seq,
          ts: 0,
          kind: 'transcript',
          agent,
          payload: { agent, records: kept.slice(i, i + 200), ...(last ? { totals } : {}) },
        });
      }
    }

    const truth = project(unbounded, false);
    const capped = project(bounded, false);
    expect(capped.totalCostUsd).toBeCloseTo(truth.totalCostUsd, 9);
    expect(capped.totalTokens).toBe(truth.totalTokens);
    for (let i = 0; i < truth.agents.length; i++) {
      expect(capped.agents[i].costUsd).toBeCloseTo(truth.agents[i].costUsd, 9);
      expect(capped.agents[i].transcript).toEqual(truth.agents[i].transcript);
      expect(capped.agents[i].contextTokens).toBe(truth.agents[i].contextTokens);
      expect(capped.agents[i].currentTool).toBe(truth.agents[i].currentTool);
      expect(capped.agents[i].status).toBe(truth.agents[i].status);
    }
  });
});

// ---------------------------------------------------------------------------
// deriveTaskState only sees the blockedBy list it's handed, so this is the
// call site that resolves it against the full task map — a completed
// dependency must actually stop blocking its dependent, and an owner who is
// actively working must never show as blocked, in the task list or the roster.
// ---------------------------------------------------------------------------
describe('task blocking', () => {
  const configWith = (names: string[]): TeamConfig => ({
    name: 'session-blocking',
    createdAt: 0,
    leadAgentId: names[0],
    leadSessionId: names[0],
    members: names.map((n) => ({ agentId: n, name: n, joinedAt: 0, tmuxPaneId: '', subscriptions: [] })),
  });

  const activity = (agent: string): TranscriptRecord => ({
    type: 'assistant',
    uuid: `${agent}-1`,
    timestamp: '2026-08-27T15:20:00.000Z',
    message: { content: [{ type: 'text', text: 'working' }] },
  });

  const taskEvent = (seq: number, task: Partial<TaskPayload> & { id: string }): StoredEvent => ({
    seq,
    ts: 0,
    kind: 'task',
    payload: { subject: 's', description: 'd', blocks: [], blockedBy: [], status: 'pending', ...task },
  });

  it('stops blocking a dependent once its dependency completes', () => {
    const log: StoredEvent[] = [
      { seq: 1, ts: 0, kind: 'roster', payload: { config: configWith(['worker']), sidecars: [] } },
      taskEvent(2, { id: '1', status: 'completed' }),
      taskEvent(3, { id: '2', owner: 'worker', blockedBy: ['1'] }),
    ];
    expect(project(log, false).tasks.find((t) => t.id === '2')!.state).toBe('pending');
  });

  it("exposes only the still-open blockers on the task, matching the tool's own contract", () => {
    const log: StoredEvent[] = [
      { seq: 1, ts: 0, kind: 'roster', payload: { config: configWith(['worker']), sidecars: [] } },
      taskEvent(2, { id: '1', status: 'completed' }),
      taskEvent(3, { id: '2' }),
      taskEvent(4, { id: '3', owner: 'worker', blockedBy: ['1', '2'] }),
    ];
    expect(project(log, false).tasks.find((t) => t.id === '3')!.blockedBy).toEqual(['2']);
  });

  it('still blocks a dependent whose dependency is still open', () => {
    const log: StoredEvent[] = [
      { seq: 1, ts: 0, kind: 'roster', payload: { config: configWith(['worker']), sidecars: [] } },
      taskEvent(2, { id: '1' }),
      taskEvent(3, { id: '2', owner: 'worker', blockedBy: ['1'] }),
    ];
    expect(project(log, false).tasks.find((t) => t.id === '2')!.state).toBe('blocked');
  });

  it('stays blocked while only some of its dependencies have completed', () => {
    const log: StoredEvent[] = [
      { seq: 1, ts: 0, kind: 'roster', payload: { config: configWith(['worker']), sidecars: [] } },
      taskEvent(2, { id: '1', status: 'completed' }),
      taskEvent(3, { id: '2' }),
      taskEvent(4, { id: '3', owner: 'worker', blockedBy: ['1', '2'] }),
    ];
    expect(project(log, false).tasks.find((t) => t.id === '3')!.state).toBe('blocked');
  });

  it('never shows an in_progress task as blocked, even with a stale blockedBy', () => {
    // The live repro: #4 depends on #2, #2 is completed, #4 is in_progress.
    const completedDep: StoredEvent[] = [
      { seq: 1, ts: 0, kind: 'roster', payload: { config: configWith(['worker']), sidecars: [] } },
      taskEvent(2, { id: '1', status: 'completed' }),
      taskEvent(3, { id: '2', owner: 'worker', status: 'in_progress', blockedBy: ['1'] }),
    ];
    expect(project(completedDep, false).tasks.find((t) => t.id === '2')!.state).toBe('in_progress');

    // Someone started the task despite a dependency that is still open.
    const openDep: StoredEvent[] = [
      { seq: 1, ts: 0, kind: 'roster', payload: { config: configWith(['worker']), sidecars: [] } },
      taskEvent(2, { id: '1' }),
      taskEvent(3, { id: '2', owner: 'worker', status: 'in_progress', blockedBy: ['1'] }),
    ];
    expect(project(openDep, false).tasks.find((t) => t.id === '2')!.state).toBe('in_progress');
  });

  it('keeps an actively-working owner off the blocked roster, even when they also own a blocked task', () => {
    const log: StoredEvent[] = [
      { seq: 1, ts: 0, kind: 'roster', payload: { config: configWith(['worker']), sidecars: [] } },
      { seq: 2, ts: 0, kind: 'transcript', agent: 'worker', payload: { agent: 'worker', records: [activity('worker')] } },
      taskEvent(3, { id: '1' }),
      // The task the owner is actually working right now.
      taskEvent(4, { id: '2', owner: 'worker', status: 'in_progress' }),
      // Also owned, but not started and genuinely blocked.
      taskEvent(5, { id: '3', owner: 'worker', blockedBy: ['1'] }),
    ];
    const state = project(log, false);
    expect(state.tasks.find((t) => t.id === '3')!.state).toBe('blocked');
    expect(state.agents.find((a) => a.name === 'worker')!.status).toBe('working');
  });

  it('still shows a genuinely stuck owner as blocked when nothing they own is in progress', () => {
    const log: StoredEvent[] = [
      { seq: 1, ts: 0, kind: 'roster', payload: { config: configWith(['worker']), sidecars: [] } },
      { seq: 2, ts: 0, kind: 'transcript', agent: 'worker', payload: { agent: 'worker', records: [activity('worker')] } },
      taskEvent(3, { id: '1' }),
      taskEvent(4, { id: '2', owner: 'worker', blockedBy: ['1'] }),
    ];
    const state = project(log, false);
    expect(state.tasks.find((t) => t.id === '2')!.state).toBe('blocked');
    expect(state.agents.find((a) => a.name === 'worker')!.status).toBe('blocked');
  });
});

// metadata is set at task creation by convention, not a schema the store
// enforces — most tasks won't carry it, so the passthrough must not choke on
// its absence.
describe('task metadata', () => {
  const configWith = (names: string[]): TeamConfig => ({
    name: 'session-metadata',
    createdAt: 0,
    leadAgentId: names[0],
    leadSessionId: names[0],
    members: names.map((n) => ({ agentId: n, name: n, joinedAt: 0, tmuxPaneId: '', subscriptions: [] })),
  });

  const taskEvent = (seq: number, task: Partial<TaskPayload> & { id: string }): StoredEvent => ({
    seq,
    ts: 0,
    kind: 'task',
    payload: { subject: 's', description: 'd', blocks: [], blockedBy: [], status: 'pending', ...task },
  });

  it('passes metadata through unchanged', () => {
    const log: StoredEvent[] = [
      { seq: 1, ts: 0, kind: 'roster', payload: { config: configWith(['worker']), sidecars: [] } },
      taskEvent(2, {
        id: '1',
        metadata: { complexity: 'judgment', model: 'opus', effort: 'high', why: 'defines the shape' },
      }),
    ];
    expect(project(log, false).tasks.find((t) => t.id === '1')!.metadata).toEqual({
      complexity: 'judgment',
      model: 'opus',
      effort: 'high',
      why: 'defines the shape',
    });
  });

  it('leaves metadata undefined on a task that never set it', () => {
    const log: StoredEvent[] = [
      { seq: 1, ts: 0, kind: 'roster', payload: { config: configWith(['worker']), sidecars: [] } },
      taskEvent(2, { id: '1' }),
    ];
    expect(project(log, false).tasks.find((t) => t.id === '1')!.metadata).toBeUndefined();
  });
});

describe('transcriptHistory', () => {
  const recs = (from: number, to: number): TranscriptRecord[] =>
    Array.from({ length: to - from }, (_, i) => ({
      type: 'assistant' as const,
      uuid: `line-${from + i}`,
      timestamp: new Date(1787843400000 + from + i).toISOString(),
      message: { content: [{ type: 'text', text: `line ${from + i}` }] },
    }));

  const log = (records: TranscriptRecord[], agent = 'solo'): StoredEvent[] => [
    { seq: 1, ts: 0, kind: 'transcript', agent, payload: { agent, records } },
  ];

  // The whole point: the live frame is capped so it stays small, and this is
  // how the operator reaches what the cap left out.
  it('returns far more than a projected frame carries', () => {
    const events = log(recs(1, 500));
    const history = transcriptHistory(events, 'solo');
    expect(history.length).toBeGreaterThan(PROJECTED_TRANSCRIPT_LINES);
    expect(history).toHaveLength(499);
    expect(history[0].text).toBe('line 1');
    expect(history[history.length - 1].text).toBe('line 499');
  });

  it('returns nothing for an agent with no transcript', () => {
    expect(transcriptHistory(log(recs(1, 5)), 'nobody')).toEqual([]);
  });

  it('keeps one agent history out of another', () => {
    const events = [...log(recs(1, 4), 'alpha'), ...log(recs(90, 93), 'bravo')];
    expect(transcriptHistory(events, 'alpha').map((l) => l.text)).toEqual([
      'line 1', 'line 2', 'line 3',
    ]);
    expect(transcriptHistory(events, 'bravo').map((l) => l.text)).toEqual([
      'line 90', 'line 91', 'line 92',
    ]);
  });

  it('dedupes records the reconciliation sweep sent twice', () => {
    const events = [...log(recs(1, 4)), ...log(recs(1, 4))];
    expect(transcriptHistory(events, 'solo')).toHaveLength(3);
  });

  // A re-read from byte zero replaces what came before rather than doubling it.
  it('restarts the history on a fromStart re-read', () => {
    const events: StoredEvent[] = [
      ...log(recs(1, 4)),
      {
        seq: 2, ts: 0, kind: 'transcript', agent: 'solo',
        payload: { agent: 'solo', fromStart: true, records: recs(50, 52) },
      },
    ];
    expect(transcriptHistory(events, 'solo').map((l) => l.text)).toEqual(['line 50', 'line 51']);
  });
});

describe('transcriptLineText', () => {
  // Three times the cap, so a capped row and the real text cannot be confused.
  const long = 'x'.repeat(TRANSCRIPT_TEXT_CAP * 3);
  const record = (uuid: string, ...texts: string[]): TranscriptRecord => ({
    type: 'assistant',
    uuid,
    timestamp: new Date(1787843400000).toISOString(),
    message: { content: texts.map((text) => ({ type: 'text', text })) },
  });
  const log = (records: TranscriptRecord[], agent = 'solo'): StoredEvent[] => [
    { seq: 1, ts: 0, kind: 'transcript', agent, payload: { agent, records } },
  ];

  it('returns the text the projected line was cut from', () => {
    const events = log([record('u1', long)]);
    const line = transcriptHistory(events, 'solo')[0];
    expect(line.text).toHaveLength(TRANSCRIPT_TEXT_CAP);
    expect(line.text.endsWith('…')).toBe(true);
    expect(transcriptLineText(events, 'solo', line.id)).toBe(long);
  });

  it('addresses the right block of a record that projects several lines', () => {
    const events = log([record('u1', 'first', 'second', 'third')]);
    const lines = transcriptHistory(events, 'solo');
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => transcriptLineText(events, 'solo', l.id))).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('keeps one agent out of another', () => {
    const events = [...log([record('u1', long)], 'alpha'), ...log([record('u2', 'b')], 'bravo')];
    const alpha = transcriptHistory(events, 'alpha')[0];
    expect(transcriptLineText(events, 'alpha', alpha.id)).toBe(long);
    expect(transcriptLineText(events, 'bravo', alpha.id)).toBeUndefined();
  });

  it('declines an id that names nothing it still holds', () => {
    const events = log([record('u1', long)]);
    expect(transcriptLineText(events, 'solo', 'gone#0')).toBeUndefined();
    expect(transcriptLineText(events, 'solo', 'u1#9')).toBeUndefined();
    expect(transcriptLineText(events, 'nobody', 'u1#0')).toBeUndefined();
  });

  it('declines a malformed id rather than guessing', () => {
    const events = log([record('u1', long)]);
    for (const id of ['', 'u1', '#0', 'u1#', 'u1#-1', 'u1#x']) {
      expect(transcriptLineText(events, 'solo', id)).toBeUndefined();
    }
  });
});
